#!/usr/bin/env python3
"""Qualify unbound session.probe against the actual compiled headless Core."""
import argparse
import tempfile
from pathlib import Path
import sys

sys.path[:0] = [str(Path(__file__).parents[2] / 'worker'), str(Path(__file__).parents[1] / 'compatibility')]
from node_agent import Agent, Boundary
from session_contract import Client, Server

parser = argparse.ArgumentParser()
parser.add_argument('--binary', required=True)
args = parser.parse_args()

with tempfile.TemporaryDirectory(prefix='compiled-session-probe-') as temp:
    boundary = Boundary(Path(temp) / 'agent', 'compiled-session-probe-secret' * 2,
                        dict(nodeId='session-probe', generation=1, chatId=0, threadId=0))
    try:
        agent = Agent(boundary, 'https://control.invalid')
        with Server(args.binary, readiness_path='/global/health') as server:
            client = Client(server.base)
            agent.ready = True
            agent.local = lambda method, route, payload=None, timeout=30: client.request(
                method, route, payload, timeout=timeout)
            result = agent.dispatch(boundary.envelope('session.probe', {}))
            assert result == {'created': True, 'deleted': True}, result
            assert boundary.get('session') is None
            assert boundary.get('runId') is None
            assert client.request('GET', '/session') == []
    finally:
        boundary.db.close()
