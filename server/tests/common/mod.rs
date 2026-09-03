// Each integration test binary compiles this module separately, so anything only one of them uses
// reads as dead code in the others.
#![allow(dead_code)]

//! Test harness: one throwaway database per test.
//!
//! Isolation matters more than usual here — the sequence-gap and purge tests both assert about
//! global state (`seq` ordering, which hunts still exist), and a shared database would let one
//! test's rows make another's assertion pass for the wrong reason.

use sqlx::{AssertSqlSafe, Connection, Executor, PgConnection, PgPool};
use std::sync::atomic::{AtomicU32, Ordering};
use uuid::Uuid;

use foxmapper_server::{
    model::Target,
    rate_limit::{ClientIpSource, RateLimiter},
    store, AppState,
};
use std::sync::Arc;
use tokio::sync::broadcast;

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn base_url() -> String {
    std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://foxmapper:foxmapper@localhost:5432/foxmapper".into())
}

pub struct TestDb {
    pub pool: PgPool,
    pub name: String,
    base: String,
}

impl TestDb {
    pub async fn new() -> Self {
        let base = base_url();
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let name = format!("fmtest_{}_{n}", Uuid::new_v4().simple());

        let mut admin = PgConnection::connect(&base)
            .await
            .expect("connect to base database");
        admin
            .execute(AssertSqlSafe(format!(r#"CREATE DATABASE "{name}""#)))
            .await
            .expect("create test database");

        let url = swap_database(&base, &name);
        let pool = PgPool::connect(&url)
            .await
            .expect("connect to test database");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("run migrations");

        Self { pool, name, base }
    }

    pub fn state(&self) -> AppState {
        self.state_with(RateLimiter::default(), ClientIpSource::default())
    }

    /// For tests that need the limit to actually fire, or need two callers to land in different
    /// buckets. The defaults are sized so neither happens.
    pub fn state_with(&self, limiter: RateLimiter, client_ip: ClientIpSource) -> AppState {
        let (notify_tx, _) = broadcast::channel(256);
        AppState {
            pool: self.pool.clone(),
            notify_tx,
            rate_limiter: Arc::new(limiter),
            client_ip: Arc::new(client_ip),
        }
    }

    pub async fn seed_hunt(&self, code: &str) {
        let target = Target {
            frequency: "146.52".into(),
            label: "Saturday fox".into(),
        };
        store::create_hunt(&self.pool, code, &target, 1_784_092_800_000)
            .await
            .expect("seed hunt");
    }

    pub async fn cleanup(self) {
        let Self { pool, name, base } = self;
        pool.close().await;
        if let Ok(mut admin) = PgConnection::connect(&base).await {
            let _ = admin
                .execute(AssertSqlSafe(format!(
                    r#"DROP DATABASE IF EXISTS "{name}" WITH (FORCE)"#
                )))
                .await;
        }
    }
}

fn swap_database(base: &str, name: &str) -> String {
    let (prefix, _) = base.rsplit_once('/').expect("database url has a path");
    format!("{prefix}/{name}")
}

/// A minimal valid report body. The server never looks inside it, so the payload can be anything —
/// which is the point worth checking.
pub fn report_body(id: Uuid, kind: &str) -> serde_json::Value {
    serde_json::json!({
        "v": 1,
        "id": id.to_string(),
        "hunt_code": "quiet-fox-8821-h7k2",
        "kind": kind,
        "observer": { "callsign": "KI7XYZ" },
        "position": { "lat": 48.7519, "lon": -122.4787 },
        "position_source": "measured",
        "observed_at": 1_784_092_800_000i64,
        "clock_offset_ms": null,
        "entered_by": { "participant_id": Uuid::new_v4().to_string(), "callsign": "KI7XYZ" },
        "payload": {}
    })
}
