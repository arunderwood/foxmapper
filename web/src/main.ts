/**
 * The app.
 *
 * The shape follows the constitution: everything is local first. The log is loaded from IndexedDB,
 * the map is a fold over it, and the network — when there is one — only feeds reports in and out.
 * Nothing below awaits the server before a hunter can look at a map or file a report.
 */
import './ui/app.css';

import { fold } from './log/fold.js';
import { add, toLog } from './log/gset.js';
import { currentIdentity, rememberHunt } from './log/identity.js';
import {
  loadLog,
  openLogDb,
  outboxDepth,
  putAuthored,
  type FoxmapperDb,
} from './log/store.js';
import { getOffset, measureOffset, type ClockOffset } from './log/clock.js';
import { Sync } from './log/sync.js';
import type { Log, Report } from './log/types.js';
import { watchPosition, type PositionState } from './sensors/position.js';
import { decideLanding, huntIsGone } from './ui/last-hunt.js';
import { joinScreen } from './ui/join.js';
import { MapView } from './ui/map-view.js';
import {
  bearingSheet,
  omniSheet,
  reportBar,
  simpleSheet,
  type ReportKind,
} from './ui/report-entry.js';
import { addToHomeScreenOffer, requestPersistence } from './ui/storage.js';
import type { Target } from './ui/target.js';
import { el, clear } from './ui/dom.js';
import { limitsNotice } from './ui/limits.js';

const API_ORIGIN = import.meta.env['VITE_API_ORIGIN'] ?? window.location.origin;
const DEFAULT_CENTER: [number, number] = [-122.4787, 48.7519];

class App {
  #root: HTMLElement;
  #db!: FoxmapperDb;
  #huntCode = '';
  #target: Target = { frequency: '', label: 'Fox hunt' };
  #log: Log = toLog([]);
  #sync: Sync | undefined;
  #view: MapView | undefined;
  #position: PositionState = { status: 'acquiring' };
  #clockOffset: ClockOffset = null;
  #queueDepth = 0;
  #live = false;
  #tilesUnavailable = false;
  #stopPosition: (() => void) | undefined;

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
      // Fetching the target is best-effort: a hunter who lost coverage after opening the link can
      // still join, so this never blocks.
      const target = await this.#fetchTarget();
      this.#renderJoin(target);
      return;
    }
    this.#identity = identity;

    void this.#fetchTarget().then((target) => {
      if (target) {
        this.#target = target;
        this.#refresh();
      }
    });
    void measureOffset(this.#db, API_ORIGIN).then((offset) => {
      this.#clockOffset = offset;
      this.#refresh();
    });

    this.#renderHunt();
  }

  async #fetchTarget(): Promise<Target | undefined> {
    try {
      const response = await fetch(`${API_ORIGIN}/api/hunts/${this.#huntCode}`);
      if (response.status === 404) {
        huntIsGone();
        return undefined;
      }
      if (!response.ok) return undefined;
      const detail = (await response.json()) as { target: Target };
      return detail.target;
    } catch {
      // Offline. The hunt still opens; the target is simply not known yet.
      return undefined;
    }
  }

  #renderStart(): void {
    clear(this.#root);

    const label = el('input', { type: 'text', placeholder: 'Saturday fox', 'data-testid': 'new-label' });
    const frequency = el('input', { type: 'text', placeholder: '146.52', 'data-testid': 'new-frequency' });
    const create = el('button', { type: 'button', class: 'primary', 'data-testid': 'create-hunt' }, 'Start a hunt');

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
            el('div', { class: 'notice' }, 'Could not reach the server. Starting a hunt needs a signal; joining one does not.'),
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
          if (target) this.#target = target;
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

    this.#view = new MapView(DEFAULT_CENTER, () => {
      this.#tilesUnavailable = true;
      this.#refresh();
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
        this.#live = true;
        this.#refresh();
      },
      onQueueDepth: (depth) => {
        this.#queueDepth = depth;
        this.#refresh();
      },
      onHuntGone: () => {
        huntIsGone();
        this.#live = false;
        this.#refresh();
      },
    });
    void this.#sync.start();

    // The picture renders from local state immediately. Nothing above is awaited.
    this.#refresh();

    window.addEventListener('online', () => {
      void this.#sync?.flush();
    });
    window.addEventListener('offline', () => {
      this.#live = false;
      this.#refresh();
    });
  }

  #openEntry(kind: ReportKind): void {
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

  #authorContext() {
    const fix = this.#position.status === 'ready' ? this.#position.fix : undefined;
    return {
      huntCode: this.#huntCode,
      identity: this.#identity,
      position: fix
        ? { lat: fix.lat, lon: fix.lon }
        : { lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] },
      // Without a device fix the position was not measured, and saying so is the difference
      // between a report someone can weigh and one that quietly claims a GPS it never had.
      position_source: fix ? ('measured' as const) : ('placed' as const),
      ...(fix ? { position_accuracy_m: fix.accuracy_m } : {}),
      observed_at: Date.now(),
      clock_offset_ms: this.#clockOffset,
    };
  }

  #identity = { participant_id: '', callsign: '' };

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
      live: this.#live && navigator.onLine,
      queueDepth: this.#queueDepth,
      clockOffset: this.#clockOffset,
      position: this.#position,
      tilesUnavailable: this.#tilesUnavailable,
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
