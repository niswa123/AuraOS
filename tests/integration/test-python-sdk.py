import sys
import os
import unittest

# Ensure we import the local SDK in tests
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../sdk/python')))

try:
    from auraos import Sandbox
except ImportError as e:
    print(f"❌ Failed to import auraos SDK: {e}")
    sys.exit(1)

class TestPythonSDK(unittest.TestCase):
    def setUp(self):
        # Default local sandbox client
        self.sb = Sandbox(runtime="python", api_key="ao_test_123")

    def test_run_hello_world(self):
        print("\n  👉 Running simple hello world execution...")
        result = self.sb.run("print('Hello from SDK integration test!')")
        
        self.assertEqual(result.exit_code, 0)
        self.assertIn("Hello from SDK integration test!", result.stdout)
        self.assertFalse(result.timed_out)
        self.assertFalse(result.oom_killed)
        self.assertGreater(result.duration_ms, 0)
        print(f"  ✅ Hello world passed. Duration: {result.duration_ms}ms")

    def test_run_checkpoint_recovery(self):
        print("\n  👉 Running state checkpoint recovery test...")
        code = """
import json
checkpoint = {"iteration": 99, "score": 987.6, "status": "completed"}
with open('/tmp/state_checkpoint.json', 'w') as f:
    json.dump(checkpoint, f)
print("Checkpoint successfully created")
"""
        result = self.sb.run(code)
        
        self.assertEqual(result.exit_code, 0)
        self.assertIn("Checkpoint successfully created", result.stdout)
        self.assertIsNotNone(result.checkpoint_vars)
        self.assertEqual(result.checkpoint_vars.get("iteration"), 99)
        self.assertEqual(result.checkpoint_vars.get("score"), 987.6)
        self.assertEqual(result.checkpoint_vars.get("status"), "completed")
        print("  ✅ State checkpoint recovery passed.")

    def test_run_exit_error(self):
        print("\n  👉 Running execution failure test...")
        result = self.sb.run("import sys; sys.exit(42)")
        
        self.assertEqual(result.exit_code, 42)
        print(f"  ✅ Exit error code verification passed ({result.exit_code}).")

    def test_run_timeout(self):
        print("\n  👉 Running container timeout test...")
        # Override limit to 2 seconds to force timeout
        result = self.sb.run("import time; time.sleep(5)", limits={"timeoutMs": 2000})
        
        self.assertTrue(result.timed_out)
        self.assertIn(result.exit_code, [137, -1])
        print("  ✅ Timeout protection verified.")

if __name__ == "__main__":
    unittest.main()
