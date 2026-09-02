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
RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
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

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server /app/target/release/foxmapper-server /usr/local/bin/foxmapper-server
COPY --from=server /app/migrations /app/migrations
COPY --from=web /web/dist /app/web

ENV BIND_ADDR=0.0.0.0:8080
ENV WEB_DIR=/app/web
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["foxmapper-server"]
