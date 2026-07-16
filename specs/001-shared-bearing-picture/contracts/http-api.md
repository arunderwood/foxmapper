# Contract: Relay HTTP API

The server is a **relay**. It stores reports, tells a device what it is missing, pushes new ones, and
purges at 30 days. It has **no opinion about direction finding** — it never parses a report body, and
every endpoint here would be identical if the payload were recipes.

That is not minimalism for its own sake. Principle III says nothing may require a live server
round-trip to be useful in the field, and Principle IV says the estimate is never authoritative on the
server. An API that could interpret a bearing would be an API someone would eventually ask to compute
one.

All responses are JSON unless noted. All requests are HTTPS.

## Auth

Possession of the hunt code. That is all (spec Assumptions).

The code travels in the URL path, which means **it will appear in server access logs** — a known,
accepted consequence of `EventSource` not supporting custom headers. Hunt content is not sensitive on
its own terms, and the constitution's RF rules do not apply: P1 has no on-air leg.

### Joining is a purely local act

**There is no join endpoint, and that is a decision rather than an omission.**

Joining means: open the link, pick a callsign, start reporting. The device mints its own
`participant_id` (UUIDv4) on first use and keeps it locally. The server is never told, never issues an
identity, and holds no roster — a participant first becomes visible to anyone else when their first
report arrives.

This falls out of the constitution rather than convenience. "Joining a hunt MUST require no account"
means there is nothing to register; Principle III means joining must work with the network already
gone (a participant who loaded the link and lost coverage can still pick a callsign and report). A
join endpoint would add a round-trip that buys nothing and breaks offline join.

Consequences worth stating: the participant roster is derived from the log (the distinct observers of
active reports), a participant who has reported nothing does not exist to anyone else, and there is no
way to enumerate who is present. That is fine — the map shows reports, not attendance.

### Hunt codes

The code is the entire access control, so its entropy is a security property rather than a cosmetic
choice.

- **Format**: `word-word-NNNN` (e.g. `quiet-fox-8821`) — speakable over a repeater, which is the
  actual delivery channel for half the people who will use it. That is the requirement the format
  exists to serve.
- **Entropy**: **at least 40 bits, from a CSPRNG.** Two 256-word lists plus four digits is ~29 bits —
  **not enough**, and a naive implementation of the format above will land there. Either widen the
  lists (two × 2048 words + four digits ≈ 35 bits, still short) or append a random suffix. **Do not
  ship a code a script can enumerate**: guessing one grants full read and write, including the ability
  to plant a false `fix`.
- **Collision**: generate, insert, retry on unique-violation. Do not check-then-insert.
- Codes are **case-insensitive** on lookup and stored lowercase — they get read aloud and typed with
  gloves.
- Codes are never reused, including after purge.

---

## `POST /api/hunts`

Create a hunt. No account, no install, no payment (FR-001).

**Request**

```json
{ "target": { "frequency": "146.52", "label": "Saturday fox" } }
```

**Response** `201`

```json
{
  "code": "quiet-fox-8821",
  "created_at": 1784092800000,
  "target": { "frequency": "146.52", "label": "Saturday fox" }
}
```

`frequency` is an **opaque string**, never parsed. Hunters say "146.52", "two meters", "the 440
machine". Validating it as a number would reject real input to enable a computation that does not
exist.

---

## `GET /api/hunts/{code}`

Hunt metadata, so a joining device can show the target before any reports arrive.

**Response** `200`

```json
{
  "code": "quiet-fox-8821",
  "created_at": 1784092800000,
  "target": { "frequency": "146.52", "label": "Saturday fox" },
  "report_count": 47,
  "id_digest": "sha256:1a2b3c…"
}
```

`404` if unknown **or purged** — the two are indistinguishable on purpose. After purge there is
nothing to disclose.

`report_count` and `id_digest` exist for the divergence audit below. They are cheap for the server and
O(1) for the client.

**`id_digest` is specified exactly, because "SHA-256 over the sorted id list" is not a specification —
a third party would guess a different answer and the audit would report divergence that isn't there:**

```
digest = "sha256:" + hex(
   SHA-256( join( sort_asc( [ lowercase(id) for id in reports ] ), "\n" ) )
)
```

- Sort **ascending, bytewise**, over the lowercase canonical UUID strings (ASCII, so bytewise and
  lexicographic agree).
