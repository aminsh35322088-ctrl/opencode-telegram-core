import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ENSURE = ROOT / "scripts" / "ensure-bun.sh"


class ToolchainTests(unittest.TestCase):
    def test_wrong_bun_is_rejected_without_install(self):
        with tempfile.TemporaryDirectory() as td:
            fake = Path(td) / "bun"
            fake.write_text("#!/usr/bin/env bash\necho 9.9.9\n")
            fake.chmod(0o755)
            env = os.environ | {
                "PATH": f"{td}:{os.environ['PATH']}",
                "CORE_BUN_NO_INSTALL": "1",
            }
            result = subprocess.run([str(ENSURE)], text=True, capture_output=True, env=env)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("expected Bun 1.3.14", result.stderr)


class BuildEnvironmentTests(unittest.TestCase):
    def test_build_environment_propagates_lock_read_failure(self):
        with tempfile.TemporaryDirectory() as td:
            missing = Path(td) / "missing-lock.json"
            command = (
                f'source "{ROOT / "scripts" / "common.sh"}"; '
                'export_upstream_build_environment'
            )
            env = os.environ | {"CORE_UPSTREAM_LOCK": str(missing)}
            result = subprocess.run(["bash", "-c", command], text=True, capture_output=True, env=env)
            self.assertNotEqual(result.returncode, 0)

    def test_build_environment_uses_locked_release_version(self):
        command = (
            f'source "{ROOT / "scripts" / "common.sh"}"; '
            'export_upstream_build_environment; '
            'printf "%s" "$OPENCODE_VERSION"'
        )
        result = subprocess.run(["bash", "-c", command], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "1.18.33")


if __name__ == "__main__":
    unittest.main()
