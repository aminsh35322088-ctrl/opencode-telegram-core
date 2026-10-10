#!/usr/bin/env python3
"""Public build/package inventory only; never inspect process environment."""
import hashlib
import json
from pathlib import Path
import subprocess

def run(*args):
    return subprocess.check_output(args, text=True, timeout=15).strip()

sha = hashlib.sha256()
with open('/usr/local/bin/opencode', 'rb') as stream:
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        sha.update(block)
inventory = {'core': json.loads(Path('/usr/local/share/core-build-info.json').read_text()),
    'coreBinarySha256': sha.hexdigest(), 'node': run('node', '--version'), 'npm': run('npm', '--version'),
    'python': run('python3', '--version'), 'tailscale': run('tailscale', 'version').splitlines()[0], 'gitLfs': run('git', 'lfs', 'version'),
    'lsofPackage': run('dpkg-query', '-W', '-f=${Version}', 'lsof'),
    'gh': run('gh', '--version').splitlines()[0], 'playwrightCLI': run('playwright-cli', '--version'),
    'playwrightCore': run('node', '-e', "const r=require('module').createRequire('/usr/local/lib/node_modules/@playwright/cli/package.json');console.log(r('playwright-core/package.json').version)"),
    'debianPackages': run('dpkg-query', '-W', '-f=${binary:Package}\t${Version}\n').splitlines(),
    'browserDirectories': sorted(path.name for path in Path('/opt/ms-playwright').iterdir() if path.is_dir())}
print(json.dumps(inventory, indent=2, sort_keys=True))
