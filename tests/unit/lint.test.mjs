import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintDir, lintWorkflow } from '../../scripts/lint-workflows.mjs';

const dir = new URL('../../workflows/', import.meta.url).pathname;
const load = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const good = () => load('incident-to-slack.json');

test('every committed workflow passes the schema and lint rules', () => {
  const results = lintDir(dir);
  assert.equal(Object.keys(results).length, 3);
  for (const [f, problems] of Object.entries(results)) assert.deepEqual(problems, [], f);
});

const cases = [
  [
    'hard-coded URL',
    (w) => (w.nodes[4].parameters.url = 'https://hooks.slack.com/services/T000/B000/XXXX'),
    /hard-coded URL/,
  ],
  [
    'committed credentials',
    (w) => (w.nodes[4].credentials = { httpHeaderAuth: { id: '1', name: 'x' } }),
    /schema|credentials/,
  ],
  ['secret in parameters', (w) => (w.nodes[4].parameters.headerValue = 'Bearer abc123'), /secret/],
  ['untested node version', (w) => (w.nodes[1].typeVersion = 2.4), /not tested/],
  ['unknown node type', (w) => (w.nodes[1].type = 'n8n-nodes-base.executeCommand'), /not on the tested list/],
  [
    'dangling connection',
    (w) => (w.connections['Post to Slack webhook'].main[0][0].node = 'Nope'),
    /unknown node "Nope"/,
  ],
  ['orphan node', (w) => delete w.connections['Post to Slack webhook'], /not connected/],
  ['duplicate node name', (w) => (w.nodes[2].name = w.nodes[3].name), /duplicate node name/],
  ['pinned test data', (w) => (w.pinData = { 'Incident webhook': [{ json: {} }] }), /schema: \/pinData/],
  ['active flag', (w) => (w.active = true), /schema: \/active/],
  ['bad webhook path', (w) => (w.nodes[0].parameters.path = 'Incident_Path'), /kebab/],
  ['missing webhookId', (w) => delete w.nodes[0].webhookId, /webhookId/],
  ['legacy execution order', (w) => (w.settings.executionOrder = 'v0'), /executionOrder/],
  [
    'respond node removed',
    (w) => {
      w.nodes = w.nodes.filter((n) => n.type !== 'n8n-nodes-base.respondToWebhook');
      w.connections = { 'Incident webhook': w.connections['Incident webhook'] };
    },
    /no Respond to Webhook node/,
  ],
];

for (const [name, mutate, expected] of cases) {
  test(`lint catches: ${name}`, () => {
    const wf = good();
    mutate(wf);
    const problems = lintWorkflow(wf);
    assert.ok(
      problems.some((p) => expected.test(p)),
      `expected ${expected} in:\n${problems.join('\n')}`,
    );
  });
}

test('lint catches duplicate ids and webhook paths across files', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wf-'));
  writeFileSync(join(tmp, 'a.json'), JSON.stringify(good()));
  writeFileSync(join(tmp, 'b.json'), JSON.stringify(good()));
  const problems = lintDir(tmp)['b.json'];
  assert.ok(problems.some((p) => /id incidentToSlack1 is also used/.test(p)));
  assert.ok(problems.some((p) => /POST incident is also used/.test(p)));
});

test('lint rejects file names that are not kebab-case', () => {
  assert.ok(lintWorkflow(good(), 'Incident To Slack.json').some((p) => /kebab-case/.test(p)));
});
