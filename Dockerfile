# syntax=docker/dockerfile:1
#
# One image, one origin: the relay serves the PWA it talks to.
#
# `EventSource` cannot send custom headers, and CORS on an SSE stream is a needless way to lose
# the entire sync path. Same-origin removes the question.

FROM node:26-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Vite bakes env at build time, so the PostHog key must be present here, not at runtime. Render
# passes matching service env vars into the build as args (declared below). Absent — as in a plain
# `docker build` or CI — analytics stays off, which is the correct default for anything but prod.
ARG VITE_PUBLIC_POSTHOG_KEY=""
ARG VITE_PUBLIC_POSTHOG_HOST=""
ENV VITE_PUBLIC_POSTHOG_KEY=$VITE_PUBLIC_POSTHOG_KEY
ENV VITE_PUBLIC_POSTHOG_HOST=$VITE_PUBLIC_POSTHOG_HOST
RUN npm run build

FROM rust:1.98-slim AS server
WORKDIR /app
# rust-toolchain.toml rides along with the manifests: it must be here before the stub build below,
# or the dependency layer compiles with the base image's toolchain instead of the pinned one.
COPY server/Cargo.toml server/Cargo.lock server/rust-toolchain.toml ./
# Cache the dependency build against a stub, so a source edit does not rebuild the world.
RUN mkdir src \
    && echo 'fn main() {}' > src/main.rs \
    && echo '' > src/lib.rs \
    && cargo build --release \
    && rm -rf src
COPY server/ ./
RUN touch src/main.rs src/lib.rs && cargo build --release

# Distroless: no shell, no package manager, no apt, and a non-root default user. `cc` rather than
# `base` because the binary links libgcc_s.so.1, which `base` does not carry. CA certificates ship
# in the image already. The tag is pinned by index digest — see .github/dependabot.yml for why.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:c31ff9abcb1910f3ab25c7957bdaf0bfe12a01eb546e8df2282f1c8f682b606c AS runtime
WORKDIR /app
COPY --from=server /app/target/release/foxmapper-server /usr/local/bin/foxmapper-server
# Deliberately not `--chown`: the bundle lands root-owned and world-readable while the process runs
# as uid 65532, so the app can serve its own static files but cannot rewrite them.
COPY --from=web /web/dist /app/web

ENV BIND_ADDR=0.0.0.0:8080
ENV WEB_DIR=/app/web
EXPOSE 8080

# No HEALTHCHECK: there is no shell and no curl here to run one. The real probe is Render's, over
# HTTP against `healthCheckPath: /health` in render.yaml.

# Absolute path, not a bare name: with no shell in the image there is nothing to resolve PATH.
ENTRYPOINT ["/usr/local/bin/foxmapper-server"]
