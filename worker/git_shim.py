#!/usr/bin/env python3
"""Replace this process with governed Git; only non-secret local transport routing is injected."""
import os
import sys


def main(arguments):
    proxy = os.environ.get('CORE_GIT_PROXY_URL')
    options = []
    if proxy:
        if proxy != 'http://127.0.0.1:4100/github/':
            raise ValueError('invalid Worker Git transport')
        options = ['-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'http.followRedirects=false']
        for prefix in ('https://github.com/', 'git@github.com:', 'ssh://git@github.com/'):
            options.extend(['-c', 'url.' + proxy + '.insteadOf=' + prefix])
        os.environ['GIT_TERMINAL_PROMPT'] = '0'
        for key in ('GITHUB_TOKEN', 'GH_TOKEN', 'GIT_ASKPASS', 'SSH_ASKPASS'):
            os.environ.pop(key, None)
    os.execv('/usr/bin/git', ['/usr/bin/git', *options, *arguments])


if __name__ == '__main__':
    main(sys.argv[1:])
