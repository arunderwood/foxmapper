/**
 * The hunt-code leak guard, kept in its own module with no dependencies so it is trivially testable
 * and can never drag the browser-only PostHog SDK into a unit test.
 *
 * The hunt code is the shared secret that admits a device to a hunt. It appears in the URL as
 * `/h/<code>`, and PostHog attaches the URL to every event (`$current_url` and friends). This
 * rewrites it to `/h/:code` so the code never leaves the device through an analytics property.
 */
export function redactHuntCode(value: string): string {
  return value.replace(/\/h\/[^/?#]+/g, '/h/:code');
}
