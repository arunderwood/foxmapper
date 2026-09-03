//! Append and catch-up.

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::SocketAddr;

use crate::{
    model::{IncomingReport, ReportEnvelope},
    now_ms, store, AppState,
};

/// Reports per request. **Must equal `FLUSH_BATCH_SIZE` in `web/src/log/sync.ts`.**
///
/// One token per report against a bucket capped at 600, so a batch above that capacity is
/// undeliverable at any refill rate: it 429s, the client keeps the queue, the next flush rebuilds
/// the same batch, and the device is stuck with reports nobody else can see.
pub const MAX_BATCH: usize = 200;

/// Bytes per report, measured on the envelope and nothing inside it.
///
/// Eight times the worst case the format allows (~1 KB: signed, with a raw APRS frame), so it
/// bounds storage without firing in the field — the doctrine the rate limit is held to. Size is a
/// property of the envelope, not a foot in the door for reading the body (Principle IV).
pub const MAX_REPORT_BYTES: usize = 8 * 1024;

#[derive(Debug, Serialize)]
pub struct AppendResponse {
    pub accepted: Vec<String>,
}

/// One report, or an array of them for a queue flush.
///
/// Branching on the parsed JSON rather than deriving `#[serde(untagged)]`: `Value` matches an
/// array too, so an untagged single-report variant silently swallows the whole batch and the
/// flush 400s — which is the request a phone makes the moment it regains coverage.
fn bodies_of(request: Value) -> Vec<Value> {
    match request {
        Value::Array(reports) => reports,
        one => vec![one],
    }
}

fn serialized_len(body: &Value) -> usize {
    serde_json::to_vec(body).map_or(usize::MAX, |bytes| bytes.len())
}

/// `POST /api/hunts/{code}/reports`. Idempotent by report `id`.
pub async fn append(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(code): Path<String>,
    Json(request): Json<Value>,
) -> Result<(StatusCode, Json<AppendResponse>), StatusCode> {
    let bodies = bodies_of(request);

    // Before any token is spent, so the cost stays proportional to what gets stored: a caller who
    // stores nothing must not be able to drain the bucket others are sharing with them.
    if bodies.len() > MAX_BATCH {
        tracing::debug!(count = bodies.len(), "rejecting an oversized batch");
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    if let Some(bytes) = bodies
        .iter()
        .map(serialized_len)
        .find(|n| *n > MAX_REPORT_BYTES)
    {
        tracing::debug!(bytes, "rejecting an oversized report");
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    if !state
        .rate_limiter
        .allow(state.client_ip.resolve(&headers, peer), bodies.len())
    {
        // The client must treat this as retryable and keep the report queued. A dropped report is
        // the one unacceptable outcome.
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    // The only validation the server performs: the JSON parses and `id` is a UUID. It does not
    // check `kind`, does not validate a heading, and does not reject a confidence of 9. Enforcing
    // domain rules here would put direction-finding logic in the server.
    let mut reports = Vec::with_capacity(bodies.len());
    for body in bodies {
        match IncomingReport::from_value(body) {
            Ok(report) => reports.push(report),
            Err(error) => {
                tracing::debug!(%error, "rejecting malformed report");
                return Err(StatusCode::BAD_REQUEST);
            }
        }
    }

    match store::append_reports(&state.pool, &code, &reports, now_ms()).await {
        Ok(accepted) => Ok((
            StatusCode::ACCEPTED,
            Json(AppendResponse {
                accepted: accepted.into_iter().map(|id| id.to_string()).collect(),
            }),
        )),
        // The client keeps the report locally rather than discarding it.
        Err(store::StoreError::HuntNotFound) => Err(StatusCode::NOT_FOUND),
        Err(error) => {
            tracing::error!(%error, "append failed");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SinceQuery {
    #[serde(default)]
    pub since: i64,
}

#[derive(Debug, Serialize)]
pub struct SyncResponse {
    pub reports: Vec<ReportEnvelope>,
    pub cursor: i64,
}

/// `GET /api/hunts/{code}/reports?since={seq}`.
///
/// `since=0` (or omitted) returns the whole log — the recovery path after storage eviction, and
/// why eviction costs a re-download rather than a lost hunt.
pub async fn sync(
    State(state): State<AppState>,
    Path(code): Path<String>,
    Query(query): Query<SinceQuery>,
) -> Result<Json<SyncResponse>, StatusCode> {
    match store::get_hunt(&state.pool, &code).await {
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(error) => {
            tracing::error!(%error, "hunt lookup failed");
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(Some(_)) => {}
    }

    match store::reports_since(&state.pool, &code, query.since).await {
        Ok(reports) => {
            let cursor = reports.last().map_or(query.since, |r| r.seq);
            Ok(Json(SyncResponse { reports, cursor }))
        }
        Err(error) => {
            tracing::error!(%error, "sync failed");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
