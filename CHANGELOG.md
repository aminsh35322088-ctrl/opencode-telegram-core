# Changelog

## Unreleased migration work

These entries describe prerelease development, not final v1 release notes.

- Add Core-owned result polling with immutable run identity, cancellation, finite deadlines/attempts and stale-result rejection.
- Expose polling through the owned Topic task context, without allowing the application to replace its run fence.
- Fix deadline handling so pre-aborted parents cannot start work and cancellation rejects uncooperative requests promptly.
- Document the remaining pause/process migration, ownership audit and RC/soak/stable release gates.
- True pause/resume and custom-tool process governance remain release blockers.
- Integrate unreleased live pause gates into the existing upstream session runners, model streams, tool bridges, and child scheduler; retain background ownership through follow-up delivery.
- Add run-fenced runtime pause/resume controls, protected recovery intent, workspace checks, and destructive cleanup before session deletion.
- Fence earlier model phases and ensure workspace disposal attempts all resource cleanup after runner errors.
- Add actual upstream runtime/API regressions and generated SDK wire-contract checks to CI. Native delivery/control and custom-process integration are still incomplete.
- Settle shell readiness when cancellation fences work before shell startup; preserve bounded existing-tool result finalization and truncation during destructive cleanup while rejecting new work and late callbacks.
