# Codex Progress

## Current Baseline

- Current redesign baseline HEAD: `dcc130999b05faea8a3cad12d61f03f0a6e7aebc`
- Initial HEAD: `6d3bd28293c793d157080c7ddfe737a9fadb1bd0`
- Branch: `main`
- Implementation commit: `314d50b` (`feat: compose evidence-grounded memory research`)
- Test and documentation commit: `8118f9d` (`test: cover compositional MCP retrieval`)
- Host-review hardening commit: `e6af2f3564ae34c668fcf84ca13ed67f36669573` (`fix: harden evidence-grounded MCP fallback`)
- Evidence-firewall commit: `3d6f220996723e9469472c2a76fedb5571937a21` (`fix: enforce evidence-safe MCP responses`)
- Deployed source HEAD: `d3f35a371ef319b53737efe9c05d3f006917b7cc`
- Objective: upgrade the existing nine-tool, read-only MCP into a compositional, evidence-grounded personal-memory retrieval system without changing the database schema or unrelated UI.

## Follow-up: Evidence Firewall And User-confirmed References

- Baseline HEAD: `dcc130999b05faea8a3cad12d61f03f0a6e7aebc`
- Objective: prevent weak MCP clients from narrating rejected candidates or contradicting the user by replacing the staged host-verdict path with strict public response projection and user-confirmed reference resolution.
- [Complete] Inspect the current query plan, semantic review, disclosure boundary, Memory API response assembly, local MCP, cloud MCP, and related tests.
- [Complete] Replace denylist redaction with status-specific allowlist response DTOs and mandatory machine directives.
- [Complete] Add neutral reference options and an authenticated, revision-bound, expiring continuation token.
- [Complete] Add user confirmation as the only promotion path for fuzzy references; host-model suggestions remain retrieval hints only.
- [Complete] Add structured MCP output, weak-client data-minimization tests, and local/cloud transport parity.
- [Complete] Verify the local SDK at runtime and add a top-level object compatibility schema so `tools/list` publishes `outputSchema` while exact four-state validation remains enforced.
- [Complete] Run lint, Edge checks, unit tests, production build, mobile WebKit E2E, and final diff review.
- [Complete] Commit and push `main`, deploy only `mcp` and `memory-api`, and verify production authentication plus GitHub workflows.
- Decision: preserve exactly nine public read-only tools, add no database migration, and add no backend model, embedding service, vector database, or paid model call.
- Decision: non-supported responses must contain no candidate body, title, score, date, coordinates, routes, images, classification, totals, rejection reasons, or free-form internal reasoning.
- Completed phase notes: non-supported DTOs now use a strict four-state allowlist; neutral option labels reveal no archive title, excerpt, date, score, coordinate, or place; the continuation token is encrypted, authenticated-user scoped, query-bound, revision-bound, and expiring; legacy host semantic verdicts remain accepted only for input compatibility and cannot promote evidence.
- Completed transport work: both MCP implementations now advertise the same structured research schema; research returns `structuredContent`, while non-supported text content is exactly the server directive with no appended narration.
- Local SDK runtime result: an in-memory MCP client now confirms that `tools/list` includes the structured object schema and that calls validate `structuredContent`; non-supported responses with forbidden fields are rejected.
- Validation results: focused evidence-firewall checks passed, `npm run lint` passed, the exact `npm test` script passed 201/201, `npm run build` passed, and `npm run test:e2e` passed 1/1 mobile WebKit test.
- Edge validation: `npm run lint:edge` could not start because no global `deno` binary is installed. The equivalent `npx --yes deno check` passed all six production Edge Functions.
- Fixed during validation: strict JSON Schema literal typing, canonical Base64URL token validation so equivalent non-canonical ciphertext encodings are rejected, and explicit MCP instruction wording required by the existing safety regressions.
- Documentation result: README now describes the strict four-state evidence firewall and opaque user-confirmation flow instead of the retired candidate-body host-verdict workflow.
- Production result: commit `3d6f220` was pushed to `origin/main`; only `mcp` and `memory-api` were deployed. Both production endpoints are reachable and reject unauthenticated requests with HTTP 401.
- GitHub result: CI run `29642753330` and Pages run `29642824118` both completed successfully for `3d6f220`.

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
- `node --import tsx --test tests/mcpOutputSchema.test.ts tests/mcpTransport.test.ts tests/memoryPublicResponse.test.ts tests/memoryReferenceConfirmation.test.ts`
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

