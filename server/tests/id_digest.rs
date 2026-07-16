//! The divergence audit's digest.
//!
//! Specified exactly because "SHA-256 over the sorted id list" is not a specification — a third
//! party would guess a different answer and the audit would report divergence that isn't there.
//! These tests pin every clause of that spec independently of the implementation.

use foxmapper_server::store::id_digest;
use proptest::prelude::*;
use sha2::{Digest, Sha256};

fn reference(ids: &[&str]) -> String {
    let mut sorted: Vec<String> = ids.iter().map(|s| s.to_lowercase()).collect();
    sorted.sort();
    format!(
        "sha256:{}",
        hex::encode(Sha256::digest(sorted.join("\n").as_bytes()))
    )
}

#[test]
fn the_digest_of_an_empty_log_is_the_digest_of_the_empty_string() {
    assert_eq!(
        id_digest(&[]),
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn there_is_no_trailing_newline() {
    // The clause a reimplementer is most likely to get wrong.
    let ids = vec!["9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f".to_string()];
    let with_trailing = format!(
        "sha256:{}",
        hex::encode(Sha256::digest(format!("{}\n", ids[0]).as_bytes()))
    );
    assert_ne!(id_digest(&ids), with_trailing);
    assert_eq!(
        id_digest(&ids),
        reference(&["9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"])
    );
}

#[test]
fn ids_are_lowercased_before_hashing() {
    let upper = vec!["9F1C2D3E-4A5B-4C6D-8E7F-0A1B2C3D4E5F".to_string()];
    let lower = vec!["9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f".to_string()];
    assert_eq!(id_digest(&upper), id_digest(&lower));
}

#[test]
fn the_digest_is_lowercase_hex() {
    let ids = vec!["9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f".to_string()];
    let digest = id_digest(&ids);
    let hex = digest.strip_prefix("sha256:").expect("prefix");
    assert_eq!(hex, hex.to_lowercase());
    assert_eq!(hex.len(), 64);
}

proptest! {
    #[test]
    fn the_digest_does_not_depend_on_input_order(mut ids in prop::collection::vec(
        "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", 0..12
    )) {
        // Two devices holding the same set must agree, whatever order they stored it in —
        // otherwise the audit cries wolf on every hunt.
        let forward = id_digest(&ids);
        ids.reverse();
        prop_assert_eq!(forward, id_digest(&ids));
    }

    #[test]
    fn a_different_set_gives_a_different_digest(
        a in prop::collection::hash_set(
            "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", 1..8
        ),
        extra in "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
    ) {
        prop_assume!(!a.contains(&extra));
        let base: Vec<String> = a.iter().cloned().collect();
        let mut grown = base.clone();
        grown.push(extra);
        prop_assert_ne!(id_digest(&base), id_digest(&grown));
    }
}
