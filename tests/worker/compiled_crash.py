"""Run as the essential container process with a disposable persistent /data volume.
First invocation: crash. Second invocation on the same volume: recover.
All identities are synthetic; no control-plane or provider network requests.
"""
import json
import os
from pathlib import Path
import signal
import sys
import threading
sys.path.insert(0, str(Path(__file__).parents[2] / 'worker'))
from node_agent import Agent, Boundary, digest

root = Path('/data')
root.mkdir(exist_ok=True)
root.chmod(0o755)
boundary = Boundary(root / 'agent', 'compiled-crash-fixture-secret' * 2,
                    dict(nodeId='crash-fixture', generation=1, chatId=-1, threadId=2))
(root / 'agent').chmod(0o700)
if boundary.snapshot is None:
    snapshot = dict(version=1, revision=1, configuration={'runtime': {}}, skills=[],
                    actions=[], catalog={}, defaults={}, credentialReferences=[])
    snapshot['hash'] = digest(snapshot)
    boundary.apply(snapshot)
agent = Agent(boundary, 'https://control.invalid')
agent.workspace = root / 'topic'
agent.workspace.mkdir(exist_ok=True)
agent.start_core()
if sys.argv[1] == 'crash':
    created = agent.dispatch(boundary.envelope('session.create', {}))
    assert boundary.get('session') == created['sessionId']
    os.kill(agent.process.pid, signal.SIGKILL)
    # The default supervisor must os._exit(1), not leave readiness503 alive.
    threading.Event().wait(10)
    os._exit(91)
if sys.argv[1] != 'recover':
    raise ValueError('expected crash or recover')
session = boundary.get('session')
assert session
assert agent.local('GET', '/session/' + session)['id'] == session
assert boundary.snapshot['revision'] == 1
agent.stop_core()
agent.start_core()
assert agent.local('GET', '/session/' + session)['id'] == session
agent.stop_core()
print(json.dumps({'essentialCrashExit': True, 'restoredSession': True,
                  'snapshotRestore': True, 'intentionalJoinedZeroReload': True}))