- Join with a single `\n`. **No trailing newline.**
- Lowercase hex.
- The digest of an empty log is the SHA-256 of the empty string.

The client computes this over its own local log, including reports it has not yet synced — so a
mismatch is expected while the outbound queue is non-empty. **Only audit when the queue is empty**,
or the check cries wolf every time someone reports offline.

### Target immutability

**The target is fixed at creation and there is no endpoint to change it.** `frequency` and `label` are
set by `POST /api/hunts` and never updated.

This is deliberate. A mutable target would be server-held domain state that a device could not
recompute from the log, which Principle IV forbids, and it would need a conflict rule that the union
merge does not have — two people renaming a target concurrently has no correct answer. If a hunt is
chasing a different thing, that is a different hunt, and hunts are cheap and disposable by design.

`found` is **not** part of the target here — it is derived from the log on each device
([data-model.md](../data-model.md)). The server does not know whether the fox has been found and has
no way to find out.

---

## `POST /api/hunts/{code}/reports`

Append. **Idempotent by report `id`.**

**Request**: one report object per [log-format.md](log-format.md), or an array for a queue flush.

**Response** `202`

```json
{ "accepted": ["9f1c2d3e-…", "7a8b9c0d-…"] }
```

**Rules**

- **Idempotent by `id`**: re-appending a known `id` is a no-op returning `202`. This is what lets the
  client retry blindly forever with no dedup logic — exactly what a flaky mobile link needs, and the
  reason the outbound queue can be dumb.
- The body is **stored opaquely**. The server validates only that `id` is a UUID and the JSON parses.
  It does not check `kind`, does not validate a heading, does not reject a `confidence_q` of 9.
  Enforcing domain rules here would put direction-finding logic in the server.
- **Appends are serialized through a single writer.** Not for throughput. See "The sequence gap".
- Purged or unknown hunt → `404`. The client keeps the report locally rather than discarding it.
- **Rate limited** (FR-026). Anti-flood only, not anti-abuse — see below.

### Rate limiting

A loose per-IP cap on appends. Deliberately crude, and worth being clear about why:

- **It exists to stop a script, not to pace a person.** Set it high enough that a hunt full of hunters
  reporting hard never touches it. A rate limit that fires during a real hunt is a bug — it would put
  the network in the write path, which Principle III forbids, and the client's queue would silently
  back up in the field.
- **Per-IP is the only handle we have.** There are no accounts, so there is nothing else to key on.
  It is trivially defeated by anyone who cares, and that is accepted: this stops a runaway loop and a
  bored script, not a determined human.
- `429` must be treated by the client as **retryable, never as a rejection**. The report stays in the
  local queue. A dropped report is the one unacceptable outcome.
- **No rate limit on reads or the stream** — a hunt of thirty devices all catching up at once is
  normal, not an attack.

### What the server will not do about bad reports

Nothing. This is worth stating in the contract because it is the kind of thing a future maintainer
will try to "fix":

- **There is no endpoint to delete, hide, edit, or override a report** (FR-025), and there must not
  be. Only the participant who entered a report can retract it, and they do that by appending a
  retraction like any other fact.
- **No moderator, no creator privilege.** The hunt's creator has no powers; there is no role to grant
  (FR-024). A creator whose phone dies must not take the hunt with them.
- Anyone with the code can append anything, including a false `fix`. The remedy is social: abandon the
  hunt, share a new code. Hunts are cheap and disposable by design, and that disposability *is* the
  moderation story.
- A poisoned hunt keeps its 30-day idle clock alive as long as the poisoner keeps reporting. Accepted:
  it is a dead code holding some rows.

---

## `GET /api/hunts/{code}/reports?since={seq}`

Catch-up. Everything with a sequence above `since`, ascending.

**Response** `200`

```json
{
  "reports": [ { "seq": 48, "received_at": 1784092900000, "body": { } } ],
  "cursor": 48
}
```

`since=0` (or omitted) returns the whole log. That is the recovery path after storage eviction, and it
is why eviction costs a re-download rather than a lost hunt.

`received_at` is **envelope metadata, not part of the report** — the report stays client-authored and
immutable. It exists for two reasons: the idle purge clock, and letting a client notice its own phone
clock is wrong.

---

## `GET /api/hunts/{code}/stream`

