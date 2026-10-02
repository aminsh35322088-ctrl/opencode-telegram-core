#!/usr/bin/env python3
"""Fail a production build if a retired implementation re-enters its bundle graph."""
import argparse
import json
from pathlib import Path

FORBIDDEN = (
    '/core/src/pty.ts', '/core/src/pty/', 'src/server/shared/pty-ticket.ts', '/protocol/src/groups/pty.ts', '/core/src/pty/bun.ts', '/core/src/pty/node.ts',
    'node-pty@', 'bun-pty@', '/codemode/', '/codemode/src/', 'typescript/lib/typescript.js',
    '/fff-bin-', '/fff-core/', '/filesystem/fff.',
    'src/mcp/browser.ts', 'src/server/mdns.ts', 'bonjour-service',
    'src/account/account.ts', 'src/account/repo.ts', 'src/share/share-next.ts', 'src/share/session.ts', 'src/installation.ts',
    'src/server/shared/ui.ts', '/server/src/handlers/',
    'httpapi/handlers/pty.ts', 'httpapi/handlers/tui.ts', 'httpapi/handlers/experimental.ts',
    'httpapi/handlers/control-plane.ts', 'httpapi/handlers/workspace.ts',
    'httpapi/handlers/file.ts', 'httpapi/handlers/project-copy.ts', 'httpapi/handlers/sync.ts',
    'httpapi/handlers/provider.ts', 'src/cli/', '/desktop/src/', '/tui/src/index.',
)
REQUIRED = ('src/session/prompt.ts', 'src/tool/registry.ts', 'src/mcp/index.ts',
            'src/lsp/lsp.ts', 'src/tool/task.ts', 'src/tool/read.ts',
            '/core/src/telegram-owned-process.ts', '/core/src/telegram-service-process.ts')

def verify(meta):
    paths = list(meta['inputs'])
    forbidden = [p for p in paths if any(s in p for s in FORBIDDEN)]
    missing = [s for s in REQUIRED if not any(s in p for p in paths)]
    if forbidden or missing:
        raise ValueError(f'forbidden production implementations: {forbidden}; missing required implementations: {missing}')
    return {'inputModules': len(paths), 'sourceBytes': sum(v['bytes'] for v in meta['inputs'].values())}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('metafile', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(json.loads(args.metafile.read_text())), sort_keys=True))
