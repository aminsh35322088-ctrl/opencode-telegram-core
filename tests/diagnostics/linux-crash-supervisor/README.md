# Unshipped Linux crash-containment experiment

This directory contains an exploratory supervisor prototype for testing what happens when a compiled Core runtime is killed during work. It is diagnostic material only: it is not production code, a release dependency, or evidence that hard-crash containment is solved. See the Core root README and docs/MINIMUM_TELEGRAM_RELEASE.md for the maintained runtime and release gates.

## Compile and run

~~~bash
gcc -Wall -Wextra -Werror -O2 supervisor.prototype.c -o /tmp/core-supervisor
/tmp/core-supervisor LOCKFILE EXECUTABLE [ARGS...]
~~~

The prototype owns Bun as a child, adopts/reaps escaped descendants as a Linux subreaper, and uses pidfds to signal unreaped child identities. A controlled compiled-runtime probe retired a physically paused shell after Bun received SIGKILL. Enumerating /proc children is necessary because the kernel does not provide per-task children files for this case.

## Limitations

This experiment does not close the lifecycle gate. Killing the supervisor itself also kills Bun through PDEATHSIG but strands the paused shell. Error paths need fail-closed retention. Packaging, interrupted startup, detached/double-fork descendants, durable replacement fencing, and all required process classes remain unverified.

Do not ship this prototype or describe its one successful path as production crash containment.
