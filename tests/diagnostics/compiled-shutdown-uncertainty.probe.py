"""Read-only diagnostic: does headless shutdown report uncertain retirement?"""
import json
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/compatibility'))
from session_contract import Server, Client
from production_execution import plugin_registry
roots = []; registry = plugin_registry()
def configure(root, env):
    roots.append(root)
    directory = root / 'plugin-config'; directory.mkdir()
    plugin = directory / 'uncertain-plugin.js'
    plugin.write_text("export default async () => ({async dispose(){await Bun.write(" +
        json.dumps(str(root / 'cleanup-attempted')) + ", 'attempted');throw Error('fixture shutdown uncertainty')}});\n")
    (directory / '.npmrc').write_text(f'registry=http://127.0.0.1:{registry.server_port}/\n')
    env['NPM_CONFIG_REGISTRY'] = f'http://127.0.0.1:{registry.server_port}/'
    env['OPENCODE_CONFIG_DIR'] = str(directory)
    env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'plugin': [plugin.as_uri()]})
try:
    with Server(str(ROOT / 'dist/runtime/opencode'), readiness_path='/global/health', configure=configure) as server:
        Client(server.base).request('GET', '/agent', timeout=30)
        server.process.terminate(); server.process.wait(timeout=15)
        attempted = (roots[0] / 'cleanup-attempted').exists()
        server.close()
        print(json.dumps({'exitCode': server.process.returncode, 'cleanupAttempted': attempted,
                          'cleanupUncertaintyReported': 'fixture shutdown uncertainty' in server.stderr,
                          'shutdownReportsSuccess': server.process.returncode == 0}))
finally:
    registry.shutdown(); registry.server_close()
