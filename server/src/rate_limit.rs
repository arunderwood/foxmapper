//! Per-IP append rate limiting. Anti-flood only, not anti-abuse.
//!
//! This exists to stop a script, not to pace a person. **A rate limit that fires during a real
//! hunt is a bug** — it would put the network in the write path, which Principle III forbids, and
//! the client's queue would silently back up in the field. The ceiling below is set orders of
//! magnitude above what a hunt of thirty people reporting hard can produce.
//!
//! Per-IP is the only handle we have: there are no accounts, so there is nothing else to key on.
//! It is trivially defeated by anyone who cares, and that is accepted.
//!
//! There is deliberately no limit on reads or the stream — thirty devices catching up at once is
//! normal, not an attack.

use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// A token bucket per IP. A hunter entering a report every ten seconds for an hour uses 360.
const CAPACITY: f64 = 600.0;
const REFILL_PER_SECOND: f64 = 5.0;

struct Bucket {
    tokens: f64,
    last: Instant,
}

pub struct RateLimiter {
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
    capacity: f64,
    refill_per_second: f64,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new(CAPACITY, REFILL_PER_SECOND)
    }
}

impl RateLimiter {
    #[must_use]
    pub fn new(capacity: f64, refill_per_second: f64) -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            capacity,
            refill_per_second,
        }
    }

    /// Consumes `cost` tokens. A queue flush of 50 reports costs 50 — the client batches, so the
    /// limit counts reports rather than requests.
    ///
    /// # Panics
    /// If the bucket mutex was poisoned by a panic in another thread.
    #[allow(clippy::cast_precision_loss)]
    pub fn allow(&self, ip: IpAddr, cost: usize) -> bool {
        self.allow_at(ip, cost, Instant::now())
    }

    /// # Panics
    /// If the bucket mutex was poisoned by a panic in another thread.
    #[allow(clippy::cast_precision_loss)]
    pub fn allow_at(&self, ip: IpAddr, cost: usize, now: Instant) -> bool {
        let mut buckets = self.buckets.lock().expect("rate limiter mutex poisoned");
        let bucket = buckets.entry(ip).or_insert_with(|| Bucket {
            tokens: self.capacity,
            last: now,
        });

        let elapsed = now.saturating_duration_since(bucket.last).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.refill_per_second).min(self.capacity);
        bucket.last = now;

        let cost = cost as f64;
        if bucket.tokens >= cost {
            bucket.tokens -= cost;
            true
        } else {
            false
        }
    }

    /// Drops buckets untouched for `older_than`, so the map cannot grow without bound.
    ///
    /// A bucket at full capacity is indistinguishable from one that never existed, so forgetting an
    /// idle IP costs nothing and enforces nothing less.
    ///
    /// # Panics
    /// If the bucket mutex was poisoned by a panic in another thread.
    pub fn evict_idle(&self, older_than: Duration) {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().expect("rate limiter mutex poisoned");
        buckets.retain(|_, b| now.saturating_duration_since(b.last) < older_than);
    }

    /// How many IPs are currently tracked. The eviction sweep is otherwise unobservable.
    ///
    /// # Panics
    /// If the bucket mutex was poisoned by a panic in another thread.
    #[must_use]
    pub fn tracked_ips(&self) -> usize {
        self.buckets
            .lock()
            .expect("rate limiter mutex poisoned")
            .len()
    }
}

/// Sweeps idle buckets for the life of the process.
///
/// Without this the per-IP map grows for as long as the relay runs — every IP that ever appended,
/// remembered forever. `evict_idle` existed for exactly this and was never called.
pub fn spawn_eviction(limiter: Arc<RateLimiter>, interval: Duration, older_than: Duration) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        loop {
            ticker.tick().await;
            limiter.evict_idle(older_than);
        }
    });
}

/// `HeaderName` has no const constructor for this one.
static FORWARDED_FOR: axum::http::HeaderName =
    axum::http::HeaderName::from_static("x-forwarded-for");

