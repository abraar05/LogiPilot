/**
 * test/parity.test.js — the server state machine must stay identical to the
 * client's copy (js/config.js), so the two never disagree about what a legal
 * transition is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRANSITIONS, PROOF_REQUIRED, STATUSES } from '../src/domain/order-machine.js';

const clientConfig = readFileSync(new URL('../../js/config.js', import.meta.url), 'utf8');

/** Pull `SP.TRANSITIONS = { ... }` out of the client config source. */
function clientBlock(name) {
  const start = clientConfig.indexOf(`SP.${name} = {`);
  assert.ok(start >= 0, `${name} not found in client config`);
  let i = clientConfig.indexOf('{', start);
  let depth = 0;
  for (; i < clientConfig.length; i += 1) {
    if (clientConfig[i] === '{') depth += 1;
    if (clientConfig[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const src = clientConfig.slice(start, i + 1).replace(`SP.${name}`, 'CFG');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src.replace('CFG', '').replace(/^\s*=\s*/, '')};`)();
}

test('transitions match the client', () => {
  const client = clientBlock('TRANSITIONS');
  assert.deepEqual(TRANSITIONS, client);
});

test('proof-required flags match the client', () => {
  const client = clientBlock('PROOF_REQUIRED');
  const normalise = (o) => Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, typeof v === 'object' ? !!v.optional === false : v]),
  );
  const server = Object.fromEntries(Object.entries(PROOF_REQUIRED).map(([k, v]) => [k, v === true]));
  const clientFlat = Object.fromEntries(
    Object.keys(client).map((k) => [k, typeof client[k] === 'object' ? client[k].optional === undefined : client[k]]),
  );
  assert.deepEqual(server, clientFlat, `server=${JSON.stringify(server)} client=${JSON.stringify(clientFlat)}`);
});

test('status ids match the client', () => {
  const clientIds = [...clientConfig.matchAll(/\{ id: '([a-z_]+)', label:.*?stage: '(\w+)' \}/g)].map((m) => m[1]);
  assert.deepEqual(STATUSES.map((s) => s.id), clientIds);
});