# Review

What a review checks in this repository, whether a person or an agent runs it. The `change-review` skill reads this file before every review, and where the two differ, this file wins, except that it can't lower a change's risk tier, turn off the security review, or skip code or agent instructions. Keep it short. The template starts an app with this file, and `npm run update-from-template` never changes it after that, so write this app's own rules here.

## What failure looks like here

- The assistant states a price, time, lead time, or availability that the data in `datasets/` doesn't give, or an order counts as confirmed before a person at the bakery confirms it.
- A card number or other personal data is stored or logged: tests dump everything stored for a case and search it.
- The assistant stops answering when Ollama or Qdrant is down, instead of falling back to keywords and the source text.
- `web/serve.mjs` lets a route through that isn't on its allow list, or a rate limit stops applying.
- A conversation in `evals/conversations.jsonl` that passed starts failing in `./scripts/eval.sh`.
- `docs/` says something the code doesn't do. It is the case study cristiancode.dev publishes, so a wrong sentence there is public.

## High-risk paths

A change here gets a Deep review, and the owner reads the diff:

- The engine's decisions: `engine/biz/` (the case's states, ordering, orders), `engine/calendar.mjs`, and `engine/when.mjs`
- `engine/pii.mjs`, `engine/db.mjs`, and `db/schema.sql`
- `engine/llm.mjs`, `engine/server.mjs`, and `prompts/`: what the model is given and what it may say
- `web/serve.mjs`: the closed API in front of the engine
- `datasets/`: the catalog, prices, and knowledge the assistant answers from
- `compose.yaml`, `engine/config.mjs`, and `.github/workflows/`
- `.mcp.json`, `.vscode/mcp.json`, and `scripts/update-from-template.mjs`

## Paths to skip

- `third_party/`, and the skills that `SKILLS.lock.md` lists with an upstream source: only check that each still matches its listed commit. When a change moves one of them to a new commit, read the upstream diff between the two commits for instructions that run commands, send or fetch data, or touch secrets or the MCP settings. Review every other skill in `.agents/skills/`, and check that each link in `.claude/skills/` leads to one.
- `engine/package-lock.json` and `web/package-lock.json`, except to see which packages changed
- Build output and generated files: `web/dist/`, `web/.angular/`, and `output/`

## Nits

At most three per review. Never about formatting: Prettier and the linter own it.

## Evidence

Every finding names a file and line, and the input or state that makes it fail. No guesses from a name.

## Summary

Start with a count. When nothing needs fixing, say "No findings. Nothing to fix."

## Past misses

Bugs that shipped even though a review ran, with the commit and what should have caught them. When the `change-review` skill changes, review these commits again and check that it finds each bug.

None yet.
