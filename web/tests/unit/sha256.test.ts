/**
 * The colour contract is specified in terms of SHA-256, so a wrong digest silently repaints
 * every hunt and breaks Principle IV's "computed identically on every client". This suite
 * checks our sync implementation against Node's, which is OpenSSL.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { sha256, sha256Utf8, toHex } from '../../src/log/sha256.js';

describe('sha256', () => {
  it('matches the published vectors', () => {
    expect(toHex(sha256Utf8(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(sha256Utf8('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('agrees with node:crypto on arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        const expected = createHash('sha256').update(bytes).digest('hex');
        expect(toHex(sha256(bytes))).toBe(expected);
      }),
    );
  });

  it('agrees with node:crypto across every padding boundary', () => {
    // The length-block edge cases: 55/56 bytes and 63/64 bytes are where a padding bug hides.
    for (let n = 0; n <= 130; n++) {
      const bytes = new Uint8Array(n).fill(0x61);
      const expected = createHash('sha256').update(bytes).digest('hex');
      expect(toHex(sha256(bytes))).toBe(expected);
    }
  });

  it('agrees with node:crypto on utf8 text', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const expected = createHash('sha256').update(text, 'utf8').digest('hex');
        expect(toHex(sha256Utf8(text))).toBe(expected);
      }),
    );
  });
});
