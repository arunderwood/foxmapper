import { defineConfig } from 'vite';

const RELAY = process.env['FOXMAPPER_RELAY'] ?? 'http://localhost:8080';

export default defineConfig({
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
