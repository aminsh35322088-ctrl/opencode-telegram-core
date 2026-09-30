# Changelog

## Unreleased migration work

These entries describe prerelease development, not final v1 release notes.

- Add Core-owned result polling with immutable run identity, cancellation, finite deadlines/attempts and stale-result rejection.
- Expose polling through the owned Topic task context, without allowing the application to replace its run fence.
- Fix deadline handling so pre-aborted parents cannot start work and cancellation rejects uncooperative requests promptly.
- Document the remaining pause/process migration, ownership audit and RC/soak/stable release gates.
- True pause/resume and custom-tool process governance remain release blockers.
