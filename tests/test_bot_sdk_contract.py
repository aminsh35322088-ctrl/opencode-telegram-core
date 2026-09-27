from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BotSdkContractTests(unittest.TestCase):
    def test_contract_is_nontrivial_and_unique(self):
        contract = json.loads(
            (ROOT / "runtime/compat/opencode-telegram-bot-sdk-surface.json").read_text()
        )
        required = contract["required"]
        self.assertGreaterEqual(len(required), 40)
        self.assertEqual(len(required), len(set(required)))
        for expected in (
            "session.promptAsync",
            "session.status",
            "mcp.auth.start",
            "event.subscribe",
            "path.get",
            "app.skills",
            "global.health",
        ):
            self.assertIn(expected, required)

    def test_sdk_build_enforces_contract(self):
        build = (ROOT / "scripts/build-sdk.sh").read_text()
        self.assertIn("verify-bot-sdk-surface.ts", build)
        self.assertIn("tsconfig.tsbuildinfo", build)
        self.assertIn("node_modules/.bin", build)


if __name__ == "__main__":
    unittest.main()
