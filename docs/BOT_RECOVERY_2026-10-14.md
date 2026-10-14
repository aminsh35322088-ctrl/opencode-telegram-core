# Reviewed Bot recovery — 2026-10-14

The operator explicitly deferred Stable Bot publication and authorized review, fixes,
merges of Bot #191/Core #31 and restoration of the production Bot.

## Revisions and artifact handoff

| Item | Verified identity |
|---|---|
| Core #31 merge / pre.36 source | `6e19b05849ace61271d8fbc1adc14e7e8f85c297` |
| Core release | `v1.18.33-bot.13-pre.36`, prerelease with complete changelog |
| Bot #191 reviewed final head | `24a253d9f739124ec674847d2b5110285d96a889` |
| Bot #191 merge / live source | `8b0716207e7db7ec717ac30a806214239b1b95e9` |
| Default Worker image | `ghcr.io/aminsh35322088-ctrl/opencode-telegram-worker@sha256:2538ac4b78f0270bbe7226ac3174621065754de307be59eff46defbbc10dd095` |

All seven release checksum entries passed. Installed SDK/native metadata and runtime
build-info report the locked Core source; OCI index/manifest/config hashes and Worker
revision label were verified. The installed-artifact test requires Core's capability
export and compact GFM tables. Existing Worker RPC implementation is unchanged from
production pre.34; existing bound Topics/Workers were not migrated. New allocations
use the verified pre.36 image.

## Independent review and fixes

Core's compact GFM policy preserves cells, headers, alignment and fallback paths;
explicit HTML compactness remains author-controlled. Its public descriptor is
TypeScript-readonly rather than runtime-immutable; the documentation now says so.

Bot review found and fixed four important defects before merge:

- Redact Activity before chunking; quoted JSON assignments and escaped quoted values
  are covered, and redaction expansion is included in Telegram message bounds.
- Keep one Activity across intermediate assistant/tool steps instead of breaking it
  at each assistant message completion.
- Propagate compaction cancellation into prepare/readiness and active event streams,
  settle the terminal promise and join teardown before releasing ownership.
- Require the exact session identity in a real compaction-success event.

Tests first reproduced leaked secret tails, unredacted JSON secrets, oversized fallback,
indefinitely pending cancellation, premature cleanup release and duplicate Activity.
The fixes were independently re-reviewed without remaining merge blockers.

## Verification

- Final local Bot: 298/298 top-level Node tests, 2268/2268 CI-only Vitest tests; lint,
  typecheck, build and diff checks passed.
- Core final PR CI `38605621761`, merge CI `38606421199`, release/image workflow
  `38607228255`: success.
- Bot final PR CI `38608919771` and merge-source CI `38609512837`: success.
- Bot Publish workflow `38609512620`: skipped; no Stable Bot release was published.

## Production evidence

Existing Railway project `a708ce3f-e5d2-4625-b359-608754d17a9a`, production environment
`f21c4efb-fc4e-4dce-ac73-b86daaa687f3`, control-plane service
`a64ba999-b5be-4b71-ab73-6523e2a0e6c4` deployed the exact Bot merge source as
`a873d8d5-6674-4465-8cc8-9d214f4d6ab9`. Deployment became SUCCESS at 17:47:51Z; one
replica is Online, with no pending work/recent failure. Runtime log records
`Bot @opencode_owo_bot started!` at 17:47:45Z; startup and first 91 s heartbeats show no
startup error. `https://control-plane-production-b00f.up.railway.app/health` returned
HTTP 200 and `{"status":"healthy"}`.

This verifies deployed source, startup, Telegram polling and serving health. A new
production Telegram Topic/model task was not created as a probe.

## Remaining scope

Stable Bot publication is deferred. No soak gate was promoted by this recovery.
PR #192 remains unmerged; G1 run `38599794531` uses the earlier `da2728cf` / pre.35
candidate and cannot qualify the new production pair. Do not start G6/new qualification
runs until stabilization is explicitly resumed.
