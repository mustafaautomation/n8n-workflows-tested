# n8n-workflows-tested

[![CI](https://github.com/mustafaautomation/n8n-workflows-tested/actions/workflows/ci.yml/badge.svg)](https://github.com/mustafaautomation/n8n-workflows-tested/actions/workflows/ci.yml)

Three small, useful n8n workflows kept as JSON in git, with the checks I would want before importing someone's workflow into a real instance: schema validation, lint rules, and end-to-end tests that import the workflows into **n8n running in Docker** and execute them against mock endpoints. Personal open-source project, built with AI coding agents.

## Workflows

| File                               | Trigger                                         | What it does                                                                                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflows/incident-to-slack.json` | `POST /webhook/incident`                        | Validates `{title, severity, service}`. High and critical incidents are posted to a Slack incoming webhook (text + a Block Kit section); others get `202` without a post; a missing title or severity gets `400`.                                  |
| `workflows/form-to-sheet.json`     | `POST /webhook/signup` (JSON or form-encoded)   | Trims and lower-cases fields, checks name, email and plan (`free`/`pro`/`team`), then appends a row through the Google Sheets `values:append` API shape and answers `200` with the updated range; invalid input gets `422` and nothing is written. |
| `workflows/api-health-check.json`  | every 5 minutes, or `GET /webhook/health-check` | Checks each URL in `HEALTH_TARGETS`, treats non-2xx and unreachable hosts as down, and sends **one** Slack alert listing every failing endpoint.                                                                                                   |

Configuration comes from environment variables read with `$env` (see `.env.example`): `SLACK_WEBHOOK_URL`, `SHEETS_API_BASE`, `SHEET_ID`, `HEALTH_TARGETS`. n8n blocks `$env` in nodes by default, so the instance needs `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.

The sheet workflow calls the Sheets REST endpoint with an HTTP Request node so it can be tested against a mock. Against the real Google API you need to add a Google OAuth2 credential to that node (or swap it for n8n's Google Sheets node); no credentials are stored in this repo.

## Use them in your n8n

```bash
n8n import:workflow --separate --input=workflows/
n8n publish:workflow --id=incidentToSlack1     # n8n 2.x: publish replaces the old "active" toggle
```

Or import a file from the n8n editor (Workflows → Import from File).

## What is checked

**Static (no n8n needed)** — `npm run lint:workflows`

- JSON Schema (`schema/workflow.schema.json`, Ajv 2020-12): required fields, 16-character ids, `active: false`, no pinned test data, `executionOrder: v1`, only `n8n-nodes-base` node types.
- Lint rules (`scripts/lint-workflows.mjs`):
  - only node types and versions that the e2e tests cover;
  - no `credentials` blocks, no hard-coded URLs (use `$env`), nothing that looks like a token;
  - every connection points at an existing node, and no node is left without input;
  - webhook paths are kebab-case and unique across files, and every webhook has a `webhookId`;
  - `responseMode: responseNode` comes with a Respond to Webhook node.
- Unit tests (`node --test`) mutate a good workflow 14 different ways and require the linter to catch each one, plus tests for the mock server.

**End-to-end (n8n 2.44.7 in Docker)** — CI job `e2e`

1. starts `mock/server.mjs`: a Slack-like webhook that answers `ok`, the Sheets `values:append` endpoint, `/status/<code>` endpoints, and a request log;
2. imports the workflows with `n8n import:workflow`, publishes them with `n8n publish:workflow`, and starts n8n;
3. calls the production webhooks and checks both the HTTP responses and exactly what n8n sent to the mocks: Slack text and blocks, the sheet row values and query string, a single alert naming the 503 endpoint and the unreachable one, and nothing sent on rejected input.

## Run locally

```bash
npm ci
npm run lint:workflows && npm test
# end-to-end, with Docker:
npm run mock &
docker run -d --name n8n -p 5678:5678 --add-host=host.docker.internal:host-gateway \
  -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
  -e SLACK_WEBHOOK_URL=http://host.docker.internal:4010/slack/webhook \
  -e SHEETS_API_BASE=http://host.docker.internal:4010/sheets -e SHEET_ID=test-sheet \
  -e HEALTH_TARGETS=http://host.docker.internal:4010/status/200,http://host.docker.internal:4010/status/503,http://host.docker.internal:9/ \
  n8nio/n8n:2.44.7
# import + publish as in .github/workflows/ci.yml, restart n8n, then:
npm run test:e2e
```

## CI

Every job must pass: **validate** (Prettier, schema + lint, unit tests), **e2e** (n8n in Docker against the mocks), **secrets** (gitleaks over the full history).

## License

MIT
