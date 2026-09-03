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
pub mod security;
pub mod store;

use axum::{
    routing::{get, post},
    Router,
};
use sqlx::{postgres::PgListener, PgPool};
use std::sync::Arc;
use tokio::sync::{broadcast, oneshot};

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
        .route("/health", get(health))
        .with_state(state)
}

/// Serves the PWA from the same origin as the API.
///
/// Same-origin is not a convenience: `EventSource` cannot send custom headers and CORS on an SSE
/// stream is a needless way to lose the entire sync path. Serving both from one origin removes
/// the question.
///
/// Unknown paths fall back to `index.html` so a hunt link (`/h/quiet-fox-8821-h7k2`) opens the
/// app — the link is the whole of joining, and a 404 there is the product not working.
///
/// The security headers go on here rather than in [`router`] because this is where a *document*
/// starts being served, and a Content-Security-Policy governs a document. They land on the API
/// responses too, which costs nothing — see [`security::layer`].
pub fn with_static(router: Router, dir: &str) -> Router {
    use tower_http::services::{ServeDir, ServeFile};
    let index = ServeFile::new(format!("{dir}/index.html"));
    security::layer(router.fallback_service(ServeDir::new(dir).fallback(index)))
}

/// Liveness, and the clock reference the client measures its own skew against.
///
/// `no-store` is load-bearing rather than hygiene: a cached response carries a stale `Date`, and a
/// client measuring against it would compute the cache's age instead of its clock's error — either
/// warning about a good clock or, worse, staying quiet about a bad one.
async fn health() -> impl axum::response::IntoResponse {
    (
        [(axum::http::header::CACHE_CONTROL, "no-store, max-age=0")],
        "ok",
    )
}

/// Bridges Postgres NOTIFY into the in-process broadcast the SSE handlers subscribe to.
///
/// One LISTEN connection per process, fanned out to every open stream. Reconnects on error: a
/// dropped listener means live push stops, and the streams would sit silent with no way to know.
///
/// `ready` fires once, after the first successful `LISTEN`: a NOTIFY sent before that point is
/// never delivered, so anything that needs to guarantee delivery (namely: tests) can wait on it
/// rather than race the connection.
pub fn spawn_listener(
    database_url: String,
    notify_tx: broadcast::Sender<String>,
    ready: Option<oneshot::Sender<()>>,
) {
    tokio::spawn(async move {
        let mut ready = ready;
        loop {
            match PgListener::connect(&database_url).await {
                Ok(mut listener) => {
                    if let Err(error) = listener.listen(store::NOTIFY_CHANNEL).await {
                        tracing::error!(%error, "LISTEN failed; retrying");
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        continue;
                    }
                    tracing::info!("listening for report notifications");
                    if let Some(tx) = ready.take() {
                        let _ = tx.send(());
                    }
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
