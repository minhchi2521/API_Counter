const fs = require('fs');
const http = require('http');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function createDashboardServer({ configStore, counter, publicDir = path.join(__dirname, 'public') }) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url, { configStore, counter });
        return;
      }

      serveStatic(req, res, url, publicDir);
    } catch (error) {
      console.error('[dashboard] request failed:', error.message);
      sendJson(res, 500, { error: 'Dashboard request failed' });
    }
  });
}

async function handleApi(req, res, url, { configStore, counter }) {
  if (req.method === 'GET' && url.pathname === '/api/today') {
    sendJson(res, 200, counter.getToday());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/today/hourly') {
    sendJson(res, 200, counter.getHourly());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    sendJson(res, 200, counter.getHistory(url.searchParams.get('days') || 7));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/logs') {
    sendJson(res, 200, counter.getLogs(url.searchParams.get('limit') || 50));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    sendJson(res, 200, configStore.get());
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/config/limits') {
    const body = await readJson(req);
    const limits = body && body.limits ? body.limits : body;
    sendJson(res, 200, configStore.updateLimits(limits));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reset-today') {
    sendJson(res, 200, counter.resetToday());
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url, publicDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }

  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const requested = path.normalize(path.join(publicDir, pathname));
  const root = path.normalize(publicDir);

  if (!requested.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(requested, (error, content) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'content-type': MIME_TYPES[path.extname(requested)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(content);
    }
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

module.exports = {
  createDashboardServer,
  sendJson
};
