import requests
from typing import Dict, Any, Optional

class ExecutionResult:
    """Captured outputs and resource metrics of a sandbox execution session."""
    def __init__(self, data: Dict[str, Any]):
        self.execution_id: str = data.get("executionId", "")
        self.exit_code: int = data.get("exitCode", -1)
        self.stdout: str = data.get("stdout", "")
        self.stderr: str = data.get("stderr", "")
        self.duration_ms: int = data.get("durationMs", 0)
        self.timed_out: bool = data.get("timedOut", False)
        self.oom_killed: bool = data.get("oomKilled", False)
        self.checkpoint_vars: Optional[Dict[str, Any]] = data.get("checkpointVars")

    def __repr__(self) -> str:
        return (
            f"<ExecutionResult id={self.execution_id} exit_code={self.exit_code} "
            f"duration={self.duration_ms}ms oom_killed={self.oom_killed} timed_out={self.timed_out}>"
        )


class Sandbox:
    """Client wrapper for AuraOS Cognitive Sandbox executions."""
    def __init__(
        self,
        runtime: str = "python",
        api_key: Optional[str] = None,
        base_url: str = "http://localhost:8081"
    ):
        self.runtime = runtime
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def run(
        self,
        code: str,
        env: Optional[Dict[str, str]] = None,
        limits: Optional[Dict[str, Any]] = None
    ) -> ExecutionResult:
        """
        Execute a script inside an isolated, cgroup-constrained sandbox environment.
        """
        payload = {
            "runtime": self.runtime,
            "code": code,
            "env": env or {},
            "limits": limits or {}
        }
        
        headers = {
            "Content-Type": "application/json"
        }
        if self.api_key:
            headers["X-AuraOS-Token"] = self.api_key

        url = f"{self.base_url}/api/sandboxes"
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=35.0)
        except requests.RequestException as e:
            raise RuntimeError(f"Failed to reach AuraOS server at {url}: {e}")

        if response.status_code != 200:
            try:
                err_data = response.json()
                err_msg = err_data.get("error", response.text)
            except Exception:
                err_msg = response.text
            raise RuntimeError(f"AuraOS execution failed (status {response.status_code}): {err_msg}")

        data = response.json()
        if not data.get("success"):
            raise RuntimeError(f"AuraOS server error: {data.get('error', 'Unknown failure')}")

        return ExecutionResult(data)
