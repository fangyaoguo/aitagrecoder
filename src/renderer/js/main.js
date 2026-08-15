'use strict';
// 入口:导航切换 + 视图初始化 + 对话框全局关闭行为

import { initEntries, refresh } from './entries.js';
import { initWordlib } from './wordlib.js';
import { wirePresets } from './presets.js';

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
}

window.addEventListener('error', (e) => {
  console.error('[renderer]', e.message, e.filename, e.lineno);
});
