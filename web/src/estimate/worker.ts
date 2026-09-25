/**
 * The estimate, off the main thread (contracts/estimate-module.md §2).
 *
 * 500 reports take long enough that computing them beside the compass dial and the report sheets
 * would stall both, and report entry must never wait on the estimate (FR-021). `client.ts` is the
 * only thing that talks to this.
 */
import { estimate } from './estimate.js';
import type { EstimateInput, EstimateResult } from './types.js';

export type WorkerRequest = { type: 'estimate'; input: EstimateInput };
export type WorkerResponse =
  | { type: 'result'; result: EstimateResult }
  | { type: 'error'; generation: number; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

scope.onmessage = (event) => {
  const { input } = event.data;
  try {
    scope.postMessage({ type: 'result', result: estimate(input) });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      generation: input.generation,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
