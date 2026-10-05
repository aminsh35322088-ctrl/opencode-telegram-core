# Provider credential and authentication reachability

Current production baseline: main `884ae87d47f96ddbe670d4abcd4088dc2ae832da`.
Bot remains frozen. Published pre.9 still targets `28e7527` and contains neither
PR26 nor PR27. This document corrects the 2026-10-04 investigation checkpoint.

## Corrected production boundary

ProviderAuth is **not in the Telegram production graph**. The minimal production
profile removes its service node, provider HTTP group and handler. The actual
compiled runtime returns 404 for `/provider/auth`, `/provider/:id/oauth/authorize`
and `/provider/:id/oauth/callback`. The bundle metafile contains none of
`src/provider/auth.ts`, `httpapi/handlers/provider.ts` or
`httpapi/groups/provider.ts`. The release graph check now explicitly fences all
three exclusions, with compiled negative-route coverage.

The earlier report incorrectly treated materialized common-source reachability as
production reachability. The two diagnostic assertions do reproduce late credential
publication and callback replay in the independent full upstream composition. They
are **not Telegram Core RC blockers**. No ProviderAuth callback feature or lifecycle
layer is added to production to fix dead behavior. Provider/model inference,
credential storage, plugin loaders and retained MCP sign-in remain supported.
The existing minimum-release decision deliberately excludes provider-auth HTTP APIs;
no current Bot caller or committed target consumer requires their reintroduction.

The experimental callback implementation and cancellation helper are classified as
unshipped diagnostic material in `tests/diagnostics/provider-auth-unshipped/`. They
are not in the patch series, overlays, public API or production graph. Their source
and tests are preserved so the investigation is reviewable rather than VM-only.
They do not prove a shipped provider lifetime and must not be applied as a release
fix without a new product requirement and integration validation.

Builtin provider sign-in methods and the Codex loopback callback are invoked by the
excluded ProviderAuth/CLI surfaces. Merely finding these function declarations in a
retained plugin file does not establish an active production listener or poller.
Model-time credential refresh and provider helper acquisition are different paths
and still require their own ownership audit.

## Confirmed production defect: shared credential mutation

Model-time plugin refreshes use `Auth.Service` through their internal SDK client.
Compiled validation exposed a minimum-profile contradiction: the entire control
group, including `/auth/:providerID`, had been excluded. Codex and xAI retained
model-time refresh hooks call `input.client.auth.set`; rotated credentials could
therefore never be persisted through that client. The production profile now
retains only authenticated credential PUT/DELETE handlers; `/log`, provider sign-in,
CLI/control-plane and other excluded surfaces remain excluded. A real compiled
plugin-SDK credential publication regression covers this internal consumer. Its `set/remove` previously performed an unlocked asynchronous
read/modify/write of the same credential JSON file. Two real-service tests with a
controlled filesystem dependency reproduce:

- Concurrent updates lose one unrelated provider account.
- Concurrent removal and update either restore a removed account or lose the update.

Both account-update assertions fail on the original source (`0 pass / 2 fail`).
Additional deterministic tests reproduce cancellation interrupting admitted provider
and MCP filesystem writes while a lock could be released. The candidate
serializes reads and mutations using the existing `EffectFlock` service with a
stable file-specific key. Mutation reads use a private unlocked read inside the
exclusive lock; public reads take the same lock. Provider and MCP mutation bodies
mask fiber interruption once admitted, so their locks outlive the actual write.
Original cancellation, state/nonce checks and post-read MCP ownership guards remain
in place; request cancellation cannot pretend a started filesystem mutation vanished. The existing credential schema,
0600 mode and environment override are preserved. No flow authority or new
workspace lifecycle is invented for this shared account store.

Tests reside in `runtime/upstream/test/telegram-provider-auth-store.test.ts` and are
installed into the cumulative gate. Compiled verification adds twelve simultaneous
credential API writes and checks the actual stored account set and removal.
Six focused credential/guard assertions pass after red/green reproduction.
The reduced common-source cumulative gate passes: 366 tests, two expected skips,
zero failures, ten helper tests and five repeated shell race runs. Compiled/CI
verification is in progress;
the earlier 375-test run exercised an experimental superset and is not final-candidate
closure evidence.

## Required remaining provider audit

