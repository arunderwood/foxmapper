//! The relay.
//!
//! It stores reports, tells a device what it is missing, pushes new ones, and purges at 30 days.
//! It has **no opinion about direction finding** — it never parses a report body, and every
//! endpoint would be identical if the payload were recipes.
//!
//! That is not minimalism for its own sake. Principle III says nothing may require a live server
//! round-trip to be useful in the field, and Principle IV says the estimate is never authoritative
//! on the server. An API that could interpret a bearing would be an API someone would eventually
//! ask to compute one.

pub mod model;
pub mod rate_limit;
pub mod routes;
pub mod store;

use axum::{
    routing::{get, post},
    Router,
};
use sqlx::{postgres::PgListener, PgPool};
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// Fan-out of hunt codes with new reports, fed by one `PgListener` per process.
    pub notify_tx: broadcast::Sender<String>,
    pub rate_limiter: Arc<rate_limit::RateLimiter>,
}

/// There is deliberately no join endpoint: joining is a purely local act. The device mints its own
/// `participant_id` and keeps it, the server is never told, and it holds no roster. A join endpoint
/// would add a round-trip that buys nothing and breaks offline join.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/hunts", post(routes::hunts::create_hunt))
        .route("/api/hunts/{code}", get(routes::hunts::get_hunt))
        .route("/api/hunts/{code}/ids", get(routes::hunts::get_ids))
        .route(
            "/api/hunts/{code}/reports",
            post(routes::reports::append).get(routes::reports::sync),
        )
        .route("/api/hunts/{code}/stream", get(routes::stream::stream))
        .route("/health", get(|| async { "ok" }))
        .with_state(state)
}

/// Bridges Postgres NOTIFY into the in-process broadcast the SSE handlers subscribe to.
///
/// One LISTEN connection per process, fanned out to every open stream. Reconnects on error: a
/// dropped listener means live push stops, and the streams would sit silent with no way to know.
pub fn spawn_listener(database_url: String, notify_tx: broadcast::Sender<String>) {
    tokio::spawn(async move {
        loop {
            match PgListener::connect(&database_url).await {
                Ok(mut listener) => {
                    if let Err(error) = listener.listen(store::NOTIFY_CHANNEL).await {
                        tracing::error!(%error, "LISTEN failed; retrying");
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        continue;
                    }
                    tracing::info!("listening for report notifications");
                    loop {
                        match listener.recv().await {
                            Ok(notification) => {
                                // Send fails only when nobody is subscribed, which is normal.
                                let _ = notify_tx.send(notification.payload().to_string());
                            }
                            Err(error) => {
                                tracing::error!(%error, "listener dropped; reconnecting");
                                break;
                            }
                        }
                    }
                }
                Err(error) => {
                    tracing::error!(%error, "LISTEN connect failed; retrying");
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    });
}

/// UTC epoch milliseconds.
#[must_use]
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let since = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    i64::try_from(since.as_millis()).unwrap_or(i64::MAX)
}
