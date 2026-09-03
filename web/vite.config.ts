import { defineConfig, type Plugin } from 'vite';

const RELAY = process.env['FOXMAPPER_RELAY'] ?? 'http://localhost:8080';

/**
 * The security headers the relay serves in production, repeated here for the dev and preview
 * servers.
 *
 * `server/src/security.rs` is the source of truth — production is served by the relay, and these
 * two servers do not exist there. The copy is what makes the policy testable at all: the E2E suite
 * loads the app from `vite preview`, so a policy only the relay sent would be a policy no test
 * ever ran the map against. `server/tests/security_headers.rs` pins the Rust side to the same
 * strings, so a change to one that is not made to the other fails a test rather than a hunt.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self'",
  // blob: and data: are MapLibre's own: sprites arrive as blobs and the canvas reads back data URLs.
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  // us-assets is analytics' *config*, fetched as JSON, not as a script: the extensions PostHog
  // would otherwise pull from there are bundled instead (web/src/analytics/posthog.ts).
  "connect-src 'self' https://tiles.openfreemap.org https://us.i.posthog.com https://us-assets.i.posthog.com",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // `geolocation=(self)` is load-bearing, not hygiene: the whole reporting flow is a position
  // plus a bearing, and an empty allowlist here would kill it silently.
  'permissions-policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
};

function securityHeaders(): Plugin {
  const apply = (_req: unknown, res: { setHeader(name: string, value: string): void }): void => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  };
  return {
    name: 'foxmapper-security-headers',
    configureServer: (server) => {
      server.middlewares.use((req, res, next) => {
        apply(req, res);
        next();
      });
    },
    configurePreviewServer: (server) => {
      server.middlewares.use((req, res, next) => {
        apply(req, res);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [securityHeaders()],
  build: {
    target: 'es2022',
  },
  server: {
    proxy: {
      // Proxied rather than cross-origin so the browser sees one origin: EventSource cannot send
      // custom headers and CORS on an SSE stream is a needless way to lose the whole sync path.
      '/api': { target: RELAY, changeOrigin: true },
      '/health': { target: RELAY, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: RELAY, changeOrigin: true },
      '/health': { target: RELAY, changeOrigin: true },
    },
  },
});