SSE. **This endpoint is the sync protocol and the realtime protocol at once**, which is the single
best structural decision in the design.

```
GET /api/hunts/quiet-fox-8821/stream
Accept: text/event-stream
Last-Event-ID: 47
```

```
retry: 5000

id: 48
data: {"seq":48,"received_at":1784092900000,"body":{ }}

: ping
```

**Rules**

- `id:` is the **server sequence**. The browser stores it and replays it as `Last-Event-ID` on
  reconnect, per the WHATWG spec — automatically, with no client code. So the handler is: *stream
  everything above `Last-Event-ID`, then stream live.* Reconnecting after four offline hours and
  receiving a live report are the same path.
- `Last-Event-ID` absent → stream from 0.
- `retry:` sets the browser's reconnect delay.
- `: ping` comments every 30–60 s keep NAT and proxies from killing an idle stream. Keep them sparse;
  each one is a radio wake-up.
- **`204 No Content` when the hunt is purged or unknown.** Per spec this tells the browser to stop
  reconnecting *permanently* — a clean, correct end for an expired hunt, and the reason the client can
  land an arriving participant where a first-timer lands without polling a dead code forever.

**Deployment requirements — these are not tuning, they are correctness:**

- **Disable proxy buffering** (`X-Accel-Buffering: no`, `proxy_buffering off`). nginx buffers by
  default: events sit in a buffer, the client sees nothing for minutes, and SC-002's five seconds
  fails *invisibly and only in production*. This is the number one SSE footgun.
- **Serve over HTTP/2 or HTTP/3.** HTTP/1.1's six-connections-per-origin cap is marked "Won't fix" in
  Chrome and Firefox.
- Long read timeouts. A healthy stream looks idle.

**Client-side caveat worth stating plainly**: SSE's automatic reconnection is *oversold*. Only network
errors retry. A non-200 or a wrong MIME type makes the browser **fail the connection and never
reconnect** — so a transient 502 from a load balancer kills the stream for good. The client must watch
`onerror`, check `readyState === CLOSED`, and re-create the `EventSource` with backoff. Less reconnect
logic than WebSocket, not none.

---

## `GET /api/hunts/{code}/ids`

The divergence audit's slow path. Returns every report `id`.

**Response** `200`

```json
{ "ids": ["9f1c2d3e-…", "7a8b9c0d-…"] }
```

Only fetched when `id_digest` from `GET /api/hunts/{code}` disagrees with the client's. At ~36 bytes
per UUID this is ~180 KB for 5,000 reports — far too much to poll, and fine as a rare repair.

**Why this exists.** The cursor protocol has exactly one silent-loss failure mode (below). The
constitution says no report may be lost; the honest response is to **detect divergence rather than
assume correctness**. Compare a digest for free; do the expensive diff only when it says something is
wrong. *(This audit is our own construction, not a standard protocol.)*

---

## The sequence gap

**The one place this design can silently lose a report.**

If `seq` is assigned at transaction start and commits land out of order, a reader can observe seq 5
while seq 4 is still in flight, advance its cursor past 4, and **never see 4**. No error, no retry —
the report simply never arrives, and the log has diverged permanently.

**Mitigation: serialize appends through a single writer**, so a sequence is never visible before it is
committed. At tens of participants and thousands of reports this costs nothing measurable, and it
removes the failure mode rather than narrowing it. The digest audit above is the belt to this
suspenders.

## Purge

- A hunt purges **30 days after its most recent report** (FR-004). Idle-based: every append restarts
  the clock, so a hunt in use never expires under its participants.
- Purge deletes the hunt and its reports. `GET` endpoints then `404`; the stream `204`s.
- A hunt with no reports purges 30 days after creation.

## What the server deliberately does not do

Worth listing, because each is a thing someone will eventually propose:

- Parse or validate a report body beyond "is this JSON with a UUID `id`".
- Compute, store, or serve a location estimate. There isn't one, and if there were it would be
  derived state on the client (Principle IV).
- Decode or encode APRS. That mapping is client-side (see [aprs-mapping.md](aprs-mapping.md)).
- Deduplicate similar reports. Two relays of one voice call are two reports (log-format.md).
- Order, rank, fade, or filter by age (FR-012a).
- Know what a callsign is, or that two participants share one.
- Authenticate anyone.
