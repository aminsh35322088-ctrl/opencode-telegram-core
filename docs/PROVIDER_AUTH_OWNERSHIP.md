# Provider authentication ownership investigation

Checkpoint date: 2026-10-04. Production source is main
`884ae87d47f96ddbe670d4abcd4088dc2ae832da`, which merges PR27. Bot is frozen;
published pre.9 still targets `28e752722ac616a74fbaa5c38709fa4e39d87ea4`.
No provider production fix or release is included in this checkpoint.

## Confirmed defects

`packages/opencode/src/provider/auth.ts` captures an instance-scoped pending map,
awaits a plugin OAuth result and calls the shared credential store without
rechecking the original workspace or flow. Disposal invalidates the cache, but
an already-running callback keeps its old pending entry. The entry also remains
usable after success.

Two controlled-plugin probes exercise the real ProviderAuth and Auth services:

1. Hold token completion at a barrier, await workspace disposal, release the
   callback: the credential store receives the late credential. Expected no write;
   actual `Api` credential exists.
2. Authorize once, complete twice: the plugin exchange runs twice. Expected one
   exchange; actual two.

Both assertions fail on the current source (`0 pass / 2 fail`). No network,
model or real credentials are involved. The first probe separately failed before
adding the second. Gates are coordinated by promises, not timing sleeps.

The probe is deliberately stored outside the passing cumulative suite while it
records an unfixed release blocker. It is not a skipped passing regression or
closure evidence. Move it into the cumulative suite with the actual fix.

After normal materialization and dependency installation, reproduce:

```sh
cp tests/diagnostics/provider-auth-retirement.probe.ts \
  .work/opencode-test/packages/opencode/test/telegram/telegram-provider-auth-workspace.test.ts
cd .work/opencode-test/packages/opencode
bun test test/telegram/telegram-provider-auth-workspace.test.ts --timeout 30000
```

In this Cloud VM invoke Bun through the existing test-only subreaper wrapper.
Remove only this copied diagnostic from the generated tree before running the
unchanged cumulative baseline; retaining it will intentionally expose the known
red assertions. The source probe remains versioned.

## Reachability and limits of the finding

The Telegram production graph includes ProviderAuth HTTP routes and plugin auth
hooks. Provider/model/plugin/extension support and Telegram-mediated sign-in are
required target capabilities even though the current read-only Bot SDK inventory
has no provider OAuth caller. Bot non-adoption cannot remove this Core gate.

The production Codex plugin still contains module-global loopback OAuth server
and pending-flow state. Its dispose hook closes WebSocket pools, not that OAuth
listener. The headless device callback polls in a `while (true)` and uses ordinary
fetch/sleep without an evident workspace cancellation signal. Copilot also has a
polling callback. These are source findings requiring targeted lifecycle tests;
they are not measured orphan/leak claims or independently reproduced failures.

The excluded OS browser opener is a different capability from a retained OAuth
listener. Do not claim removing the launcher proved provider authentication
retirement, and do not remove required headless/Telegram sign-in for upstream
parity reduction.

## Required boundary before implementation

Shared account credentials remain shared account state. The authority to publish
an authentication result belongs to the exact originating workspace/flow; it must
not be inferred from the current provider name or a replacement workspace.

The next fix must establish:

- Captured flow identity before asynchronous authorization; invalidated startup
  cannot publish a pending result after retirement or overwrite a later flow.
- One-shot callback admission and exact-flow validation; completed/interrupted or
  replaced flows cannot exchange or commit again.
- Revocation plus cancellation/join of actual owned authorization/polling/listener
  work on expiry, interruption and workspace retirement. Effect interruption by
  itself does not establish settlement of an arbitrary underlying Promise.
- Credential authority recheck after async reads and immediately before mutation;
  serialization of shared credential mutations must not lose another provider's
  concurrent update. `Auth.set/remove` currently read then write without the MCP
  store's lock. Lost updates are a hypothesis here, not a reproduced defect.
- Confirmed listener/request retirement before replacement; bounded uncertain
  retirement must use existing registry quarantine, not best-effort success.
- Restart drops live flows and late callbacks fail closed. Run pause/abort is not
  automatically a command to destroy an independent human sign-in flow; workspace
  replacement/deletion is the relevant destructive ownership boundary.

First decide whether the local-loopback browser method is actually required by
Telegram. If not, exclude that method in the production composition while retaining
required device/manual sign-in; do not stabilize unreachable local desktop behavior.
Third-party plugin cancellation contracts and built-in device flows must be audited
before claiming full provider lifecycle closure. Reuse the shared workspace fence
and retirement model, not a second workspace lifecycle implementation.

## Validation still required

Convert the probes to red/green regressions; add startup interruption, replacement,
concurrent callbacks, expiry, credential-read race and actual polling/listener
retirement tests. Run the cumulative gate and repeated Linux stress. Material
lifecycle changes require the actual compiled headless runtime and exact-candidate
Railway tests. PR27's successful runtime observation does not verify a future
provider fix.

Provider auth ownership is the next demonstrated boundary to close. It does not
replace the raw custom/persistent browser, helper acquisition, hard-crash/restart,
realistic concurrent resource, final audit, aligned RC artifacts and RC soak gates.