The compiled graph includes AWS's `credential-provider-process` module, whose SDK
implementation uses raw `child_process.exec` for configured `credential_process`.
Azure's retained model-time OAuth loader can call `Process.run` for Azure CLI tokens.
Both a Linux SDK probe and an actual compiled Bedrock invocation started the AWS
helper. The SDK probe observed Core governor activeCount=0 while it ran. The optional
AWS CLI credential_process mechanism has no documented Telegram consumer/target;
it is now rejected at production bundle resolution, without echoing the command.
A selected process profile fails terminally instead of silently changing identity.
Static profiles and non-process credential-chain links remain supported; five
bundled-SDK policy regressions pass, including actual HTTP container credential
acquisition and terminal process-backed source_profile rejection. A compiled negative-acquisition regression and
graph exclusion guard are added; candidate build verification is pending.
Azure CLI model-time acquisition still needs its own production scope/ownership
assessment. They are more relevant than excluded sign-in
callbacks. No leak or root-cause fix is claimed from source inspection alone.

Trace each required helper to its captured run/workspace owner, admission, pause,
abort, process group, confirmed cleanup and uncertain retirement. Remove helper
features that the Telegram product does not require rather than preserving upstream
parity. Keep supported providers, account credentials and inference intact.

Raw custom/persistent browser ownership, required helper/plugin acquisition,
hard-crash/restart containment, realistic concurrent resource measurements, final
ownership audit, aligned RC artifacts and RC soak remain open. Bot stays frozen.

## Corrected credential transport checkpoint

The initial `79718a7` candidate's common/native/Python gates passed, but its compiled
concurrent-account regression failed with twelve credential PUT 404 responses,
locally and in GitHub CI 37177808269. This is not ignored or rerun away. The shared
credential implementation was present but its required internal transport was
excluded. The narrowed profile corrects that consumer contract. Local actual
compiled execution now passes all eleven tests, including a real plugin SDK
publication, concurrent account mutations, AWS fail-closed acquisition, MCP and
physical pause/resume/abort/workspace retirement. The six compiled surface tests
pass, including unauthenticated credential rejection and excluded logging/sign-in.
The new recoverable AuthError regression passes alongside four credential race tests.
The corrected exact-commit cumulative/CI and Railway gates remain pending.

GitHub candidate `789cb9a` passes validate and telegram-headless; upstream-runtime
found the new failure-injection fixture used a generic Error rather than FSUtil's
declared error type. The fixture now uses FSUtil.FileSystemError and a void failure
effect. Local full upstream typechecking and focused credential regressions pass;
new exact-source CI is still required. This is a test typing correction, not a
runtime retry or waived failure.

The exact credential checkpoint `64dfc91` passes all GitHub gates in run37178606141.
Railway compiled deployment `a3d8309b-5bea-4340-a262-85ee454d4733` is SUCCESS,
reports exact source `64dfc918108a1ceb193fa9d7ea9fa4b7ce939f51`, and passed the
compiled surface/execution startup suite. The initial observation is 14 workloads,
no reported failures, healthy PID218. This is checkpoint evidence, not RC soak.
The continuing plugin-retirement candidate has not been deployed or released.

## Azure production credential scope correction (2026-10-04)

Actual compiled Core started the builtin Azure CLI token helper and acknowledged
session abort while that helper remained alive. The read-only Telegram product and
installation audit found no requirement for implicit Azure CLI credentials; generic
Azure provider/API-key inference remains required. The production build replaces
only the builtin `src/plugin/azure.ts` loader. API-key credentials keep their
original provider transport; stored CLI OAuth credentials fail terminally before
any helper or network acquisition, without retries or alternate-identity fallback.
The graph gate excludes the original CLI loader, not the Azure provider SDK. Full
upstream source is unchanged. Required explicitly governed custom tools may still
invoke CLI programs; this exclusion is specific to implicit provider acquisition.

Bundle policy regressions pass for terminal rejection and API-key pass-through.
The pre-fix compiled API-key inference assertion passes; CLI OAuth fails its bounded
request assertion. Actual post-fix compiled/cumulative/CI/Railway verification is
pending. Removing this optional mechanism does not prove ownership of required
raw custom processes, persistent browsers, other helpers or hard-crash survivors.

Exact Azure checkpoint `32f2437ede3a0e4e87cce489d119e0d9308548a9` passes all three
GitHub gates (run 37187110574). Actual compiled verification passes CLI rejection
without helper launch and API-key model/tool inference. The cumulative production
gate passes, including all five shell race repeats, six surface checks, fourteen
execution checks and ten independent session-contract checks. Isolated Railway
candidate verification is in progress; no broader crash/daemon closure is implied.
