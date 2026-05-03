# VietAPI Smart Counter Proxy

Transparent OpenAI-compatible reverse proxy for counting VietAPI requests by model and API key, with a dark realtime dashboard.

## Local Run

```bash
npm install
npm start
```

- Proxy endpoint: `http://localhost:9000/v1`
- Dashboard: `http://localhost:9001`
- Upstream: `https://api.vietapi.tech`

The proxy preserves request method, path, query, headers, and raw body. It records counters in SQLite as a best-effort side effect and never blocks requests because of quota or database errors.

## Config

Runtime config lives at `data/config.json`.

Default limited models:

```json
{
  "gpt-5.5": 800,
  "claude-opus-4.6": 200
}
```

Models not listed in `limits` are unlimited and still counted. The dashboard Settings panel can edit limits without restarting the proxy.

## Docker

```bash
docker compose up -d --build
```

The `./data` folder is mounted into the container and stores `config.json` plus `counter.db`.

## Client Examples

Codex CLI:

```toml
api_base_url = "http://100.x.x.x:9000/v1"
```

Chatbox:

```text
API Host: http://100.x.x.x:9000/v1
API Key: keep the original VietAPI key
```

Claude Code/OpenAI-compatible tools:

```bash
export OPENAI_BASE_URL="http://100.x.x.x:9000/v1"
export OPENAI_API_KEY="sk-your-vietapi-key"
```

## Tests

```bash
npm test
```

Tests use a local mock upstream and an isolated temporary SQLite database.
