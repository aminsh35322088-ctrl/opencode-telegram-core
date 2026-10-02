"""External MCP stdio fixture for the actual compiled runtime, no SDK internals."""
import json
import os
from pathlib import Path
import subprocess
import sys
child = subprocess.Popen(['/bin/sleep', '60'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
Path(sys.argv[1]).write_text(json.dumps([os.getpid(), child.pid]))
for line in sys.stdin:
    request = json.loads(line)
    if 'id' not in request: continue
    method = request['method']
    if method == 'initialize': result = {'protocolVersion': request['params']['protocolVersion'], 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'compiled-fixture', 'version': '1'}}
    elif method == 'tools/list': result = {'tools': [{'name': 'probe', 'description': 'Compiled MCP probe', 'inputSchema': {'type': 'object', 'properties': {}}}]}
    elif method == 'tools/call': result = {'content': [{'type': 'text', 'text': 'compiled-mcp-result'}]}
    else: result = {}
    print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
