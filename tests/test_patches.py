import os
from pathlib import Path
import shutil
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

    def run_apply_with_series(self, series_text):
        """Run apply-patches.sh against a self-contained CORE_ROOT.

        ``series_text`` of None leaves the patches directory without a series
        file at all.
        """
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        core = Path(td.name)
        shutil.copytree(ROOT / "scripts", core / "scripts")
        if series_text is not None:
            (core / "patches").mkdir()
            (core / "patches" / "series").write_text(series_text)
        tree = core / "worktree"
        tree.mkdir()
        return subprocess.run(
            [str(core / "scripts" / "apply-patches.sh"), str(tree)],
            text=True,
            capture_output=True,
        )

    def test_missing_series_fails_closed(self):
        result = self.run_apply_with_series(None)
        self.assertNotEqual(result.returncode, 0, "a missing series must not silently skip every patch")

    def test_comment_only_series_fails_closed(self):
        result = self.run_apply_with_series("# nothing lands today\n\n   \n")
        self.assertNotEqual(result.returncode, 0, "an empty effective series must not silently skip every patch")


if __name__ == "__main__":
    unittest.main()
