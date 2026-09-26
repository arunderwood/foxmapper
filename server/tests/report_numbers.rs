//! A number in a report body comes back as the same `f64` the client wrote.
//!
//! The log must be identical on every device (Principle IV). The authoring device keeps its own
//! number, so a relay that nudges a coordinate by one ulp hands every other device a different
//! report. The location estimate then draws a different region on the author's screen than on
//! everyone else's.
//!
//! These compare JSON text, never a parsed `Value`. Parsing in the test would run through the same
//! parser under suspicion and could round both sides the same wrong way.

mod common;

use common::TestDb;
use foxmapper_server::{router, store};
use proptest::prelude::*;
use std::net::SocketAddr;
use uuid::Uuid;

const CODE: &str = "quiet-fox-8821-h7k2";

/// Coordinates that a parser without correct rounding reads as a neighbouring `f64`.
const LON: &str = "-122.57812663477081";
const LAT: &str = "48.59532872157967";

fn body_text(id: Uuid) -> String {
    format!(r#"{{"v":1,"id":"{id}","kind":"fix","position":{{"lat":{LAT},"lon":{LON}}}}}"#)
}

async fn serve(db: &TestDb) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    let app = router(db.state());
    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await;
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn coordinates_survive_append_and_catch_up_exactly() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;
    let base = serve(&db).await;
    let http = reqwest::Client::new();

    let appended = http
        .post(format!("{base}/api/hunts/{CODE}/reports"))
        .header("content-type", "application/json")
        .body(body_text(Uuid::new_v4()))
        .send()
        .await
        .expect("append");
    assert_eq!(appended.status(), 202);

    let synced = http
        .get(format!("{base}/api/hunts/{CODE}/reports?since=0"))
        .send()
        .await
        .expect("sync")
        .text()
        .await
        .expect("sync body");

    assert!(
        synced.contains(&format!(r#""lat":{LAT},"lon":{LON}"#)),
        "coordinates changed in transit: {synced}"
    );

    db.cleanup().await;
}

/// The read side alone: a row written by Postgres, not by this server, decoded by the store.
#[tokio::test]
async fn coordinates_survive_the_jsonb_decode_exactly() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    sqlx::query(
        "INSERT INTO reports (id, hunt_code, received_at, body) VALUES ($1, $2, 0, $3::jsonb)",
    )
    .bind(Uuid::new_v4())
    .bind(CODE)
    .bind(body_text(Uuid::new_v4()))
    .execute(&db.pool)
    .await
    .expect("insert");

    let reports = store::reports_since(&db.pool, CODE, 0).await.expect("read");
    let text = serde_json::to_string(&reports[0].body).expect("serialize");

    assert!(
        text.contains(&format!(r#""lat":{LAT},"lon":{LON}"#)),
        "coordinates changed on decode: {text}"
    );

    db.cleanup().await;
}

proptest! {
    /// Every finite `f64` a client can write survives the relay's parse and re-serialize.
    ///
    /// JavaScript's `JSON.stringify` emits the shortest digits that round-trip, as `ryu` does, so
    /// `to_string` stands in for the client here.
    #[test]
    fn any_finite_f64_round_trips_through_serde_json(bits in any::<u64>()) {
        let x = f64::from_bits(bits);
        prop_assume!(x.is_finite());
        let text = serde_json::to_string(&x).expect("serialize");
        let parsed: serde_json::Value = serde_json::from_str(&text).expect("parse");
        prop_assert_eq!(parsed.as_f64().expect("a number").to_bits(), bits, "{}", text);
    }
}
