import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../../mock/server.mjs';

let server;
let base;
before(async () => {
  server = createMockServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('slack webhook accepts a text payload and rejects anything else, like Slack does', async () => {
  assert.equal(await (await post('/slack/webhook', { text: 'hi' })).text(), 'ok');
  assert.equal((await post('/slack/webhook', { blocks: [] })).status, 400);
});

test('sheets append returns an updatedRange and validates values', async () => {
  const r = await post('/sheets/v4/spreadsheets/s1/values/Signups!A:D:append', { values: [['a', 'b', 'c', 'd']] });
  assert.equal(r.status, 200);
  assert.match((await r.json()).updates.updatedRange, /^Signups!A\d+:D\d+$/);
  assert.equal((await post('/sheets/v4/spreadsheets/s1/values/Signups!A:D:append', {})).status, 400);
});

test('status endpoints and request recording', async () => {
  assert.equal((await fetch(base + '/status/503')).status, 503);
  const recorded = await (await fetch(base + '/__requests')).json();
  assert.ok(recorded.some((r) => r.path === '/status/503'));
  await fetch(base + '/__requests', { method: 'DELETE' });
  assert.deepEqual(await (await fetch(base + '/__requests')).json(), []);
  assert.equal((await fetch(base + '/nope')).status, 404);
});
