// Validates every workflow in workflows/ against schema/workflow.schema.json, then applies rules
// the schema cannot express. Exit code 1 on any problem. Usage: node scripts/lint-workflows.mjs [dir]
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = new URL('..', import.meta.url).pathname;
const schema = JSON.parse(readFileSync(join(ROOT, 'schema/workflow.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

// Node types and versions this repo has been tested with in n8n 2.44.
export const ALLOWED_TYPES = {
  'n8n-nodes-base.webhook': [2],
  'n8n-nodes-base.respondToWebhook': [1.1],
  'n8n-nodes-base.httpRequest': [4.2],
  'n8n-nodes-base.if': [2.2],
  'n8n-nodes-base.set': [3.4],
  'n8n-nodes-base.code': [2],
  'n8n-nodes-base.scheduleTrigger': [1.2],
};
const TRIGGERS = new Set(['n8n-nodes-base.webhook', 'n8n-nodes-base.scheduleTrigger']);
const SECRETISH = /(api[_-]?key|token|secret|password|authorization|bearer\s+[a-z0-9])/i;

export function lintWorkflow(wf, file = 'workflow.json') {
  const problems = [];
  if (!validate(wf)) {
    for (const e of validate.errors) problems.push(`schema: ${e.instancePath || '/'} ${e.message}`);
    return problems;
  }
  const names = new Set();
  for (const n of wf.nodes) {
    if (names.has(n.name)) problems.push(`duplicate node name "${n.name}"`);
    names.add(n.name);
    const versions = ALLOWED_TYPES[n.type];
    if (!versions) problems.push(`node "${n.name}": type ${n.type} is not on the tested list`);
    else if (!versions.includes(n.typeVersion))
      problems.push(`node "${n.name}": ${n.type} v${n.typeVersion} is not tested (use ${versions.join(', ')})`);
    if ('credentials' in n) problems.push(`node "${n.name}": credentials must not be committed`);
    const params = JSON.stringify(n.parameters);
    for (const m of params.matchAll(/https?:\/\/[^"\\\s]+/g)) {
      problems.push(`node "${n.name}": hard-coded URL ${m[0]} (use an $env expression)`);
    }
    if (SECRETISH.test(params)) problems.push(`node "${n.name}": parameters look like they contain a secret`);
    if (n.type === 'n8n-nodes-base.webhook') {
      if (!n.webhookId) problems.push(`node "${n.name}": webhook needs a webhookId`);
      if (!/^[a-z0-9-]+$/.test(n.parameters.path ?? ''))
        problems.push(`node "${n.name}": webhook path must be lower-case kebab`);
    }
  }
  for (const [src, conn] of Object.entries(wf.connections)) {
    if (!names.has(src)) problems.push(`connection from unknown node "${src}"`);
    for (const out of conn.main)
      for (const t of out) if (!names.has(t.node)) problems.push(`connection to unknown node "${t.node}"`);
  }
  const targets = new Set(Object.values(wf.connections).flatMap((c) => c.main.flat().map((t) => t.node)));
  for (const n of wf.nodes) {
    if (!TRIGGERS.has(n.type) && !targets.has(n.name))
      problems.push(`node "${n.name}" is not connected to anything upstream`);
  }
  if (!wf.nodes.some((n) => TRIGGERS.has(n.type))) problems.push('workflow has no trigger node');
  const usesResponseNode = wf.nodes.some(
    (n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.responseMode === 'responseNode',
  );
  const hasRespond = wf.nodes.some((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  if (usesResponseNode && !hasRespond)
    problems.push('webhook uses responseMode=responseNode but there is no Respond to Webhook node');
  if (file !== 'workflow.json' && !basename(file).match(/^[a-z0-9-]+\.json$/))
    problems.push('file name must be kebab-case .json');
  return problems;
}

export function lintDir(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const results = {};
  const ids = new Map();
  const paths = new Map();
  for (const f of files) {
    const wf = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const problems = lintWorkflow(wf, f);
    if (ids.has(wf.id)) problems.push(`workflow id ${wf.id} is also used by ${ids.get(wf.id)}`);
    ids.set(wf.id, f);
    for (const n of wf.nodes ?? []) {
      if (n.type !== 'n8n-nodes-base.webhook') continue;
      const key = `${n.parameters.httpMethod ?? 'GET'} ${n.parameters.path}`;
      if (paths.has(key)) problems.push(`webhook ${key} is also used by ${paths.get(key)}`);
      paths.set(key, f);
    }
    results[f] = problems;
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? join(ROOT, 'workflows');
  const results = lintDir(dir);
  let bad = 0;
  for (const [f, problems] of Object.entries(results)) {
    if (problems.length === 0) console.log(`✓ ${f}`);
    for (const p of problems) {
      console.log(`✗ ${f}: ${p}`);
      bad++;
    }
  }
  if (Object.keys(results).length === 0) {
    console.log('no workflows found');
    bad++;
  }
  process.exit(bad ? 1 : 0);
}
