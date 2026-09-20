import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
VERIFY = ROOT / "scripts" / "verify-release.sh"
PACKAGE = ROOT / "scripts" / "package-release.sh"

UPSTREAM = "1" * 40
CORE = "a" * 40


class ReleaseTests(unittest.TestCase):
    def fixture(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        root = Path(td.name)
        release = root / "release"
        release.mkdir()
        lock = root / "lock.json"
        lock.write_text(json.dumps({
            "repository": "fixture",
            "tag": "v1.0.0",
            "commit": UPSTREAM,
            "version": "1.0.0",
            "bun": "1.3.14",
            "telegramCoreVersion": "1.0.0-bot.1",
        }))

        runtime_dir = root / "runtime"
        runtime_dir.mkdir()
        runtime = runtime_dir / "opencode"
        runtime.write_text(
            "#!/usr/bin/env bash\n"
            "if [[ \"$1\" == \"--version\" ]]; then echo 1.0.0; exit 0; fi\n"
            "if [[ \"$1\" == \"debug\" && \"$2\" == \"build-info\" ]]; then\n"
            f"  echo '{{\"upstreamVersion\":\"1.0.0\",\"upstreamCommit\":\"{UPSTREAM}\","
            f"\"telegramCoreVersion\":\"1.0.0-bot.1\",\"telegramCoreCommit\":\"{CORE}\","
            f"\"sdkRevision\":\"{UPSTREAM}\"}}'\n"
            "  exit 0\n"
            "fi\nexit 2\n"
        )
        runtime.chmod(0o755)

        sdk_dir = root / "sdk"
        sdk_dir.mkdir()
        (sdk_dir / "UPSTREAM_REVISION").write_text(UPSTREAM + "\n")
        (sdk_dir / "index.js").write_text("export {};\n")

        with tarfile.open(release / "opencode-telegram-core-linux-x64.tar.gz", "w:gz") as tf:
            tf.add(runtime, arcname="opencode")
        with tarfile.open(release / "opencode-telegram-core-sdk.tar.gz", "w:gz") as tf:
            for item in sdk_dir.iterdir():
                tf.add(item, arcname=item.name)

        build_info = {
            "upstreamVersion": "1.0.0",
            "upstreamCommit": UPSTREAM,
            "telegramCoreVersion": "1.0.0-bot.1",
            "telegramCoreCommit": CORE,
            "sdkRevision": UPSTREAM,
        }
        (release / "build-info.json").write_text(json.dumps(build_info))
        manifest = {
            **build_info,
            "platform": "linux-x64",
            "artifacts": [
                "opencode-telegram-core-linux-x64.tar.gz",
                "opencode-telegram-core-sdk.tar.gz",
            ],
        }
        (release / "release-manifest.json").write_text(json.dumps(manifest))
        self.write_checksums(release)
        return release, lock

    def write_checksums(self, release):
        names = [
            "opencode-telegram-core-linux-x64.tar.gz",
            "opencode-telegram-core-sdk.tar.gz",
            "build-info.json",
            "release-manifest.json",
        ]
        lines = []
        for name in names:
            digest = hashlib.sha256((release / name).read_bytes()).hexdigest()
            lines.append(f"{digest}  {name}")
        (release / "SHA256SUMS").write_text("\n".join(lines) + "\n")

    def verify(self, release, lock):
        env = os.environ | {"CORE_UPSTREAM_LOCK": str(lock)}
        return subprocess.run([str(VERIFY), str(release)], text=True, capture_output=True, env=env)

    def test_packaging_rejects_dirty_source_tree(self):
        probe = ROOT / ".release-dirty-probe"
        probe.write_text("dirty\n")
        try:
            result = subprocess.run([str(PACKAGE)], text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("source tree is dirty", result.stderr.lower())
        finally:
            probe.unlink(missing_ok=True)

    def test_valid_release_verifies(self):
        release, lock = self.fixture()
        result = self.verify(release, lock)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_changed_artifact_byte_fails_checksum(self):
        release, lock = self.fixture()
        artifact = release / "opencode-telegram-core-linux-x64.tar.gz"
        artifact.write_bytes(artifact.read_bytes() + b"tamper")
        result = self.verify(release, lock)
        self.assertNotEqual(result.returncode, 0)

    def test_wrong_upstream_commit_fails_identity(self):
        release, lock = self.fixture()
        manifest_path = release / "release-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["upstreamCommit"] = "2" * 40
        manifest_path.write_text(json.dumps(manifest))
        self.write_checksums(release)
        result = self.verify(release, lock)
        self.assertNotEqual(result.returncode, 0)

    def test_wrong_core_version_fails_identity(self):
        release, lock = self.fixture()
        manifest_path = release / "release-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["telegramCoreVersion"] = "9.9.9-bot.9"
        manifest_path.write_text(json.dumps(manifest))
        self.write_checksums(release)
        result = self.verify(release, lock)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
