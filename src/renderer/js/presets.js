'use strict';
// 提示词预设管理对话框:角色/场景/服装/动作/表情,另存/覆盖升版/载入/删除,配图与版本历史

import { esc, toast, confirmBox, fmtDate } from './util.js';
import { composerState } from './wordlib.js';

let typeLabels = { character: '角色', scene: '场景', outfit: '服装', action: '动作', expression: '表情' };
let presets = [];
let currentType = 'character';
let selectedId = null;
let loadCallback = null;

const $ = (id) => document.getElementById(id);

export async function openPresets(onLoad) {
  loadCallback = onLoad;
  typeLabels = await window.api.presetsTypeLabels();
  presets = await window.api.presetsList();
  const dlg = $('preset-dialog');
  renderTypes();
  renderList();
  selectPreset(null);
  dlg.showModal();
}

function closePresets() {
  $('preset-dialog').close();
}

function renderTypes() {
  const el = $('preset-types');
  el.innerHTML = Object.entries(typeLabels).map(([k, v]) => `
    <button class="chip${currentType === k ? ' active' : ''}" data-type="${k}">${esc(v)}</button>`).join('');
  el.querySelectorAll('[data-type]').forEach((b) => {
    b.addEventListener('click', () => { currentType = b.dataset.type; renderTypes(); renderList(); selectPreset(null); });
  });
}

function renderList() {
  const list = presets.filter((p) => p.type === currentType);
  const el = $('preset-list');
  $('preset-list-title').textContent = `${typeLabels[currentType]}预设`;
  $('preset-list-count').textContent = list.length;
  el.innerHTML = list.length
    ? list.map((p) => `
        <button class="preset-item${selectedId === p.id ? ' active' : ''}" data-id="${p.id}">
          <span class="preset-item-name">${esc(p.name || '(未命名)')}</span>
          <span class="preset-item-ver">v${p.version}</span>
          <span class="preset-item-time">${fmtDate(p.updatedAt)}</span>
        </button>`).join('')
    : '<span class="meta" style="padding:8px">暂无预设</span>';
  el.querySelectorAll('[data-id]').forEach((b) => {
    b.addEventListener('click', () => selectPreset(Number(b.dataset.id)));
  });
}

function selectPreset(id) {
  selectedId = id;
  const p = presets.find((x) => x.id === id) || null;
  $('preset-name').value = p ? p.name : '';
  $('preset-notes').value = p ? p.notes : '';
  $('preset-positive').value = p ? p.positive : '';
  $('preset-negative').value = p ? p.negative : '';
  $('preset-artist').value = p ? p.artist : '';
  $('preset-image-count').textContent = p ? `${p.images.length} / 48` : '0 / 48';
  renderImages(p ? p.images : []);
  renderHistory(p);
  $('preset-overwrite').disabled = !p;
  $('preset-load').disabled = !p;
  $('preset-delete').disabled = !p;
  renderList();
}

function renderImages(images) {
  const el = $('preset-images');
  el.innerHTML = images.length
    ? images.map((name) => `
        <div class="preset-img">
          <img src="presetimg://presets/${esc(name)}" alt="配图">
          <button class="rm" data-img="${esc(name)}">✕</button>
        </div>`).join('')
    : '<span class="meta">无配图</span>';
  el.querySelectorAll('.rm').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!selectedId) return;
      const p = presets.find((x) => x.id === selectedId);
      await window.api.presetsRemoveImage(b.dataset.img);
      await window.api.presetsSave({ id: selectedId, images: p.images.filter((i) => i !== b.dataset.img) });
      presets = await window.api.presetsList();
      selectPreset(selectedId);
    });
  });
}

async function renderHistory(p) {
  const box = $('preset-history-box');
  const ul = $('preset-history-list');
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  const h = await window.api.presetsHistory(p.id);
  ul.innerHTML = h.length
    ? h.map((r) => `
        <li><span class="v">v${r.version}</span>
            <span class="h-text">${esc(r.positive.slice(0, 60) || '(空)')}</span>
            <span class="h-time">${fmtDate(r.created_at)}</span></li>`).join('')
    : '<li>暂无历史</li>';
}

// ---------- 动作 ----------

function composerSnapshot() {
  const c = composerState();
  return {
    positive: c.positive.map((s) => s.en).join(', '),
    negative: c.negative.map((s) => s.en).join(', '),
    artist: c.artist.map((s) => s.en).join(', '),
  };
}

function snapshotToSlots(p) {
  return {
    positive: p.positive ? p.positive.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((s) => ({ id: s, en: s, zh: '' })) : [],
    negative: p.negative ? p.negative.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((s) => ({ id: s, en: s, zh: '' })) : [],
    artist: p.artist ? p.artist.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((s) => ({ id: s, en: s, zh: '' })) : [],
  };
}

export function wirePresets() {
  $('preset-dialog-close').addEventListener('click', closePresets);
  $('preset-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) closePresets(); });

  $('preset-import-images').addEventListener('click', async () => {
    if (!selectedId) { toast('请先选择预设'); return; }
    const p = presets.find((x) => x.id === selectedId);
    if (p.images.length >= 48) { toast('最多 48 张配图'); return; }
    const names = await window.api.presetsPickImages();
    if (!names.length) return;
    const all = p.images.concat(names).slice(0, 48);
    await window.api.presetsSave({ id: selectedId, images: all });
    presets = await window.api.presetsList();
    selectPreset(selectedId);
  });

  $('preset-save-new').addEventListener('click', async () => {
    const name = $('preset-name').value.trim();
    const notes = $('preset-notes').value.trim();
    if (!name) { toast('请输入预设名称'); return; }
    const snap = composerSnapshot();
    if (!snap.positive && !snap.negative && !snap.artist) { toast('组合区为空'); return; }
    await window.api.presetsSave({ type: currentType, name, notes, ...snap, images: [] });
    toast('已另存为新预设');
    presets = await window.api.presetsList();
    selectPreset(presets.find((p) => p.type === currentType && p.name === name)?.id ?? null);
  });

  $('preset-overwrite').addEventListener('click', async () => {
    if (!selectedId) return;
    if (!(await confirmBox('覆盖并升版', '用当前组合覆盖该预设并升一个版本号?'))) return;
    const p = presets.find((x) => x.id === selectedId);
    const snap = composerSnapshot();
    await window.api.presetsSave({ id: selectedId, name: p.name, notes: $('preset-notes').value.trim(), ...snap, overwrite: true });
    toast('已覆盖并升版');
    presets = await window.api.presetsList();
    selectPreset(selectedId);
  });

  $('preset-load').addEventListener('click', () => {
    const p = presets.find((x) => x.id === selectedId);
    if (!p) return;
    loadCallback(snapshotToSlots(p));
    closePresets();
    toast(`已载入「${p.name}」到组合`);
  });

  $('preset-delete').addEventListener('click', async () => {
    const p = presets.find((x) => x.id === selectedId);
    if (!p) return;
    if (await confirmBox('删除预设', `确定删除「${p.name}」吗?`)) {
      await window.api.presetsDelete(p.id);
      toast('已删除');
      presets = await window.api.presetsList();
      selectPreset(null);
    }
  });
}
