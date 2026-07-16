# syntax=docker/dockerfile:1

FROM rust:1.97-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libssl-dev curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Live-reload development. Sources are bind-mounted by compose.
FROM base AS dev
RUN cargo install cargo-watch --locked
ENV CARGO_TARGET_DIR=/app/target
EXPOSE 8080
CMD ["cargo", "watch", "-x", "run"]

FROM base AS builder
COPY Cargo.toml Cargo.lock ./
# Cache the dependency build against a stub main, so a source edit does not rebuild the world.
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release \
    && rm -rf src
COPY . .
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/foxmapper-server /usr/local/bin/foxmapper-server
COPY --from=builder /app/migrations /app/migrations
ENV BIND_ADDR=0.0.0.0:8080
EXPOSE 8080
CMD ["foxmapper-server"]
