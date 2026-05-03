const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ConfigStore } = require('../config');
const { Counter } = require('../counter');
const { createDatabase } = require('../db');
const { createDashboardServer } = require('../dashboard');
const { createProxyServer } = require('../proxy');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function createHarness() {
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    const body = await readBody(req);
    upstreamRequests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body
    });

    if (req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }

    let parsed = {};
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      parsed = {};
    }

    if (parsed.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
      res.write('data: {"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl_test',
      usage: {
        prompt_tokens: 2,
        completion_tokens: 5,
        total_tokens: 7
      }
    }));
  });
  const upstreamPort = await listen(upstream);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vietapi-counter-'));
  const configPath = path.join(tempDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    upstream: `http://127.0.0.1:${upstreamPort}`,
    proxyPort: 0,
    dashboardPort: 0,
    limits: {
      'gpt-5.5': 800,
      'claude-opus-4.6': 200
    },
    timezone: 'Asia/Tokyo',
    retentionDays: 30,
    knownModels: ['gpt-5.5', 'claude-opus-4.6']
  }, null, 2));

  const configStore = new ConfigStore({ dataDir: tempDir, configPath });
  configStore.init({ watch: false });
  const db = createDatabase({ dbPath: path.join(tempDir, 'counter.db') });
  const counter = new Counter(db, configStore);
  const proxy = createProxyServer({ configStore, counter, timeoutMs: 3000 });
  const dashboard = createDashboardServer({ configStore, counter });
  const proxyPort = await listen(proxy);
  const dashboardPort = await listen(dashboard);

  return {
    upstreamRequests,
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    dashboardUrl: `http://127.0.0.1:${dashboardPort}`,
    counter,
    configStore,
    async close() {
      await close(proxy);
      await close(dashboard);
      await close(upstream);
      configStore.close();
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

test('proxy forwards raw OpenAI request and records non-stream usage', async () => {
  const harness = await createHarness();
  try {
    const payload = {
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }]
    };

    const response = await fetch(`${harness.proxyUrl}/v1/chat/completions?debug=1`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer sk-test-a1b2',
        'content-type': 'application/json',
        'x-client-name': 'codex-test'
      },
      body: JSON.stringify(payload)
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.usage.total_tokens, 7);

    assert.equal(harness.upstreamRequests.length, 1);
    assert.equal(harness.upstreamRequests[0].method, 'POST');
    assert.equal(harness.upstreamRequests[0].url, '/v1/chat/completions?debug=1');
    assert.equal(harness.upstreamRequests[0].headers.authorization, 'Bearer sk-test-a1b2');
    assert.equal(harness.upstreamRequests[0].headers['x-client-name'], 'codex-test');
    assert.deepEqual(JSON.parse(harness.upstreamRequests[0].body.toString('utf8')), payload);

    const today = harness.counter.getToday();
    assert.equal(today.total, 1);
    assert.equal(today.limitedModels.find((row) => row.model === 'gpt-5.5').requests, 1);
    assert.equal(today.byKey[0].requests, 1);
    assert.equal(harness.counter.getLogs(1)[0].total_tokens, 7);
  } finally {
    await harness.close();
  }
});

test('unknown paths and invalid JSON are forwarded without counting', async () => {
  const harness = await createHarness();
  try {
    const unknown = await fetch(`${harness.proxyUrl}/v1/other`, {
      method: 'POST',
      headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.5' })
    });
    assert.equal(unknown.status, 200);

    const invalid = await fetch(`${harness.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
      body: '{not-json'
    });
    assert.equal(invalid.status, 200);

    const models = await fetch(`${harness.proxyUrl}/v1/models`, {
      headers: { authorization: 'Bearer sk-test' }
    });
    assert.equal(models.status, 200);

    assert.equal(harness.upstreamRequests.length, 3);
    assert.equal(harness.counter.getToday().total, 0);
  } finally {
    await harness.close();
  }
});

test('streaming SSE is piped immediately and usage is recorded best-effort', async () => {
  const harness = await createHarness();
  try {
    const response = await fetch(`${harness.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer sk-stream', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4.6',
        stream: true,
        messages: [{ role: 'user', content: 'stream' }]
      })
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const text = await response.text();
    assert.match(text, /data: \[DONE\]/);

    const today = harness.counter.getToday();
    const opus = today.limitedModels.find((row) => row.model === 'claude-opus-4.6');
    assert.equal(opus.requests, 1);
    assert.equal(harness.counter.getLogs(1)[0].total_tokens, 7);
  } finally {
    await harness.close();
  }
});

test('dashboard APIs summarize data, update limits, and reset today', async () => {
  const harness = await createHarness();
  try {
    await fetch(`${harness.proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer sk-api', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.5', messages: [] })
    });

    const today = await (await fetch(`${harness.dashboardUrl}/api/today`)).json();
    assert.equal(today.total, 1);

    const hourly = await (await fetch(`${harness.dashboardUrl}/api/today/hourly`)).json();
    assert.equal(hourly.hours.reduce((sum, hour) => sum + hour.requests, 0), 1);

    const configResponse = await fetch(`${harness.dashboardUrl}/api/config/limits`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'gpt-5.5': 900 })
    });
    assert.equal(configResponse.status, 200);
    const config = await configResponse.json();
    assert.equal(config.limits['gpt-5.5'], 900);

    const reset = await (await fetch(`${harness.dashboardUrl}/api/reset-today`, {
      method: 'POST'
    })).json();
    assert.equal(reset.deleted, 1);

    const afterReset = await (await fetch(`${harness.dashboardUrl}/api/today`)).json();
    assert.equal(afterReset.total, 0);
  } finally {
    await harness.close();
  }
});
