# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Answer each gate concretely for this feature. An unanswered gate is a failed gate. Violations that
cannot be removed go in Complexity Tracking below with the simpler alternative named.

- [ ] **I. Honest Uncertainty**: Does this feature present any derived estimate? If so, where is its
      credible region rendered, and what makes confidence visibly degrade on poor geometry (<3
      reports, narrow angular spread, multi-modal posterior)? Confirm no uncertainty signal is
      relegated to a footer, tooltip, or dismissible modal.
- [ ] **II. Every Radio Contributes**: Can a participant with a stock handheld and no training
      contribute through this feature? Confirm signal-strength and negative reports remain
      first-class inputs and bearings are not the only path.
- [ ] **III. Offline Is the Normal Case**: State how this feature behaves with no network for the
      whole hunt. Confirm no report is lost or blocked, the estimate still displays, and nothing
      here needs a live server round-trip to be useful in the field.
- [ ] **IV. Append-Only Log, Derived State**: Confirm this feature adds only immutable appended
      facts (corrections are invalidation/supersession records), computes estimates client-side, and
      leaves log merge a conflict-free union.
- [ ] **V. Interop Over Invention, Plain Language**: For each new report kind, name the APRS DF/DFS
      encoding it maps to losslessly, or justify why no on-air format exists. Separately, confirm no
      protocol vocabulary (NRQ, DFS, PHG) reaches a participant-facing surface.
- [ ] **Operating Constraints**: Check RF-leg content is unencrypted and non-business; position
      tracking beyond per-report is opt-in and revocable; no search-and-rescue or certification
      claim; joining still needs no account, install, or payment.
- [ ] **Fusion discipline**: If this plan touches location-estimate mathematics, name the user story
      that motivates it, and cite a field observation if one exists.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
