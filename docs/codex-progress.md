# Codex Progress

## Current Baseline

- Initial HEAD: `6d3bd28293c793d157080c7ddfe737a9fadb1bd0`
- Branch: `main`
- Implementation commit: `314d50b` (`feat: compose evidence-grounded memory research`)
- Test and documentation commit: `8118f9d` (`test: cover compositional MCP retrieval`)
- Host-review hardening commit: `e6af2f3564ae34c668fcf84ca13ed67f36669573` (`fix: harden evidence-grounded MCP fallback`)
- Deployed source HEAD: `e6af2f3564ae34c668fcf84ca13ed67f36669573`
- Objective: upgrade the existing nine-tool, read-only MCP into a compositional, evidence-grounded personal-memory retrieval system without changing the database schema or unrelated UI.

## Files Inspected

- `README.md`
- `mcp/memory-server.mjs`
- `supabase/functions/mcp/index.ts`
- `supabase/functions/memory-api/index.ts`
- `supabase/functions/_shared/mcp-query-routing.mjs`
- `supabase/functions/_shared/memory-personal-context.ts`
- `supabase/functions/_shared/memory-research.ts`
- `supabase/functions/_shared/memory-date.ts`
- `supabase/functions/_shared/time-zone.ts`
- `tests/mcpQueryRouting.test.ts`
- `tests/memoryPersonalContext.test.ts`
- `tests/memoryResearch.test.ts`
- `tests/timeZone.test.ts`
- `tests/mcpTransport.test.ts`

## Implementation Phases

1. [Complete] Structured query plan and authenticated-user temporal context.
2. [Complete] Positive public-geocoding gate and multilingual private-alias protection.
3. [Complete] Sentence-level evidence extraction, attribution, negation, and title/body ranking.
4. [Complete] Temporal home/work/study episodes and compositional anchor-plus-event retrieval.
5. [Complete] Resolved personal-nearby route support and evidence-first response fields.
6. [Complete] Bounded candidate review that remains separate from evidence.
7. [Complete] Regression, negative, metamorphic, transport, and timezone tests added.
8. [Complete] README synchronization, full validation, and final diff review.
9. [Complete] Production deployment and online endpoint verification.

## Completed Items

- Confirmed a clean `main` baseline before work began.
- Read every required source, test, and documentation file.
- Began the shared temporal-context helper in `supabase/functions/_shared/time-zone.ts`.
- Confirmed the public MCP contract currently exposes exactly nine read-only tools.
- Added `MemoryQueryPlan` with separate public-place, anchor, event, target, action, spatial, route, image, answer, and date fields.
- Added a positive public-place gate and multilingual private alias protection before geocoding.
- Replaced whole-note identity matching with bounded title/body passages, first-person attribution, negation rejection, third-party ownership rejection, and deterministic evidence ranking.
- Removed the global title short-circuit: a weak title no longer suppresses stronger body evidence elsewhere.
- Added temporal personal-anchor episodes, direct-or-independent-corroboration gates, compositional target evidence, and route-only note filtering.
- Bounded candidate excerpts are ranked separately and remain explicitly unverified rather than entering evidence records.
- Added temporal anchor filtering so dated old/new home, work, and study questions resolve only evidence from the requested period; undated multiple anchors stay ambiguous.
- Added personal-nearby event composition and route matching after a single anchor resolves.
- Added evidence roles, bounded passages, heuristic confidence labeling, decision reasons, and image-note selection constrained to evidence records.
- Aligned cloud and local MCP descriptions and temporal instructions through one shared contract; both transports still expose exactly nine tools.
- Added explicit read-only annotations to all nine cloud MCP tools.
- Removed latest-saved-memory coordinate tie-breaking from public-place resolution; unresolved public-place ambiguity now remains explicit.
- Added focused compositional tests for anchor-plus-target questions, temporal anchors, personal-nearby routes, multilingual evidence, privacy-gated geocoding, and metamorphic stability.
- Updated README wording to describe evidence-based user-relative place resolution, explicit ambiguity, heuristic confidence, and the continued read-only nine-tool contract.
- Hardened the positive geocoder gate against private aliases and full event sentences in Chinese, English, Japanese, and Korean while preserving explicit public-place extraction.
- Confirmed candidate notes remain unverified and separate from `records`, selected image note IDs are a subset of evidence note IDs, and resolved nearby routes require an unambiguous personal anchor.
- Confirmed no database migration or unrelated UI change was introduced.
- Deployed the updated `mcp` and `memory-api` Edge Functions to Supabase project `mbclmtoxxxxahbzissgm` from source HEAD `e9e01db`.
- Confirmed both production endpoints are online and reject unauthenticated requests with structured HTTP 401 responses.
- Confirmed GitHub Pages workflow #239 completed successfully from `e9e01db` and deployed the matching frontend build.

## Remaining Items

