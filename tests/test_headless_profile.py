from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]

class HeadlessProfileTests(unittest.TestCase):
    def test_lock_selects_headless_profile_with_size_budget(self):
        lock = json.loads((ROOT / "upstream/lock.json").read_text())
        self.assertEqual(lock["runtimeProfile"], "telegram-headless")
        self.assertGreater(lock["runtimeMaxBytes"], 0)
        self.assertLess(lock["runtimeMaxBytes"], 178 * 1024 * 1024)

    def test_production_entrypoint_depends_on_server_not_frontends(self):
        source = (ROOT / "runtime/upstream/telegram-headless.ts").read_text()
        self.assertIn('import("./server/server")', source)
        for forbidden in ("@opencode-ai/tui", "./cli/cmd/tui", "./cli/cmd/web", "@opentui/"):
            self.assertNotIn(forbidden, source)

    def test_compiler_has_single_headless_entrypoint(self):
        source = (ROOT / "scripts/build-headless-runtime.ts").read_text()
        self.assertIn('entrypoints: ["./src/telegram-headless.ts"]', source)
        self.assertNotIn("opencode-web-ui.gen.ts", source)
        self.assertNotIn("OPENCODE_WORKER_PATH", source)
        self.assertNotIn("treeSitterWorker", source)

if __name__ == "__main__":
    unittest.main()
