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

## Going live: online multiplayer (Alpha 1.2)

Online matches need two things on Cloudflare: the game (Pages, already live since Alpha 1) and the **relay**, a small Worker in `relay/` with one Durable Object per room code (D-219). The game finds the relay through `VITE_RELAY_URL`, which is baked in **at build time**. So the order matters: deploy the relay, then build the game with its address.

### 1. Let the API token deploy Workers

The CI token (GitHub secret `CLOUDFLARE_API_TOKEN`) can deploy Pages today. It also needs Workers.

1. Cloudflare dashboard → your avatar (top right) → **My Profile** → **API Tokens**.
2. Next to the token used by CI, click **⋯ → Edit**. (Or **Create Token** → template **Edit Cloudflare Workers**, then add the Pages permission below.)
3. Under **Permissions**, make sure these rows exist (**+ Add more** for the missing ones):
   - **Account · Workers Scripts · Edit**: deploys the relay and its Durable Objects;
   - **Account · Cloudflare Pages · Edit**: deploys the game (already there);
   - **Account · Account Settings · Read**: lets wrangler read the account.
4. **Account Resources**: Include → your account. **Continue to summary** → **Update token**.
5. If you created a new token: GitHub → the repo → **Settings → Secrets and variables → Actions → Secrets**, then edit `CLOUDFLARE_API_TOKEN` and paste it. Editing an existing token keeps its value, so there is nothing to paste.

### 2. Find your workers.dev subdomain

Dashboard → **Workers & Pages** → **Overview**. The right column shows **Your subdomain: `<name>.workers.dev`**. The first time, Cloudflare asks you to pick one.

The relay's addresses will then be:
- `https://ecoclash-relay.<name>.workers.dev`, for a browser check;
- `wss://ecoclash-relay.<name>.workers.dev`, for the game.

### 3. Deploy the relay once by hand

From the repo root (PowerShell or Git Bash):

```sh
npx wrangler@4 login     # opens the browser: allow wrangler on your account (once per machine)
npm run relay:deploy     # bundles relay/worker.mjs and creates the Durable Object class
```

wrangler prints `https://ecoclash-relay.<name>.workers.dev`. Open it in a browser: the page should read **EcoClash relay**. The Durable Object class uses SQLite storage (`new_sqlite_classes` in `relay/wrangler.toml`), so it runs on the free plan.

### 4. Tell CI where the relay is

GitHub → the repo → **Settings → Secrets and variables → Actions → Variables** tab → **New repository variable**:
- Name: `RELAY_URL`
- Value: `wss://ecoclash-relay.<name>.workers.dev` (with `wss://`, no trailing slash)

From now on, every push to `main`:
- builds the game with `VITE_RELAY_URL` set to that address;
- deploys the game to Pages;
- redeploys the relay (`.github/workflows/ci.yml`).

### 5. Test on two machines before going public (optional, recommended)

Build a preview of the branch that points at the live relay and deploy it to a **preview** address. The public site stays untouched.

```powershell
$env:VITE_RELAY_URL = "wss://ecoclash-relay.<name>.workers.dev"
$env:VITE_BUILD = "alpha-1.2-preview"
npm run wasm:build
npm run client:build
npx wrangler@4 pages deploy client/dist --project-name ecoclash --branch alpha-1-2
```

wrangler prints a preview URL like `https://alpha-1-2.ecoclash.pages.dev`. On each machine, open that URL:
- On machine A: **Play → Multiplayer**, choose a map, click **Host a match**, then **Copy invite link**.
- On machine B: open the link, or **Play → Multiplayer**, type the code and click **Join**.
- Play a few minutes. Plant, call animals and raid on both sides.
- Then close one tab: the other player should get **Victory, "Your opponent left the match"**.

Both players must load the **same deploy**. The game refuses a guest whose build differs from the host's: a local `npm run client:dev` ("dev") cannot join the preview, and the preview cannot join production.

### 6. Merge and go live

```sh
git push -u origin alpha-1.2-multiplayer-foodweb
```

Open a pull request on GitHub, wait for CI to pass, then merge into `main` (or ask Claude to do it). The push to `main` deploys the game and the relay. Check:
- **Actions** shows both **Deploy to Cloudflare Pages** and **Deploy the relay to Cloudflare Workers** as run, not skipped;
- the main menu at the production URL reads **Alpha 1.2**;
- **Play → Multiplayer → Host a match** shows a room code.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "cannot reach the relay at ws://localhost:8787/…" on the live site | The site was built without `VITE_RELAY_URL`: set the `RELAY_URL` variable (step 4) and push or rerun the workflow. |
| "cannot reach the relay at wss://…" | Typo in `RELAY_URL`, or the relay is not deployed: open its `https://` address (step 3). |
| "refused: a different game version from the host" | The two players run different deploys: both reload the page (Ctrl+F5) on the same URL. |
| "room full" | That code already has two players, or its match is over: host a new match. |
| CI step "Deploy the relay…" skipped | `RELAY_URL` is not set (step 4). |
| wrangler `Authentication error [code: 10000]` in CI | The token lacks **Workers Scripts · Edit** (step 1). |
| A player is dropped mid-match | That player sent nothing for 30 s (`[net] stall_timeout_s`): a frozen tab or a lost connection. The other player wins. |

Local development needs no Cloudflare: `npm run relay` (Node relay on `ws://localhost:8787`) plus `npm run client:dev`, then host in one tab and join in another.