- No implementation, test, or documentation item remains for this repository task.
- No production migration or `supabase db push` was required or performed.

## Commands Run

- `git status --short --branch`
- `git log -3 --oneline`
- `git rev-parse HEAD`
- Read-only `sed`, `cat`, and `rg` inspection of all files listed above.
- `git diff --check`
- `npm run lint`
- `npm run lint:edge`
- `npx --yes deno check supabase/functions/register-with-invite/index.ts supabase/functions/delete-account/index.ts supabase/functions/mcp-token/index.ts supabase/functions/mcp/index.ts supabase/functions/memory-api/index.ts supabase/functions/media-retention/index.ts`
- `npm test`
- `npm run build`
- `npm run test:e2e`
- `node --import tsx --test tests/mcpQueryRouting.test.ts tests/memoryQueryPlan.test.ts tests/memoryPersonalContext.test.ts tests/memoryCompositionalResearch.test.ts tests/memoryResearch.test.ts tests/timeZone.test.ts tests/mcpTransport.test.ts`
- `node --import tsx --test tests/exportImages.test.ts`
- Targeted `rg`, `sed`, and `git diff` review of README, public-place resolution, and the production Memory API call path.
- Secret-pattern scan for Supabase personal/service-role keys, long-lived MCP tokens, and committed credentials.
- Two atomic commits were created and pushed to `origin/main`; the final code-bearing remote HEAD before this progress-only update was `8118f9d`.
- `npx --yes supabase@latest functions deploy mcp --project-ref mbclmtoxxxxahbzissgm --no-verify-jwt`
- `npx --yes supabase@latest functions deploy memory-api --project-ref mbclmtoxxxxahbzissgm --no-verify-jwt`
- Unauthenticated `curl` checks against the production `mcp` and `memory-api` endpoints.
- Read-only Supabase dashboard verification of both Function deployment timestamps.
- Read-only GitHub Actions verification of CI #131 and Pages #239 for `e9e01db`.

## Test Results

- `npm run lint`: passed; TypeScript completed with exit code 0.
- `npm run lint:edge`: could not start because this machine has no global `deno` binary (`sh: deno: command not found`, exit 127).
- Equivalent Edge validation with `npx --yes deno check` completed with no diagnostics for all six production Functions.
- `npm test`: passed with 172 tests, 0 failures, exit code 0.
- `npm run build`: passed; Vite transformed 2,247 modules and built successfully. The existing large-chunk advisory remains non-blocking.
- `npm run test:e2e`: passed 1/1 mobile WebKit test.
- Final focused privacy/query-plan suite: 15 tests passed, 0 failures.
- Isolated image-export suite: 7 tests passed, 0 failures.
- Supabase CLI deployment: both Functions returned `Deployed Functions.` with exit code 0.
- Production `mcp` verification: HTTP 401 with JSON-RPC `Unauthorized`, confirming the updated endpoint is reachable and authentication remains enforced.
- Production `memory-api` verification: HTTP 401 with `A valid user token is required.`, confirming the endpoint is reachable and authentication remains enforced.
- GitHub Actions: CI #131 passed and Pages #239 passed for commit `e9e01db`.

## Known Failures Or Decisions

- The restricted first `npm test` attempt was blocked by `tsx` IPC permissions; the exact command was rerun outside the restricted sandbox and passed 172/172.
- One repeated full-suite run briefly tripped the pre-existing image timeout test's 250 ms wall-clock assertion under concurrent load. The same test passed in isolation at about 21 ms, and the final unmodified `npm test` run passed 172/172; no unrelated export code or test threshold was changed.
- `npm run lint:edge` requires a global Deno installation. The equivalent `npx deno check` was used without changing package scripts.
- Decision: keep the existing bounded candidate-review response contract rather than adding a tenth public MCP tool.
- Decision: numeric confidence remains only for backward compatibility and will be labeled as heuristic rather than calibrated probability.
- Decision: personal aliases and entire natural-language event sentences are never sent to public geocoding; only the extracted explicit public place span may leave the authenticated research path.
- Decision: no schema change is objectively required for this retrieval-only upgrade.
- Decision: deploy only `mcp` and `memory-api`; do not run migrations, `supabase db push`, or redeploy unrelated Functions.

## Follow-up: Host-assisted Semantic Fallback And Date Semantics

