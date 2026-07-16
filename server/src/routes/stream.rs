//! Server-sent events.
//!
//! **This endpoint is the sync protocol and the realtime protocol at once.** The server assigns a
//! monotonic sequence to each report; that sequence is the SSE `id:`, and the browser replays it
//! as `Last-Event-ID` on reconnect per the WHATWG spec, with no client code. So the handler is:
//! stream everything above `Last-Event-ID`, then stream live. Reconnecting after four offline
//! hours and receiving a live report are the same path.

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use std::{convert::Infallible, time::Duration};
use tokio::sync::broadcast::error::RecvError;

use crate::{store, AppState};

const RETRY: Duration = Duration::from_secs(5);
/// Sparse on purpose — each heartbeat is a radio wake-up on a phone in the field.
const HEARTBEAT: Duration = Duration::from_secs(45);

pub async fn stream(
    State(state): State<AppState>,
    Path(code): Path<String>,
    headers: HeaderMap,
) -> Response {
    // 204 tells the browser to stop reconnecting permanently — a clean, correct end for an
    // expired hunt, and the reason the client can land an arriving participant where a
    // first-timer lands instead of polling a dead code forever.
    match store::get_hunt(&state.pool, &code).await {
        Ok(None) => return StatusCode::NO_CONTENT.into_response(),
        Err(error) => {
            tracing::error!(%error, "hunt lookup failed");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        Ok(Some(_)) => {}
    }

    let code = code.to_lowercase();
    let mut cursor: i64 = headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let mut notifications = state.notify_tx.subscribe();
    let pool = state.pool.clone();
    let hunt_code = code.clone();

    let events = async_stream::stream! {
        yield Ok::<Event, Infallible>(Event::default().retry(RETRY).comment("connected"));

        loop {
            match store::reports_since(&pool, &hunt_code, cursor).await {
                Ok(reports) => {
                    for report in reports {
                        cursor = report.seq;
                        let data = match serde_json::to_string(&report) {
                            Ok(data) => data,
                            Err(error) => {
                                tracing::error!(%error, "serializing envelope failed");
                                continue;
                            }
                        };
                        yield Ok(Event::default().id(report.seq.to_string()).data(data));
                    }
                }
                Err(error) => {
                    tracing::error!(%error, "stream catch-up failed");
                    return;
                }
            }

            // Wait for an append to this hunt. Lagging just means re-querying from the cursor,
            // which is the same code path as catch-up — the cursor, not the channel, is the
            // source of truth about what a client has seen.
            loop {
                match notifications.recv().await {
                    Ok(notified) if notified == hunt_code => break,
                    Ok(_) => {}
                    Err(RecvError::Lagged(n)) => {
                        tracing::warn!(missed = n, "listener lagged; re-querying from cursor");
                        break;
                    }
                    Err(RecvError::Closed) => return,
                }
            }
        }
    };

    let sse = Sse::new(events).keep_alive(KeepAlive::new().interval(HEARTBEAT).text("ping"));

    // Set here as well as at the proxy, because buffered SSE fails the five-second requirement
    // silently and only in production. This is correctness, not tuning.
    (
        [
            (header::CACHE_CONTROL, "no-cache, no-transform"),
            (header::HeaderName::from_static("x-accel-buffering"), "no"),
        ],
        sse,
    )
        .into_response()
}
