# Unshipped Linux crash-containment experiment

This is a diagnostic prototype, not production code or an artifact dependency.
Compile supervisor.prototype.c with gcc -Wall -Wextra -Werror -O2. Invocation:
`prototype LOCKFILE EXECUTABLE [ARGS...]`.

It owns Bun as a child, adopts/reaps escaped descendants as a Linux subreaper,
and uses pidfds to signal un-reaped child identities. A controlled compiled-runtime
probe showed it retiring a physically paused shell after Bun SIGKILL. `/proc` child
PPid enumeration is necessary here because the kernel omits per-task children files.

It does **not** close the lifecycle gate: SIGKILL of the supervisor kills Bun through
PDEATHSIG but strands the paused shell. Error paths also need fail-closed retention,
and packaging, startup interruption, detached/double-fork descendants, durable
replacement fencing and all required process classes remain unverified. Do not
ship this prototype or label its one successful path production crash containment.
