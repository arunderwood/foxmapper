/**
 * The app.
 *
 * The shape follows the constitution: everything is local first. The log is loaded from IndexedDB,
 * the map is a fold over it, and the network — when there is one — only feeds reports in and out.
 * Nothing below awaits the server before a hunter can look at a map or file a report.
 */

// MapLibre's own stylesheet, first so ours can override it.
//
// Without this its popups are `position: static` and flow out of the bottom of the map instead of
// anchoring to the report they describe, and the attribution control — which the basemap licence
// requires and which must show even when no tile ever loads — is unpositioned. Nothing caught it
// because the E2E suite reads the map's GeoJSON sources rather than its pixels, and the sources
// were always right.
import 'maplibre-gl/dist/maplibre-gl.css';
import './ui/app.css';

import { audit } from './log/audit.js';
import { fold } from './log/fold.js';
import { add, toLog } from './log/gset.js';
import { currentIdentity, rememberHunt } from './log/identity.js';
import {
  getMeta,
  getReports,
  loadLog,
  openLogDb,
  outboxDepth,
  putAuthored,
  setMeta,
  type FoxmapperDb,
} from './log/store.js';
import { getOffset, measureOffset, type ClockOffset } from './log/clock.js';
import { Sync } from './log/sync.js';
import type { Log, Report } from './log/types.js';
import { watchPosition, type PositionState } from './sensors/position.js';
import { decideLanding, huntIsGone } from './ui/last-hunt.js';
import { joinScreen, targetLine } from './ui/join.js';
import { MapView } from './ui/map-view.js';
import {
  bearingSheet,
  omniSheet,
  reportBar,
  simpleSheet,
  type ReportKind,
} from './ui/report-entry.js';
import { canRetract, composeRetraction } from './report/retract.js';
import type { AuthorContext } from './report/author.js';
import { addToHomeScreenOffer, requestPersistence } from './ui/storage.js';
import type { Target } from './ui/target.js';
import { el, clear } from './ui/dom.js';
import { limitsNotice } from './ui/limits.js';

const API_ORIGIN = import.meta.env['VITE_API_ORIGIN'] ?? window.location.origin;

/**
 * Where the map looks before it knows anything.
 *
 * **This is a camera position and nothing else.** It was once also the fallback position for a
 * report with no fix, which meant a wedge could be drawn from here, under a hunter's callsign,
 * marked as though they had placed it by hand. Nothing may read this into a report.
 */
const DEFAULT_CENTER: [number, number] = [-122.4787, 48.7519];

