# Custom-tool process capability (pre.8 prerelease)

Core supplies `context.process.execFile(command, args, options)` to custom tools
at the existing plugin registry boundary. It captures the actual runtime lease,
phase, session, workspace and cancellation signal. A tool cannot choose another
owner. The exported native `ToolProcessPort` type describes this capability; the
native package does not implement another process engine.

Options support `cwd`, `env`, `timeout`, `maxBuffer` and an additional `signal`.
Output is returned as UTF-8 `stdout` and `stderr`. Nonzero exits expose their code
and bounded output. Timeouts are between one millisecond and ten minutes; output
is capped at sixteen MiB. Caller cancellation can only narrow the captured
lifetime. Arguments and environment values are not logged by this capability.

## Ownership and lifecycle

- Canonical working directories must remain inside the captured Topic workspace,
  including after symlink resolution. Pause is checked again after asynchronous
  path validation, immediately before synchronous admission and spawning.
- The existing Telegram process governor remains authoritative for category,
  global and memory admission. Process-group leases retain accounting until
  explicit cleanup confirms group death; leader exit alone cannot free capacity.
- Linux process groups are suspended with `SIGSTOP`, resumed with `SIGCONT`, and
  terminated with `SIGKILL` on cancellation, ownership loss or output pressure.
  Active execution timeouts freeze during pause.
- Invocation completion closes the process capability, terminates detached work,
  joins cleanup and rejects late callbacks. Retirement never adopts a newer run.
- Cleanup has a five-second group bound and a ten-second invocation bound.
  Failure fences execution and preserves admission accounting instead of claiming
  the workspace is safe for replacement.
- Missing live ownership, disabled process governance and unsupported Windows
  process-group lifecycle fail closed. There is no raw spawning fallback.

## Integration gates

Linux runtime tests, artifact verification and an aligned prerelease are required
before Bot tools consume this API. Persistent daemon tools require separate
inspection: a CLI that detaches descendants into another OS session must not be
treated as governed solely because its launcher was admitted. Existing MCP/LSP/
PTY services retain their existing service lifetimes; this capability does not
attach those shared services to individual model runs.

The Bot's raw custom-tool calls have not yet been migrated. The aligned pre.8
artifacts passed verification and are published from `f110bd25419b6bedc40db36e9ae929bc4e52b9ac`.
The capability is not a declaration that Bot custom-tool governance or v1 is complete.
