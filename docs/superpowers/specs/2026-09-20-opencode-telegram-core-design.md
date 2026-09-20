# OpenCode Telegram Core — Architecture Design

Date: 2026-09-20
Status: Approved architecture baseline
Repository: aminsh35322088-ctrl/opencode-telegram-core

## 1. Intent

Build a maintainable OpenCode runtime specifically for opencode-telegram-bot without turning the bot repository into a long-lived copy of the entire OpenCode monorepo.

Success means:

1. The bot runs a runtime built from an exact, auditable OpenCode upstream commit.
2. Runtime and TypeScript SDK/API contracts come from the same upstream revision.
3. Telegram-specific core changes remain a small, reviewable patch set.
4. An upstream OpenCode update becomes a controlled version bump, patch replay, build, and compatibility test instead of a manual rewrite.
5. Production can pin or roll back one runtime release without rebuilding an arbitrary upstream state.
6. Multi-topic Telegram sessions can consume session-scoped durable OpenCode events instead of depending on ambiguous global or directory event routing where native APIs provide a stronger primitive.

## 2. Upstream baseline

Initial upstream:

- Repository: anomalyco/opencode
- Release: v1.18.31
- Commit: 014614d35b397775e5d397a490fc72368c894ec2
- Root package manager: bun 1.3.14
- Official standalone build entrypoint: packages/opencode/script/build.ts --single

The upstream commit, not only the semantic version, is authoritative.

A future update must change the locked version and commit together. The build must fail if the fetched tag does not resolve to the locked commit.

## 3. Distribution model

This repository is a thin downstream distribution, not a permanently vendored copy of the OpenCode monorepo.

The repository stores:

- an exact upstream lock;
- Telegram-specific patch files;
- build and verification scripts;
- compatibility tests;
- runtime metadata;
- release manifest and checksums;
- documentation.

The build workspace materializes upstream source at the locked commit and applies our patch series in deterministic order.

This keeps upstream history upstream and makes our maintenance burden approximately proportional to the size of our patch set instead of the size of OpenCode.

## 4. Version model

Downstream releases use:

    <upstream-version>-bot.<patch-revision>

Example:

    1.18.31-bot.1

The runtime must expose at least:

- upstream version;
- upstream commit SHA;
- downstream Telegram Core version;
- downstream source commit;
- build identifier;
- API/SDK schema revision.

The same metadata must be emitted into the release manifest.

## 5. Release artifacts

A production release contains at minimum:

- Linux x64 standalone runtime binary;
- SHA-256 checksum file;
- build metadata JSON;
- matching generated TypeScript SDK package or artifact when the bot needs generated contracts not guaranteed by the public package at the exact locked revision.

The bot pins an explicit Telegram Core release. It must not download latest at runtime.

Rollback is a version pin change to a previously verified artifact.

## 6. Runtime and API strategy

Prefer native OpenCode APIs and plugin hooks over downstream source patches.

OpenCode v1.18.31 already exposes the session-scoped v2 primitives needed by the Telegram architecture:

- session.wait
- session.context
- session.history
- session.events
- session.interrupt

The generated v2 SDK describes session.history as finite durable Session-event history after an exclusive aggregate sequence, and session.events as replay-after-sequence followed by live streaming.

Therefore Phase 1 must integrate and validate these native stable APIs before adding any custom event-transport patch.

The target Telegram flow is:

    Telegram topic
      -> bot topic/session binding
      -> one OpenCode session ID
      -> session-scoped history/event cursor
      -> ordered event consumption
      -> Telegram stream/rendering

A directory-wide or global event stream remains a compatibility fallback only where native session events cannot represent a required event.

## 7. Downstream patch budget

Patches are allowed only when at least one of these is true:

1. Stable upstream cannot expose data required for correct Telegram behavior.
2. Stable upstream behavior is incorrect for a headless multi-session consumer and cannot be fixed at the bot or plugin layer.
3. A small build/runtime metadata hook materially improves production diagnosis.
4. Structured machine-readable error or capability data is unavailable from stable upstream and text parsing would otherwise be required.