## Follow-up: Staged Generic Semantic Review

- Baseline HEAD: `a0e5f9eba73a0d7c1537cb58b9f2c039ed9fd286`
- Objective: prevent weak MCP clients from narrating unverified candidates while retaining a model-free, generic path for the host AI to interpret aliases and implicit language such as a pet name, a personal routine, or a subtly described place.
- [Complete] Hide candidate text from the first unresolved response and require an explicit same-tool candidate request.
- [Complete] Add bounded candidate pagination with lexical-first ranking and archive-wide fallback.
- [Complete] Require a separate exact-quote decision call before any candidate can become evidence or expose coordinates.
- [Complete] Add generic clarification-only handling for plausible aliases, nicknames, paraphrases, and implicit descriptions that lack a literal evidence bridge.
- [Complete] Remove candidate star identifiers from unverified Memory API review payloads.
- [Complete] Require full word or phrase boundaries for Latin country aliases and prefer canonical countries over territory aliases when names conflict.
- [Complete] Remove multilingual function words from target extraction so an action involving a different object cannot satisfy the query.
- [Complete] Align the local and cloud nine-tool contracts, public response boundary, tests, and README.
- [Complete] Commit and push the staged semantic-review implementation as code-bearing commit `389bc58`.
- [Complete] Deploy only `mcp` and `memory-api`, then verify production authentication and GitHub deployment.
- Decision: My Life Memory continues to contain no model runtime or model API. Semantic interpretation is performed only by the AI application already handling the conversation, using bounded authenticated-user excerpts.
- Decision: candidate passages are review material, never evidence. The host must return an exact quote and the server revalidates ownership, relation, negation, exclusions, and target linkage before any coordinate-bearing result is allowed.
- Targeted compositional, semantic-review, country-routing, disclosure, and transport suite: 62 passed, 0 failed.
- Final `npm run lint`: passed with exit code 0.
- `npm run lint:edge`: could not start because no global `deno` binary is installed (`sh: deno: command not found`, exit 127).
- Equivalent `npx --yes deno check` passed for all six production Edge Functions.
- Final `npm test`: 199 passed, 0 failed.
- Final `npm run build`: passed; Vite transformed 2,247 modules. The existing large-chunk advisory remains non-blocking.
- Final `npm run test:e2e`: 1/1 mobile WebKit test passed after rerunning outside the restricted port-binding sandbox.
- Secret-pattern scan found no committed Supabase personal access token.
- Supabase deployment: `mcp` and `memory-api` both returned `Deployed Functions.` with exit code 0 on 2026-07-18; no migration or `supabase db push` was run.
- Production smoke checks: unauthenticated `mcp` returned HTTP 401 with JSON-RPC `Unauthorized`; unauthenticated `memory-api` returned HTTP 401 with `A valid user token is required.`
- GitHub verification: CI run `29639644009` and Pages run `29639703319` both completed successfully for `389bc58a90501e13610b774f94d99cbae0e9a685`.

## Follow-up: Final Evidence Firewall Deployment

- Source HEAD: `3d6f220996723e9469472c2a76fedb5571937a21`.
- [Complete] Push the strict four-state response projection, neutral user-confirmation flow, and SDK-compatible structured output schema to `origin/main`.
- [Complete] Deploy only `mcp` and `memory-api` to Supabase project `mbclmtoxxxxahbzissgm`.
- [Complete] Clear the temporary Supabase access token from every deployment shell after use; no token was written to the repository or application files.
- [Complete] Verify both production endpoints reject unauthenticated requests with HTTP 401 and structured error bodies.
- [Complete] Verify GitHub CI run `29642753330` and Pages run `29642824118` both passed for `3d6f220`.
- Final validation: `npm run lint` passed; exact `npm test` passed 201/201; `npm run build` passed; `npm run test:e2e` passed 1/1 mobile WebKit; `git diff --check` and the secret-pattern review passed.
- Edge validation: the exact `npm run lint:edge` command remains unavailable because no global `deno` binary is installed; equivalent `npx --yes deno check` passed all six production Edge Functions.
- Production decision: no migration, `supabase db push`, unrelated Function deployment, UI change, backend model, embedding service, or paid inference call was introduced.

