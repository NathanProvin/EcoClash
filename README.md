# EcoClash

A 1v1 real-time strategy game in the browser where you **cultivate a food web** instead of commanding an army.
A deterministic Rust simulation runs in a Web Worker and is rendered with Three.js. You can play against a bot, or against another player through lockstep multiplayer.

- Spec: [`memory/INSTRUCTIONS.md`](memory/INSTRUCTIONS.md)
- Plan and status: [`memory/ROADMAP.md`](memory/ROADMAP.md)
- Decision log: [`memory/DECISIONS.md`](memory/DECISIONS.md)
- Open questions: [`memory/OPEN_QUESTIONS.md`](memory/OPEN_QUESTIONS.md)
- Session log: [`memory/JOURNAL.md`](memory/JOURNAL.md)

## Prerequisites (Windows)

| Tool | Pinned in | Install |
|---|---|---|
| Node 24 + npm 11 | `.nvmrc`, `package.json` | `winget install OpenJS.NodeJS` |
| Git | — | `winget install Git.Git` |
| uv + Python 3.12 | `.python-version`, `tools/uv.lock` | `winget install astral-sh.uv`, then `uv python install 3.12` |
| Rust 1.98.1 + wasm32 target | `rust-toolchain.toml` | `winget install Rustlang.Rustup`, then `rustup toolchain install` in the repo |
| MSVC C++ build tools (Rust linker) | — | `winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"` |

Blender is only needed from M5 (asset pipeline).

## Setup

```sh
npm run doctor    # checks every tool above and prints the fix for anything missing
npm run py:sync   # creates tools/.venv from tools/uv.lock
npm run py:test
```

## Commands

Every task goes through a root `npm run` script, so the same commands work in PowerShell, Git Bash and CI.

| Script | What it does |
|---|---|
| `doctor` | Environment check |
| `py:sync` / `py:test` / `py:lint` | Python tooling (`tools/`) |

Rust (M1), WASM and client (M2) scripts are added with their milestones.
On this machine, always run Python through `uv run` (or these scripts). The bare `python` command is the Microsoft Store stub.

## Environments

| Env | Where | Config |
|---|---|---|
| local | Vite dev server | `.env.local` (gitignored) |
| preview | Cloudflare Pages branch deploys | Pages env vars |
| prod | itch.io + Cloudflare Pages `main` | Pages env vars |

- Client configuration uses `VITE_*` variables only, and each one is documented in `.env.example`.
- Secrets (deploy tokens, relay credentials) live only in GitHub Actions or Cloudflare secrets, never in the repo.
- See INSTRUCTIONS §14 for details.
