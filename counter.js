const crypto = require('crypto');
const { getDateString, getZonedParts } = require('./time');

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey || 'missing').digest('hex');
}

function displayHash(hash) {
  return `...${String(hash || '').slice(-4)}`;
}

class Counter {
  constructor(db, configStore) {
    this.db = db;
    this.configStore = configStore;
  }

  recordRequest({ apiKey, model, endpoint, now = new Date() }) {
    const config = this.configStore.get();
    const { date, hour } = getZonedParts(now, config.timezone);
    const apiKeyHash = hashApiKey(apiKey);
    const row = this.db.prepare(`
      INSERT INTO requests (timestamp, date, hour, api_key_hash, model, endpoint)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(now.toISOString(), date, hour, apiKeyHash, model, endpoint);

    return {
      id: row.lastInsertRowid,
      date,
      hour,
      apiKeyHash
    };
  }

  updateRequest(id, update) {
    if (!id) {
      return;
    }

    this.db.prepare(`
      UPDATE requests
      SET prompt_tokens = ?,
          completion_tokens = ?,
          total_tokens = ?,
          status_code = ?,
          response_time_ms = ?
      WHERE id = ?
    `).run(
      update.prompt_tokens || 0,
      update.completion_tokens || 0,
      update.total_tokens || 0,
      update.status_code || 0,
      update.response_time_ms || 0,
      id
    );
  }

  getToday(now = new Date()) {
    const config = this.configStore.get();
    const date = getDateString(now, config.timezone);
    const limits = config.limits || {};

    const modelRows = this.db.prepare(`
      SELECT model,
             COUNT(*) AS requests,
             COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
             COALESCE(SUM(total_tokens), 0) AS total_tokens
      FROM requests
      WHERE date = ?
      GROUP BY model
      ORDER BY requests DESC, model ASC
    `).all(date);

    const byKey = this.db.prepare(`
      SELECT api_key_hash,
             COUNT(*) AS requests,
             COALESCE(SUM(total_tokens), 0) AS total_tokens
      FROM requests
      WHERE date = ?
      GROUP BY api_key_hash
      ORDER BY requests DESC
    `).all(date).map((row) => ({
      key: displayHash(row.api_key_hash),
      api_key_hash: row.api_key_hash,
      requests: row.requests,
      total_tokens: row.total_tokens
    }));

    const limitedModels = [];
    const unlimitedModels = [];
    const seen = new Set();

    for (const row of modelRows) {
      seen.add(row.model);
      const base = {
        model: row.model,
        requests: row.requests,
        prompt_tokens: row.prompt_tokens,
        completion_tokens: row.completion_tokens,
        total_tokens: row.total_tokens
      };

      if (limits[row.model]) {
        const limit = limits[row.model];
        const percent = limit > 0 ? Math.round((row.requests / limit) * 100) : 0;
        limitedModels.push({
          ...base,
          limit,
          percent,
          warning: percent >= 70,
          danger: percent >= 90
        });
      } else {
        unlimitedModels.push(base);
      }
    }

    for (const [model, limit] of Object.entries(limits)) {
      if (!seen.has(model)) {
        limitedModels.push({
          model,
          requests: 0,
          limit,
          percent: 0,
          warning: false,
          danger: false,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        });
      }
    }

    return {
      date,
      total: modelRows.reduce((sum, row) => sum + row.requests, 0),
      limitedModels: limitedModels.sort((a, b) => b.percent - a.percent || a.model.localeCompare(b.model)),
      unlimitedModels,
      byKey
    };
  }

  getHourly(now = new Date()) {
    const config = this.configStore.get();
    const date = getDateString(now, config.timezone);
    const currentHour = getZonedParts(now, config.timezone).hour;
    const rows = this.db.prepare(`
      SELECT hour, COUNT(*) AS requests
      FROM requests
      WHERE date = ?
      GROUP BY hour
    `).all(date);
    const counts = new Map(rows.map((row) => [row.hour, row.requests]));

    return {
      date,
      currentHour,
      hours: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        requests: counts.get(hour) || 0,
        current: hour === currentHour
      }))
    };
  }

  getHistory(days = 7, now = new Date()) {
    const config = this.configStore.get();
    const count = Math.min(Math.max(Number(days) || 7, 1), 30);
    const dates = [];
    for (let index = 0; index < count; index += 1) {
      dates.push(getDateString(new Date(now.getTime() - index * 24 * 60 * 60 * 1000), config.timezone));
    }

    const rows = this.db.prepare(`
      SELECT date, model, COUNT(*) AS requests
      FROM requests
      WHERE date IN (${dates.map(() => '?').join(',')})
      GROUP BY date, model
      ORDER BY date DESC, requests DESC
    `).all(...dates);

    const byDate = new Map(dates.map((date) => [date, { date, total: 0, models: [] }]));
    for (const row of rows) {
      const day = byDate.get(row.date);
      if (day) {
        day.total += row.requests;
        day.models.push({ model: row.model, requests: row.requests });
      }
    }

    return Array.from(byDate.values());
  }

  getLogs(limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.db.prepare(`
      SELECT id, timestamp, date, hour, api_key_hash, model, endpoint,
             prompt_tokens, completion_tokens, total_tokens, status_code, response_time_ms
      FROM requests
      ORDER BY id DESC
      LIMIT ?
    `).all(safeLimit).map((row) => ({
      ...row,
      key: displayHash(row.api_key_hash)
    }));
  }

  resetToday(now = new Date()) {
    const config = this.configStore.get();
    const date = getDateString(now, config.timezone);
    const result = this.db.prepare('DELETE FROM requests WHERE date = ?').run(date);
    return {
      date,
      deleted: result.changes
    };
  }
}

module.exports = {
  Counter,
  displayHash,
  hashApiKey
};
