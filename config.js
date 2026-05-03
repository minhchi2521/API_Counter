const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const DEFAULT_CONFIG = {
  upstream: 'https://api.vietapi.tech',
  proxyPort: 9000,
  dashboardPort: 9001,
  limits: {
    'gpt-5.5': 800,
    'claude-opus-4.6': 200
  },
  timezone: 'Asia/Tokyo',
  retentionDays: 30,
  knownModels: [
    'gpt-5.3-codex',
    'gpt-5.3-codex-high',
    'gpt-5.3-codex-xhigh',
    'gpt-5.3-high',
    'gpt-5.3-xhigh',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-image',
    'claude-opus-4.6'
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeConfig(raw) {
  const incoming = raw && typeof raw === 'object' ? raw : {};
  const limits = incoming.limits && typeof incoming.limits === 'object' ? incoming.limits : DEFAULT_CONFIG.limits;
  const knownModels = Array.isArray(incoming.knownModels) ? incoming.knownModels : DEFAULT_CONFIG.knownModels;

  return {
    ...clone(DEFAULT_CONFIG),
    ...incoming,
    limits: sanitizeLimits(limits),
    knownModels: Array.from(new Set([...DEFAULT_CONFIG.knownModels, ...knownModels].filter(Boolean))),
    proxyPort: Number.isInteger(incoming.proxyPort) ? incoming.proxyPort : DEFAULT_CONFIG.proxyPort,
    dashboardPort: Number.isInteger(incoming.dashboardPort) ? incoming.dashboardPort : DEFAULT_CONFIG.dashboardPort,
    retentionDays: Number.isInteger(incoming.retentionDays) ? incoming.retentionDays : DEFAULT_CONFIG.retentionDays
  };
}

function sanitizeLimits(limits) {
  const clean = {};
  for (const [model, limit] of Object.entries(limits || {})) {
    const name = String(model).trim();
    const value = Number(limit);
    if (name && Number.isFinite(value) && value > 0) {
      clean[name] = Math.floor(value);
    }
  }
  return clean;
}

class ConfigStore extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dataDir = options.dataDir || path.join(__dirname, 'data');
    this.configPath = options.configPath || path.join(this.dataDir, 'config.json');
    this.config = clone(DEFAULT_CONFIG);
    this.watcher = null;
    this.reloadTimer = null;
    this.writing = false;
  }

  init({ watch = true } = {}) {
    fs.mkdirSync(this.dataDir, { recursive: true });

    if (!fs.existsSync(this.configPath)) {
      this.config = clone(DEFAULT_CONFIG);
      this.writeConfig(this.config);
    } else {
      this.reload();
    }

    if (watch) {
      this.watch();
    }

    return this.get();
  }

  get() {
    return clone(this.config);
  }

  reload() {
    const text = fs.readFileSync(this.configPath, 'utf8');
    const parsed = JSON.parse(text);
    this.config = mergeConfig(parsed);
    this.emit('change', this.get());
    return this.get();
  }

  updateLimits(limits) {
    const next = {
      ...this.get(),
      limits: sanitizeLimits(limits)
    };
    next.knownModels = Array.from(new Set([...(next.knownModels || []), ...Object.keys(next.limits)]));
    this.config = mergeConfig(next);
    this.writeConfig(this.config);
    this.emit('change', this.get());
    return this.get();
  }

  writeConfig(config) {
    this.writing = true;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, `${JSON.stringify(mergeConfig(config), null, 2)}\n`);
    setTimeout(() => {
      this.writing = false;
    }, 50);
  }

  watch() {
    if (this.watcher) {
      return;
    }

    this.watcher = fs.watch(this.configPath, () => {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        if (this.writing) {
          return;
        }
        try {
          this.reload();
        } catch (error) {
          this.emit('error', error);
        }
      }, 100);
    });
  }

  close() {
    clearTimeout(this.reloadTimer);
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

module.exports = {
  ConfigStore,
  DEFAULT_CONFIG,
  mergeConfig,
  sanitizeLimits
};
