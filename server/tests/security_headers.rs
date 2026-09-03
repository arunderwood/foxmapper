//! The hardening headers, over real HTTP — and the check that the two servers agree.
//!
//! No database: `with_static` takes any router, and what is under test is what comes back on a
//! document, not what is in it.

use axum::Router;
use foxmapper_server::{security, with_static};
use std::{net::SocketAddr, path::PathBuf};

/// A directory holding just enough of a build for `ServeDir` to answer.
struct StaticDir(PathBuf);

impl StaticDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("foxmapper-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create static dir");
        std::fs::write(dir.join("index.html"), "<!doctype html><title>x</title>")
            .expect("write index");
        Self(dir)
    }
}

impl Drop for StaticDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn serve(dir: &StaticDir) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    let app = with_static(Router::new(), &dir.0.to_string_lossy());
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
async fn the_document_carries_every_security_header() {
    let dir = StaticDir::new("headers");
    let base = serve(&dir).await;

    // Both the file itself and a hunt link, which is served by the SPA fallback — a policy that
    // only reached `/` would miss every URL a hunter is actually sent.
    for path in ["/", "/h/quiet-fox-8821-h7k2"] {
        let response = reqwest::get(format!("{base}{path}"))
            .await
            .expect("request");
        assert_eq!(response.status(), 200, "{path}");
        for (name, value) in security::headers() {
            assert_eq!(
                response.headers().get(&name).map(|v| v.to_str().unwrap()),
                Some(value),
                "{name} on {path}"
            );
        }
    }
}

/// Geolocation is the app's core sensor, and `geolocation=()` would read as a correct-looking
/// policy while killing every report. Nothing else in the list may be permissive.
#[test]
fn geolocation_is_allowed_to_the_app_itself() {
    assert!(security::PERMISSIONS_POLICY.contains("geolocation=(self)"));
    for feature in ["camera", "microphone", "payment", "usb"] {
        assert!(
            security::PERMISSIONS_POLICY.contains(&format!("{feature}=()")),
            "{feature} should be denied outright"
        );
    }
}

/// The policy forbids the things it is for. Written out rather than checked by substring on the
/// whole string, so `script-src` gaining `'unsafe-inline'` cannot pass because `style-src` has none.
#[test]
fn no_directive_allows_inline_or_eval() {
    for directive in security::CONTENT_SECURITY_POLICY.split("; ") {
        assert!(
            !directive.contains("'unsafe-inline'") && !directive.contains("'unsafe-eval'"),
            "{directive} weakens the policy"
        );
    }
}

/// The dev and preview servers repeat this policy in `web/vite.config.ts`, because the E2E suite
/// loads the app from `vite preview` and never from the relay. Two copies drift; this fails when
/// they do, so the copy the tests exercise stays the copy production serves.
#[test]
fn the_vite_dev_server_serves_the_same_headers() {
    let config = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/vite.config.ts");
    let source = std::fs::read_to_string(&config)
        .unwrap_or_else(|error| panic!("read {}: {error}", config.display()));

    // The CSP is one string here and a list of directives there, so it is compared a directive
    // at a time; the rest are single values and compare whole.
    for (name, value) in security::headers() {
        let expected: Vec<&str> = if name == axum::http::header::CONTENT_SECURITY_POLICY {
            value.split("; ").collect()
        } else {
            vec![value]
        };
        for piece in expected {
            assert!(
                source.contains(piece),
                "{name}: web/vite.config.ts does not serve `{piece}`"
            );
        }
    }
}
