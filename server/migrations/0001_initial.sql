-- The relay's whole schema.
--
-- The server stores an envelope and deliberately cannot read the domain: `body` is opaque jsonb,
-- and no column here knows what a bearing is. Every table would be identical if the payload were
-- recipes.

CREATE TABLE hunts (
    code       TEXT        PRIMARY KEY,
    created_at BIGINT      NOT NULL,
    -- Opaque string. Hunters say "146.52", "two meters", "the 440 machine". Validating it as a
    -- number would reject real input to enable a computation that does not exist.
    frequency  TEXT        NOT NULL,
    label      TEXT        NOT NULL
);

-- The target is fixed at creation: a mutable target would be server-held domain state a device
-- could not recompute from the log, and two people renaming it concurrently has no correct answer.
-- There is deliberately no UPDATE path.

CREATE TABLE reports (
    id          UUID     PRIMARY KEY,
    hunt_code   TEXT     NOT NULL REFERENCES hunts(code) ON DELETE CASCADE,
    seq         BIGSERIAL NOT NULL UNIQUE,
    -- Envelope metadata, NOT part of the report. Feeds the idle purge clock and lets a client
    -- notice its own phone clock is wrong. The report itself stays client-authored and immutable.
    received_at BIGINT   NOT NULL,
    body        JSONB    NOT NULL
);

-- The cursor read: everything above `since`, ascending, for one hunt.
CREATE INDEX reports_hunt_seq_idx ON reports (hunt_code, seq);

-- The idle purge clock is max(received_at) per hunt.
CREATE INDEX reports_hunt_received_idx ON reports (hunt_code, received_at DESC);

-- Appends serialize through pg_advisory_xact_lock(hashtext(hunt_code)) rather than a lock table:
-- the lock is held for the whole transaction, so seq order matches commit order and no seq is
-- ever visible before its row commits. Without that, a reader can observe seq 5 while seq 4 is
-- still in flight, advance its cursor past 4, and never see it — the one place this design can
-- silently lose a report. An advisory lock (not a row lock) because it works across instances.
