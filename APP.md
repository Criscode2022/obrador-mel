# This app

Rules and context for this app only. Agents read this file after [PROJECT.md](PROJECT.md), and where the two differ, this file wins, except that it can't loosen the rules on secrets and Neon. PROJECT.md comes from the template, and `npm run update-from-template` brings in its newer versions. That update never changes this file, so keep everything specific to this app here.

## What the app is

Obrador Mel is the website of a fictional bakery in Santiago de Compostela, with a chat assistant that takes orders in Spanish or Galician. It prices the order, checks lead times and pickup slots, and leaves the order for a person at the bakery to confirm in the staff panel. Nothing is confirmed until that person does. It is a public demo and a case study on cristiancode.dev.

## Decisions

- The app type is `spa`, and it applies only to `web/`: a classic Angular 22 single-page app (zoneless, signals). In production `web/serve.mjs` serves it and puts a closed API in front of the engine: allow-listed routes and rate limits. Run Angular commands inside `web/`, for example `npm --prefix web start`.
- `engine/` is the conversation engine, in plain JavaScript ES modules on Node 24, not Angular. AGENTS.md's Angular rules and the Angular skills don't apply there. Its one runtime dependency is `pg`; keep it that way unless the user asks.
- The engine computes prices, opening hours and availability from the data. The local model (Ollama) only words answers from the sources the engine hands it, and every price, time and lead time it mentions is checked against those sources. Keep the model out of decisions.
- The assistant must keep working without the model: if Ollama or Qdrant are down, search falls back to keywords and answers fall back to the source text.
- Postgres 16 and Qdrant run in Docker (`compose.yaml`, started by `scripts/up.sh`). The browser never reaches the database; everything goes through the engine. PROJECT.md's rules for the Neon Data API, Neon Auth and RLS don't apply here.
- What the engine writes can hold data from people who try the demo, which is why `output/` is gitignored. Tests check that a card number is never stored; keep them passing.

## Rules

- Checks: `npm --prefix engine test`, `npm --prefix engine run test:integration` (needs Postgres), `npm --prefix web test`, `npm --prefix web run build`, and `./scripts/eval.sh` for the 32 conversations over HTTP. The web app has no `ng test`: its tests are `web/serve.test.mjs`.
- There is no `package.json` at the root, so update from the template with `node scripts/update-from-template.mjs` from the repository root.
- `scripts/up.sh`, `scripts/ingest.sh` and `scripts/eval.sh` belong to this app; the template's update leaves them alone.
- `docs/` is the case study that cristiancode.dev publishes: a push to `main` that changes it rebuilds the portfolio. Keep secrets, connection strings and private notes out of it.
