# Specification Quality Checklist: Shared Bearing Picture

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-14
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Constitution Alignment

- [x] **I. Honest Uncertainty** — FR-011 and FR-013: bearings render as bounded regions, and P1
      publishes no location estimate at all, so no derived claim can outrun its inputs. FR-012b
      extends this to provenance: a relayed report is marked as having passed through a voice hop
      rather than appearing identical to one its observer entered directly.
- [x] **III. Offline Is the Normal Case** — FR-015 through FR-018 cover offline reporting, no report
      loss, union merge, and a primary-view indication of what the device is missing.
- [x] **IV. Append-Only Log, Derived State** — FR-010 (retraction as a new fact), FR-017 (union
      merge), FR-021 (documented format); the shared picture is derived state on every device.
- [x] **V. Interop Over Invention, Plain Language** — FR-019 and FR-020 separate participant-facing
      vocabulary from the on-air mapping. FR-020a keeps the relay concept mapped to the existing
      on-air notion of third-party traffic rather than inventing an encoding for it.
- [x] **II. Every Radio Contributes** — **closed by the 2026-07-14 clarification session.** P1 now
      accepts all four report kinds; FR-005a/b/c/d make signal-strength and negative reports
      first-class and reachable from the same surface, and SC-009 field-validates the non-directional
      path. One residual reading is recorded in Assumptions: the principle asks that these feed the
      *location estimate*, and P1 has no estimate, so "first-class" here means first-class evidence
      on the shared map. The obligation to feed the posterior lands with the story that adds one.

## Notes

- **Session 2026-07-15 (post-plan)** closed the two gaps the plan had flagged and the spec had never
  covered at all. **Clock skew**: FR-009a–d — the offset is measured against the server, retained
  offline, recorded per report, and never used to rewrite what a reporter said. The key distinction
  is `null` (never checked) vs `0` (checked, correct); conflating them would assert a clock is good
  when nothing knows that. **Abuse**: FR-025–027 — there is no remedy for a poisoned hunt and that is
  deliberate. Nobody can retract another's facts; the rate limit stops scripts, not people; a spoiled
  hunt is abandoned for a fresh code. The threat model is now written down in Assumptions, including
  what it does *not* cover: the hunt code is normally read aloud on an open repeater, so a determined
  human with a receiver is out of scope and the constitution's session password is the first thing to
  revisit if that ever stops being acceptable.

- The Principle II violation carried by the initial draft is resolved — all four report kinds ship in
  P1. Nothing needs to reach the plan's Complexity Tracking table on that account.
- Clarification session 2026-07-14 also resolved: one target per hunt, three-bucket bearing
  confidence with full-precision storage, compass-drafts-but-reporter-confirms heading entry, and a
  30-day idle expiry.
- 30-day retention is derived from the interference-hunter persona, not a loose default. **Settled —
  do not re-open.** Re-examine only if continuous position tracking is ever added.
- That pass also **narrowed** scope rather than growing it: an intermediate answer added a
  device-local hunt list, then withdrew it. A device remembers exactly one hunt — the last one — and
  every other hunt is reached by its link. Multi-hunt features are an explicit non-goal (FR-004d).
- Report age carries no rendering meaning (FR-012a): reports are drawn alike and labelled with their
  time. Checked against Principle I, which governs derived estimates and report geometry — P1 derives
  nothing, so a timestamped raw report overstates nothing. Age-weighting becomes a live question when
  fusion arrives.
- A third pass (same day) added the **net control** persona, which was the only one of the four the
  spec structurally could not express. It forced a real data-model change: a report now carries an
  **observer** (whose observation it is, from whose position) distinct from the **operator who
  entered it**. "Reporter" was ambiguous once those can differ and has been normalized to "observer"
  wherever it means whose observation a report is.
- Two non-goals were made explicit rather than left as silence: no net-control console (FR-023) and
  no roles or permissions of any kind (FR-024). Net control is a behaviour, not a role — which is
  what keeps the no-account constraint intact and means a hunt does not break when net control's
  phone dies.
- **Watch in field validation**: net control is the one persona whose context contradicts the spec's
  own constraints (a keyboard and a monitor, versus "one-handed on a phone screen you can barely
  see"). P1 deliberately does not resolve that in their favour. SC-012 is the test; if entering
  relayed reports cannot keep up with voice traffic, the console becomes its own story.
