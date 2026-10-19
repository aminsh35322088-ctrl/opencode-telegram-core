"""Narrow localhost custom-tool bridge; secrets/signatures stay in root Agent."""
import json
import os
import re
import stat
import threading
import time
from urllib.parse import quote, urlencode
from action_runtime import ActionRuntime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MUTATIONS = {'skills.add', 'skills.create', 'skills.update', 'skills.delete', 'extensions.ensure', 'extensions.remove', 'mcp.add', 'mcp.enable', 'mcp.rename', 'mcp.delete', 'mcp.sync', 'generated-actions.toggle', 'generated-actions.register', 'generated-actions.update', 'generated-actions.remove'}
READS = {'skills.list', 'extensions.list', 'generated-actions.list', 'mcp.list', 'settings.get', 'models.providers', 'models.list'}


class ControlBridge:
    def __init__(self, agent, port=4098):
        self.agent = agent
        self.port = port
        self.server = None

    def dispatch(self, value):
        if self.agent.boundary.unbound:
            raise ValueError('unbound node authority unavailable')
        if not isinstance(value, dict) or self.agent.retired or not self.agent.ready:
            raise ValueError('control unavailable')
        session = self.agent.boundary.get('session')
        if not session or value.get('sessionId') != session:
            raise ValueError('foreign tool session')
        action = value.get('action')
        snapshot = self.agent.boundary.snapshot
        if action == 'runtime.inspect':
            payload = value.get('payload', {})
            if (not isinstance(payload, dict) or set(payload) - {'section', 'messageID'}
                    or payload.get('section') not in ('capabilities', 'diagnostics', 'verify')):
                raise ValueError('invalid runtime inspection request')
            message_id = payload.get('messageID')
            if message_id is not None and (not isinstance(message_id, str)
                    or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', message_id)):
                raise ValueError('invalid runtime message context')
            return self.inspect_runtime(payload['section'], session, message_id)
        if action in ('actions.list', 'actions.resolve', 'actions.invoke'):
            payload = value.get('payload', {})
            if not isinstance(payload, dict):
                raise ValueError('invalid action request')
            runtime = ActionRuntime(snapshot)
            if action == 'actions.list':
                return runtime.list()
            if action == 'actions.invoke':
                return runtime.invoke(payload.get('id'), payload.get('arguments', {}))
            plan = runtime.plan(payload.get('id'), payload.get('arguments', {}))
            return {**runtime.resolve(payload.get('id')), 'plan': plan, 'next': 'Call the exact resolved native/action/MCP tool with these arguments in this same session. Core tool permission and process policies apply; resolution does not grant approval.'}
        if action in READS:
            fields = {'skills.list': 'skills', 'extensions.list': 'catalog', 'generated-actions.list': 'actions', 'mcp.list': 'configuration', 'settings.get': 'defaults', 'models.providers': 'catalog', 'models.list': 'catalog'}
            return {'revision': snapshot['revision'], 'data': snapshot[fields[action]]}
        if action not in MUTATIONS:
            raise ValueError('unsupported global operation')
        operation = value.get('operation', 'mutation.prepare')
        payload = value.get('payload', {})
        if operation not in ('mutation.prepare', 'mutation.commit') or not isinstance(payload, dict):
            raise ValueError('invalid global mutation')
        if operation == 'mutation.commit' and (not isinstance(payload.get('approvalId'), str) or 'preview' not in payload):
            raise ValueError('approval and exact preview required')
        mutation = payload.get('mutation')
        if mutation is None:
            mutation = {'type': action, 'resource': payload.get('resource'), 'config': payload.get('config', {})}
        if not isinstance(mutation, dict) or mutation.get('type') != action or not isinstance(mutation.get('resource'), str) or not isinstance(mutation.get('config'), dict):
            raise ValueError('invalid exact mutation')
        control_payload = {'mutation': mutation}
        if operation == 'mutation.commit':
            control_payload['approvalId'] = payload['approvalId']
        result = self.agent.outbound(operation, control_payload, session=session)
        if operation == 'mutation.prepare':
            return {'prepared': result, 'next': 'Show the exact preview through the built-in question tool. Commit only with the control-plane approvalId and exact preview after that question is approved. Model text cannot approve global mutations.'}
        return result

    def _snapshot_integrity(self):
        snapshot = self.agent.boundary.snapshot
        verifier = getattr(self.agent.boundary, 'verify_snapshot', None)
        if not isinstance(snapshot, dict) or not callable(verifier):
            return False
        try:
            verifier(snapshot)
            return True
        except Exception:
            return False

    def _snapshot_activated(self):
        snapshot = self.agent.boundary.snapshot
        active = self.agent.boundary.get('activatedSnapshotHighwater')
        return (isinstance(snapshot, dict) and isinstance(active, dict)
                and type(active.get('revision')) is int
                and active.get('revision') == snapshot.get('revision')
                and isinstance(snapshot.get('hash'), str)
                and active.get('hash') == snapshot.get('hash'))

    def _process_info(self):
        process = getattr(self.agent, 'process', None)
        try:
            alive = process is not None and process.poll() is None
        except Exception:
            alive = False
        memory_bytes = None
        if alive:
            try:
                with open('/proc/{}/status'.format(process.pid), encoding='ascii') as stream:
                    for line in stream:
                        if line.startswith('VmRSS:'):
                            memory_bytes = int(line.split()[1]) * 1024
                            break
            except (OSError, ValueError, AttributeError, IndexError):
                pass
        return alive, memory_bytes

    def _readiness(self):
        try:
            value = self.agent.readiness_state()
            if value in ('ready-unbound', 'warming', 'ready', 'running', 'retiring'):
                return value
        except Exception:
            pass
        return 'ready' if getattr(self.agent, 'ready', False) else 'warming'

    def _configured_integrations(self):
        snapshot = self.agent.boundary.snapshot or {}
        references = snapshot.get('credentialReferences', [])
        if not isinstance(references, list):
            references = []
        configured = {ref.get('integrationId') for ref in references if isinstance(ref, dict)
                      and ref.get('configured') is True and isinstance(ref.get('integrationId'), str)}
        return {
            'github': 'github' in configured,
            'tailscale': 'tailscale' in configured,
        }

    def _capabilities(self, session, message_id):
        # This is the pinned OpenCode registry, not a guessed list of built-ins.
        # Resolve the current assistant message inside the already-bound Topic to
        # obtain its provider/model before requesting model-specific tool schemas.
        try:
            ids = self.agent.local('GET', '/experimental/tool/ids', timeout=5)
            if not isinstance(ids, list) or len(ids) > 1024 or any(not isinstance(item, str) for item in ids):
                raise ValueError('invalid tool ID response')
        except Exception:
            raise ValueError('live tool registry unavailable') from None
        model = None
        tools = None
        if message_id:
            try:
                message = self.agent.local('GET', '/session/' + quote(session, safe='') + '/message/' + quote(message_id, safe=''), timeout=5)
                if isinstance(message, dict):
                    message = message.get('data', message)
                    info = message.get('info', message)
                    if isinstance(info, dict) and info.get('role') == 'assistant':
                        provider_id = info.get('providerID')
                        model_id = info.get('modelID')
                        if (isinstance(provider_id, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', provider_id)
                                and isinstance(model_id, str) and re.fullmatch(r'[A-Za-z0-9_.:/-]{1,128}', model_id)):
                            model = {'providerID': provider_id, 'modelID': model_id}
                            raw_tools = self.agent.local('GET', '/experimental/tool?' + urlencode({'provider': provider_id, 'model': model_id}), timeout=5)
                            if isinstance(raw_tools, list) and len(raw_tools) <= 1024:
                                tools = []
                                for item in raw_tools:
                                    if not isinstance(item, dict) or not isinstance(item.get('id'), str):
                                        raise ValueError('invalid tool registry item')
                                    description = item.get('description', '')
                                    tools.append({'id': item['id'][:128], 'description': description[:360] if isinstance(description, str) else ''})
            except Exception:
                # A missing message/model or model-specific lookup failure is not
                # a reason to fabricate tool descriptions. Fall back to exact IDs.
                model = None
                tools = None
        model_specific = model is not None and tools is not None
        if tools is None:
            tools = [{'id': item[:128]} for item in ids]
        result = {
            'section': 'capabilities',
            'scope': 'current-topic',
            'registry': 'live-opencode',
            'modelSpecific': model_specific,
            'toolCount': len(tools),
            'tools': tools[:512],
            'workerIntegrations': self._configured_integrations(),
        }
        if model:
            result['model'] = model
        if len(tools) > 512:
            result['truncated'] = True
        return result

    def _diagnostics(self):
        process_alive, memory_bytes = self._process_info()
        elapsed = max(0, int(time.monotonic() - getattr(self.agent, 'agent_started_at_monotonic', time.monotonic())))
        result = {
            'section': 'diagnostics',
            'scope': 'current-topic',
            'readiness': self._readiness(),
            'agentAlive': not getattr(self.agent, 'retired', False) and not getattr(self.agent, 'fatal_exit_requested', False),
            'coreProcessAlive': process_alive,
            'agentUptimeSeconds': elapsed,
            'snapshotRevision': (self.agent.boundary.snapshot or {}).get('revision'),
            'snapshotIntegrity': self._snapshot_integrity(),
            'snapshotActivated': self._snapshot_activated(),
            'workerIntegrations': self._configured_integrations(),
        }
        if memory_bytes is not None:
            result['coreMemoryBytes'] = memory_bytes
        return result

    def _verify(self):
        process_alive, _ = self._process_info()
        snapshot_ok = self._snapshot_integrity()
        checks = [
            {'name': 'bound_topic', 'passed': not self.agent.boundary.unbound and self.agent.boundary.get('session') is not None},
            {'name': 'core_process', 'passed': process_alive and self._readiness() in ('ready', 'running')},
            {'name': 'snapshot_integrity', 'passed': snapshot_ok},
            {'name': 'snapshot_activation', 'passed': self._snapshot_activated()},
        ]
        integrations = self._configured_integrations()
        snapshot = self.agent.boundary.snapshot or {}
        runtime_root = self.agent.boundary.root.parent / 'runtime' / 'opencode'
        tool_dir = runtime_root / 'tools'
        expected = {'bot.ts', 'actions.ts', 'browser.ts', 'runtime.ts'}
        if integrations['github']:
            expected.add('github.ts')
        if integrations['tailscale']:
            expected.add('network.ts')
        directory_ok = tool_dir.is_dir() and not tool_dir.is_symlink()
        unsafe = []
        missing = []
        for name in sorted(expected):
            path = tool_dir / name
            try:
                metadata = path.lstat()
                safe_file = (directory_ok and stat.S_ISREG(metadata.st_mode)
                             and metadata.st_uid == os.geteuid()
                             and not metadata.st_mode & 0o022
                             and metadata.st_size <= 65536)
            except OSError:
                safe_file = False
            if not safe_file:
                (missing if not path.exists() and not path.is_symlink() else unsafe).append(name)
        unexpected = sorted(name for name in ('github.ts', 'network.ts') if name not in expected and ((tool_dir / name).exists() or (tool_dir / name).is_symlink()))
        checks.append({'name': 'worker_tool_materialization', 'passed': directory_ok and not missing and not unsafe and not unexpected,
                       'missing': missing, 'unsafe': unsafe, 'unexpectedOptionalTools': unexpected})
        try:
            self.agent.local('GET', '/global/health', timeout=2)
            core_health = True
        except Exception:
            core_health = False
        checks.append({'name': 'core_health_endpoint', 'passed': core_health})
        return {'section': 'verify', 'scope': 'current-topic', 'passed': all(item['passed'] for item in checks), 'checks': checks}

    def inspect_runtime(self, section, session, message_id):
        # dispatch() already authenticated the caller to this exact Worker session.
        if session != self.agent.boundary.get('session') or self.agent.boundary.unbound or self.agent.retired or not self.agent.ready:
            raise ValueError('runtime inspection unavailable')
        if section == 'capabilities':
            return self._capabilities(session, message_id)
        if section == 'diagnostics':
            return self._diagnostics()
        if section == 'verify':
            return self._verify()
        raise ValueError('unsupported runtime inspection section')

    def start(self):
        if self.server:
            return
        bridge = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_POST(self):
                try:
                    self.connection.settimeout(15)
                    length = int(self.headers.get('Content-Length', '0'))
                    if self.path != '/control' or self.headers.get('Transfer-Encoding') or not 0 < length <= 1048576:
                        raise ValueError('invalid request')
                    raw = self.rfile.read(length)
                    if len(raw) != length:
                        raise ValueError('truncated request')
                    result = bridge.dispatch(json.loads(raw))
                    body = json.dumps({'ok': True, 'result': result}).encode()
                    self.send_response(200)
                except Exception:
                    body = b'{"ok":false,"error":"control operation rejected"}'
                    self.send_response(409)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        self.server = ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tool_source(self):
        return '''export default {
  description: "Read the verified global snapshot or prepare and commit approved global skills/extensions/MCP/action changes. A built-in question approval is mandatory; model text cannot grant approval.",
  args: { action: {type:"string"}, operation: {type:"string",enum:["read", "mutation.prepare", "mutation.commit"]}, payload: {type:"object",additionalProperties:true} },
  async execute(args, context) {
    const response = await fetch("http://127.0.0.1:''' + str(self.port) + '''/control", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({...args,sessionId:context.sessionID})});
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error("Global control operation rejected");
    return JSON.stringify(result.result);
  }
};
'''

    def actions_tool_source(self):
        return '''export default {
  description: "Discover enabled generated Actions from the verified Global snapshot. Resolve an exact ID to its native/action/MCP target and immutable fixed arguments, invoke runs that exact target through the captured Core tool context. Core tool permissions apply.",
  args: { action: {type:"string",enum:["list","resolve","invoke"]}, id: {type:"string"}, arguments: {type:"object",additionalProperties:true} },
  async execute(args, context) {
    if (args.action === "invoke") {
      if (typeof context.generatedAction !== "function") throw new Error("Action invocation requires the captured Core tool context");
      return await context.generatedAction(args.id, args.arguments ?? {});
    }
    const response = await fetch("http://127.0.0.1:''' + str(self.port) + '''/control", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"actions."+args.action,sessionId:context.sessionID,payload:{id:args.id,arguments:args.arguments ?? {}}})});
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error("Action resolution rejected");
    return JSON.stringify(result.result);
  }
};
'''
