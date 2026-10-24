# FoxMapper docs

Reference material for the FoxMapper client, its data, and the relay that carries it.

- [design-system.md](design-system.md) — tokens, iconography, and motion for the field UI.
- [log-format.md](log-format.md) — the append-only report log: shape, semantics, and merge rules.
- [estimate.md](estimate.md) — the location estimate: how the reports become "the fox is probably
  in here", what each warning means, and how the model is tested. Off by default; each participant
  turns it on in **Settings → Show where the fox probably is**.
- [product-tour.md](product-tour.md) — the optional first-visit guided tour of the core hunt loop,
  and the drift check that keeps it honest. First-timers are offered it on their first hunt view;
  anyone can relaunch it later from **Settings → Take the tour**.
- [analytics.md](analytics.md) — the anonymous, opt-out usage and error analytics (PostHog): exactly
  what is and is not sent, how to opt out, and how in-app feedback is collected.
- [database.md](database.md) — measuring the production Postgres: reading per-statement timing,
  why the slow-statement log is permanently silent here, what the relay actually costs (a second a
  day), and why the instance's transaction count is a statistic about Render rather than the relay.
