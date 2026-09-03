//! Response headers that harden the app without changing what it does.
//!
//! Defence in depth, not a fix: the app builds its DOM node by node and never interpolates a
//! report into markup, so there is no known injection for a policy to stop. The policy is here for
//! the one that gets written later.
//!
//! Sent as headers rather than a `<meta http-equiv>`: `frame-ancestors` is ignored in meta, and
//! clickjacking a map someone is navigating by is the attack worth closing.

use axum::http::{header, HeaderName, HeaderValue};

/// Everything the app loads, and nothing else.
///
/// Both external origins are load-bearing: `tiles.openfreemap.org` is the basemap (style, glyphs,
/// sprites, tiles) and `us.i.posthog.com` is analytics, which is bundled from npm and so needs
/// `connect-src` rather than `script-src`.
///
/// What is *not* here is the point:
///
/// - No `'unsafe-inline'` anywhere. The built `index.html` carries no inline script and no inline
///   style, and no code path sets a `style` attribute: spacing is class-driven and the one width
///   that varies is set through the CSSOM, which CSP does not govern. So `style-src-attr` is shut
///   as well, and neither half of `style-src` has an exception.
/// - `worker-src 'self'` with no `blob:`. `MapLibre` normally needs it; this app hands it a
///   same-origin worker URL (`web/src/map/basemap.ts`), so the usual exception does not apply.
/// - `frame-ancestors 'none'` and `form-action 'none'`: the app is never framed and submits no
///   form — every input is read by script.
pub const CONTENT_SECURITY_POLICY: &str = concat!(
    "default-src 'self'; ",
    "script-src 'self'; ",
    "worker-src 'self'; ",
    "style-src 'self'; ",
    // blob: and data: are MapLibre's own: sprites arrive as blobs and the canvas reads back data URLs.
    "img-src 'self' data: blob: https://tiles.openfreemap.org; ",
    // us-assets is analytics' *config*, fetched as JSON. The extensions PostHog would otherwise
    // pull from that host as `<script>` tags are bundled into the app instead
    // (`web/src/analytics/posthog.ts`), which is why `script-src` still names no third party.
    "connect-src 'self' https://tiles.openfreemap.org https://us.i.posthog.com https://us-assets.i.posthog.com; ",
    "font-src 'self'; ",
    "manifest-src 'self'; ",
    "object-src 'none'; ",
    "base-uri 'none'; ",
    "frame-ancestors 'none'; ",
    "form-action 'none'"
);

/// Geolocation is the app's core sensor — Principle II, and every report is a position plus a
/// bearing. `geolocation=(self)` is therefore the one entry in this list that must be right:
/// dropping it, or writing `geolocation=()`, kills position reporting silently and only on a
/// device outdoors. `server/tests/security_headers.rs` and `web/tests/e2e/security-headers.spec.ts`
/// exercise it rather than reading it.
pub const PERMISSIONS_POLICY: &str =
    "geolocation=(self), camera=(), microphone=(), payment=(), usb=()";

/// Every header this serves, in one list so a test can assert the set rather than a sample.
#[must_use]
pub fn headers() -> [(HeaderName, &'static str); 4] {
    [
        (header::CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        (header::REFERRER_POLICY, "no-referrer"),
        (
            HeaderName::from_static("permissions-policy"),
            PERMISSIONS_POLICY,
        ),
    ]
}

/// Wraps a router so every response it produces carries the headers above.
///
/// Applied to the whole router, API included, rather than only to the static files: one layer is
/// simpler to read than two, and a JSON endpoint that says `nosniff` and refuses to be framed
/// loses nothing.
pub fn layer(router: axum::Router) -> axum::Router {
    use tower_http::set_header::SetResponseHeaderLayer;

    let mut router = router;
    for (name, value) in headers() {
        router = router.layer(SetResponseHeaderLayer::overriding(
            name,
            HeaderValue::from_static(value),
        ));
    }
    router
}
