// Environment check (INSTRUCTIONS §14): each toolchain present at its pinned version.
// Zero dependencies. Exit code 1 if anything is missing. Usage: `npm run doctor`.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8').trim();
const run = (cmd) => {
  try {
    return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
};

const nodeMajor = Number(read('.nvmrc'));
const python = read('.python-version');
const rust = read('rust-toolchain.toml').match(/channel\s*=\s*"([^"]+)"/)[1];
const vswhere = 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe';
// The wasm-bindgen CLI must match the wasm-bindgen crate exactly (D-008).
const bindgen = read('Cargo.lock').match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)?.[1];

// [name, check() -> found version / true when OK, falsy when not, fix hint]
const checks = [
  ['node', () => Number(process.versions.node.split('.')[0]) >= nodeMajor && process.versions.node,
    `install Node ${nodeMajor}+: winget install OpenJS.NodeJS`],
  ['npm', () => run('npm --version'), 'comes with Node'],
  ['git', () => run('git --version'), 'winget install Git.Git'],
  ['uv', () => run('uv --version'), 'winget install astral-sh.uv'],
  [`python ${python} (uv)`, () => run(`uv python find ${python}`), `uv python install ${python}`],
  ['rustup', () => run('rustup --version'), 'winget install Rustlang.Rustup'],
  [`rustc ${rust}`, () => run('rustc --version')?.includes(rust) && rust,
    'rustup toolchain install   (reads rust-toolchain.toml)'],
  ['wasm32 target', () => run('rustup target list --installed')?.includes('wasm32-unknown-unknown'),
    'rustup toolchain install   (reads rust-toolchain.toml)'],
  [`wasm-bindgen-cli ${bindgen}`, () => bindgen && run('wasm-bindgen --version')?.endsWith(bindgen) && bindgen,
    `cargo install wasm-bindgen-cli --version =${bindgen} --locked`],
];
if (process.platform === 'win32') {
  checks.push(['MSVC C++ build tools', () => existsSync(vswhere)
    && run(`"${vswhere}" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`),
    'winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"']);
}

let failed = 0;
for (const [name, check, fix] of checks) {
  const got = check();
  if (got) console.log(`  ok    ${name}${typeof got === 'string' ? `  (${got.split('\n')[0]})` : ''}`);
  else {
    failed++;
    console.log(`  MISS  ${name}\n        fix: ${fix}`);
  }
}
console.log(failed ? `\n${failed} problem(s). Fix them and run again.` : '\nEnvironment OK.');
process.exit(failed ? 1 : 0);
