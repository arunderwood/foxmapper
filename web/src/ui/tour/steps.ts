/**
 * The tour's ordered walkthrough (data-model.md §TourStep).
 *
 * Each step is a stable `id`, the `data-testid` `anchor` it spotlights, and plain-language copy.
 * The order **is** the hunt loop (FR-007): the map and its estimate, the three ways any radio
 * contributes, how to bring a team in, and where you land. Copy uses only the words a hunter says on
 * the repeater — no NRQ/DFS/PHG (FR-011, guarded by the vocabulary test).
 *
 * These `anchor` strings are a contract: they are the tour's link to real controls and the surface
 * the drift check runs against (manifest.ts). Renaming one here without renaming the control it
 * points at is exactly the rot US3 exists to catch.
 */
import type { ReportKind } from '../report-entry.js';

export interface TourStep {
  /** Stable identifier; also the key the e2e suite steps by. */
  id: string;
  /** The control this step spotlights. `finish` is anchorless (centred hand-off, FR-015). */
  anchor?: string;
  title: string;
  body: string;
  /** The estimate step: show the scripted credible-region sample (FR-014, Principle I). */
  sample?: boolean;
}

export interface Tour {
  version: number;
  steps: TourStep[];
  coveredKinds: ReportKind[];
}

/**
 * The fixed order (data-model.md §Ordered steps). `share` sits immediately before `finish` (US2).
 * `finish` is the only anchorless step — it points at nothing because it is the hand-off to a live
 * hunt, not a control.
 */
export const STEPS: TourStep[] = [
  {
    id: 'estimate',
    anchor: 'map',
    sample: true,
    title: 'Where the fox might be',
    body: 'The map shades the ground the fox is most likely on — a whole region, never a single dot. Few or clashing reports leave it wide; better ones pull it tight. It never looks more certain than the reports are.',
  },
  {
    id: 'bearing',
    anchor: 'report-bearing',
    title: 'Point a bearing',
    body: 'If you can tell which way the fox is — off a beam or a body fade — drop a bearing. The map draws it as a wedge out from where you are standing.',
  },
  {
    id: 'omni',
    anchor: 'report-omni',
    title: 'Just how strong it is',
    body: 'No beam? A stock handheld with a rubber duck still counts. Say how strong the signal is where you stand — that alone helps close in on the fox.',
  },
  {
    id: 'null',
    anchor: 'report-null',
    title: '“I hear nothing here”',
    body: 'Hearing nothing is real evidence too — it clears ground for everyone. When the fox is silent where you are, say so, and the map rules that ground out.',
  },
  {
    id: 'share',
    anchor: 'share-hunt',
    title: 'Bring the team in',
    body: 'One radio gives a wedge; three give a fix. Tap here to share the hunt — whoever you send it to just opens the link and starts reporting.',
  },
  {
    id: 'finish',
    title: 'You are ready',
    body: 'That is the whole loop. File a report whenever you hear the fox, and watch the map close in. You can take this tour again any time from Settings.',
  },
];
