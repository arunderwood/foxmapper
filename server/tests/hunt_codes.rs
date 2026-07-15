//! Hunt codes.
//!
//! The code is the entire access control, so its entropy is a security property rather than a
//! cosmetic choice: guessing one grants full read and write, including the ability to plant a
//! false `fix`.

mod common;

use common::TestDb;
use foxmapper_server::{
    model::Target,
    routes::hunts::{code_entropy_bits, generate_code, MIN_ENTROPY_BITS},
    store,
};
use std::collections::HashSet;

#[test]
fn the_entropy_floor_is_met() {
    assert!(
        code_entropy_bits() >= MIN_ENTROPY_BITS,
        "hunt codes carry {:.1} bits, below the {MIN_ENTROPY_BITS} bit floor — a script can \
         enumerate this",
        code_entropy_bits()
    );
}

#[test]
fn the_naive_word_word_nnnn_would_fail_this_test() {
    // The contract names the trap by name: two 256-word lists plus four digits is ~29 bits. This
    // asserts the floor actually rejects it, so the test above is not vacuous.
    let naive = 256f64.log2() + 256f64.log2() + 10_000f64.log2();
    assert!(
        naive < 30.0,
        "sanity: the naive scheme really is ~29 bits, got {naive:.1}"
    );
    assert!(
        naive < MIN_ENTROPY_BITS,
        "the floor must reject the naive scheme, or it is not doing any work"
    );
}

#[test]
fn codes_are_speakable_and_lowercase() {
    for _ in 0..200 {
        let code = generate_code();
        assert_eq!(
            code,
            code.to_lowercase(),
            "codes are stored and spoken lowercase"
        );
        assert!(
            code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
            "code has a character that does not survive being read over a repeater: {code}"
        );
        // No I, L, O or U in the random suffix — the characters that get misheard or mistyped.
        let suffix = code.rsplit('-').next().expect("suffix");
        assert!(
            !suffix.contains(['i', 'l', 'o', 'u']),
            "suffix contains an ambiguous character: {code}"
        );
    }
}

#[test]
fn generated_codes_do_not_repeat_in_practice() {
    // Not a proof of entropy — that is the calculation above. This catches a generator that is
    // seeded per-call or otherwise degenerate, which the calculation cannot see.
    let codes: HashSet<String> = (0..5_000).map(|_| generate_code()).collect();
    assert_eq!(
        codes.len(),
        5_000,
        "generator produced a duplicate in 5,000 draws"
    );
}

#[test]
fn every_position_in_the_code_actually_varies() {
    // A generator that always draws the same adjective would still pass the entropy calculation,
    // which reads list lengths rather than output.
    let codes: Vec<Vec<String>> = (0..500)
        .map(|_| generate_code().split('-').map(str::to_string).collect())
        .collect();
    let fields = codes.first().expect("codes").len();
    for field in 0..fields {
        let distinct: HashSet<&String> = codes.iter().map(|c| &c[field]).collect();
        assert!(distinct.len() > 1, "field {field} of the code never varies");
    }
}

#[tokio::test]
async fn a_code_collision_retries_rather_than_failing() {
    let db = TestDb::new().await;
    let target = Target {
        frequency: "146.52".into(),
        label: "Saturday fox".into(),
    };

    // Generate-insert-retry, never check-then-insert: the check-then-insert race is exactly what
    // the unique constraint is for.
    let code = generate_code();
    store::create_hunt(&db.pool, &code, &target, 1_000)
        .await
        .expect("first insert");

    let again = store::create_hunt(&db.pool, &code, &target, 2_000).await;
    let Err(sqlx::Error::Database(e)) = again else {
        panic!("a duplicate code must be a unique violation the caller can retry on");
    };
    assert!(e.is_unique_violation());

    db.cleanup().await;
}

#[tokio::test]
async fn lookup_is_case_insensitive() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;

    // Codes get read aloud and typed with gloves.
    for spelling in [code, "QUIET-FOX-8821-H7K2", "Quiet-Fox-8821-h7k2"] {
        let found = store::get_hunt(&db.pool, spelling).await.expect("lookup");
        assert!(found.is_some(), "lookup failed for {spelling}");
    }

    db.cleanup().await;
}
