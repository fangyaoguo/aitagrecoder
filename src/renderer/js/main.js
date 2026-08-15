'use strict';
// 入口:导航切换 + 视图初始化 + 对话框全局关闭行为

import { initEntries, refresh } from './entries.js';
import { initWordlib, refreshWordlib } from './wordlib.js';
import { wirePresets } from './presets.js';
import { toast } from './util.js';

// 视图切换(侧边导航)
document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.view;
    document.querySelectorAll('.nav-item').forEach((x) => x.classList.toggle('active', x === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${target}`));
  });
});

// dialog:点击遮罩关闭
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg && dlg.id !== 'entry-dialog') dlg.close();
  });
});

wirePresets();
initEntries();
initWordlib();
initSettings();

async function initSettings() {
  const dir = await window.api.dataDir();
  const wlDir = dir + '\\wordlib';
  document.getElementById('set-data-dir').textContent = dir;
  document.getElementById('set-db-path').textContent = dir + '\\aitagrecorder.db';
  document.getElementById('set-wordlib-path').textContent = wlDir + '\\classification_editor.sqlite';
  document.getElementById('set-images-dir').textContent = dir + '\\preset-images';
  document.getElementById('set-version').textContent = 'v' + (await window.api.version());
  document.getElementById('btn-open-data-dir').addEventListener('click', () => window.api.openPath(dir));
  document.getElementById('btn-open-wordlib-dir').addEventListener('click', () => window.api.openPath(wlDir));
  initWlUpdate();
}

// ---------- 词库更新(设置页) ----------

let wlUpdateProgressSub = null;

function initWlUpdate() {
  const btn = document.getElementById('btn-wl-update');
  const bar = document.getElementById('wl-update-bar');
  const statusEl = document.getElementById('wl-update-status');
  const row = document.getElementById('wl-update-progress-row');
  const modeEl = document.getElementById('wl-update-mode');
  const setRunning = (running) => { btn.disabled = running; row.hidden = !running; };

  wlUpdateProgressSub = window.api.onWordlibUpdateProgress((p) => {
    if (p.phase === 'discover' || p.phase === 'refresh') {
      const pct = p.totalPages ? Math.round((p.pagesFetched / p.totalPages) * 100) : 0;
      bar.style.width = pct + '%';
      statusEl.textContent = `${p.phaseLabel} ${p.page}/${p.totalPages} 页 · 新增 ${p.newCount} · 更新 ${p.updatedCount} · 失败 ${p.failedCount}`;
    } else if (p.phase === 'done') {
      statusEl.textContent = '完成';
    } else if (p.phase === 'error') {
      statusEl.textContent = '失败:' + (p.message || '未知错误');
    }
  });

  btn.addEventListener('click', async () => {
    setRunning(true);
    statusEl.textContent = '连接 Danbooru…';
    try {
      const res = await window.api.wordlibUpdate({ mode: modeEl.value });
      toast(`词库更新完成:新增 ${res.newTags} · 更新 ${res.updatedTags}`);
      await refreshWordlib();   // 词库视图重载树与筛选(若已初始化)
    } catch (e) {
      toast('词库更新失败:' + ((e && e.message) || e));
      statusEl.textContent = '失败:' + ((e && e.message) || e);
    } finally {
      setRunning(false);
      renderUpdateLast(await window.api.wordlibUpdateStatus());
    }
  });

  // 页面加载时恢复上次状态(进行中/上次结果)
  window.api.wordlibUpdateStatus().then((s) => {
    if (s.updating) { setRunning(true); statusEl.textContent = '更新进行中…'; }
    renderUpdateLast(s);
  });
}

function renderUpdateLast(s) {
  document.getElementById('wl-update-last').textContent = s.lastAt ? new Date(s.lastAt).toLocaleString() : '从未';
  const st = s.lastStats;
  document.getElementById('wl-update-last-stats').textContent = st
    ? `${st.mode === 'full' ? '完整' : '快速'}档 · 新增 ${st.newTags} · 更新 ${st.updatedTags} · 失败页 ${st.failedPages}`
    : (s.lastError ? '上次失败:' + s.lastError : '—');
}

window.addEventListener('error', (e) => {
  console.error('[renderer]', e.message, e.filename, e.lineno);
});
