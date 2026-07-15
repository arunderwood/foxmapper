<!--
Sync Impact Report
==================
Version change: (unfilled template) → 1.0.0
Bump rationale: Initial ratification. Template placeholders replaced with concrete
governance; no prior version to compare against.

Modified principles:
  - [PRINCIPLE_1_NAME] → I. Honest Uncertainty (NON-NEGOTIABLE)
  - [PRINCIPLE_2_NAME] → II. Every Radio Contributes
  - [PRINCIPLE_3_NAME] → III. Offline Is the Normal Case
  - [PRINCIPLE_4_NAME] → IV. Append-Only Log, Derived State
  - [PRINCIPLE_5_NAME] → V. Interop Over Invention, Plain Language Over Jargon

Added sections:
  - Operating Constraints (was [SECTION_2_NAME])
  - Development Workflow (was [SECTION_3_NAME])
  - Governance (rules filled)

Removed sections: none

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check gates added
  - ✅ .specify/templates/spec-template.md — field-gate + uncertainty/offline prompts added
  - ✅ .specify/templates/tasks-template.md — field-gate checkpoint note added
  - ✅ .claude/skills/speckit-*/SKILL.md — reviewed, no agent-specific or outdated
       references requiring change

Follow-up TODOs: none
-->

# FoxMapper Constitution

## Core Principles

### I. Honest Uncertainty (NON-NEGOTIABLE)

The product's output is a claim about where a transmitter is, and that claim will be acted on by
people driving vehicles and walking into terrain. A confident-looking result that is wrong is worse
than no result.

- Every location estimate MUST be rendered with its credible region, never as a bare point.
- The system MUST visibly degrade its own confidence when report geometry is poor: fewer than three
  reports, narrow angular spread, or multi-modal posterior mass.
- Uncertainty warnings MUST appear in the primary view. They MUST NOT live in a footer, a tooltip,
  or a dismissible modal.
- No feature may present a derived estimate more precisely than its inputs support. Any PR that
  makes the output look more certain without making it more correct is rejected on this principle
  alone.

### II. Every Radio Contributes

The system's advantage over existing tools is that participants without directional antennas produce
useful evidence.

- Signal-strength reports and negative ("heard nothing here") reports MUST be first-class inputs to
  the location estimate, not annotations layered beside it.
- Any change that makes bearing reports the only path to contribution violates this principle.
- The reporting interface MUST be usable by someone holding a handheld radio with a stock antenna
  and no prior training.

### III. Offline Is the Normal Case

Hunts happen where cell coverage does not.

- Every feature MUST function with no network connection for the duration of a hunt, degrading only
  to the reports the device already holds.
- Loss of connectivity MUST NOT lose reports, block reporting, or block display of the location
  estimate.
- Any feature that requires a live server round-trip to be useful in the field is rejected or
  redesigned.

### IV. Append-Only Log, Derived State

- Reports are immutable and append-only. Corrections are new facts — invalidation, supersession —
  never mutations or deletions.
- The location estimate is derived state, computed identically from the same log on every client. It
  is never authoritative on the server.
- Merging two divergent logs MUST be a union requiring no conflict resolution.
- The log format MUST be documented and reimplementable by a third party.

### V. Interop Over Invention, Plain Language Over Jargon

Prior art exists and is specified. We reuse it on the wire — and we never make a participant learn
it.

- **On the wire**: report semantics (bearing quality, range, signal-strength grading) MUST map
  losslessly to the APRS DF and DFS formats, which remain the only specified on-air encoding for
  these observations. Every report kind MUST be expressible in, and ingestible from, an existing
  on-air format where one exists.
- **In the interface**: the language MUST be the language hunters actually speak — fox, bunny,
  sniffer, attenuator, body fade, bearing, null, S-meter, "I hear nothing here." Protocol vocabulary
  (NRQ, DFS, PHG) MUST NOT appear on any participant-facing surface. These formats are a 1990s
  encoding that most APRS clients never implemented and that the great majority of active hunters
  have never encountered; reusing them is an interoperation decision, not a vocabulary decision, and
  must never be confused for one.
- The two rules above pull in opposite directions on purpose. Where they conflict, the interface
  wins and the mapping absorbs the ugliness.
- New concepts require justification against what already exists — on the wire, against the existing
  formats; in the interface, against what a hunter would actually say on the repeater.

## Operating Constraints

**Regulatory**: If any transport bridges to amateur radio spectrum, message content on the RF leg
MUST NOT be encrypted or obscured, and MUST NOT carry business communications. Session passwords
protect the internet leg only.

**Privacy**: Participant location is shared per-report by default. Continuous position tracking is
opt-in, per-session, and revocable. Sessions expire and purge by default. The system MUST NOT become
a location beacon by accident.

**Liability**: The product is not certified for life-safety search. It MUST NOT be marketed for
search-and-rescue, MUST NOT imply certification, and MUST express its limits in the interface rather
than in terms of service.

**Cost of entry**: Joining a hunt MUST require no account, no install, and no payment.

## Development Workflow

**Field-gate**: Each user story ships to a real hunt with real participants before the next story is
started. A story is not done when its tests pass; it is done when someone used it outdoors and the
interaction survived contact.

**Fusion discipline**: The location-estimate mathematics is the most interesting part of this
project and therefore the most likely to be built beyond what any user asked for. Fusion work
requires a named user story and a field observation motivating it.

**Simplicity**: The server has no opinion about direction finding. Any proposal to move estimation,
interpretation, or DF-specific logic server-side requires explicit justification against Principles
III and IV.

## Governance

This constitution supersedes all other development practices. Where a plan, spec, task list, or
review comment conflicts with it, the constitution wins.

**Compliance review**: Every PR and review MUST verify compliance with the five Core Principles and
the Operating Constraints. A reviewer MAY reject a PR citing a principle alone, with no further
justification required. Complexity that violates a principle MUST be recorded in the plan's
Complexity Tracking table with the simpler alternative named and the reason it was rejected — an
unrecorded violation is a defect regardless of merit.

**Amendment procedure**: Amendments MUST be proposed as a PR that changes this file, states the
version bump and its rationale, and lists the dependent artifacts it touches. Any amendment
loosening a MUST requires a migration plan describing what happens to features that relied on the
stricter rule.

**Versioning policy**: Semantic versioning applies to this document.

- MAJOR: a principle is removed, or redefined in a way that would reverse a past rejection.
- MINOR: a principle or section is added, or its guidance is materially expanded.
- PATCH: clarification, wording, or typo fixes that change no outcome.

**Version**: 1.0.0 | **Ratified**: 2026-07-14 | **Last Amended**: 2026-07-14
