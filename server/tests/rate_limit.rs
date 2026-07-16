//! The append rate limit.
//!
//! Anti-flood only. **A rate limit that fires during a real hunt is a bug** — it would put the
//! network in the write path, which Principle III forbids.

use foxmapper_server::rate_limit::RateLimiter;
use std::{
    net::{IpAddr, Ipv4Addr},
    time::{Duration, Instant},
};

fn ip(last: u8) -> IpAddr {
    IpAddr::V4(Ipv4Addr::new(10, 0, 0, last))
}

#[test]
fn a_hunt_full_of_hunters_reporting_hard_never_touches_it() {
    // The requirement, stated as a test rather than as a hope: an hour of one hunter entering a
    // report every ten seconds. If this ever fails, the limit is pacing a person.
    let limiter = RateLimiter::default();
    let start = Instant::now();
    for minute in 0..60 {
        for six in 0..6 {
            let at = start + Duration::from_secs(minute * 60 + six * 10);
            assert!(
                limiter.allow_at(ip(1), 1, at),
                "the limit fired during a normal hunt at minute {minute}"
            );
        }
    }
}

#[test]
fn a_queue_flush_of_fifty_reports_is_accepted() {
    // Coming back into coverage after an offline stretch dumps the whole queue at once. That is
    // the normal case, not an attack.
    let limiter = RateLimiter::default();
    assert!(limiter.allow(ip(2), 50));
}

#[test]
fn a_runaway_script_is_eventually_stopped() {
    let limiter = RateLimiter::default();
    let now = Instant::now();
    let mut allowed = 0;
    for _ in 0..5_000 {
        if limiter.allow_at(ip(3), 1, now) {
            allowed += 1;
        }
    }
    assert!(
        allowed < 5_000,
        "the limit never fires, so it stops nothing"
    );
}

#[test]
fn the_bucket_refills_over_time() {
    let limiter = RateLimiter::new(10.0, 5.0);
    let start = Instant::now();
    assert!(limiter.allow_at(ip(4), 10, start));
    assert!(!limiter.allow_at(ip(4), 1, start), "bucket should be empty");
    assert!(
        limiter.allow_at(ip(4), 5, start + Duration::from_secs(1)),
        "one second refills five"
    );
}

#[test]
fn one_flooding_ip_does_not_starve_another() {
    // Per-IP is the only handle we have — there are no accounts — but it must at least isolate.
    let limiter = RateLimiter::new(10.0, 1.0);
    let now = Instant::now();
    for _ in 0..20 {
        limiter.allow_at(ip(5), 1, now);
    }
    assert!(
        !limiter.allow_at(ip(5), 1, now),
        "flooder should be limited"
    );
    assert!(
        limiter.allow_at(ip(6), 1, now),
        "an unrelated hunter was starved"
    );
}

#[test]
fn idle_buckets_are_evicted() {
    let limiter = RateLimiter::default();
    limiter.allow(ip(7), 1);
    limiter.evict_idle(Duration::from_secs(0));
    // Nothing to assert but the absence of unbounded growth; the bucket is rebuilt on next use.
    assert!(limiter.allow(ip(7), 1));
}
