# syntax=docker/dockerfile:1
#
# The compose dev build, and nothing else. The production image is built from the root ./Dockerfile;
# there is no second runtime stage here, because an untested copy of one only drifts.

FROM rust:1.98-slim AS base
WORKDIR /app
# Before any cargo call, so dev's cargo-watch resolves the same compiler. rust-toolchain.toml is the
# source of truth; the tag above is only the base layer. When they agree this costs nothing, and when
# Dependabot bumps one first rustup fetches the pinned toolchain rather than quietly building with
# the other one.
COPY rust-toolchain.toml ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Live-reload development. Sources are bind-mounted by compose.
#
# Runs as root on purpose. compose bind-mounts ./server over /app and writes build output to
# /app/target, so a uid that does not match the host's fails on the mount. Production is non-root
# (uid 65532) — see the runtime stage in the root ./Dockerfile.
FROM base AS dev
RUN cargo install cargo-watch --locked
ENV CARGO_TARGET_DIR=/app/target
EXPOSE 8080
CMD ["cargo", "watch", "-x", "run"]
