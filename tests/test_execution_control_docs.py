"""Guard: Core documentation must present the Stop-only execution-control contract.

The Bot's former Pause/Resume/Abort commands were deleted, and pause/resume/abort
survive only as *internal* runtime primitives. Documentation drift here is
dangerous because it tells operators a user control exists that does not. This is
the Core-side counterpart of the Bot's `tests/legacy-run-controls-audit.test.ts`.

Every assertion is checked against the text that is currently shipped; if any of
them fails, the document has drifted from the enforced product behavior.
"""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


class ExecutionControlDocumentationTest(unittest.TestCase):
    def test_core_readme_states_stop_is_the_only_user_control(self) -> None:
        readme = read("README.md")
        self.assertIn(
            "the only user-facing execution control is Telegram's native Stop",
            readme,
        )
        self.assertIn("exposes no pause/resume/abort control", readme)

    def test_core_readme_keeps_pause_resume_abort_internal(self) -> None:
        readme = read("README.md")
        self.assertIn("INTERNAL runtime primitives", readme)
        self.assertIn("They are not user commands", readme)

    def test_execution_control_decision_is_stop_only(self) -> None:
        decision = read("docs/TELEGRAM_EXECUTION_CONTROL.md")
        self.assertIn("Stop-only user-facing contract (authoritative)", decision)
        # Stop must attribute the cancelled run by identity, not by timing alone.
        self.assertIn("stale-draft", decision)

    def test_pause_resume_doc_describes_stop_not_pause(self) -> None:
        doc = read("docs/PAUSE_RESUME.md")
        self.assertIn("attributed to the stopped draft", doc)

    def test_bot_core_calls_records_the_stop_route(self) -> None:
        calls = read("docs/BOT_CORE_CALLS.md")
        self.assertIn("The only user-facing execution control is Telegram's native Stop", calls)
        self.assertIn("no pause/resume/abort control", calls)

    def test_minimum_release_report_no_longer_claims_pause_behavior(self) -> None:
        report = read("docs/MINIMUM_TELEGRAM_RELEASE.md")
        self.assertNotIn("The Bot currently implements pause by aborting", report)
        self.assertIn("execution control is **Telegram Stop only**", report)

    def test_no_core_doc_advertises_pause_resume_or_abort_to_bot_users(self) -> None:
        """No Core document may advertise these as Bot user commands.

        The documented form of a Bot command is a backticked token (`/pause`);
        internal runtime vocabulary (the execution/pause/resume HTTP surface,
        shell STOP/CONT, physical pause probes) is legitimate and expected in
        design records. STABILIZATION_LEDGER.md is deliberately out of scope:
        it exists to record the historical defect and the guard that caught it.
        """
        forbidden = ("`/pause`", "`/resume`", "`/abort`")
        checked = [ROOT / "README.md",
                   ROOT / "docs" / "MINIMUM_TELEGRAM_RELEASE.md",
                   ROOT / "docs" / "PAUSE_RESUME.md",
                   ROOT / "docs" / "TELEGRAM_EXECUTION_CONTROL.md",
                   ROOT / "docs" / "BOT_CORE_CALLS.md"]
        for path in checked:
            text = path.read_text(encoding="utf-8")
            for phrase in forbidden:
                self.assertNotIn(
                    phrase, text,
                    f"{path.relative_to(ROOT)} advertises {phrase} as a Bot control",
                )


if __name__ == "__main__":
    unittest.main()
