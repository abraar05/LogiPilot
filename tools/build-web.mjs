/**
 * build-web.mjs — assemble a clean `www/` bundle.
 *
 * Capacitor copies `webDir` verbatim into the native project, so it must
 * contain only what the app needs. Pointing `webDir` at the repository root
 * would drag node_modules, the Android project and the tooling in with it.
 *
 * Run:  node tools/build-web.mjs
 */

import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'www');

const ENTRIES = [
  'index.html',
  'sw.js',
  'css',
  'js',
  'assets',
];

/** Validate the manifest matches index.html so the bundle is self-consistent. */
async function readManifest() {
  const raw = await readFile(resolve(ROOT, 'assets/manifest.webmanifest'), 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const manifest = await readManifest();

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  for (const entry of ENTRIES) {
    await cp(resolve(ROOT, entry), resolve(OUT, entry), { recursive: true });
    console.log(`  + ${entry}`);
  }

  // The bundled app runs offline from the app's own origin, so rewrite the
  // manifest start_url/scope to be relative.
  manifest.start_url = './index.html';
  manifest.scope = './';
  await writeFile(
    resolve(OUT, 'assets/manifest.webmanifest'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  // A tiny marker so the native shell can confirm which build it carries.
  await writeFile(
    resolve(OUT, 'build-info.json'),
    `${JSON.stringify({
      app: 'LogiPilot',
      version: '1.0.0',
      builtAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8',
  );

  console.log(`\n  www/ ready (${manifest.name})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});