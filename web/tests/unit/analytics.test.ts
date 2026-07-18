/**
 * The hunt code is a shared secret (see docs/analytics.md). This holds the one guard that keeps it
 * out of analytics — the URL redactor — to account. A regression here silently leaks the code that
 * admits a device to a hunt, so the cases below are deliberately mean: query strings, fragments,
 * multiple hunts in one string, and the shapes PostHog actually produces for `$current_url`.
 */
import { describe, expect, it } from 'vitest';
import { redactHuntCode } from '../../src/analytics/redact.js';

describe('redactHuntCode', () => {
  it('rewrites a hunt path to /h/:code', () => {
    expect(redactHuntCode('/h/ABC123')).toBe('/h/:code');
  });

  it('redacts the code inside a full origin URL', () => {
    expect(redactHuntCode('https://foxmapper.example/h/ABC123')).toBe(
      'https://foxmapper.example/h/:code',
    );
  });

  it('stops the code at a query string, keeping the rest intact', () => {
    expect(redactHuntCode('https://foxmapper.example/h/ABC123?ref=1')).toBe(
      'https://foxmapper.example/h/:code?ref=1',
    );
  });

  it('stops the code at a fragment', () => {
    expect(redactHuntCode('https://foxmapper.example/h/ABC123#map')).toBe(
      'https://foxmapper.example/h/:code#map',
    );
  });

  it('stops the code at the next path segment, keeping what follows', () => {
    expect(redactHuntCode('https://foxmapper.example/h/ABC123/report')).toBe(
      'https://foxmapper.example/h/:code/report',
    );
  });

  it('redacts each URL property independently', () => {
    // PostHog attaches the URL to several properties; each is redacted on its own.
    expect(redactHuntCode('https://foxmapper.example/h/ONE')).toBe(
      'https://foxmapper.example/h/:code',
    );
    expect(redactHuntCode('https://foxmapper.example/h/TWO?x=1')).toBe(
      'https://foxmapper.example/h/:code?x=1',
    );
  });

  it('leaves a URL with no hunt path untouched', () => {
    expect(redactHuntCode('https://foxmapper.example/')).toBe('https://foxmapper.example/');
  });

  it('does not treat a literal code as already-redacted content differently', () => {
    // `/h/:code` has no `[^/?#]` past the colon-word boundary that would re-trigger — it is stable.
    expect(redactHuntCode('/h/:code')).toBe('/h/:code');
  });
});
