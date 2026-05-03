const path = require('path');
const Database = require('better-sqlite3');
const { getCutoffDate } = require('./time');

function createDatabase(options = {}) {
  const dbPath = options.dbPath || path.join(__dirname, 'data', 'counter.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      date TEXT NOT NULL,
      hour INTEGER NOT NULL,
      api_key_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      status_code INTEGER DEFAULT 0,
      response_time_ms INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_date ON requests(date);
    CREATE INDEX IF NOT EXISTS idx_date_model ON requests(date, model);
    CREATE INDEX IF NOT EXISTS idx_date_key ON requests(date, api_key_hash);
  `);

  return db;
}

function cleanupOldRequests(db, config) {
  const cutoff = getCutoffDate(config.retentionDays, config.timezone);
  return db.prepare('DELETE FROM requests WHERE date < ?').run(cutoff);
}

module.exports = {
  createDatabase,
  cleanupOldRequests
};
