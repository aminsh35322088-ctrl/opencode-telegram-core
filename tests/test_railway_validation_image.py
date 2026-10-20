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
        self.assertIn("cc -std=c11 -O2 runtime/linux/process-scope.c -o dist/runtime/process-scope", dockerfile)
        self.assertIn("COPY --from=build /core/dist/runtime/process-scope ./runtime/linux/process-scope", dockerfile)
        self.assertIn("CORE_PROCESS_SCOPE_RUNNER", entrypoint)
        self.assertIn("COMPILED_FIXTURE_TESTS=/validation/tests/compatibility", dockerfile)
        execution = (ROOT / "tests/compatibility/production_execution.py").read_text()
        self.assertIn("configured_runner=os.environ.get('CORE_PROCESS_SCOPE_RUNNER')", execution)
        validation_script = (ROOT / "scripts/test-railway-validation-image.sh").read_text()
        self.assertIn("docker build", validation_script)
        self.assertIn("--memory", validation_script)
        self.assertIn("MEMORY_LIMIT_BYTES=1000000000", validation_script)
        self.assertIn("MEMORY_LIMIT_TOLERANCE_BYTES=4096", validation_script)
        self.assertIn("memoryMaxBytes", validation_script)
        self.assertIn("containerMemoryLimitObservedBytes", validation_script)
        self.assertIn("completedWorkloads", validation_script)
        self.assertIn("MIN_COMPLETED_WORKLOADS=10", validation_script)
        self.assertIn("minimum_workloads = int(os.environ[\"MIN_COMPLETED_WORKLOADS\"])", validation_script)
        self.assertIn("completedWorkloads\", 0) >= minimum_workloads", validation_script)
        self.assertIn("\"minimumCompletedWorkloads\": minimum_workloads", validation_script)
        self.assertIn("maxObservedDescendants", validation_script)


if __name__ == "__main__":
    unittest.main()
