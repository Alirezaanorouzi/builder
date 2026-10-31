# Coding engines

Pluggable backends for the website builder orchestrator.

| Folder | Engine | When to use |
|--------|--------|-------------|
| `cursor/` | Cursor Cloud Agents API | Default; Cursor hosts the VM |
| `opencode/` | OpenCode `serve` + Docker | Self-hosted; you run the worker |

Set **`CODING_ENGINE=cursor`** or **`CODING_ENGINE=opencode`** in `.env.local`.

Implementation entry point: `engines/index.ts` → `getCodingEngine()`.