## Follow-up: Safe Recognizable Reference Labels

- Baseline HEAD: `0260f09d16f068c088649cbd1302a89fe32d2ee0`.
- Objective: improve ambiguous-reference usability without weakening the strict four-state evidence firewall or exposing candidate bodies, coordinates, dates, scores, routes, images, or internal reasoning.
- Files inspected: `memory-reference-candidates.ts`, `memory-reference-token.ts`, `memory-research.ts`, `memory-personal-context.ts`, `memory-public-response.ts`, both MCP transports and schemas, Memory API assembly, and reference-confirmation tests.
- [Complete] Confirm the reported issues in current source: ordinal-only labels, anchor-style candidate deduplication for every relation, query-hash rejection of short confirmation replies, and confirmed passages incorrectly marked as title evidence.
- [Complete] Add conservative recognizable labels, relation-aware deduplication, encrypted original-query recovery, and explicit reference evidence source.
- [Complete] Add privacy, ambiguity, short-reply, same-location candidate, schema, and transport regressions.
- [Complete] Run the full validation suite, inspect the diff, and update README.
- [Complete] Commit, deploy only changed Functions, and verify production authentication plus GitHub workflows.
- Decision: keep exactly nine public read-only tools, add no migration, and do not add a backend model, embedding service, vector database, paid inference, or unrelated UI change.
- Targeted reference, compositional-research, public-response, output-schema, and transport suite: 52 passed, 0 failed.
- `npm run lint`: passed with exit code 0 after the implementation phase.
- Exact `npm run lint:edge`: could not start because this machine has no global `deno` binary (`sh: deno: command not found`, exit 127).
- Equivalent `npx --yes deno check`: passed all six production Edge Functions with exit code 0.
- Final `npm test`: 208 passed, 0 failed.
- Final `npm run build`: passed; Vite transformed 2,247 modules. The existing large-chunk advisory remains non-blocking.
- Final `npm run test:e2e`: 1/1 mobile WebKit test passed.
- `git diff --check`: passed with no whitespace errors.
- Final review confirmed exactly nine public read-only tools, no migration or UI change, no candidate-body/date/coordinate/score/route/image/internal-ID disclosure in clarification options, and no committed secret.
- Decision: anchor labels may use only a generic soft cue; fuzzy event references may use a privacy-screened short title or explicit name. Unsafe labels fall back to an ordinal, and all options remain unverified until the user explicitly confirms one.
- Decision: token v2 stores the original query only inside authenticated AES-GCM ciphertext, remains bound to user, archive revision, expiry, and ciphertext integrity, and accepts a short confirmation reply without trusting that reply as the original research question.
- Source result: commit `d3f35a371ef319b53737efe9c05d3f006917b7cc` (`fix: make MCP reference confirmations recognizable`) was pushed to `origin/main`.
- Supabase result: only `mcp` and `memory-api` were deployed to project `mbclmtoxxxxahbzissgm`; both CLI deployments returned `Deployed Functions.` No migration or `supabase db push` was run.
- Token handling: the Supabase access token was read silently into a temporary shell environment, unset after both deployments, and never written to a repository or configuration file.
- Production smoke checks: unauthenticated `mcp` returned HTTP 401 with JSON-RPC `Unauthorized`; unauthenticated `memory-api` returned HTTP 401 with `A valid user token is required.`
- GitHub verification: CI run `29644768844` and Pages run `29644828541` both completed successfully for `d3f35a371ef319b53737efe9c05d3f006917b7cc`.

## Follow-up: Build Week Protocol And Privacy Hardening

