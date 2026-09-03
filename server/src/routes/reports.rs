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

/// Reports per request.
///
/// **This must stay equal to `FLUSH_BATCH_SIZE` in `web/src/log/sync.ts`.** The limiter charges one
/// token per report against a bucket that holds 600 and is capped there, so a batch larger than the
/// bucket can never be accepted at any refill rate: it 429s, the client keeps the queue by design,
/// the next flush rebuilds the same batch, and the device is stuck forever with reports nobody else
/// can see. A cap here above the client's would leave room for a future client to build exactly
/// that batch; a cap below it would 413 a flush the deployed client considers normal.
pub const MAX_BATCH: usize = 200;

/// Bytes per report, measured on the envelope and nothing inside it.
///
/// A bearing report is ~505 bytes, ~655 signed, and ~1 KB in the worst case the format allows — a
/// signature plus a raw APRS frame. Eight times that is a bound on storage that cannot fire in the
/// field, which is the same doctrine the rate limit is held to: a limit that fires during a real
/// hunt is a bug.
///
/// Size is a property of the envelope. It is not a foot in the door for reading the body — `kind`,
/// headings and confidence values remain none of the server's business (Principle IV).
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

    // Size is checked before any token is spent, so the token cost stays proportional to what gets
    // stored. Charging for an oversized request first would let one caller who never stores a byte
    // drain the bucket shared by everyone the limiter cannot tell apart from them.
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
