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
    net::IpAddr,
    sync::Mutex,
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

    /// Drops buckets untouched for an hour, so the map cannot grow without bound.
    ///
    /// # Panics
    /// If the bucket mutex was poisoned by a panic in another thread.
    pub fn evict_idle(&self, older_than: Duration) {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().expect("rate limiter mutex poisoned");
        buckets.retain(|_, b| now.saturating_duration_since(b.last) < older_than);
    }
}