- Baseline HEAD: `0529f36abd0092387fd313dbc17b8cf626062c3b`.
- Objective: close the remaining cloud MCP transport correctness gaps, remove the dead public `semanticReview` input, prevent local/cloud tool-contract drift, add evidence-boundary corpus tests, and apply low-risk rich-image privacy hardening without changing product UI or normalized data.
- Files inspected: `README.md`, `package.json`, `mcp/memory-server.mjs`, cloud `mcp` and `memory-api` Functions, shared MCP contract/public schema/query/research modules, browser and Edge HTML sanitizers, transport/output/research tests, `index.html`, and backend/progress documentation.
- [Complete] Implement real MCP protocol-version negotiation for the supported `2025-03-26` contract.
- [Complete] Return HTTP 202 with no body for accepted notification/response-only messages and reject batched `initialize` requests.
- [Complete] Replace wildcard MCP CORS with native-client-safe Origin validation and an explicit configured allowlist for concrete browser origins.
- [Complete] Add one shared nine-tool manifest and full input-schema parity tests for cloud and local transports.
- [Complete] Remove the deprecated public `semanticReview` input while preserving encrypted user reference confirmation.
- [Complete] Add a 36-query multilingual golden corpus focused on geocoder privacy, query planning, evidence boundaries, and no-answer invariants.
- [Complete] Add document-level and sanitizer-level no-referrer image controls without silently deleting legacy external-image data.
- [Complete] Align the package and MCP versions at `1.0.0`, remove duplicate Vite ownership, add an explicit `typecheck` script, and pin the MapLibre/Leaflet bridge.
- [Complete] Move the production migration, Vault, Cron, backup, rollback, and recovery runbook out of the product README and into `docs/backend-setup.md`.
- [Complete] Run all validation commands, inspect the final diff, and record exact results.
- [Complete] Commit and push the reviewed release, deploy the two changed Edge Functions, verify CI/Pages, and close the obsolete draft PR.
- Decision: do not refactor `useCloudAuthSync`, `App.tsx`, or `HomeScreen` during the final competition window.
- Decision: no database migration is required for this protocol and documentation hardening.
- Decision: support MCP `2025-03-26` until the newer transport contract is implemented completely; do not falsely advertise `2025-06-18` while retaining batch behavior removed by that version.
- Decision: allow missing Origin and native-client `Origin: null`, but require every concrete Origin to match `ALLOWED_ORIGINS` and every request to pass bearer-token authentication.
- Decision: do not silently remove legacy remote images. The low-risk release fix is a global and per-image no-referrer policy; strict remote-image blocking requires a visible migration flow after the competition window.
- Targeted MCP, research, public-response, and privacy suite: 53 passed, 0 failed.
- Golden corpus, query-routing, and query-plan suite: 18 passed, 0 failed.
- Rich HTML, rich-text editing, and color-session suite: 13 passed, 0 failed.
- `npm install --package-lock-only --ignore-scripts`: completed with 0 reported vulnerabilities.
- Interim `npm run lint`: passed with exit code 0.
- Final `npm run lint`: passed; the explicit `typecheck` alias completed with exit code 0.
- Exact `npm run lint:edge`: could not start because this machine has no global `deno` binary (`sh: deno: command not found`, exit 127).
- Equivalent `npx --yes deno check`: passed all six production Edge Functions with no diagnostics.
- Final `npm test`: 215 passed, 0 failed.
- Final `npm run build`: passed; Vite transformed 2,247 modules. Two existing map/application chunks remain above the 500 kB advisory threshold, with no build failure.
- Final `npm run test:e2e`: 1/1 mobile WebKit test passed.
- Final `git diff --check`: passed with no whitespace errors.
- Secret-pattern review found environment-variable names and security assertions only; no real Supabase personal token, service-role value, invite code, MCP token, or password was added.
- Source result: commit `cb6f14fea7e1f94e81a06f546a41e823b6a128aa` (`fix: harden MCP protocol and release docs`) was pushed to `origin/main`.
- Supabase result: only `mcp` and `memory-api` were deployed to project `mbclmtoxxxxahbzissgm`; both deployments returned `Deployed Functions.` No migration or `supabase db push` was run.
- Production smoke checks: unauthenticated `mcp` returned HTTP 401 with JSON-RPC `Unauthorized`; a concrete disallowed Origin returned HTTP 403 `Origin not allowed`; unauthenticated `memory-api` POST returned HTTP 401 `A valid user token is required.`
- GitHub verification: CI run `29683987957` and Pages run `29684064381` both completed successfully for `cb6f14fea7e1f94e81a06f546a41e823b6a128aa`.
- Repository cleanup: obsolete draft PR `#2` was closed without merging because its implementation is already superseded by `main`.
- Remaining presentation-only action: the GitHub About description, homepage field, and formal GitHub Release require an authenticated repository-settings browser or GitHub CLI session; the code and production deployment do not depend on these fields.

