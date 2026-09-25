/**
 * The main thread's side of the estimate worker (contracts/estimate-module.md §2, research R10).
 *
 * Requests coalesce: while one runs, only the newest waits, so a burst of arriving reports costs
 * two estimates rather than one per report. A result older than one already shown is dropped. The
 * worker exists only while the estimate is on (FR-031).
 */
import type { ObservationReport } from '../log/types.js';
import { toEstimateInput } from './input.js';
import type { EstimateInput, EstimateResult } from './types.js';
import type { WorkerRequest, WorkerResponse } from './worker.js';
// `?worker&url`, as basemap.ts loads MapLibre's worker: Vite emits a self-contained bundle and hands
// back its URL, which `warmUp` can also fetch on its own.
import workerUrl from './worker.ts?worker&url';

export interface EstimateClientOptions {
  onResult: (result: EstimateResult) => void;
  /** The previous region stays on screen; the caller only reports the failure. */
  onError: (error: Error) => void;
}

export class EstimateClient {
  #worker: Worker;
  #options: EstimateClientOptions;
  #generation = 0;
  #answered = -1;
  #inFlight = false;
  #pending: EstimateInput | undefined;
  #disposed = false;

  constructor(options: EstimateClientOptions) {
    this.#options = options;
    this.#worker = new Worker(workerUrl, { type: 'module' });
    this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.#receive(event.data);
    this.#worker.onerror = (event) => {
      event.preventDefault();
      this.#options.onError(new Error(event.message || 'estimate worker failed'));
      this.#next();
    };
  }

  /** Estimates from these active reports, as soon as the worker is free. */
  request(active: readonly ObservationReport[]): void {
    if (this.#disposed) return;
    const input = toEstimateInput(active, ++this.#generation);
    if (this.#inFlight) this.#pending = input;
    else this.#post(input);
  }

  dispose(): void {
    this.#disposed = true;
    this.#pending = undefined;
    this.#worker.terminate();
  }

  #post(input: EstimateInput): void {
    this.#inFlight = true;
    const message: WorkerRequest = { type: 'estimate', input };
    this.#worker.postMessage(message);
  }

  #receive(response: WorkerResponse): void {
    if (this.#disposed) return;
    if (response.type === 'result') {
      if (response.result.generation > this.#answered) {
        this.#answered = response.result.generation;
        this.#options.onResult(response.result);
      }
    } else {
      this.#options.onError(new Error(response.message));
    }
    this.#next();
  }

  #next(): void {
    this.#inFlight = false;
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending && !this.#disposed) this.#post(pending);
  }
}

/**
 * Fetches the worker script once, through the service worker, so a participant who first switches
 * the estimate on with no signal still gets it (Principle III). The shell precache cannot see the
 * worker, because `index.html` never names it.
 *
 * On a first visit no service worker controls the page yet, so the fetch waits until one does. It
 * never creates the worker, and a failure is silent: the next online start tries again.
 */
export function warmUp(): void {
  const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (!container) return;
  const fetchOnce = (): void => {
    void fetch(workerUrl).catch(() => undefined);
  };
  if (container.controller) fetchOnce();
  else container.addEventListener('controllerchange', fetchOnce, { once: true });
}
