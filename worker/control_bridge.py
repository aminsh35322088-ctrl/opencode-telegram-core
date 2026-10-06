"""Narrow localhost custom-tool bridge; secrets/signatures stay in root Agent."""
import json
import threading
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
  description: "Discover enabled generated Actions from the verified Global snapshot. Resolve an exact ID to its native/action/MCP target and immutable fixed arguments, then call that tool directly. Core tool permissions apply.",
  args: { action: {type:"string",enum:["list","resolve"]}, id: {type:"string"}, arguments: {type:"object",additionalProperties:true} },
  async execute(args, context) {
    const response = await fetch("http://127.0.0.1:''' + str(self.port) + '''/control", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"actions."+args.action,sessionId:context.sessionID,payload:{id:args.id,arguments:args.arguments ?? {}}})});
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error("Action resolution rejected");
    return JSON.stringify(result.result);
  }
};
'''
