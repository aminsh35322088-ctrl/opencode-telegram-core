# Escaped custom-process ownership diagnostic

`detached-descendant.probe.ts` is a causal Linux probe, not a green cumulative
regression or a shipped implementation. Run with the patched production package
as `OPENCODE_PACKAGE_DIR`, beneath a test-only subreaper that joins all adopted
children. It deliberately fails while the demonstrated ownership boundary is open.

On source `58ce9b2`, a successful `context.process.execFile` launcher exits and
invocation cleanup returns. Admission returns from zero to zero, yet the captured
`sleep` PID/start-time identity remains alive in its own process group. The fixture
then kills only that captured identity; the outer subreaper performs reaping.
This demonstrates successful-release escape, separately from Bun crash containment.

The frozen Bot's Playwright CLI dependency is `@playwright/cli@0.1.18`, which pins
`playwright-core@1.63.0-alpha-2026-08-05`. Read-only package inspection confirms:

- `lib/tools/cli-client/session.js` starts its persistent daemon with
  `detached: true`.
- `lib/coreBundle.js`, `launchProcess`, launches browsers with
  `detached: process.platform !== "win32"`.

Tarball: https://registry.npmjs.org/playwright-core/-/playwright-core-1.63.0-alpha-2026-08-05.tgz

Published integrity: `sha512-YussvUybTfBtyYbGXWh43f+5kNP03wg98M6mu4DphYET7PSbNVajsdLGjWE1xrsjqOw32i2wFlRP7U5mcOpMZg==`.

This is implementation evidence that launcher-group cleanup is insufficient for
the required persistent-browser target. It is not an execution test of Chromium
and does not authorize changing Bot or removing the required browser capability.

Do not move this probe into the passing cumulative gate until the shared process
ownership primitive actually retires the escaped descendant and retains admission
through confirmed retirement. Do not relabel a launcher lease as daemon ownership.
