import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "materialize-upstream.sh"


class UpstreamTests(unittest.TestCase):
    def fixture(self):
        td = tempfile.TemporaryDirectory()
        root = Path(td.name)
        src = root / "src"
        src.mkdir()
        subprocess.run(["git", "init", "-q", str(src)], check=True)
        subprocess.run(["git", "-C", str(src), "config", "user.name", "test"], check=True)
        subprocess.run(["git", "-C", str(src), "config", "user.email", "test@example.invalid"], check=True)
        (src / "README.md").write_text("fixture\n")
        subprocess.run(["git", "-C", str(src), "add", "README.md"], check=True)
        subprocess.run(["git", "-C", str(src), "commit", "-qm", "fixture"], check=True)
        sha = subprocess.check_output(["git", "-C", str(src), "rev-parse", "HEAD"], text=True).strip()
        subprocess.run(["git", "-C", str(src), "tag", "v1.0.0"], check=True)
        return td, src, sha

    def test_exact_commit_materializes(self):
        td, src, sha = self.fixture()
        self.addCleanup(td.cleanup)
        lock = Path(td.name) / "lock.json"
        lock.write_text(json.dumps({
            "repository": str(src),
            "tag": "v1.0.0",
            "commit": sha,
            "version": "1.0.0",
            "bun": "1.3.14",
            "telegramCoreVersion": "1.0.0-bot.1",
        }))
        dest = Path(td.name) / "out"
        env = os.environ | {"CORE_UPSTREAM_LOCK": str(lock)}
        result = subprocess.run([str(SCRIPT), str(dest)], text=True, capture_output=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        actual = subprocess.check_output(["git", "-C", str(dest), "rev-parse", "HEAD"], text=True).strip()
        self.assertEqual(actual, sha)

    def test_tag_commit_mismatch_is_rejected(self):
        td, src, sha = self.fixture()
        self.addCleanup(td.cleanup)
        lock = Path(td.name) / "lock.json"
        lock.write_text(json.dumps({
            "repository": str(src),
            "tag": "v1.0.0",
            "commit": "0" * 40,
            "version": "1.0.0",
            "bun": "1.3.14",
            "telegramCoreVersion": "1.0.0-bot.1",
        }))
        env = os.environ | {"CORE_UPSTREAM_LOCK": str(lock)}
        result = subprocess.run([str(SCRIPT), str(Path(td.name) / "out")], text=True, capture_output=True, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("commit mismatch", result.stderr.lower())


if __name__ == "__main__":
    unittest.main()
