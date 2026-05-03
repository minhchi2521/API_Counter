const state = {
  config: null,
  today: null,
  hourly: null,
  history: [],
  logs: []
};

const elements = {
  todayDate: document.querySelector('#todayDate'),
  refreshStatus: document.querySelector('#refreshStatus'),
  totalRequests: document.querySelector('#totalRequests'),
  limitedModels: document.querySelector('#limitedModels'),
  unlimitedModels: document.querySelector('#unlimitedModels'),
  keyStats: document.querySelector('#keyStats'),
  hourly: document.querySelector('#hourly'),
  hourlyTotal: document.querySelector('#hourlyTotal'),
  history: document.querySelector('#history'),
  logs: document.querySelector('#logs'),
  configMeta: document.querySelector('#configMeta'),
  limitsForm: document.querySelector('#limitsForm'),
  modelInput: document.querySelector('#modelInput'),
  limitInput: document.querySelector('#limitInput'),
  knownModels: document.querySelector('#knownModels'),
  limitsList: document.querySelector('#limitsList'),
  refreshButton: document.querySelector('#refreshButton'),
  resetButton: document.querySelector('#resetButton')
};

async function api(path, options) {
  const response = await fetch(path, {
    cache: 'no-store',
    headers: {
      'content-type': 'application/json'
    },
    ...options
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function refresh() {
  elements.refreshStatus.textContent = 'Refreshing...';
  try {
    const [config, today, hourly, history, logs] = await Promise.all([
      api('/api/config'),
      api('/api/today'),
      api('/api/today/hourly'),
      api('/api/history?days=7'),
      api('/api/logs?limit=50')
    ]);

    Object.assign(state, { config, today, hourly, history, logs });
    render();
    elements.refreshStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    elements.refreshStatus.textContent = `Error: ${error.message}`;
  }
}

function render() {
  renderConfig();
  renderToday();
  renderHourly();
  renderHistory();
  renderLogs();
}

function renderConfig() {
  const config = state.config || {};
  const limits = config.limits || {};
  elements.configMeta.textContent = `${config.upstream || '--'} · ${config.timezone || '--'}`;
  elements.knownModels.innerHTML = (config.knownModels || [])
    .map((model) => `<option value="${escapeHtml(model)}"></option>`)
    .join('');
  elements.limitsList.innerHTML = Object.entries(limits).map(([model, limit]) => `
    <span class="chip">
      <strong>${escapeHtml(model)}</strong>
      <span>${limit}/day</span>
      <button type="button" title="Remove ${escapeHtml(model)}" data-remove="${escapeHtml(model)}">×</button>
    </span>
  `).join('');
}

function renderToday() {
  const today = state.today;
  if (!today) {
    return;
  }

  elements.todayDate.textContent = today.date;
  elements.totalRequests.textContent = `${today.total} requests today`;

  elements.limitedModels.innerHTML = today.limitedModels.length
    ? today.limitedModels.map(renderLimitedModel).join('')
    : '<p class="empty">No limited models configured.</p>';

  elements.unlimitedModels.innerHTML = today.unlimitedModels.length
    ? today.unlimitedModels.map((row) => `
      <div class="compact-row">
        <strong>${escapeHtml(row.model)}</strong>
        <span class="compact-meta">${row.requests} requests · ${row.total_tokens} tokens</span>
      </div>
    `).join('')
    : '<p class="empty">No unlimited model requests today.</p>';

  elements.keyStats.innerHTML = today.byKey.length
    ? today.byKey.map((row) => `
      <div class="compact-row">
        <strong>Key ${escapeHtml(row.key)}</strong>
        <span class="compact-meta">${row.requests} requests · ${row.total_tokens} tokens</span>
      </div>
    `).join('')
    : '<p class="empty">No key usage today.</p>';
}

function renderLimitedModel(row) {
  const percent = Math.min(row.percent, 100);
  const tone = row.danger ? 'danger' : row.warning ? 'warn' : '';
  return `
    <div class="model-row">
      <div class="model-head">
        <span class="model-name">${escapeHtml(row.model)}</span>
        <span class="model-count">${row.requests} / ${row.limit} · ${row.percent}%</span>
      </div>
      <div class="bar ${tone}" style="--value: ${percent}%"><span></span></div>
    </div>
  `;
}

function renderHourly() {
  const hourly = state.hourly;
  if (!hourly) {
    return;
  }

  const max = Math.max(...hourly.hours.map((hour) => hour.requests), 1);
  const total = hourly.hours.reduce((sum, hour) => sum + hour.requests, 0);
  elements.hourlyTotal.textContent = `${total} total`;
  elements.hourly.innerHTML = hourly.hours.map((hour) => {
    const value = Math.round((hour.requests / max) * 100);
    return `
      <div class="hour-cell ${hour.current ? 'current' : ''}">
        <div class="hour-time">${String(hour.hour).padStart(2, '0')}:00</div>
        <div class="hour-bar" style="--value: ${value}%"></div>
        <strong>${hour.requests}</strong>
      </div>
    `;
  }).join('');
}

function renderHistory() {
  elements.history.innerHTML = state.history.length
    ? state.history.map((day) => {
      const topModels = day.models.slice(0, 4).map((model) => `${escapeHtml(model.model)}: ${model.requests}`).join(' · ');
      return `
        <div class="history-row">
          <div class="history-head">
            <span class="history-date">${escapeHtml(day.date)}</span>
            <span class="history-meta">${day.total} total</span>
          </div>
          <p class="empty">${topModels || 'No requests'}</p>
        </div>
      `;
    }).join('')
    : '<p class="empty">No history yet.</p>';
}

function renderLogs() {
  elements.logs.innerHTML = state.logs.length
    ? state.logs.map((row) => `
      <tr>
        <td>${escapeHtml(formatTime(row.timestamp))}</td>
        <td>${escapeHtml(row.model)}</td>
        <td>${escapeHtml(row.key)}</td>
        <td>${row.status_code || '--'}</td>
        <td>${row.total_tokens || 0}</td>
        <td>${row.response_time_ms || 0} ms</td>
      </tr>
    `).join('')
    : '<tr><td colspan="6">No logs yet.</td></tr>';
}

async function saveLimit(event) {
  event.preventDefault();
  const model = elements.modelInput.value.trim();
  const limit = Number(elements.limitInput.value);
  if (!model || !Number.isFinite(limit) || limit < 1) {
    return;
  }

  const limits = { ...(state.config.limits || {}), [model]: Math.floor(limit) };
  await api('/api/config/limits', {
    method: 'PUT',
    body: JSON.stringify(limits)
  });
  elements.modelInput.value = '';
  elements.limitInput.value = '';
  await refresh();
}

async function removeLimit(model) {
  const limits = { ...(state.config.limits || {}) };
  delete limits[model];
  await api('/api/config/limits', {
    method: 'PUT',
    body: JSON.stringify(limits)
  });
  await refresh();
}

async function resetToday() {
  const confirmed = window.confirm('Reset today counters? This deletes today records from SQLite.');
  if (!confirmed) {
    return;
  }
  await api('/api/reset-today', { method: 'POST', body: '{}' });
  await refresh();
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '--';
  }
  return new Date(timestamp).toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

elements.limitsForm.addEventListener('submit', saveLimit);
elements.refreshButton.addEventListener('click', refresh);
elements.resetButton.addEventListener('click', resetToday);
elements.limitsList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-remove]');
  if (button) {
    removeLimit(button.dataset.remove);
  }
});

refresh();
setInterval(refresh, 10000);