## Follow-up: Executable MCP Input And Error Contract

- Baseline HEAD: `012f324c28fc88f63e84262ad3999a1bc7106e5b`.
- Objective: make the cloud MCP execute the shared nine-tool input schemas, preserve local/cloud runtime parity, return expected Memory API failures as actionable tool errors, and reject invalid JSON-RPC request IDs without changing the database or product UI.
- Files inspected: shared MCP manifest and transport helpers, cloud `mcp` and `memory-api` Functions, local MCP server, MCP transport/runtime tests, package scripts, and the MCP 2025-03-26 tools and base-protocol specifications.
- [Complete] Restore the `uniqueItems` contract for private image note IDs.
- [Complete] Compile the shared manifest into dependency-free validators that enforce types, required fields, unknown-field rejection, bounds, patterns, uniqueness, and defaults in both Node and Deno runtimes.
- [Complete] Execute shared validation before every cloud tool call and add a local runtime guard for constraints not preserved by Zod JSON Schema conversion.
- [Complete] Preserve the exact local/cloud published schema by restoring `uniqueItems` through Zod metadata while enforcing it through the shared validator.
- [Complete] Map Memory API 4xx, 429, and structured business failures to MCP tool results with `isError: true`; keep genuine 5xx/program failures as generic `-32603` protocol errors without leaking internals.
- [Complete] Accept only string or integer request IDs and return `-32600` with a null response ID for null, fractional, boolean, or object IDs.
- [Complete] Add targeted tests for defaults, malformed types, unknown fields, bounds, required arguments, duplicate note IDs, tool-error mapping, local duplicate rejection, and request-ID validation.
- [Complete] Run the full validation suite and inspect the final diff.
- [Complete] Commit, push, deploy only the changed `mcp` Function, and verify production/GitHub results.
- Targeted MCP transport and runtime suite: 17 passed, 0 failed.
- Final `npm run lint`: passed; `typecheck` completed with exit code 0.
- Final `npm run lint:edge`: passed all six production Edge Functions with Deno 2.4.3 and exit code 0.
- Final `npm test`: 221 passed, 0 failed.
- Final `npm run build`: passed; Vite transformed 2,247 modules. The existing large-chunk advisory remains non-blocking.
- Final `npm run test:e2e`: 1/1 mobile WebKit test passed.
- Final review confirmed exactly nine public tools, all read-only; no migration, UI, database, app-state, or write-capability change; and no committed secret.
- Specification check: MCP 2025-03-26 requires string or integer non-null request IDs, server-side input validation, and tool-result errors for API/input/business failures.
- Decision: no migration, database change, UI change, new tool, write capability, model runtime, embedding service, or vector database is required.
- Source result: commit `556e5e48b0ab9dbcf87c38b80bc812b207b1d618` (`fix: enforce MCP tool contracts`) was pushed to `origin/main`.
- Supabase result: only the `mcp` Function was deployed to project `mbclmtoxxxxahbzissgm`; the CLI returned `Deployed Functions.` No migration, `supabase db push`, or unrelated Function deployment was run.
- Token handling: the temporary Supabase access token existed only in the deployment process environment and disappeared with that process; it was not written to the repository, `.env`, shell configuration, or logs.
- Production smoke checks: unauthenticated `mcp` returned HTTP 401 with JSON-RPC `Unauthorized`; a concrete disallowed Origin returned HTTP 403 `Origin not allowed`.
- GitHub verification: CI run `29689562578` and Pages run `29689645138` both completed successfully for `556e5e48b0ab9dbcf87c38b80bc812b207b1d618`.
