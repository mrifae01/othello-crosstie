#!/usr/bin/env node
// npm start orchestration (design-contract.md §1):
//   1. If DATABASE_URL is unset, bring up Postgres via `docker compose up -d --wait db`.
//   2. Run migrations.
//   3. Run the API and the web client together via concurrently.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Same root .env the API and web client read, so DATABASE_URL set there skips Docker here too.
try {
  process.loadEnvFile(resolve(root, '.env'));
} catch {
  // No .env: all settings are optional.
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
}

function fail(msg) {
  console.error(`\n[start] ${msg}\n`);
  process.exit(1);
}

// Docker Desktop on macOS doesn't always put the CLI on PATH.
function findDocker() {
  const probe = spawnSync('docker', ['--version'], { stdio: 'ignore' });
  if (probe.status === 0) return 'docker';
  const macCli = '/Applications/Docker.app/Contents/Resources/bin/docker';
  if (existsSync(macCli)) return macCli;
  return null;
}

const NO_DOCKER_HELP = `Either start Docker, or point at any Postgres (>= 13) instead:

  DATABASE_URL=postgres://user:pass@localhost:5432/othello npm start

When DATABASE_URL is set, Docker is skipped entirely.`;

if (process.env.DATABASE_URL) {
  console.log('[start] DATABASE_URL is set; skipping Docker.');
} else {
  const docker = findDocker();
  if (!docker) fail(`Docker was not found.\n\n${NO_DOCKER_HELP}`);

  const info = spawnSync(docker, ['info'], { stdio: 'ignore' });
  if (info.status !== 0) fail(`Docker is installed but the daemon is not running.\n\n${NO_DOCKER_HELP}`);

  console.log('[start] Starting Postgres (docker compose up -d --wait db)...');
  const up = run(docker, ['compose', 'up', '-d', '--wait', 'db']);
  if (up.status !== 0) fail(`docker compose failed.\n\n${NO_DOCKER_HELP}`);
}

console.log('[start] Running migrations...');
const mig = run('npm', ['run', 'migrate', '-w', 'backend']);
if (mig.status !== 0) fail('Migrations failed (see output above).');

console.log('[start] Starting API (:3001) and web (:5173)...');
const child = spawn(
  'npx',
  ['concurrently', '-n', 'api,web', '-c', 'blue,magenta', 'npm run dev -w backend', 'npm run dev -w frontend'],
  { cwd: root, stdio: 'inherit' },
);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
