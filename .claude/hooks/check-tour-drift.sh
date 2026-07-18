#!/usr/bin/env bash
#
# PostToolUse drift guard for the first-visit product tour (spec 003, US3, FR-017/FR-018).
#
# Runs the authoritative drift test (web/tests/unit/tour-manifest.test.ts) whenever a tour-relevant
# file is edited in a Claude Code session, and — on failure — prints the one required action clearly
# enough to act on without opening the spec. The test is the source of truth; this only surfaces it
# in-session so a change that invalidates the tour is caught before it is called done.
#
# Reads the hook payload (JSON) on stdin; exits 0 (silent) for edits to files the tour does not
# depend on, so unrelated work is never interrupted.
set -euo pipefail

payload="$(cat)"

# Pull tool_input.file_path out of the payload without assuming jq is installed.
file="$(printf '%s' "$payload" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{process.stdout.write("")}})' 2>/dev/null || true)"

# Only these surfaces can invalidate the tour (contracts/tour-drift-check.md §Layer 2).
case "$file" in
  *web/src/ui/report-entry.ts | \
  *web/src/ui/share.ts | \
  *web/src/ui/join.ts | \
  *web/src/ui/target.ts | \
  *web/src/ui/map-view.ts | \
  *web/src/ui/settings.ts | \
  *web/src/ui/tour/*) ;;
  *) exit 0 ;;
esac

# Locate the web/ package relative to this script so it works from any cwd and inside a worktree.
script_dir="$(cd "$(dirname "$0")" && pwd)"
root_dir="$(cd "$script_dir/../.." && pwd)"
cd "$root_dir/web"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

if npm run --silent test:unit -- tour-manifest >"$log" 2>&1; then
  echo "✓ Tour drift check passed (tour-manifest) after editing ${file##*/}."
  exit 0
fi

# Blocking feedback to the session (exit 2): the tour may now point at something that no longer
# exists, and a tour that lies to a newcomer is worse than no tour.
cat <<EOF
✗ Tour drift check FAILED — the product tour may be stale after editing ${file##*/}.

Required action (pick one, then this passes again):
  • If the change moved or renamed something the tour points at, update the tour to match:
    web/src/ui/tour/steps.ts (step anchors + copy) and web/src/ui/tour/manifest.ts (anchors,
    coveredKinds, uncoveredKinds).
  • If a new way to contribute a report was added, give it a tour step and add its kind to
    coveredKinds — or, if it is not a way to contribute evidence, add it to uncoveredKinds.
  • If the change is cosmetic and the tour is still correct, no edit is needed; re-run once the
    anchor/kind names are back in sync.

What counts as tour-invalidating is documented in docs/product-tour.md.

--- tour-manifest output ---
EOF
tail -n 25 "$log"
exit 2
