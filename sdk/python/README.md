# AuraOS Python SDK

A minimal, production-grade Python client library to programmatically interact with AuraOS. Spin up secure cgroup-clamped Docker sandboxes, run dynamic code scripts ad-hoc, and receive immediate console logs and execution metrics.

## Installation

```bash
pip install -e .
```

## Quickstart

```python
from auraos import Sandbox

sb = Sandbox(runtime="python", api_key="ao_test_...")

# Run code in sandbox
result = sb.run("print('Hello from AuraOS!')")

print(f"Stdout: {result.stdout}")
print(f"Duration: {result.duration_ms}ms")
```
