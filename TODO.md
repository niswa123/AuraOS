# AuraOS MVP - Technical TODO List

This document outlines the detailed development tasks required to build the AuraOS Agentic Runtime Environment MVP, grouped by structural module layers.

---

## [x] Phase 1: Foundation & Database Layer
- [x] Initialize Node.js & TypeScript configuration (`tsconfig.json`, `package.json`).
- [x] Set up database container configuration (Docker Compose with PostgreSQL + `pgvector`).
- [x] Implement database migration pipeline (`npm run migrate:up`).
  - [x] Write SQL schema to initialize the `agents`, `executions`, `states`, and `vector_memories` tables.
  - [x] Create `pgvector` index with HNSW or IVFFlat for cosine distance operations on memory vectors.
- [x] Implement DB Connection client with TypeScript connection pooling.

---

## [x] Phase 2: Module 1 - Cognitive Container (Sandbox)
- [x] Set up execution sandbox orchestrator interface.
- [ ] **Option A: WebAssembly (Wasm) Execution Pipeline** _(deferred post-MVP)_
  - [ ] Configure `wasi-js` / Wasmtime runner integration.
  - [ ] Design WASI-compliant JavaScript/Python entry points.
- [x] **Option B: Docker Micro-Container Execution Pipeline**
  - [x] Implement Docker Engine API client wrapper in Node.js (`dockerode`).
  - [x] Write lightweight execution runner images for Python & Node.js.
- [x] **Resource Limits & Protection**
  - [x] Implement RAM limit boundaries per execution container.
  - [x] Implement CPU shares constraints.
  - [x] Implement hard timeouts (Timeout protection) with automatic SIGKILL triggers.

---

## [ ] Phase 3: Module 2 - State & Memory Engine
- [ ] **Runtime State Serialization**
  - [ ] Write a script execution wrapper to capture scope state variables, execution stack offsets, and log dumps.
  - [ ] Design API JSON response structure for runtime serialization pushes.
- [ ] **Memory Engine (`pgvector` Integration)**
  - [ ] Set up connection to OpenAI / local embedding API (e.g., HuggingFace transformers) to convert memories to vector arrays.
  - [ ] Implement the `memory.remember` action: store content, metadata, and embeddings to PostgreSQL.
  - [ ] Implement the `memory.recall` action: execute cosine similarity query using `pgvector` (`<=>` operator) with variable retrieval limits.

---

## [ ] Phase 4: Module 3 - Chronos Trigger System
- [ ] Implement the Event Broker engine in Node.js.
- [ ] **Hibernation Controls**
  - [ ] Implement execution suspend API: teardown active Wasm/Docker sandboxes and save context status.
- [ ] **Wake-up Triggers**
  - [ ] *Webhook Trigger*: Build HTTP Router endpoint to listen to external webhooks and trigger container hydrate cycles.
  - [ ] *Cron Trigger*: Integrate Node-cron scheduler to fire agents on recurring intervals.
  - [ ] *Async Task Trigger*: Set up callback queues to wake up agents when long-running sub-tasks complete.

---

## [ ] Phase 5: Module 4 - Headless Browser API
- [ ] Install Playwright runner inside the server host environment.
- [ ] Build a microservice wrapper around Playwright BrowserContext pools.
- [ ] Implement basic scraping actions:
  - [ ] Navigation and Page-to-HTML parser.
  - [ ] Form submission, click simulators, and input typers.
  - [ ] Local storage session persistence for automated login routines.

---

## [ ] Phase 6: Developer Dashboard (React UI)
- [ ] Initialize React frontend project.
- [ ] **Visual Theme Integration (Cinematic Dark Mode)**
  - [ ] Apply `#0A0A0A` background and `#121214` card variables to `index.css`.
  - [ ] Configure OKLCH indigo (#4F46E5-equivalent) accents.
  - [ ] Build glassmorphic overlays (`backdrop-filter: blur(12px)` + 1px white border with 5% opacity).
- [ ] **Core Panels**
  - [ ] Build Agent List Grid (using neon-teal indicator rings for running containers).
  - [ ] Build Real-time Log Stream panel using Monospace fonts (JetBrains Mono) with red/yellow syntax highlighting for errors/warnings.
  - [ ] Build JSON State Inspector visualization block.
  - [ ] Build Interactive Timeline showcasing agent transitions (Trigger -> Active -> Hibernate -> Sleep).
- [ ] Integrate WebSockets client to stream container statuses directly from backend core.
