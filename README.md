# AuraOS Agentic Runtime Environment

AuraOS is an ultra-secure, serverless-metered execution runtime designed specifically for autonomous artificial intelligence agents. It enables AI loops to dynamically write and execute code inside isolated, cgroup-constrained sandbox containers, safeguarding host systems from malicious scripts, infinite loops, and data exfiltration.

---

## 🚀 Key Features

* **Cognitive Sandboxing:** Isolated Docker/gVisor runners limited to `128MB RAM` (no swap), `0.5 CPU`, and `32 process PIDs` with a `Read-only Rootfs` and `64MB /tmp tmpfs`.
* **Outbound Egress Allowlist:** Integrated proxy gateway filtering outbound traffic on port `8086`. Explicitly permits access to essential AI platforms (`api.openai.com`, `api.anthropic.com`, etc.) while blocking unauthorized connection attempts.
* **Resilient State Checkpoints:** Dynamic Docker volume mounts backing `/tmp` allow the host to recover intermediate state variables (`/tmp/state_checkpoint.json`) via `docker cp` even when a container crashes (OOM, Timeout, or exit error).
* **Usage-Based Billing:** Telemetry tracking calculates execution costs on the fly based on a serverless GB-seconds formula:
  $$\text{Cost} = \text{Duration (seconds)} \times \left(\frac{\text{RAM}}{1024}\right) \times \$0.00001667$$
* **Chronos Event Triggers:** Asynchronous triggers handling standard HTTP webhooks, recurring cron schedules, and database mutation signals (e.g., Supabase DB integrations).
* **Cinematic Control Center:** Clean developer console streaming stdout/stderr/system logs and real-time execution cost statistics via WebSockets.

---

## 🛠️ System Architecture

```
[ Local developer IDE / Web UI ]
               │
               ▼  (HTTP POST /api/sandboxes)
    ┌──────────────────────┐
    │  Webhook Listener &  │ ◄─────── [ Supabase DB Webhook ]
    │       REST API       │
    └──────────┬───────────┘
               │
               ▼  (Wakeup Event)
    ┌──────────────────────┐
    │  Chronos Event       │ ◄─────── [ cron-scheduler ]
    │  Broker              │
    └──────────┬───────────┘
               │
               ▼  (executeInSandbox)
    ┌─────────────────────────────────────────────────────────────┐
    │ Docker Sandbox Supervisor                                   │
    │  ┌───────────────────────────────────────────────────────┐  │
    │  │ Secure Sandbox Container (128MB RAM, 0.5 CPU)         │  │
    │  │  ┌──────────────────────┐   ┌──────────────────────┐  │  │
    │  │  │ Python/Node Script   │   │ state_checkpoint.json│  │  │
    │  │  └──────────┬───────────┘   └──────────┬───────────┘  │  │
    │  └─────────────┼──────────────────────────┼──────────────┘  │
    └────────────────┼──────────────────────────┼─────────────────┘
                     │ (Outbound Traffic)       │ (docker cp on Exit)
                     ▼                          ▼
            ┌──────────────────┐       ┌──────────────────┐
            │   Egress Proxy   │       │   PostgreSQL     │
            │   (Port 8086)    │       │   State Hydrator │
            └──────────────────┘       └──────────────────┘
```

---

## 💾 Local Development Setup

### Prerequisites
* **Node.js** v20+
* **Docker** running locally
* **PostgreSQL** with the `pgvector` extension

### 1. Build Docker Runner Images
AuraOS executes scripts inside lightweight sandbox runners. Build them using the provided dockerfiles:
```bash
# Build python runner
docker build -t auraos-python-runner ./docker/python-runner

# Build node runner
docker build -t auraos-node-runner ./docker/node-runner
```

### 2. Configure Environment
Create a `.env` file in the project root:
```env
DATABASE_URL=postgresql://auraos:auraos_dev_passwd@localhost:5433/auraos_db
WEBHOOK_SECRET=ao_test_3a8c1f9e2b774d8bb9a3efd85c414902
PORT=8080
```

### 3. Initialize Database & Run Migrations
Run the local migrations script to build PostgreSQL tables and indexes:
```bash
npm run migrate:up
```

### 4. Start Server Back-end
Starts the HTTP webhook listener (`8081`), the Egress HTTP proxy (`8086`), and the Live WS broadcaster (`8085`):
```bash
npm run dev
```

### 5. Launch UI Dashboard Front-end
```bash
cd dashboard
npm install
npm run dev
```
Open [http://localhost:5173/](http://localhost:5173/) to access the Developer Control Center.

---

## 🐍 Using the Python SDK

Install the SDK locally from the repository root:
```bash
pip install -e ./sdk/python
```

### Quickstart Execution Script
Create a `run_sandbox.py` file:
```python
from auraos import Sandbox

# Initialize sandbox (points to http://localhost:8081 by default)
sb = Sandbox(
    runtime="python",
    api_key="ao_test_3a8c1f9e2b774d8bb9a3efd85c414902"
)

# Run code in sandbox
result = sb.run("""
import time
import json

print("🚀 Running inside secure sandbox container...")
time.sleep(1)

# Write state checkpoint variables
checkpoint = {"iteration": 42, "score": 95.8}
with open('/tmp/state_checkpoint.json', 'w') as f:
    json.dump(checkpoint, f)
""")

print("--- RESULTS ---")
print(f"Stdout:      {result.stdout}")
print(f"Exit code:   {result.exit_code}")
print(f"Duration:    {result.duration_ms}ms")
print(f"Checkpoints: {result.checkpoint_vars}")
```

---

## 🌐 API Reference

### 1. Execute Sandbox Ad-hoc
Executes code synchronously in a secure container and returns output metrics.
* **Endpoint:** `POST http://localhost:8081/api/sandboxes`
* **Headers:** `X-AuraOS-Token: <api_key>`
* **Payload:**
```json
{
  "runtime": "python",
  "code": "print('Hello AuraOS!')",
  "env": {
    "ENV_VAR_KEY": "value"
  },
  "limits": {
    "memoryBytes": 134217728,
    "timeoutMs": 15000
  }
}
```

### 2. Register Agent
Registers a persistent agent inside the database.
* **Endpoint:** `POST http://localhost:8081/api/agents`
* **Payload:**
```json
{
  "name": "Sentiment Classifier",
  "runtime": "python",
  "code": "print('Active agent')"
}
```

### 3. Trigger Agent Execution (Async Webhook)
Dispatches a wakeup trigger event to spin up the agent's sandbox.
* **Endpoint:** `POST http://localhost:8081/webhook/:agentId`

### 4. Database Mutation Event Mock (Supabase Listener)
Simulates database state updates to trigger registered agent pipelines.
* **Endpoint:** `POST http://localhost:8081/webhook/db-change`
* **Payload:**
```json
{
  "table": "users",
  "type": "INSERT",
  "record": { "id": 109, "name": "Egor" }
}
```

---

## 🧪 Testing

AuraOS includes a comprehensive test suite covering core subsystems:
```bash
# Run unit tests (logic, clamping limits, egress matching, billing rates)
npm run test:unit

# Run server REST API & WS WebSocket integration tests (requires server running)
npm run test:integration

# Run Python SDK package tests (requires server running)
python3 tests/integration/test-python-sdk.py

# Run all TypeScript tests together
npm test
```
