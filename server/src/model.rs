//! The envelope. The server stores it and deliberately cannot read the domain.
//!
//! Every type here would be identical if the payload were recipes. That is not minimalism for its
//! own sake: an API that could interpret a bearing would be an API someone would eventually ask to
//! compute one, and the constitution puts the estimate on the client or nowhere.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// A stored report. `body` is opaque — the server never parses inside it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportEnvelope {
    /// Monotonic. The SSE `id:` and the sync cursor.
    pub seq: i64,
    /// Envelope metadata, **not** part of the report: the report stays client-authored and
    /// immutable. Feeds the idle purge clock and lets a client notice its own phone clock is wrong.
    pub received_at: i64,
    /// The report exactly as the client wrote it.
    pub body: Value,
}

/// An inbound report. The only validation the server performs.
///
/// It checks that the JSON parses and that `id` is a UUID. It does **not** check `kind`, does not
/// validate a heading, and does not reject a `confidence_q` of 9 — enforcing domain rules here
/// would put direction-finding logic in the server.
#[derive(Debug, Clone)]
pub struct IncomingReport {
    pub id: Uuid,
    pub body: Value,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("report is not a JSON object")]
    NotAnObject,
    #[error("report has no `id`")]
    MissingId,
    #[error("report `id` is not a UUID")]
    IdNotUuid,
}

impl IncomingReport {
    /// Extracts `id` and keeps everything else untouched.
    pub fn from_value(body: Value) -> Result<Self, ParseError> {
        let object = body.as_object().ok_or(ParseError::NotAnObject)?;
        let id = object.get("id").ok_or(ParseError::MissingId)?;
        let id = id.as_str().ok_or(ParseError::IdNotUuid)?;
        let id = Uuid::parse_str(id).map_err(|_| ParseError::IdNotUuid)?;
        Ok(Self { id, body })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Target {
    /// Opaque string, never parsed. Hunters say "146.52", "two meters", "the 440 machine".
    pub frequency: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hunt {
    pub code: String,
    pub created_at: i64,
    pub target: Target,
}

/// `GET /api/hunts/{code}`. `found` is deliberately absent: it is derived from the log on each
/// device, and the server has no way to find out whether the fox has been found.
#[derive(Debug, Clone, Serialize)]
pub struct HuntDetail {
    pub code: String,
    pub created_at: i64,
    pub target: Target,
    pub report_count: i64,
    pub id_digest: String,
}
