"""Run the network tool ssh-prompt TypeScript suite via the CI Node runtime.

The worker runtime tools are TypeScript; this harness keeps their behavioral
contracts inside the existing Python unittest discovery without duplicating
assertions. Skipped when node is unavailable (matches partial local toolchains).
"""

import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
TS_SUITE = ROOT / "tests" / "worker" / "network_tool_ask.test.ts"


class NetworkToolAskTests(unittest.TestCase):
    def test_network_tool_ssh_prompt_suite(self):
        node = shutil.which("node")
        if node is None:
            raise unittest.SkipTest("node is unavailable")
        result = subprocess.run(
            [node, "--experimental-transform-types", str(TS_SUITE)],
            capture_output=True,
            text=True,
            timeout=180,
            cwd=str(ROOT),
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"network_tool_ask suite failed:\n{result.stdout}\n{result.stderr}",
        )
        self.assertIn("# fail 0", result.stdout)


if __name__ == "__main__":
    unittest.main()
