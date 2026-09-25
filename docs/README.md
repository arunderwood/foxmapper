# FoxMapper docs

Reference material for the FoxMapper client and its data.

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
