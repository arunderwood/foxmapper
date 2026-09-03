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

/// Where the client's address is read from.
///
/// Behind a proxy the peer address is the proxy, so every caller shares one bucket and one script
/// can 429 an entire hunt. Reading a forwarded header instead gives real hunters their own bucket
/// back.
///
/// It does **not** make the limit robust. A forwarded header is written by whoever is upstream of
/// the header-stripping proxy, so an attacker who can reach the relay directly, or who is trusted
/// by that proxy, rotates the value and evades the limit entirely — the same concession the module
/// header already makes. What this buys is collateral damage reduction, nothing more. The byte and
/// batch caps in `routes::reports` are what actually bound resource consumption, and they hold
/// whatever the key turns out to be.
///
/// Which header is safe depends on the deployment, so there is no default: unset means the peer
/// address, exactly as before there was a proxy. A header only ever narrows buckets when the
/// operator has confirmed the proxy in front overwrites it on every inbound request.
pub struct ClientIpSource {
    header: Option<axum::http::HeaderName>,
    /// One warning per process when the configured header never arrives — a silent fallback to the
    /// peer address looks identical to a working config, and the whole point of the setting is that
    /// it was chosen by observation rather than from documentation.
    warned: std::sync::atomic::AtomicBool,
}

impl Default for ClientIpSource {
    /// The peer address. Identical in every respect to having no forwarded-header support at all.
    fn default() -> Self {
        Self {
            header: None,
            warned: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

impl ClientIpSource {
    /// Reads the header name from `TRUSTED_CLIENT_IP_HEADER`. Unset, empty, or unparseable as a
    /// header name all mean the peer address.
    ///
    /// A single-value header (`CF-Connecting-IP`, `True-Client-IP`) is what this is for. Naming a
    /// list-valued one such as `X-Forwarded-For` is accepted but a poor choice: a proxy that
    /// *appends* leaves the leftmost entry client-written, so the key would be attacker-chosen by
    /// design rather than only when someone bypasses the proxy.
    #[must_use]
    pub fn from_env(var: &str) -> Self {
        let Ok(name) = std::env::var(var) else {
            return Self::default();
        };
        let name = name.trim();
        if name.is_empty() {
            return Self::default();
        }
        let Ok(header) = axum::http::HeaderName::try_from(name) else {
            tracing::warn!(%name, "{var} is not a valid header name; using the peer address");
            return Self::default();
        };
        tracing::info!(%header, "keying the rate limit on a forwarded header");
        Self::trusting(header)
    }

    /// Trusts `header`. `from_env` is how the relay builds one; this is for callers that already
    /// know the name, including tests, which must not race each other over a process-wide variable.
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

    /// The address to key a bucket on.
    ///
    /// Falls back to `peer` whenever the header is absent or does not hold an address: a request
    /// that cannot be attributed still has to be limited, and attributing it to nothing would make
    /// omitting the header the way to skip the limit.
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
/// `[2001:db8::1]:443` and `203.0.113.7:9000` both appear in the wild, so a port is stripped rather
/// than treated as a parse failure.
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
