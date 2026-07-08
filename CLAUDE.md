# AuraOS Developer Guide (CLAUDE.md)

This file contains the configuration rules, build commands, and coding standards for developing the AuraOS Agentic Runtime Environment.

---

## 1. Technical Stack Overview

AuraOS is built with high reliability, performance, and low-latency state serialization in mind.
- **Backend (Core Engine)**: Node.js (TypeScript) using an asynchronous, event-driven pattern.
- **Frontend (Developer Dashboard)**: React.js (TypeScript) utilizing a premium cinematic dark theme (OKLCH, CSS variables, glassmorphism, JetBrains Mono typography).
- **Database Layer**: PostgreSQL with `pgvector` extension for persistent relational metadata and high-performance vector retrieval.
- **Sandbox execution**: WebAssembly (Wasm) runtime and lightweight Docker container execution pools.

---

## 2. Project Directory Structure

```text
├── .agents/               # Customization configurations and workspace skills
│   └── skills/            # Copied/Downloaded skills (impeccable, ui-ux-pro-max, etc.)
├── docs/                  # Project specifications and manuals
├── src/
│   ├── core/              # Orchestrator, Sandbox Manager, Chronos Trigger Engine
│   │   ├── sandbox/       # Wasm and Docker container isolation layer
│   │   ├── memory/        # pgvector serialization & State Engine
│   │   └── scheduler/     # Chronos triggers, webhooks, and cron handlers
│   ├── dashboard/         # React Frontend code
│   │   ├── components/    # Reusable UI elements (Logs, Status indicators, Timelines)
│   │   ├── hooks/         # React hooks for WebSockets and API streams
│   │   └── styles/        # CSS variables, theme configuration, index.css
│   └── server.ts          # Backend core entrypoint
├── package.json
└── tsconfig.json
```

---

## 3. Development Commands

### Setup and Dependencies
```bash
npm install                # Install core and dashboard dependencies
```

### Database Migrations
```bash
npm run migrate:up         # Apply database schemas (including pgvector setups)
npm run migrate:down       # Rollback database changes
```

### Running Locally
```bash
npm run dev                # Run backend and frontend concurrently
npm run dev:backend        # Run backend server alone (port 8080)
npm run dev:frontend       # Run React dashboard dev server (port 3000)
```

### Build and Test
```bash
npm run build              # Compile typescript core and build React production files
npm run test               # Run unit and integration tests (Jest)
npm run lint               # Run ESLint validation
```

---

## 4. Coding Standards & Best Practices

### TypeScript Guidelines
- Enable `strict: true` in `tsconfig.json`.
- Avoid using `any`. Explicitly declare type interfaces and type assertions where necessary.
- Use ES modules (`import`/`export` syntax).
- Prefer functional paradigms and immutable structures when representing system configurations.

### State & Context Handling (Core Engine)
- Always serialize state variables at the end of each container iteration cycle.
- Use PostgreSQL transactional queries when committing updated memory layers to avoid race conditions.

### UI & UX Styling
- Follow the visual rules detailed in `PRODUCT.md` and the `impeccable` skill specifications.
- Use OKLCH colors exclusively for layout palettes.
- Utilize clean CSS custom properties (variables) for theme styling.
- All interactive controls must support visible focus states (`:focus-visible`) and keyboard triggers.