- Baseline HEAD: `7069735a8333e5c5005589fe284a48ecdb4328fd`
- Objective: prevent temporary institutional stays from resolving as home, distinguish query-evaluation time from saved-memory timestamps, and add an optional evidence-quote review fallback without adding any model service, model API, embedding service, migration, or paid backend dependency.
- Files inspected: `memory-personal-context.ts`, `memory-research.ts`, `memory-answer-boundary.ts`, `memory-query-plan.ts`, `memory-presenters.ts`, `time-zone.ts`, Memory API and both MCP transports, compositional/transport/timezone tests, and the current progress record.
- [Complete] Reproduce the likely rehabilitation-hospital false-positive path and identify ambiguous timestamp semantics.
- [Complete] Add deterministic hard exclusions for temporary or institutional residence and incidental work/study visits.
- [Complete] Add an optional same-tool host-AI review protocol that accepts only exact bounded candidate quotes and is revalidated server-side.
- [Complete] Add explicit query-clock versus memory-timestamp semantics.
- [Complete] Add targeted regressions for institutional stays, exact-quote host review, ambiguous anchors, event evidence, transport parity, and timestamp semantics.
- [Complete] Run the complete validation suite and inspect the final diff.
- [Complete] Commit and push the hardened retrieval contract to `origin/main`.
- [Complete] Deploy the changed `mcp` and `memory-api` Edge Functions from `e6af2f3`.
- Targeted validation: `npm run lint` passed; `node --import tsx --test tests/memoryCompositionalResearch.test.ts tests/timeZone.test.ts tests/mcpTransport.test.ts` passed 40/40.
- Final targeted retrieval/transport/timezone validation passed 49/49 after the unverified-candidate wording was restored.
- `npm run lint`: passed with exit code 0.
- `npm run lint:edge`: could not start because this machine has no global `deno` binary (`sh: deno: command not found`, exit 127).
- Equivalent `npx --yes deno check` passed for all six production Edge Functions.
- `npm test`: passed 190/190 with exit code 0. The first restricted run was blocked by the known `tsx` IPC sandbox limitation and was rerun with local IPC permission.
- `npm run build`: passed; Vite transformed 2,247 modules. The existing large-chunk advisory remains non-blocking.
- `npm run test:e2e`: passed 1/1 mobile WebKit test after rerunning outside the restricted port-binding sandbox.
- `git diff --check`: passed with no whitespace errors.
- Final review confirmed exactly nine public read-only MCP tools, no model SDK or model endpoint, no public-geocoder use of private aliases, and no database migration.
- Decision: the user's existing AI conversation host may optionally use its own reasoning to review bounded excerpts and call the same tool again. My Life Memory contains no model runtime, calls no model API, requires no model key, and incurs no model-service cost.
- Supabase deployment: `mcp` and `memory-api` both returned `Deployed Functions.` with exit code 0 on 2026-07-18.
- Production smoke checks: unauthenticated `mcp` returned HTTP 401 with JSON-RPC `Unauthorized`; unauthenticated `memory-api` returned HTTP 401 with `A valid user token is required.`
- GitHub verification: CI run `29637411384` and Pages run `29637471917` both completed successfully for `e6af2f3`.

## Follow-up: Weak-client Hallucination Hardening

- Baseline HEAD: `e3049e2d3b7d7f43f8b30d0d73bb3cd7f281b38c`
- Objective: prevent weaker MCP clients from inventing a place when a personal anchor is missing or ambiguous, while improving deterministic body-text retrieval for fuzzy home/work/study and event questions.
- Files inspected: shared MCP contract, local and cloud transports, query routing, query planning, personal-context extraction, compositional research, Memory API response assembly, and related MCP/research tests.
- [Complete] Add a mandatory evidence-only answer boundary with explicit no-answer and disambiguation behavior.
- [Complete] Keep bounded candidate passages coordinate-free and separate from evidence for archives of any size.
- [Complete] Expand colloquial query and negation coverage without introducing a backend model or paid API.
- [Complete] Redact coordinates, routes, and image access from unresolved or ambiguous public responses.
- [Complete] Run targeted tests, `npm run lint`, Edge checks, the full unit suite, mobile WebKit E2E, and production build.
- Decision: no database migration is required; this remains deterministic, authenticated-user-scoped retrieval.
- Decision: preserve exactly nine public read-only MCP tools and deploy only `mcp` and `memory-api` after validation.
- Targeted compositional, routing, transport, and disclosure suite: 49 passed, 0 failed.
- `npm run lint`: passed after the response-boundary implementation.
- Added generic non-home regression coverage for first-person observations, purchases, study-nearby photos, and unresolved workplace language; no relation-specific shortcut was introduced.
- Final targeted compositional, routing, transport, disclosure, and research suite: 61 passed, 0 failed.
- Final `npm run lint`: passed with exit code 0.
- `npm run lint:edge`: could not start because no global `deno` binary is installed (`sh: deno: command not found`, exit 127).
- Equivalent `npx --yes deno check` passed for all six production Edge Functions.
- Final `npm test`: 183 passed, 0 failed.
- Final `npm run build`: passed; Vite transformed 2,247 modules. The existing large-chunk advisory remains non-blocking.
- Final `npm run test:e2e`: 1/1 mobile WebKit test passed.
- Final `git diff --check`: passed with no whitespace errors.
- Final secret-pattern review found environment-variable names and authorization tests only; no real Supabase token, service-role value, invite code, MCP token, or password was added.
