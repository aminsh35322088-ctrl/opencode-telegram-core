# Remote MCP and OAuth ownership checkpoint

Base: main `d7dfe4be6bd8baca56b316a8b8a271af450aa85a` (PR26).
Published pre.9 remains `28e752722ac616a74fbaa5c38709fa4e39d87ea4`.
This branch is an unpublished candidate, not an RC-readiness claim. Bot is frozen.

## Demonstrated production defect

Remote MCP and manual OAuth start/callback are required by the controlled Add MCP
Server product flow. Automatic OS browser authentication is excluded from the
production graph; stabilizing an OS browser launcher is not part of this change.

The previous pending-transport map and persisted PKCE/nonce were keyed only by
server name. Real SDK/HTTP regressions demonstrated cross-workspace handshake
replacement, one workspace's disposal erasing another's flow, acceptance of a
callback without its originating state, and credentials written after retirement.
A further regression demonstrated reuse of an interrupted token exchange.
These are required production ownership boundaries, not upstream parity work.

## Candidate contract

- The existing MCP workspace state captures the original instance context and
  owns remote client/transport acquisition before asynchronous startup. Existing
  per-server operation serialization also covers auth start, callback and removal.
- Each handshake keeps its PKCE verifier and random nonce privately in memory.
  A callback requires the exact `oauthState` returned by `auth.start`; absent,
  replaced or cross-workspace identities fail before token exchange. An orphan
  callback is rejected before service-cache acquisition, so it cannot bootstrap
  configured remote services after retirement or restart.
- Remote requests compose the SDK signal with the captured workspace owner's
  abort signal. Underlying connect, fetch and credential operations stay tracked
  until their actual promise settles, even if their Effect observer is interrupted.
- Cleanup aborts requests, joins client/transport close and pending operations,
  and releases the owner only after confirmed retirement. Cleanup has a finite
  bound; failure retains the exact owner and blocks replacement. Workspace disposal
  propagates uncertainty to the existing registry quarantine (PR26).
- Pending flows expire after five minutes. Expiry targets the captured owner,
  never whatever same-name replacement is current when a timer callback runs.
- Token-exchange error or interruption retires that exact flow. A successful
  exchange checks ownership before commit, and credential mutations recheck inside
  the existing file lock after asynchronous reading. Existing credentials survive
  failed reauthentication. No unowned fallback transport is installed.
- Workspace services remain live during an individual run's pause/abort. Workspace
  retirement ends their authority; persistent configuration is not live ownership.
  Container restart discards handshakes; old callbacks cannot recreate them.

## Consumer compatibility

`POST /mcp/:name/auth/callback` now requires `{ code, oauthState }`.
The frozen Bot already retains and checks callback state locally, but its later
stable migration must forward that state to Core. No Bot source/pin change is
included here. Restarted clients must start a new flow, not reuse a saved nonce.

## Validation recorded so far

- Five original isolation/late-credential cases reproduced failures before their
  fixes. Interrupted token-exchange reuse also failed before its retirement fix.
- Seven real SDK/HTTP workspace tests pass individually/in focused runs, including
  interrupted registration and replacement; nine existing OAuth compatibility
  tests pass after explicit private-nonce and callback-state contract updates.
- A deterministic credential-file-lock test proves retirement while reading
  prevents the delayed write; original concurrent-write coverage remains intact.
- Production exclusion patch applies cleanly to the updated common patches.
- The first cumulative run found one real regression: SDK SSE startup can remain
  unresolved after EventSource close. The owner-cancellable startup adapter fixes
  that boundary without releasing transport/request cleanup early. The existing
  real HTTP timeout regression and seven OAuth tests then passed together:
  28 pass, zero failures. The previous cumulative run is not a green gate.

Additional regression: an orphan callback bootstrapped enabled remote services
and performed dynamic registration before rejecting its state. This reproduced
red, then passed after checking for an existing service cache before acquisition.
The full MCP-focused suite now passes 74 tests, including eight OAuth ownership
cases. Cumulative/CI evidence for earlier `1fe6a5b` is green (361 upstream plus
five shell repeats, 299 native and 24 toolchain); final-tree checks must be repeated
after the orphan-callback correction. Local actual compiled `1fe6a5b` passed seven
execution tests, including two new HTTP callback/late-token tests; a third compiled
orphan-callback regression is now mandatory.

Remaining before integration: cumulative validation of the final exact tree,
repeated Linux stress, production build/typecheck and graph exclusion, actual
compiled callback/lifecycle coverage, isolated Railway candidate verification,
review and artifact identity checks. This checkpoint does not close raw custom
process/browser ownership, provider/plugin/helper acquisition, crash containment
or realistic concurrent resource/soak gates. No RC or stable publication.
