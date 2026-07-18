# Codex Progress

## Current Baseline

- Initial HEAD: `6d3bd28293c793d157080c7ddfe737a9fadb1bd0`
- Branch: `main`
- Implementation commit: `314d50b` (`feat: compose evidence-grounded memory research`)
- Test and documentation commit: `8118f9d` (`test: cover compositional MCP retrieval`)
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

## Remaining Items

- No implementation, test, or documentation item remains for this repository task.
- Production deployment of the updated Supabase `mcp` and `memory-api` Functions was not requested and was intentionally not performed in this pass.

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

## Test Results

- `npm run lint`: passed; TypeScript completed with exit code 0.
- `npm run lint:edge`: could not start because this machine has no global `deno` binary (`sh: deno: command not found`, exit 127).
- Equivalent Edge validation with `npx --yes deno check` completed with no diagnostics for all six production Functions.
- `npm test`: passed with 172 tests, 0 failures, exit code 0.
- `npm run build`: passed; Vite transformed 2,247 modules and built successfully. The existing large-chunk advisory remains non-blocking.
- `npm run test:e2e`: passed 1/1 mobile WebKit test.
- Final focused privacy/query-plan suite: 15 tests passed, 0 failures.
- Isolated image-export suite: 7 tests passed, 0 failures.

## Known Failures Or Decisions

- The restricted first `npm test` attempt was blocked by `tsx` IPC permissions; the exact command was rerun outside the restricted sandbox and passed 172/172.
- One repeated full-suite run briefly tripped the pre-existing image timeout test's 250 ms wall-clock assertion under concurrent load. The same test passed in isolation at about 21 ms, and the final unmodified `npm test` run passed 172/172; no unrelated export code or test threshold was changed.
- `npm run lint:edge` requires a global Deno installation. The equivalent `npx deno check` was used without changing package scripts.
- Decision: keep the existing bounded candidate-review response contract rather than adding a tenth public MCP tool.
- Decision: numeric confidence remains only for backward compatibility and will be labeled as heuristic rather than calibrated probability.
- Decision: personal aliases and entire natural-language event sentences are never sent to public geocoding; only the extracted explicit public place span may leave the authenticated research path.
- Decision: no schema change is objectively required for this retrieval-only upgrade.
