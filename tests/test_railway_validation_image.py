import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class RailwayValidationImageTests(unittest.TestCase):
    def test_compiled_runtime_image_preserves_test_relative_paths(self):
        dockerfile = (ROOT / "Dockerfile.railway-runtime").read_text()
        entrypoint = (ROOT / "validation/railway/compiled-runtime.py").read_text()
        self.assertIn("COPY tests/compatibility ./tests/compatibility", dockerfile)
        self.assertIn("COPY worker/tailscale_runtime.py ./worker/tailscale_runtime.py", dockerfile)
        self.assertIn("COPY runtime/linux/process-scope.c ./runtime/linux/process-scope.c", dockerfile)
        self.assertIn("/validation/tests/compatibility", entrypoint)
        self.assertNotIn("/validation/tests/' + test", entrypoint)


if __name__ == "__main__":
    unittest.main()
