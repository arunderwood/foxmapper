//! Hunt creation, lookup, and the code generator.

use axum::{
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rand::RngExt;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

use crate::{model::Target, now_ms, store, AppState};

/// Speakable over a repeater, which is the actual delivery channel for half the people who will
/// use this. Kept short, unambiguous when read aloud, and free of near-homophones.
const ADJECTIVES: &[&str] = &[
    "quiet", "brisk", "calm", "bright", "clever", "bold", "brave", "crisp", "dark", "deep",
    "eager", "early", "easy", "fair", "fast", "fine", "firm", "free", "fresh", "glad", "grand",
    "green", "happy", "hardy", "high", "jolly", "keen", "kind", "large", "light", "lively", "lone",
    "loud", "lucky", "mellow", "merry", "mild", "neat", "noble", "north", "plain", "proud",
    "quick", "rapid", "ready", "rich", "royal", "rugged", "sharp", "short", "silent", "silver",
    "simple", "sleek", "slow", "smart", "snug", "solid", "south", "spare", "steady", "stout",
    "sturdy", "swift",
];

const NOUNS: &[&str] = &[
    "fox", "owl", "hawk", "wolf", "bear", "crow", "deer", "dove", "duck", "eagle", "elk", "finch",
    "goat", "hare", "heron", "ibis", "jay", "kite", "lark", "lynx", "mink", "mole", "moose",
    "mouse", "newt", "otter", "pike", "quail", "raven", "robin", "seal", "shrew", "skunk", "snipe",
    "stag", "stoat", "swan", "tern", "toad", "trout", "vole", "wren", "badger", "beaver", "bison",
    "cedar", "creek", "delta", "ember", "ferry", "forge", "grove", "harbor", "hollow", "island",
    "ledge", "meadow", "ridge", "river", "summit", "valley", "willow", "canyon", "basin",
];

/// Crockford base32 without I, L, O and U — the characters that get misheard or mistyped.
const SUFFIX_ALPHABET: &[u8] = b"0123456789abcdefghjkmnpqrstvwxyz";
const SUFFIX_LEN: u32 = 4;
const DIGITS: u32 = 4;

/// The floor the contract sets. Guessing a code grants full read and write, including the ability
/// to plant a false `fix`, so this is a security property rather than a cosmetic choice.
pub const MIN_ENTROPY_BITS: f64 = 40.0;

/// Entropy of a generated code, computed from the generator's actual parameters rather than
/// asserted in a comment — so shrinking a word list fails the test instead of the field.
#[must_use]
pub fn code_entropy_bits() -> f64 {
    #[allow(clippy::cast_precision_loss)]
    let (adj, noun) = (ADJECTIVES.len() as f64, NOUNS.len() as f64);
    let digits = 10f64.powi(i32::try_from(DIGITS).unwrap_or(0));
    let suffix = 32f64.powi(i32::try_from(SUFFIX_LEN).unwrap_or(0));
    adj.log2() + noun.log2() + digits.log2() + suffix.log2()
}

/// `quiet-fox-8821-h7k2`.
///
/// The bare `word-word-NNNN` the contract names as the obvious implementation is ~29 bits — a
/// script enumerates that. The suffix is what the contract sanctions to reach the floor, and the
/// words are what keep the code speakable.
///
/// Drawn from the thread-local CSPRNG via `random_range`, which rejects rather than taking a
/// modulo, so every code is uniform over the space the entropy calculation claims.
#[must_use]
pub fn generate_code() -> String {
    let mut rng = rand::rng();
    let adjective = ADJECTIVES[rng.random_range(0..ADJECTIVES.len())];
    let noun = NOUNS[rng.random_range(0..NOUNS.len())];
    let number: u32 = rng.random_range(0..10u32.pow(DIGITS));
    let suffix: String = (0..SUFFIX_LEN)
        .map(|_| SUFFIX_ALPHABET[rng.random_range(0..SUFFIX_ALPHABET.len())] as char)
        .collect();
    format!("{adjective}-{noun}-{number:04}-{suffix}")
}

/// Length caps on the target, in characters.
///
/// Generous on purpose: "the 440 machine" and "Bellingham Saturday fox hunt" both have to fit with
/// room to spare. These exist so a script cannot store a megabyte per row, not to police what
/// hunters type. The frequency stays an opaque string — see the column comment in
/// `migrations/0001_initial.sql`; validating it as a number would reject "two meters" to enable a
/// computation that does not exist.
pub const MAX_FREQUENCY_CHARS: usize = 64;
pub const MAX_LABEL_CHARS: usize = 128;

/// Tokens a hunt costs, against the same 600-token bucket a report draws from.
///
/// Creating a hunt was free until now, which made it a cheaper way to fill the database than the
/// amplification a report batch offers. Five is a discouragement, not a quota: a club starting a
/// dozen hunts in an afternoon never notices, and a script writing rows in a loop stops.
const CREATE_HUNT_COST: usize = 5;

#[derive(Debug, Deserialize)]
pub struct CreateHuntRequest {
    pub target: Target,
}

#[derive(Debug, Serialize)]
pub struct CreateHuntResponse {
    pub code: String,
    pub created_at: i64,
    pub target: Target,
}

/// `POST /api/hunts`. No account, no install, no payment.
pub async fn create_hunt(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<CreateHuntRequest>,
) -> Result<(StatusCode, Json<CreateHuntResponse>), StatusCode> {
    // The string caps do the real work; the token cost only discourages row-spam. The caps run
    // before the limiter so a request that stores nothing costs nothing.
    if request.target.frequency.chars().count() > MAX_FREQUENCY_CHARS
        || request.target.label.chars().count() > MAX_LABEL_CHARS
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    if !state
        .rate_limiter
        .allow(state.client_ip.resolve(&headers, peer), CREATE_HUNT_COST)
    {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    let created_at = now_ms();

    // Generate-insert-retry, never check-then-insert: the check-then-insert race is exactly what
    // the unique constraint is for. Codes are never reused, including after purge, so a collision
    // with a dead hunt still retries.
    for _ in 0..8 {
        let code = generate_code();
        match store::create_hunt(&state.pool, &code, &request.target, created_at).await {
            Ok(hunt) => {
                return Ok((
                    StatusCode::CREATED,
                    Json(CreateHuntResponse {
                        code: hunt.code,
                        created_at: hunt.created_at,
                        target: hunt.target,
                    }),
                ))
            }
            // The collision retry. Codes are never reused, including after purge.
            Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {}
            Err(error) => {
                tracing::error!(%error, "create hunt failed");
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }

    tracing::error!("code generation exhausted retries");
    Err(StatusCode::INTERNAL_SERVER_ERROR)
}

/// `GET /api/hunts/{code}`.
///
/// `404` if unknown **or purged** — the two are indistinguishable on purpose. After purge there is
/// nothing to disclose.
pub async fn get_hunt(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<crate::model::HuntDetail>, StatusCode> {
    match store::hunt_detail(&state.pool, &code).await {
        Ok(Some(detail)) => Ok(Json(detail)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(error) => {
            tracing::error!(%error, "hunt lookup failed");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Debug, Serialize)]
pub struct IdsResponse {
    pub ids: Vec<String>,
}

/// `GET /api/hunts/{code}/ids` — the divergence audit's slow path.
///
/// Only fetched when `id_digest` disagrees with the client's. ~180 KB for 5,000 reports: far too
/// much to poll, and fine as a rare repair.
pub async fn get_ids(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<IdsResponse>, StatusCode> {
    match store::get_hunt(&state.pool, &code).await {
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(error) => {
            tracing::error!(%error, "hunt lookup failed");
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        Ok(Some(_)) => {}
    }

    match store::report_ids(&state.pool, &code).await {
        Ok(ids) => Ok(Json(IdsResponse { ids })),
        Err(error) => {
            tracing::error!(%error, "id listing failed");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