/// Where the client's address is read from.
///
/// Behind a proxy the peer address is the proxy, so every caller shares one bucket and one script
/// can 429 an entire hunt. A forwarded header gives real hunters their own bucket back.
///
/// It does **not** make the limit robust: whoever writes the header picks their own bucket, which
/// is the concession the module header already makes. The byte and batch caps in `routes::reports`
/// are what bound consumption. There is no default — unset means the peer address, and a header is
/// safe only once the proxy in front is known to overwrite it.
pub struct ClientIpSource {
    header: Option<axum::http::HeaderName>,
    /// One warning per process when the configured header never arrives: a silent fallback looks
    /// identical to a working config.
    warned: std::sync::atomic::AtomicBool,
}

impl Default for ClientIpSource {
    /// The peer address. Identical to having no forwarded-header support at all.
    fn default() -> Self {
        Self {
            header: None,
            warned: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

impl ClientIpSource {
    /// Reads the header name from `TRUSTED_CLIENT_IP_HEADER`. Unset, empty, unparseable, or
    /// `X-Forwarded-For` all mean the peer address.
    ///
    /// This is for a header a proxy *generates* from the connection it terminates, so a caller
    /// cannot write it — `CF-Connecting-IP` behind Cloudflare. Not `True-Client-IP`: identical, but
    /// Enterprise-plan only.
    #[must_use]
    pub fn from_env(var: &str) -> Self {
        let Ok(name) = std::env::var(var) else {
            return Self::default();
        };
        Self::from_header_name(name.trim())
    }

    /// The decision `from_env` makes, without the environment.
    #[must_use]
    pub fn from_header_name(name: &str) -> Self {
        if name.is_empty() {
            return Self::default();
        }
        let Ok(header) = axum::http::HeaderName::try_from(name) else {
            tracing::warn!(%name, "not a valid header name; using the peer address");
            return Self::default();
        };
        if header == axum::http::header::FORWARDED || header == FORWARDED_FOR {
            // Refused, not warned about: trusting it is worse than the problem it was reached for.
            // Cloudflare *appends* to an existing `X-Forwarded-For`, so the leftmost entry — the one
            // `resolve` reads — is the caller's to choose. Rotate it, mint unlimited buckets.
            // Reading it safely means counting from the right at a fixed hop count, which breaks
            // silently the day a hop is added; not implemented, so not accepted.
            tracing::warn!(
                %header,
                "a caller-writable header was named; using the peer address instead"
            );
            return Self::default();
        }
        tracing::info!(%header, "keying the rate limit on a forwarded header");
        Self::trusting(header)
    }

    /// Trusts `header`. `from_env` is how the relay builds one; this is for callers that already
    /// know the name, including tests.
    #[must_use]
    pub fn trusting(header: axum::http::HeaderName) -> Self {
        Self {
            header: Some(header),
            warned: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// The name of the trusted header, if one is configured.
    #[must_use]
    pub fn header(&self) -> Option<&axum::http::HeaderName> {
        self.header.as_ref()
    }

    /// The address to key a bucket on. Falls back to `peer` when the header is absent or unusable:
    /// omitting it must not be a way to skip the limit.
    #[must_use]
    pub fn resolve(&self, headers: &axum::http::HeaderMap, peer: SocketAddr) -> IpAddr {
        let Some(name) = &self.header else {
            return peer.ip();
        };
        if let Some(ip) = headers.get(name).and_then(parse_forwarded_ip) {
            return ip;
        }
        if !self.warned.swap(true, std::sync::atomic::Ordering::Relaxed) {
            tracing::warn!(
                header = %name,
                "no usable address in the trusted header; falling back to the peer address"
            );
        }
        peer.ip()
    }
}

/// The leftmost address in a possibly comma-separated header value.
///
/// Right for a proxy-generated header, which carries one address; wrong for an appended list, which
/// is why `from_env` refuses `X-Forwarded-For`. A port is stripped rather than treated as a parse
/// failure — `[2001:db8::1]:443` and `203.0.113.7:9000` both appear in the wild.
fn parse_forwarded_ip(value: &axum::http::HeaderValue) -> Option<IpAddr> {
    let first = value.to_str().ok()?.split(',').next()?.trim();
    if let Ok(ip) = first.parse::<IpAddr>() {
        return Some(ip);
    }
    if let Ok(addr) = first.parse::<SocketAddr>() {
        return Some(addr.ip());
    }
    first
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse()
        .ok()
}
