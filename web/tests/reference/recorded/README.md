# Recorded reference hunts

Real hunts with a confirmed fox position (FR-039). The folder is empty until a real hunt is
recorded. Until then, every coverage claim rests on simulated hunts alone, and the suite says so.

`tests/unit/reference-hunts.test.ts` loads every `.json` file here. It runs each one through the
same coverage check as the simulated hunts, and it asserts that the confirmed fox position lies
inside the region.

## Adding a hunt

1. Export the hunt's log: every report the device holds for the hunt, as a JSON array in the
   format of [docs/log-format.md](../../../../docs/log-format.md).
2. Write a file here named after the hunt, for example `2026-10-bellingham-park.json`:

   ```json
   {
     "name": "2026-10-bellingham-park",
     "fox": { "lat": 48.7519, "lon": -122.4787 },
     "confirmed_by": "Found by three hunters; position read off the fox's own GPS.",
     "log": []
   }
   ```

3. Say in `confirmed_by` how the fox position was confirmed. A position someone guessed at is not a
   confirmed position.
4. Strip anything a participant would not want public before committing. Callsigns are public on
   the air. Hunt codes and home positions are not.
5. Run `npx vitest run tests/unit/reference-hunts.test.ts --reporter=verbose`. The coverage line
   now counts the recorded hunt.
