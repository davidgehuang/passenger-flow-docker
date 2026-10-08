'use strict';

// DTS Migration Lab 前端交互：操作按钮 AJAX、破坏性操作二次确认、状态轮询

(function () {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const opStatus = document.getElementById('op-status');
  const opResult = document.getElementById('op-result');
  const labButtons = document.querySelectorAll('.lab-btn');

  function setStatus(text, cls) {
    opStatus.textContent = text;
    opStatus.className = 'badge ms-2 ' + (cls || 'text-bg-secondary');
  }

  function renderResult(data) {
    opResult.textContent = JSON.stringify(data, null, 2);
  }

  async function callApi(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({ status: 'ERROR', message: '响应解析失败' }));
    if (!res.ok) {
      throw new Error(json.message || `HTTP ${res.status}`);
    }
    return json;
  }

  // 破坏性操作需要二次确认
  function needsConfirm(op) {
    return op === 'delete' || op === 'purge' || op === 'update';
  }

  function describe(op, params) {
    if (op === 'insert') return `INSERT ${params.rows} 行 flow_events`;
    if (op === 'update') return `UPDATE ${params.rows} 行业务数据`;
    if (op === 'delete') return `DELETE ${params.rows} 行 flow_events（不可恢复）`;
    if (op === 'generate') return `写入 +${params.targetMB} MiB 逻辑数据负载（最多 200,000 行）`;
    if (op === 'purge') return `删除约 ${params.targetMB}MB 数据（不可恢复）`;
    return op;
  }

  async function runOp(op, params) {
    const path = `/migration-lab/${op === 'purge' ? 'purge' : op}`;
    setStatus('running...', 'text-bg-primary');
    labButtons.forEach((b) => (b.disabled = true));
    const start = Date.now();
    try {
      const json = await callApi(path, params);
      setStatus(`OK (${((Date.now() - start) / 1000).toFixed(1)}s)`, 'text-bg-success');
      renderResult(json.result);
      refreshStatus();
      if(window.refreshDatabaseStorage)window.refreshDatabaseStorage();
    } catch (err) {
      setStatus('ERROR', 'text-bg-danger');
      renderResult({ error: err.message });
    } finally {
      labButtons.forEach((b) => (b.disabled = false));
    }
  }

  labButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const op = btn.dataset.op;
      let params = {};
      if (btn.dataset.custom) {
        const input = document.getElementById(btn.dataset.custom);
        const value = Number(input.value);
        if (!value || value < 1) {
          setStatus('invalid rows', 'text-bg-danger');
          return;
        }
        params.rows = value;
      } else if (btn.dataset.rows) {
        params.rows = Number(btn.dataset.rows);
      } else if (btn.dataset.mb) {
        params.targetMB = Number(btn.dataset.mb);
      }

      if (needsConfirm(op)) {
        const ok = window.confirm(`确认执行破坏性数据库操作？\n\n${describe(op, params)}\n\n该操作用于 DTS 迁移实验，执行后不可撤销。`);
        if (!ok) return;
      } else if (op === 'generate') {
        const ok = window.confirm(`确认执行？\n\n${describe(op, params)}`);
        if (!ok) return;
      }
      runOp(op, params);
    });
  });

  // Marker 创建
  const markerForm = document.getElementById('marker-form');
  markerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('marker-type').value;
    const message = document.getElementById('marker-message').value;
    setStatus('creating marker...', 'text-bg-primary');
    try {
      const json = await callApi('/migration-lab/marker', { type, message });
      setStatus('MARKER OK', 'text-bg-success');
      renderResult(json.result);
      refreshStatus();
      if(window.refreshDatabaseStorage)window.refreshDatabaseStorage();
    } catch (err) {
      setStatus('ERROR', 'text-bg-danger');
      renderResult({ error: err.message });
    }
  });

  // Workload 控制
  document.getElementById('wl-start').addEventListener('click', async () => {
    const body = {
      qps: Number(document.getElementById('wl-qps').value) || 20,
      insertPercent: Number(document.getElementById('wl-insert').value),
      updatePercent: Number(document.getElementById('wl-update').value),
      deletePercent: Number(document.getElementById('wl-delete').value),
    };
    setStatus('starting workload...', 'text-bg-primary');
    try {
      await callApi('/migration-lab/workload/start', body);
      setStatus('WORKLOAD STARTED', 'text-bg-success');
      refreshStatus();
      if(window.refreshDatabaseStorage)window.refreshDatabaseStorage();
    } catch (err) {
      setStatus('ERROR', 'text-bg-danger');
      renderResult({ error: err.message });
    }
  });

  document.getElementById('wl-stop').addEventListener('click', async () => {
    setStatus('stopping workload...', 'text-bg-primary');
    try {
      await callApi('/migration-lab/workload/stop', {});
      setStatus('WORKLOAD STOPPED', 'text-bg-warning');
      refreshStatus();
      if(window.refreshDatabaseStorage)window.refreshDatabaseStorage();
    } catch (err) {
      setStatus('ERROR', 'text-bg-danger');
      renderResult({ error: err.message });
    }
  });

  // 状态轮询（10 秒）
  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m ${s % 60}s` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/migration-lab/status');
      const json = await res.json();
      if (json.status !== 'OK') return;
      const { overview, workload, markers } = json;

      document.getElementById('stat-last-op').textContent = overview.lastDbOp;

      // workload 状态
      const stateEl = document.getElementById('wl-state');
      stateEl.textContent = workload.state;
      stateEl.className = 'badge ' + ({
        RUNNING: 'text-bg-success',
        STARTING: 'text-bg-info',
        STOPPING: 'text-bg-warning',
        ERROR: 'text-bg-danger',
        STOPPED: 'text-bg-secondary',
      }[workload.state] || 'text-bg-secondary');

      if (workload.stats) {
        document.getElementById('wl-qps-cur').textContent = workload.options ? workload.options.qps : '-';
        document.getElementById('wl-runtime').textContent = fmtDuration(workload.stats.runtimeMs || 0);
        document.getElementById('wl-insert-total').textContent = (workload.stats.totalInsert || 0).toLocaleString('en-US');
        document.getElementById('wl-update-total').textContent = (workload.stats.totalUpdate || 0).toLocaleString('en-US');
        document.getElementById('wl-delete-total').textContent = (workload.stats.totalDelete || 0).toLocaleString('en-US');
        document.getElementById('wl-errors').textContent = workload.stats.failedSql || 0;
        document.getElementById('wl-last-op').textContent = workload.stats.lastOp || '-';
        document.getElementById('wl-last-marker').textContent = workload.stats.lastMarkerType || '-';
      }

      // marker 表
      const tbody = document.getElementById('marker-table');
      if (markers && markers.length) {
        tbody.innerHTML = markers
          .map(
            (m) => `<tr>
              <td class="fw-bold">${escapeHtml(m.sequence_number)}</td>
              <td class="text-muted small">${escapeHtml(m.created_at)}</td>
              <td><span class="badge text-bg-info">${escapeHtml(m.marker_type)}</span></td>
              <td class="small"><code>${escapeHtml(String(m.batch_uuid).slice(0, 8))}</code></td>
              <td><span class="badge text-bg-secondary">${escapeHtml(m.source_env)}</span></td>
              <td class="small">${escapeHtml(m.message)}</td>
            </tr>`
          )
          .join('');
      }
    } catch {
      // 轮询失败忽略，下次重试
    }
  }

  refreshStatus();
  setInterval(refreshStatus, 10000);
})();
