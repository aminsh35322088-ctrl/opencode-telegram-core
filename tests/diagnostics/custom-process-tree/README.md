# Escaped custom-process ownership diagnostic

This directory preserves a causal Linux diagnostic for a custom process that survives its launcher. It is not a shipped implementation or a passing cumulative regression. For the production process contract and current release status, see the Core root README and docs/MINIMUM_TELEGRAM_RELEASE.md.

## Probes

- detached-descendant.probe.ts exercises the source-level custom process API.
- compiled-detached-descendant.probe.py reproduces the case through the compiled runtime and actual model/custom-tool API.

Run the probes only with the matching patched production package as OPENCODE_PACKAGE_DIR and under a test-only subreaper that joins adopted children. The fixture deliberately fails while the demonstrated ownership boundary is open and then cleans up its captured process identity.

On source 58ce9b2, a successful context.process.execFile launcher exits and invocation cleanup returns. Admission returns from zero to zero, but the captured sleep PID/start-time identity remains alive in its own process group. The compiled probe uses a FIFO handshake to prove the descendant entered its new session before the launcher finished; the custom tool reports success and acknowledges /global/dispose while the captured descendant remains alive. This distinguishes a successful-release escape from Bun crash containment.

The frozen Bot browser dependency was inspected read-only: @playwright/cli@0.1.18 pins playwright-core@1.63.0-alpha-2026-08-05. Its persistent session daemon and browser launchers use detached processes. This shows why launcher-group cleanup alone cannot establish ownership of a persistent browser daemon; it is evidence about package behavior, not an execution test of Chromium.

Do not move this probe into the passing cumulative gate until the shared process-ownership primitive retires the escaped descendant and retains admission until confirmed retirement. Do not relabel a launcher lease as daemon ownership, and do not remove the Bot browser capability on the basis of this diagnostic.
