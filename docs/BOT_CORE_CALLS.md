# Bot SDK call-site inventory

Read-only Bot commit `471f644aefe44950f07c2e11effced4ffca7d525`. This complements the subsystem/reachability audit. Only actual member expressions are listed; upstream imports are not consumer evidence.

| SDK member | Bot evidence |
| --- | --- |
| `app.agents` | `src/app/services/agent-selection-service.ts:14` |
| `app.skills` | `src/app/services/skills-catalog-service.ts:53` |
| `command.list` | `src/app/services/command-catalog-service.ts:13` |
| `config.get` | `src/app/services/mcp-server-service.ts:230`, `src/app/services/mcp-server-service.ts:873` |
| `config.providers` | `src/app/services/model-context-limit-service.ts:34`, `src/app/services/unified-model-catalog-service.ts:193`, `src/app/services/model-capabilities-service.ts:28`, `src/app/services/free-llm-catalog-refresh-service.ts:45`, `src/app/services/variant-selection-service.ts:43` |
| `event.subscribe` | Alias: `src/opencode/topic-event-bus.ts:183` (`eventApi.subscribe`)  |
| `global.dispose` | `src/app/services/custom-provider-service.ts:905`, `src/app/services/opencode-managed-config-service.ts:17` |
| `global.health` | `src/opencode/auto-restart.ts:50`, `src/opencode/ready-refresh.ts:12`, `src/bot/commands/status-command.ts:19`, `src/bot/commands/opencode-start-command.ts:26`, `src/app/services/model-catalog-refresh-service.ts:20` |
| `mcp.add` | `src/app/services/mcp-server-service.ts:541`, `src/app/services/mcp-server-service.ts:603`, `src/app/services/mcp-server-service.ts:621`, `src/app/services/mcp-server-service.ts:905`, `src/app/services/mcp-server-service.ts:1090` |
| `mcp.auth.callback` | `src/app/services/mcp-server-service.ts:974` |
| `mcp.auth.remove` | `src/app/services/mcp-server-service.ts:1252` |
| `mcp.auth.start` | `src/app/services/mcp-server-service.ts:947` |
| `mcp.connect` | `src/app/services/mcp-server-service.ts:1222` |
| `mcp.disconnect` | `src/app/services/mcp-server-service.ts:516`, `src/app/services/mcp-server-service.ts:1227`, `src/app/services/mcp-server-service.ts:1232`, `src/app/services/mcp-server-service.ts:1251` |
| `mcp.status` | `src/app/services/mcp-server-service.ts:246`, `src/app/services/mcp-server-service.ts:288`, `src/app/services/mcp-server-service.ts:523` |
| `path.get` | Alias: `src/app/services/session-cache-service.ts:295` (`pathApi.get`) |
| `permission.list` | `src/app/services/attach-service.ts:216`, `src/app/services/scheduled-task-executor-service.ts:261`, `src/app/services/pending-interaction-restore-service.ts:34` |
| `permission.reply` | `src/bot/menus/permission-menu.ts:100`, `src/bot/callbacks/permission-callback-handler.ts:148`, `src/app/services/scheduled-task-executor-service.ts:316` |
| `project.list` | `src/app/services/project-service.ts:16` |
| `question.list` | `src/app/services/attach-service.ts:187`, `src/app/services/scheduled-task-executor-service.ts:260`, `src/app/services/pending-interaction-restore-service.ts:33` |
| `question.reject` | `src/bot/services/event-subscription-service.ts:563`, `src/bot/callbacks/question-callback-handler.ts:138`, `src/app/services/scheduled-task-executor-service.ts:298` |
| `question.reply` | `src/bot/menus/question-menu.ts:302` |
| `session.abort` | `src/opencode/topic-event-bus.ts:39`, `src/core/opencode-session-port.ts:36`, `src/core/native-core-service.ts:240`, `src/bot/commands/abort-command.ts:41`, `src/app/services/session-error-recovery-service.ts:57` |
| `session.children` | `src/bot/commands/session-command.ts:144`, `src/app/services/session-autonomy-service.ts:47` |
| `session.command` | `src/bot/callbacks/command-catalog-callback-handler.ts:198` |
| `session.create` | `src/core/opencode-session-port.ts:19`, `src/bot/commands/new-command.ts:44`, `src/app/services/topic-session-rotation-service.ts:44`, `.opencode/tools/session-extended.ts:77` |
| `session.delete` | `src/core/opencode-session-port.ts:44`, `src/bot/commands/new-command.ts:148`, `src/app/services/topic-session-rotation-service.ts:21`, `src/app/services/telegram-topic-delete-service.ts:126`, `.opencode/tools/session-extended.ts:95` |
| `session.deleteMessage` | `src/app/services/session-error-recovery-service.ts:84` |
| `session.diff` | `src/bot/commands/session-command.ts:140`, `src/app/services/session-autonomy-service.ts:43` |
| `session.fork` | `src/bot/callbacks/message-history-callback-handler.ts:307`, `src/app/services/session-autonomy-service.ts:51` |
| `session.get` | `src/core/opencode-session-port.ts:11`, `src/core/native-core-service.ts:247`, `src/bot/middleware/auth.ts:112`, `src/bot/callbacks/session-callback-handler.ts:85`, `src/app/services/message-history-service.ts:47` |
| `session.list` | `src/bot/menus/session-selection-menu.ts:88`, `src/app/services/session-cache-service.ts:195`, `.opencode/tools/session-extended.ts:85` |
| `session.messages` | `src/bot/menus/session-selection-menu.ts:122`, `src/bot/pinned/pinned-message-manager.ts:112`, `src/bot/callbacks/session-callback-handler.ts:347`, `src/bot/callbacks/session-callback-handler.ts:444`, `src/bot/commands/pause-command.ts:17` |
| `session.prompt` | `src/app/services/opencode-image-execution-service.ts:96`, `src/app/services/scheduled-task-schedule-parser-service.ts:207` |
| `session.promptAsync` | `src/core/native-core-service.ts:107`, `src/core/native-core-service.ts:125`, `src/core/native-core-service.ts:138`, `src/app/services/scheduled-task-executor-service.ts:546` |
| `session.revert` | `src/bot/callbacks/message-history-callback-handler.ts:231`, `src/app/services/session-autonomy-service.ts:55` |
| `session.status` | `src/opencode/client.ts:187`, `src/bot/callbacks/command-catalog-callback-handler.ts:136`, `src/bot/commands/pause-command.ts:27`, `src/bot/commands/session-command.ts:132`, `src/bot/commands/abort-command.ts:26` |
| `session.summarize` | `src/bot/callbacks/context-control-callback-handler.ts:59`, `src/app/services/session-autonomy-service.ts:65` |
| `session.todo` | `src/bot/commands/session-command.ts:136`, `src/app/services/session-autonomy-service.ts:39` |
| `session.unrevert` | `src/bot/callbacks/message-history-callback-handler.ts:272`, `src/app/services/session-autonomy-service.ts:59` |
| `session.update` | `src/bot/callbacks/rename-callback-handler.ts:25` |

The earlier contract incorrectly listed `session.execution/pause/resume`. No current Bot call-site exists. `src/bot/commands/pause-command.ts` aborts; resume dispatches a continuation prompt. Those live-control endpoints are compatibility/debug-only, with their previously closed invariants still tested there.
