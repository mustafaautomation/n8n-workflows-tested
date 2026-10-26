// Runs against a real n8n (see .github/workflows/ci.yml) with the three workflows imported and
// published, and mock/server.mjs reachable from n8n as MOCK_BASE_URL.
//   N8N_URL   where the tests reach n8n (default http://localhost:5678)
//   MOCK_URL  where the tests reach the mock (default http://localhost:4010)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const N8N = process.env.N8N_URL ?? 'http://localhost:5678';
const MOCK = process.env.MOCK_URL ?? 'http://localhost:4010';

const recorded = async (prefix) =>
  (await (await fetch(`${MOCK}/__requests`)).json()).filter((r) => r.path.startsWith(prefix));
const postJson = (path, body) =>
  fetch(`${N8N}/webhook/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  await fetch(`${MOCK}/__requests`, { method: 'DELETE' });
});

test('incident: a critical incident is posted to Slack with title, service and severity', async () => {
  const r = await postJson('incident', { title: 'Checkout API 5xx spike', severity: 'critical', service: 'checkout' });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { ok: true, notified: true });
  const slack = await recorded('/slack/');
  assert.equal(slack.length, 1);
  assert.equal(slack[0].body.text, ':rotating_light: [CRITICAL] Checkout API 5xx spike');
  assert.match(slack[0].body.blocks[0].text.text, /Service: checkout\nSeverity: critical/);
});

test('incident: severity matching is case-insensitive', async () => {
  const r = await postJson('incident', { title: 'Disk 90%', severity: 'HIGH' });
  assert.deepEqual(await r.json(), { ok: true, notified: true });
  assert.match((await recorded('/slack/'))[0].body.blocks[0].text.text, /Service: unknown/);
});

test('incident: low severity is acknowledged without a Slack post', async () => {
  const r = await postJson('incident', { title: 'Slow dashboard', severity: 'low' });
  assert.equal(r.status, 202);
  assert.equal((await r.json()).notified, false);
  assert.equal((await recorded('/slack/')).length, 0);
});

test('incident: a payload without title or severity is rejected with 400 and nothing is sent', async () => {
  for (const body of [{ severity: 'critical' }, { title: 'x' }, {}]) {
    const r = await postJson('incident', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal((await r.json()).ok, false);
  }
  assert.equal((await recorded('/slack/')).length, 0);
});

test('signup: a valid JSON submission is normalised and appended as one sheet row', async () => {
  const r = await postJson('signup', { name: '  Ada Lovelace ', email: ' ADA@Example.COM ', plan: 'Pro' });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.stored, true);
  assert.match(body.updatedRange, /^Signups!A\d+:D\d+$/);
  const [append] = await recorded('/sheets/');
  assert.equal(append.path, '/sheets/v4/spreadsheets/test-sheet/values/Signups!A:D:append');
  assert.equal(append.query.valueInputOption, 'RAW');
  const [row] = append.body.values;
  assert.match(row[0], /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(row.slice(1), ['Ada Lovelace', 'ada@example.com', 'pro']);
});

test('signup: a form-encoded submission works the same way and defaults the plan to free', async () => {
  const r = await fetch(`${N8N}/webhook/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Grace Hopper', email: 'grace@example.com' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual((await recorded('/sheets/'))[0].body.values[0].slice(1), [
    'Grace Hopper',
    'grace@example.com',
    'free',
  ]);
});

test('signup: invalid email, missing name or unknown plan returns 422 and writes nothing', async () => {
  for (const body of [
    { name: 'A', email: 'not-an-email' },
    { email: 'a@example.com' },
    { name: 'A', email: 'a@example.com', plan: 'enterprise' },
  ]) {
    const r = await postJson('signup', body);
    assert.equal(r.status, 422, JSON.stringify(body));
  }
  assert.equal((await recorded('/sheets/')).length, 0);
});

test('health check: failing endpoints produce one Slack alert listing each of them', async () => {
  const r = await fetch(`${N8N}/webhook/health-check`);
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.equal(result.alerted, true);
  assert.equal(result.summary.checked, 3);
  assert.equal(result.summary.healthy, 1);
  const down = result.summary.down.map((d) => d.url).sort();
  assert.equal(down.length, 2);
  assert.ok(down.some((u) => u.endsWith('/status/503')));
  assert.ok(
    down.some((u) => u.includes(':9')),
    'the unreachable endpoint is reported',
  );
  const slack = await recorded('/slack/');
  assert.equal(slack.length, 1);
  assert.match(slack[0].body.text, /2 of 3 endpoints failing/);
  assert.match(slack[0].body.blocks[0].text.text, /status\/503 — HTTP 503/);
});