Patches must not contain Telegram UI or business logic.

The following remain in opencode-telegram-bot:

- Telegram keyboards and navigation;
- Telegram topic creation and naming;
- image-chat UX;
- voice/STT UX;
- GitHub and RustDesk UI;
- localization and user-facing copy;
- bot-specific fallback presentation;
- Telegram rate limiting and message formatting.

## 8. Initial patch candidates

Implementation begins with no assumed functional patch beyond build identity.

Candidates are admitted only after compatibility tests prove a gap.

### P0 — Build identity

Expose downstream/upstream build identity in a stable machine-readable form so Railway and bot startup logs can prove exactly which runtime is executing.

### P1 — Structured error and retry metadata

Only if stable upstream surfaces provider failures in a form that forces the bot to parse human-readable text.

### P2 — Capability metadata

Only if stable provider/model metadata is insufficient for the bot Model Center to make reliable Chat/Coding, Image AI, and Voice-to-Text routing decisions.

### P3 — Session/event changes

Do not patch initially. Stable v1.18.31 already has durable session history and session events. Patch only if stress or compatibility tests demonstrate a concrete missing invariant.

## 9. Planned repository layout

    opencode-telegram-core/
    ├── README.md
    ├── LICENSES/
    │   └── upstream-opencode-MIT.txt
    ├── upstream/
    │   └── lock.json
    ├── patches/
    │   ├── series
    │   └── 0001-*.patch
    ├── scripts/
    │   ├── fetch-upstream.sh
    │   ├── verify-upstream.sh
    │   ├── apply-patches.sh
    │   ├── build-runtime.sh
    │   ├── build-sdk.sh
    │   ├── package-release.sh
    │   └── verify-release.sh
    ├── tests/
    │   ├── compatibility/
    │   ├── events/
    │   └── smoke/
    ├── dist/                 generated and ignored
    └── docs/
        └── superpowers/
            ├── specs/
            └── plans/

No GitHub workflow is required for the initial implementation. Builds and tests run on the existing GitHub Runner Lab. Release automation can be added later only if it materially improves reliability and is explicitly desired.

## 10. Deterministic build contract

The build process must:

1. Read upstream/lock.json.
2. Fetch the exact upstream repository and tag.
3. Verify tag-to-commit equality.
4. Install with the upstream-declared Bun version.
5. Apply each patch listed in patches/series in order.
6. Fail on patch rejects or unexpected fuzz rather than silently accepting drift.
7. Build the native Linux x64 standalone binary using the upstream-supported build path.
8. Run opencode --version smoke validation.
9. Start opencode serve on a loopback ephemeral port.
10. Exercise the compatibility contract.
11. Generate checksums and metadata only after validation passes.

Build output is never considered a release merely because compilation succeeded.

## 11. SDK contract

Runtime and SDK must never intentionally target different upstream revisions.

If the bot consumes the public @opencode-ai/sdk, its resolved version must be proven to match the runtime contract required by the bot.

If exact matching cannot be guaranteed, Telegram Core builds the SDK from the same locked upstream source and packages it alongside the runtime.

The bot must not keep a floating semver range for a contract coupled to the pinned runtime.

## 12. Compatibility suite

The first compatibility suite validates behavior the Telegram bot actually depends on, not the entire upstream application.

Required initial checks:

- binary starts and reports expected build identity;
- headless server becomes ready;
- session create/get/list lifecycle;
- idle session interrupt behaves safely;
- session context endpoint works;
- session history supports exclusive after-cursor semantics;
- session event stream can replay after a cursor and then continue live;
- no event from session B is emitted on session A session-scoped stream;
- reconnect after a known sequence does not lose or duplicate durable events beyond documented cursor semantics;
- multiple sessions can stream concurrently;
- SDK calls used by the bot match server schemas;
- provider/model catalog retrieval used by model selection remains compatible.

Provider-network tests must be separable from deterministic local contract tests so lack of a paid or external API key does not make core verification nondeterministic.

## 13. Telegram bot migration

Migration is staged.

