const http = require('http');
const https = require('https');
const { StringDecoder } = require('string_decoder');
const zlib = require('zlib');

const COUNTED_ENDPOINTS = new Set([
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/embeddings',
  '/v1/responses'
]);

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function createProxyServer({ configStore, counter, timeoutMs = 60000 }) {
  return http.createServer(async (clientReq, clientRes) => {
    const started = Date.now();
    let body;

    try {
      body = await readRequestBody(clientReq);
    } catch (error) {
      clientRes.writeHead(400, { 'content-type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'Failed to read request body' }));
      return;
    }

    const config = configStore.get();
    const upstreamUrl = new URL(clientReq.url, normalizeUpstream(config.upstream));
    const endpoint = upstreamUrl.pathname;
    const counted = getCountableRequest(clientReq, body, endpoint);
    let recordId = null;

    if (counted) {
      try {
        const record = counter.recordRequest({
          apiKey: extractApiKey(clientReq.headers.authorization),
          model: counted.model,
          endpoint
        });
        recordId = record.id;
      } catch (error) {
        console.error('[counter] failed to record request:', error.message);
      }
    }

    forwardRequest({
      clientReq,
      clientRes,
      upstreamUrl,
      body,
      timeoutMs,
      onComplete: (result) => {
        if (!recordId) {
          return;
        }

        try {
          counter.updateRequest(recordId, {
            ...result.usage,
            status_code: result.statusCode,
            response_time_ms: Date.now() - started
          });
        } catch (error) {
          console.error('[counter] failed to update request:', error.message);
        }
      }
    });
  });
}

function normalizeUpstream(upstream) {
  return upstream.endsWith('/') ? upstream : `${upstream}/`;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function extractApiKey(authorization) {
  const match = /^Bearer\s+(.+)$/i.exec(authorization || '');
  return match ? match[1].trim() : 'missing';
}

function getCountableRequest(req, body, endpoint) {
  if (req.method !== 'POST' || !COUNTED_ENDPOINTS.has(endpoint) || body.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (parsed && typeof parsed.model === 'string' && parsed.model.trim()) {
      return {
        model: parsed.model.trim(),
        stream: parsed.stream === true
      };
    }
  } catch {
    return null;
  }

  return null;
}

function forwardRequest({ clientReq, clientRes, upstreamUrl, body, timeoutMs, onComplete }) {
  const transport = upstreamUrl.protocol === 'https:' ? https : http;
  const headers = buildForwardHeaders(clientReq.headers, upstreamUrl, body);
  const options = {
    protocol: upstreamUrl.protocol,
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port || (upstreamUrl.protocol === 'https:' ? 443 : 80),
    method: clientReq.method,
    path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
    headers,
    timeout: timeoutMs
  };

  let completed = false;
  const finish = (result) => {
    if (completed) {
      return;
    }
    completed = true;
    onComplete(result);
  };

  const upstreamReq = transport.request(options, (upstreamRes) => {
    const statusCode = upstreamRes.statusCode || 0;
    const responseHeaders = filterResponseHeaders(upstreamRes.headers);
    const parser = createUsageParser(upstreamRes.headers);

    clientRes.writeHead(statusCode, responseHeaders);

    upstreamRes.on('data', (chunk) => {
      parser.write(chunk);
      clientRes.write(chunk);
    });

    upstreamRes.on('end', () => {
      parser.end((usage) => {
        finish({ statusCode, usage });
      });
      clientRes.end();
    });

    upstreamRes.on('error', (error) => {
      console.error('[proxy] upstream response error:', error.message);
      parser.end((usage) => {
        if (!clientRes.destroyed) {
          clientRes.destroy(error);
        }
        finish({ statusCode, usage });
      });
    });
  });

  upstreamReq.on('timeout', () => {
    upstreamReq.destroy(new Error('Upstream timeout'));
  });

  upstreamReq.on('error', (error) => {
    console.error('[proxy] upstream request error:', error.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(504, { 'content-type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'Upstream timeout or connection error' }));
    } else if (!clientRes.destroyed) {
      clientRes.destroy(error);
    }
    finish({ statusCode: 504, usage: {} });
  });

  if (body.length > 0) {
    upstreamReq.write(body);
  }
  upstreamReq.end();
}

function buildForwardHeaders(originalHeaders, upstreamUrl, body) {
  const headers = {};
  for (const [name, value] of Object.entries(originalHeaders)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      headers[name] = value;
    }
  }
  headers.host = upstreamUrl.host;
  headers['content-length'] = String(body.length);
  return headers;
}

function filterResponseHeaders(originalHeaders) {
  const headers = {};
  for (const [name, value] of Object.entries(originalHeaders)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      headers[name] = value;
    }
  }
  return headers;
}

function createUsageParser(headers) {
  const contentType = String(headers['content-type'] || '');
  if (contentType.includes('text/event-stream')) {
    return createSseUsageParser();
  }
  return createJsonUsageParser(headers);
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return {};
  }
  return {
    prompt_tokens: Number(usage.prompt_tokens) || 0,
    completion_tokens: Number(usage.completion_tokens) || 0,
    total_tokens: Number(usage.total_tokens) || 0
  };
}

function createSseUsageParser() {
  const decoder = new StringDecoder('utf8');
  let lineBuffer = '';
  let usage = {};

  return {
    write(chunk) {
      lineBuffer += decoder.write(chunk);
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') {
          continue;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.usage) {
            usage = normalizeUsage(parsed.usage);
          }
        } catch {
          // Ignore non-JSON SSE frames.
        }
      }
    },
    end(callback) {
      const rest = `${lineBuffer}${decoder.end()}`.trim();
      if (rest.startsWith('data:')) {
        const data = rest.slice(5).trim();
        if (data && data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            if (parsed.usage) {
              usage = normalizeUsage(parsed.usage);
            }
          } catch {
            // Ignore trailing non-JSON.
          }
        }
      }
      callback(usage);
    }
  };
}

function createJsonUsageParser(headers) {
  const chunks = [];
  const encoding = String(headers['content-encoding'] || '').toLowerCase();

  return {
    write(chunk) {
      if (chunks.reduce((sum, item) => sum + item.length, 0) < 10 * 1024 * 1024) {
        chunks.push(chunk);
      }
    },
    end(callback) {
      const buffer = Buffer.concat(chunks);
      decodeBody(buffer, encoding, (error, decoded) => {
        if (error || decoded.length === 0) {
          callback({});
          return;
        }
        try {
          const parsed = JSON.parse(decoded.toString('utf8'));
          callback(normalizeUsage(parsed.usage));
        } catch {
          callback({});
        }
      });
    }
  };
}

function decodeBody(buffer, encoding, callback) {
  if (!encoding || encoding === 'identity') {
    callback(null, buffer);
    return;
  }
  if (encoding === 'gzip') {
    zlib.gunzip(buffer, callback);
    return;
  }
  if (encoding === 'br') {
    zlib.brotliDecompress(buffer, callback);
    return;
  }
  if (encoding === 'deflate') {
    zlib.inflate(buffer, callback);
    return;
  }
  callback(null, Buffer.alloc(0));
}

module.exports = {
  createProxyServer,
  getCountableRequest,
  extractApiKey
};
