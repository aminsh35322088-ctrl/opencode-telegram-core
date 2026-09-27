import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATERIALIZE = ROOT / "scripts" / "materialize-upstream.sh"
APPLY = ROOT / "scripts" / "apply-patches.sh"


class PatchTests(unittest.TestCase):
    def materialize(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        tree = Path(td.name) / "opencode"
        subprocess.run([str(MATERIALIZE), str(tree)], check=True, text=True, capture_output=True)
        return tree

    def test_series_applies_to_locked_upstream(self):
        tree = self.materialize()
        result = subprocess.run([str(APPLY), str(tree)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        debug = (tree / "packages/opencode/src/cli/cmd/debug/index.ts").read_text()
        self.assertIn('command: "build-info"', debug)
        self.assertIn("OPENCODE_TELEGRAM_CORE_VERSION", debug)
        self.assertTrue((tree / "packages/opencode/src/telegram-headless.ts").is_file())
        self.assertTrue((tree / "packages/opencode/script/build-telegram-headless.ts").is_file())

    def test_drift_fails_before_partial_application(self):
        tree = self.materialize()
        build = tree / "packages/opencode/script/build.ts"
        original = build.read_text()
        needle = "      OPENCODE_VERSION: `\'${Script.version}\'`,\n"
        self.assertIn(needle, original)
        build.write_text(original.replace(needle, "      OPENCODE_VERSION: \'drifted\',\n", 1))
        before = subprocess.check_output(["git", "-C", str(tree), "diff"], text=True)

        result = subprocess.run([str(APPLY), str(tree)], text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)

        after = subprocess.check_output(["git", "-C", str(tree), "diff"], text=True)
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