class App {
  #root: HTMLElement;
  #db!: FoxmapperDb;
  #huntCode = '';
  /** Undefined until known. Never a stand-in — see targetChips. */
  #target: Target | undefined;
  #log: Log = toLog([]);
  #sync: Sync | undefined;
  #view: MapView | undefined;
  #position: PositionState = { status: 'acquiring' };
  /** Set by hand on the map. Outranks the device fix: the hunter placed it because GPS was wrong. */
  #placed: { lat: number; lon: number } | undefined;
  #clockOffset: ClockOffset = null;
  #queueDepth = 0;
  #live = false;
  #tilesUnavailable = false;
  #stopPosition: (() => void) | undefined;
  #identity = { participant_id: '', callsign: '' };

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  async start(): Promise<void> {
    this.#db = await openLogDb();
    // An offer, never a gate: if this is denied, everything still works.
    void requestPersistence();

    const landing = decideLanding();
    if (landing.screen === 'start') {
      this.#renderStart();
      return;
    }

    this.#huntCode = landing.code;
    rememberHunt(landing.code);

    // Local state first. The map can render before the network is even consulted.
    this.#log = await loadLog(this.#db, this.#huntCode);
    this.#clockOffset = await getOffset(this.#db);
    this.#queueDepth = await outboxDepth(this.#db, this.#huntCode);

    const identity = await currentIdentity(this.#db);
    if (!identity) {
      // Joining is a purely local act, so the join screen goes up now and the target fills in
      // behind it. Awaiting the fetch here meant a captive portal or a weak link left the
      // participant looking at nothing at all for the life of the request — offline it rejected
      // fast and the "this never blocks" claim held by luck rather than by design.
      this.#renderJoin(undefined);
      void this.#fetchTarget().then((target) => {
        if (!target) return;
        this.#target = target;
        // Updated in place, never re-rendered: by the time this lands the hunter may be typing
        // their callsign into this screen, or may already be looking at the map.
        const line = this.#root.querySelector('[data-testid="join-target"]');
        if (line) line.textContent = targetLine(target, this.#huntCode);
        // ...and if they joined while it was in flight, the map is the thing that needs telling.
        this.#refresh();
      });
      return;
    }
    this.#identity = identity;

    void this.#fetchTarget().then((target) => {
      if (target) {
        this.#target = target;
        this.#refresh();
      }
    });
    void this.#measureClock();

    this.#renderHunt();
  }

  /**
   * The hunt is gone: purged after 30 idle days, or a code that never existed.
   *
   * The spec is exact about this — the participant "is not dropped into a purged hunt. They land
   * where a first-time visitor lands." Forgetting the code alone left them sitting in a dead hunt
   * while sync reconnected to a 204 and polled a 404 forever.
   */
  #huntGone(): void {
    huntIsGone();
    this.#sync?.stop();
    this.#sync = undefined;
    this.#stopPosition?.();
    this.#stopPosition = undefined;
    this.#view?.destroy();
    this.#view = undefined;
    this.#live = false;
    this.#huntCode = '';
    this.#target = undefined;
    this.#log = toLog([]);
    this.#renderStart();
  }

  /**
   * Measures the device's clock against the server (FR-009a).
   *
   * Runs on every reconnect, not once at join: a device that joined with no coverage would
   * otherwise record `clock_offset_ms: null` on every report until the page was reloaded — honest,
   * but never taking a measurement it could have taken.
   */
  async #measureClock(): Promise<void> {
    this.#clockOffset = await measureOffset(this.#db, API_ORIGIN);
    this.#refresh();
  }

  /**
   * The divergence audit (plan 3.4).
   *
   * The cursor protocol has one silent-loss failure mode, and this is the only thing that looks for
   * it. It skips itself while anything is queued, so it costs one cheap digest comparison per
   * reconnect and does the expensive diff only when the digests disagree.
   */
  async #auditLog(): Promise<void> {
    const result = await audit(this.#db, this.#huntCode, API_ORIGIN, [...this.#log.keys()]);
    if (result.status !== 'diverged') return;

    // The reports this device holds and the server does not. This is the case that loses a report,
    // and re-queueing them is the whole repair.
    const missingRemotely = await getReports(this.#db, result.missingRemotely ?? []);
    await this.#sync?.repair(missingRemotely);
  }

  /** The last target this device was told, so an offline reopen knows what it is hunting. */
  #targetKey(): string {
    return `target:${this.#huntCode}`;
  }

  async #cachedTarget(): Promise<Target | undefined> {
    return getMeta<Target>(this.#db, this.#targetKey());
  }

  /**
   * Fetches the target and remembers it.
   *
   * FR-004c promises the remembered hunt reopens offline and FR-004b promises the frequency is in
   * the primary view — which together mean the target cannot live only in a fetch. Cached here so
   * the second promise survives the first.
   */
  async #fetchTarget(): Promise<Target | undefined> {
    try {
      const response = await fetch(`${API_ORIGIN}/api/hunts/${this.#huntCode}`);

      // 404 is the one answer that means something rather than nothing: this hunt is gone.
      if (response.status === 404) {
        this.#huntGone();
        return undefined;
      }

      // Any other bad answer — a 5xx, a captive portal's login page — tells us nothing about the
      // target, so it falls back to what this device was last told. **Bad network is the more
      // common field failure than no network**, and it was the one case the cache did not cover.
      if (!response.ok) return this.#cachedTarget();

      const detail = (await response.json()) as { target: Target };
      await setMeta(this.#db, this.#targetKey(), detail.target);
      return detail.target;
    } catch {
      // Offline, or a body that would not parse. Whatever this device was last told still stands —
      // and if it was never told, the primary view says the target is unknown rather than
      // inventing a plausible one.
      return this.#cachedTarget();
    }
  }

  #renderStart(): void {
    clear(this.#root);

    const label = el('input', {
      type: 'text',
      placeholder: 'Saturday fox',
      'data-testid': 'new-label',
    });
    const frequency = el('input', {
      type: 'text',
      placeholder: '146.52',
      'data-testid': 'new-frequency',
    });
    const create = el(
      'button',
      { type: 'button', class: 'primary', 'data-testid': 'create-hunt' },
      'Start a hunt',
    );

    create.addEventListener('click', () => {
      void (async () => {
        create.toggleAttribute('disabled', true);
        try {
          const response = await fetch(`${API_ORIGIN}/api/hunts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              target: { frequency: frequency.value, label: label.value || 'Fox hunt' },
            }),
          });
          const hunt = (await response.json()) as { code: string };
          window.location.href = `/h/${hunt.code}`;
        } catch {
          create.toggleAttribute('disabled', false);
          this.#root.append(
            el(
              'div',
              { class: 'notice' },
              'Could not reach the server. Starting a hunt needs a signal; joining one does not.',
            ),
          );
        }
      })();
    });

    this.#root.append(
      el(
        'div',
        { class: 'screen', 'data-testid': 'start-screen' },
        el('h1', {}, 'FoxMapper'),
        el('p', { class: 'dim' }, 'A shared map of who heard what, and from where.'),
        el('label', {}, 'What are you hunting?'),
        label,
        el('label', {}, 'Frequency (however you say it)'),
        frequency,
        create,
        limitsNotice(),
      ),
    );
  }

  #renderJoin(target: Target | undefined): void {
    clear(this.#root);
    this.#root.append(
      joinScreen({
        db: this.#db,
        huntCode: this.#huntCode,
        target,
        onJoined: () => {
          void currentIdentity(this.#db).then((identity) => {
            if (!identity) return;
            this.#identity = identity;
            this.#renderHunt();
          });
        },
      }),
    );
  }

  #renderHunt(): void {
    clear(this.#root);

    this.#view = new MapView({
      center: DEFAULT_CENTER,
      onTilesUnavailable: () => {
        this.#tilesUnavailable = true;
        this.#refresh();
      },
      // FR-010. Only what this phone entered, and only ever as a new fact: the original stays in
      // the log forever, and no participant can touch anyone else's report.
      retract: {
        can: (id) => {
          const report = this.#log.get(id);
          return report ? canRetract(report, this.#identity.participant_id) : false;
        },
        do: (id) => {
          const report = this.#log.get(id);
          if (!report) return;
          void this.#submit(composeRetraction(this.#retractionContext(report), id));
        },
      },
    });

    // The bar goes inside the map view, not into a second wrapper: nesting .map-view in itself
    // leaves the inner one with no height to fill.
    this.#view.root.append(reportBar((kind) => this.#openEntry(kind)));
    this.#root.append(this.#view.root);

    const offer = addToHomeScreenOffer(() => {});
    if (offer) this.#root.append(offer);

    this.#stopPosition = watchPosition((state) => {
      const first = this.#position.status !== 'ready' && state.status === 'ready';
      this.#position = state;
      if (first && state.status === 'ready') {
        this.#view?.center([state.fix.lon, state.fix.lat]);
      }
      this.#refresh();
    });

    this.#sync = new Sync({
      db: this.#db,
      huntCode: this.#huntCode,
      apiOrigin: API_ORIGIN,
      onReports: (reports) => {
        for (const report of reports) this.#log = add(this.#log, report);
        this.#refresh();
      },
      // Tracks the stream, not the traffic: a hunt where nobody has reported yet is not a hunt
      // this device has lost touch with.
      onLive: (live) => {
        this.#live = live;
        this.#refresh();
        // Back in coverage. Two things are worth doing exactly here, and only here: measure the
        // clock (FR-009a), and check this device holds what the server holds.
        if (live) {
          void this.#measureClock();
          void this.#auditLog();
        }
      },
      onQueueDepth: (depth) => {
        this.#queueDepth = depth;
        this.#refresh();
      },
      onHuntGone: () => this.#huntGone(),
    });
    void this.#sync.start();

    // The picture renders from local state immediately. Nothing above is awaited.
    this.#refresh();

    window.addEventListener('online', () => {
      void this.#sync?.flush();
      // The stream may take its backoff to notice; the clock measurement should not wait for it.
      void this.#measureClock();
    });
    window.addEventListener('offline', () => {
      this.#live = false;
      this.#refresh();
    });
  }

  #openEntry(kind: ReportKind): void {
    // Every report is a claim about a place. With no fix and nothing placed there is no place to
    // claim, so the hunter is asked for one instead of having one invented for them — and then
    // dropped straight into the report they came for.
    if (!this.#authorContext()) {
      this.#placePosition(() => this.#openEntry(kind));
      return;
    }

    const options = {
      context: () => this.#authorContext(),
      onSubmit: (report: Report) => void this.#submit(report),
    };
    const close = (): void => sheetNode.remove();
    const sheetNode =
      kind === 'bearing'
        ? bearingSheet(options, close)
        : kind === 'omni'
          ? omniSheet(options, close)
          : simpleSheet(kind, options, close);
    document.body.append(sheetNode);
  }

  /**
   * The envelope for a report authored right now, or **undefined when this phone has no position**.
   *
   * There is no fallback coordinate. A hand-placed position is a fact the hunter asserted; a device
   * fix is one the phone measured; and when there is neither there is nothing honest to write. The
   * map used to substitute its default centre here and label it `placed`, which told every other
   * participant that a human had put the report where it sat.
   *
   * Placed outranks measured: a hunter only places themselves when the phone is wrong or silent,
   * and quietly preferring the fix afterwards would overrule them.
   */
  #authorContext(): AuthorContext | undefined {
    const fix = this.#position.status === 'ready' ? this.#position.fix : undefined;

    const position = this.#placed
      ? { position: this.#placed, position_source: 'placed' as const }
      : fix
        ? {
            position: { lat: fix.lat, lon: fix.lon },
            position_source: 'measured' as const,
            position_accuracy_m: fix.accuracy_m,
          }
        : undefined;
    if (!position) return undefined;

    return {
      huntCode: this.#huntCode,
      identity: this.#identity,
      ...position,
      observed_at: Date.now(),
      clock_offset_ms: this.#clockOffset,
    };
  }

  /**
   * The envelope for a retraction.
   *
   * **Withdrawing a wrong report must never be blocked**, least of all by a missing GPS fix — a
   * hunter who knows their bearing is wrong and cannot say so leaves the map drawing a wedge
   * everybody else is about to act on.
   *
   * The format requires a position on every record, and a retraction makes no claim about a place:
   * nothing renders it, because the fold never treats a retraction as an observation. So the
   * retractor's own position is used when there is one, and otherwise the retraction inherits the
   * position of the report it withdraws — a fact already in the log rather than a new invention
   * about where anyone stood.
   */
  #retractionContext(report: Report): AuthorContext {
    return (
      this.#authorContext() ?? {
        huntCode: this.#huntCode,
        identity: this.#identity,
        position: report.position,
        position_source: report.position_source,
        observed_at: Date.now(),
        clock_offset_ms: this.#clockOffset,
      }
    );
  }

  /** Point-at-map (FR-008a): the hunter taps where they are, and that is where their reports come from. */
  #placePosition(then?: () => void): void {
    this.#view?.beginPlacing('Tap the map where you are standing', (position) => {
      this.#placed = position;
      this.#refresh();
      then?.();
    });
  }

  async #submit(report: Report): Promise<void> {
    // Durable first, then rendered, then sent. The order is the whole of Principle III.
    await putAuthored(this.#db, report);
    this.#log = add(this.#log, report);
    this.#queueDepth = await outboxDepth(this.#db, this.#huntCode);
    this.#refresh();
    void this.#sync?.flush();
  }

  #refresh(): void {
    this.#view?.update({
      fold: fold(this.#log),
      target: this.#target,
      huntCode: this.#huntCode,
      live: this.#live && navigator.onLine,
      queueDepth: this.#queueDepth,
      clockOffset: this.#clockOffset,
      position: this.#position,
      placed: this.#placed,
      tilesUnavailable: this.#tilesUnavailable,
      onPlace: () => this.#placePosition(),
      onUseDevice: () => {
        this.#placed = undefined;
        this.#refresh();
      },
    });
  }

  destroy(): void {
    this.#sync?.stop();
    this.#stopPosition?.();
    this.#view?.destroy();
  }
}

const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  void app.start();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { type: 'module' });
  });
}