### Stage A — Core build only

Produce 1.18.31-bot.1 with minimal or no behavior patches and prove the custom binary is functionally equivalent for required bot APIs.

### Stage B — Matching SDK

Pin or package the exact matching SDK contract and remove runtime/SDK revision ambiguity.

### Stage C — Session event integration

Update the bot to prefer native session-scoped durable history/events over the most complex portions of directory/global SSE routing.

Do not delete the existing defensive event path immediately. Keep a guarded fallback until multi-topic concurrency tests and Railway production observation prove the new path.

### Stage D — Targeted downstream patches

Only add patches justified by a reproduced gap and a regression test.

## 14. Upgrade procedure

For a new OpenCode release:

1. Inspect upstream release notes and relevant source/API diffs.
2. Update the locked tag and commit on a dedicated branch.
3. Materialize upstream.
4. Replay the patch series.
5. Treat any patch conflict as a review event, not an automatic resolution.
6. Regenerate or build the matching SDK contract if used.
7. Run compatibility tests.
8. Build the standalone runtime.
9. Run smoke and concurrency tests on GitHub Runner Lab.
10. Review the downstream diff and patch delta.
11. Publish a new -bot.N release only after verification.
12. Update the bot pin separately.
13. Deploy the bot and inspect Railway startup/runtime logs.
14. Roll back the bot pin if production verification regresses.

An upstream version never reaches the bot merely because it exists.

## 15. Failure handling

The build fails closed on:

- upstream tag/commit mismatch;
- patch rejects or disallowed fuzz;
- SDK/runtime contract mismatch;
- build identity mismatch;
- failing compatibility tests;
- missing checksum or manifest data;
- failed runtime smoke test.

A failed candidate leaves the current production Telegram Core release untouched.

## 16. Security and supply chain

- No long-lived GitHub token is written into a repository, remote URL, build artifact, or cache.
- Runner GitHub authentication uses the Runner Lab command-scoped credential wrapper.
- Release artifacts include SHA-256 checksums.
- Upstream source identity is an exact commit SHA.
- Third-party dependencies remain governed by the upstream lockfile for that revision.
- Generated artifacts must not contain environment secrets.
- Builds and tests run outside Railway production; Railway is for deployment verification, not heavy compilation.

## 17. Observability

At bot startup, logs should eventually show one concise runtime identity record similar to:

    opencode-core upstream=1.18.31 upstream_sha=014614d telegram_core=1.18.31-bot.1 core_sha=<sha>

Health/build-info data must let production logs distinguish:

- wrong binary;
- stale Railway deployment;
- wrong SDK contract;
- upstream bug versus downstream bug.

## 18. Test execution environment

GitHub Runner Lab is the primary heavy build/test environment.

Before a heavy operation, check Runner Lab lifecycle state. Work proceeds while state is SAFE; durable changes are pushed before the restart window.

Use managed jobs for long builds so output and exit status are retained.

Railway validation happens only after the bot consumes a verified Core release.

## 19. Non-goals for the first release

The first release does not:

- rewrite OpenCode from scratch;
- move Telegram UI behavior into OpenCode;
- follow OpenCode dev directly in production;
- automatically upgrade production whenever upstream publishes;
- patch session events before native stable APIs are tested;
- add unrelated providers or features;
- replace the bot event bus in one destructive step;
- introduce a new CI workflow solely to perform the initial build.

## 20. Acceptance criteria for Phase 1

Phase 1 is acceptable when:

1. The repository can materialize exact OpenCode v1.18.31 commit 014614d35b397775e5d397a490fc72368c894ec2.
2. The official standalone Linux build succeeds on Runner Lab.
3. A release candidate reports verifiable downstream/upstream build identity.
4. Runtime and SDK compatibility are checked from the same locked source revision.
5. Native session-scoped history/events pass isolation, reconnect, and concurrency tests.
6. The patch series is minimal and every non-metadata patch has a failing regression case that justifies it.
7. Release packaging produces a binary, checksum, and metadata manifest.
8. No production bot change is required until the Core candidate itself is verified.
