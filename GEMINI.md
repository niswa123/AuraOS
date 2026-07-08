# AuraOS Agent Instruction Guide (GEMINI.md)

This document provides system prompts, prompt engineering strategies, and schema definitions for Gemini (and other LLM agents) executing inside the AuraOS runtime.

---

## 1. System Prompt Template for AuraOS Agents

When executing an agent within the AuraOS Cognitive Container, prepend the following prompt snippet to the system context:

```text
You are an autonomous agent running inside the AuraOS Runtime Environment.
Your execution space is sandboxed (WebAssembly/Docker isolation).
You have persistent state memory, which is automatically saved at the end of each turn.

Operational Guidelines:
1. State Awareness: Keep track of critical state variables in your memory index.
2. Resource Efficiency: Minimize token usage. Avoid infinite feedback loops.
3. Hibernation Triggering: If waiting for external signals (webhooks, cron timers, database hooks), suspend execution by invoking the hibernation API. Do not run blocking sleep loops.
4. Error Containment: Wrap execution of dynamic code blocks in secure try/catch sandboxes.
```

---

## 2. API Communication Schemas

Agents communicate with the AuraOS Orchestrator using structured JSON messages.

### A. Memory Indexation & Retrieval (Vector Engine)
To store a long-term memory embedding:
```json
{
  "action": "memory.remember",
  "payload": {
    "content": "User prefers Docker container isolation over Wasm for high-compute Python scripts.",
    "metadata": {
      "category": "user_preferences",
      "timestamp": 1783528715
    }
  }
}
```

To search memories using cosine similarity search on `pgvector`:
```json
{
  "action": "memory.recall",
  "payload": {
    "query": "sandbox container preference",
    "limit": 3
  }
}
```

### B. State Serialization
To serialize current state variables before suspension:
```json
{
  "action": "state.serialize",
  "payload": {
    "current_step": "data_analysis",
    "variables": {
      "dataframe_path": "/tmp/analysis_3092.csv",
      "processed_rows": 1024,
      "analysis_complete": false
    }
  }
}
```

### C. Hibernation & Chronos Trigger
To trigger hibernation until a specific event:
```json
{
  "action": "lifecycle.hibernate",
  "payload": {
    "trigger": {
      "type": "webhook",
      "endpoint": "/v1/triggers/analysis-complete",
      "method": "POST"
    },
    "timeout_seconds": 86400
  }
}
```

---

## 3. Anti-Looping & Prompt Optimizations

To prevent autonomous agents from running away with API costs, the AuraOS Orchestrator enforces several optimization controls:

1. **Step Budget**: Every execution session has a maximum step count (default: 30 steps). If exceeded, the container forces hibernation and alerts the operator.
2. **Dynamic Compression**: When history exceeds 8,000 tokens, the orchestrator automatically triggers a summarization prompt to condense past execution steps, storing the raw detail in the vector memory engine.
3. **Loop Detection**: If three consecutive LLM responses contain identical tool invocations without progress, the orchestrator interrupts the sequence with a system message: `[SYSTEM_ALERT: RUNAWAY_LOOP_DETECTED. Re-evaluate strategy or suspend execution.]`
