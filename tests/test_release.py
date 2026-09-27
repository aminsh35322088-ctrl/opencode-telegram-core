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
COMMON = ROOT / "scripts" / "common.sh"

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
            "runtimeProfile": "telegram-headless",
            "runtimeMaxBytes": 1048576,
            "embeddedWebUi": False,
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
            f"\"sdkRevision\":\"{UPSTREAM}\",\"runtimeProfile\":\"telegram-headless\",\"embeddedWebUi\":false}}'\n"
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

        native_dir = root / "native"
        native_dir.mkdir()
        (native_dir / "index.js").write_text("export {};\n")
        native_info = {
            "nativeRuntimeVersion": "0.1.0",
            "telegramCoreCommit": CORE,
            "grammyVersion": "1.46.0",
            "bunVersion": "1.3.14",
            "upstreamVersion": "1.0.0",
            "upstreamCommit": UPSTREAM,
        }
        (native_dir / "runtime-info.json").write_text(json.dumps(native_info))
        with tarfile.open(release / "opencode-telegram-native-runtime.tar.gz", "w:gz") as tf:
            tf.add(native_dir / "index.js", arcname="index.js")
            tf.add(native_dir / "runtime-info.json", arcname="runtime-info.json")

        build_info = {
            "upstreamVersion": "1.0.0",
            "upstreamCommit": UPSTREAM,
            "telegramCoreVersion": "1.0.0-bot.1",
            "telegramCoreCommit": CORE,
            "sdkRevision": UPSTREAM,
            "runtimeProfile": "telegram-headless",
            "runtimeBytes": 1024,
            "runtimeMaxBytes": 1048576,
        }
        (release / "build-info.json").write_text(json.dumps(build_info))
        manifest = {
            **build_info,
            "nativeRuntime": native_info,
            "platform": "linux-x64",
            "artifacts": [
                "opencode-telegram-core-linux-x64.tar.gz",
                "opencode-telegram-core-sdk.tar.gz",
                "opencode-telegram-native-runtime.tar.gz",
            ],
        }
        (release / "release-manifest.json").write_text(json.dumps(manifest))
        self.write_checksums(release)
        return release, lock

    def write_checksums(self, release):
        names = [
            "opencode-telegram-core-linux-x64.tar.gz",
            "opencode-telegram-core-sdk.tar.gz",
            "opencode-telegram-native-runtime.tar.gz",
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

    def test_source_tree_guard_rejects_untracked_file(self):
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td) / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            subprocess.run(["git", "-C", str(repo), "config", "user.name", "test"], check=True)
            subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
            (repo / "tracked").write_text("clean\n")
            subprocess.run(["git", "-C", str(repo), "add", "tracked"], check=True)
            subprocess.run(["git", "-C", str(repo), "commit", "-qm", "fixture"], check=True)
            (repo / "dirty").write_text("dirty\n")
            command = f'source "{COMMON}"; assert_clean_source_tree "{repo}"'
            result = subprocess.run(["bash", "-c", command], text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("source tree is dirty", result.stderr.lower())

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

    def test_wrong_runtime_profile_fails_identity(self):
        release, lock = self.fixture()
        manifest_path = release / "release-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["runtimeProfile"] = "full-cli"
        manifest_path.write_text(json.dumps(manifest))
        self.write_checksums(release)
        result = self.verify(release, lock)
        self.assertNotEqual(result.returncode, 0)

    def test_runtime_size_over_budget_fails(self):
        release, lock = self.fixture()
        manifest_path = release / "release-manifest.json"
        build_path = release / "build-info.json"
        manifest = json.loads(manifest_path.read_text())
        build = json.loads(build_path.read_text())
        manifest["runtimeBytes"] = 2097152
        build["runtimeBytes"] = 2097152
        manifest_path.write_text(json.dumps(manifest))
        build_path.write_text(json.dumps(build))
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
