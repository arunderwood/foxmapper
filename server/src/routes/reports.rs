//! Append and catch-up.

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::SocketAddr;

use crate::{
    model::{IncomingReport, ReportEnvelope},
    now_ms, store, AppState,
};

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

/// `POST /api/hunts/{code}/reports`. Idempotent by report `id`.
pub async fn append(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(code): Path<String>,
    Json(request): Json<Value>,
) -> Result<(StatusCode, Json<AppendResponse>), StatusCode> {
    let bodies = bodies_of(request);

    if !state.rate_limiter.allow(peer.ip(), bodies.len()) {
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
