'use strict';
// 条目视图:卡片网格 + 小tag筛选 + 编辑对话框 + 批量管理

import { parseTags, esc, toast, fmtTime, confirmBox, copyText, debounce } from './util.js';

const state = {
  entries: [],
  filterTag: '',          // 当前筛选的小 tag
  filterScope: 'any',     // any | positive | negative
  searchQ: '',
  editingId: null,        // 正在编辑的条目 id
};

let gridEl, chipsEl, countEl, emptyEl;

export function initEntries() {
  gridEl = document.getElementById('entries-grid');
  chipsEl = document.getElementById('tag-chips');
  countEl = document.getElementById('entries-count');
  emptyEl = document.getElementById('entries-empty');

  // 范围分段
  document.getElementById('scope-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scope]');
    if (!b) return;
    document.querySelectorAll('#scope-seg button').forEach((x) => x.classList.toggle('active', x === b));
    state.filterScope = b.dataset.scope;
    refresh();
  });

  // 全局搜索
  const search = document.getElementById('global-search');
  const onSearch = debounce(() => { state.searchQ = search.value.trim(); refresh(); }, 220);
  search.addEventListener('input', onSearch);
  document.getElementById('global-search-clear').addEventListener('click', () => {
    search.value = '';
    state.searchQ = '';
    refresh();
  });

  // 新建
  document.getElementById('btn-new-entry').addEventListener('click', () => openEntryDialog(null));

  // 对话框:保存(按钮点击与回车均触发)
  const form = document.getElementById('entry-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveDialog();
  });
  form.addEventListener('click', (e) => {
    if (e.target.id === 'entry-delete-btn') {
      e.preventDefault();
      deleteEditing();
    }
  });
  form.addEventListener('close', () => { state.editingId = null; });

  // 实时预览
  const pos = document.getElementById('entry-positive');
  const neg = document.getElementById('entry-negative');
  const upd = () => {
    renderPreview('preview-positive', pos.value, false);
    renderPreview('preview-negative', neg.value, true);
  };
  pos.addEventListener('input', upd);
  neg.addEventListener('input', upd);
  document.getElementById('entry-dialog').addEventListener('close', upd);

  refresh();
}

// ---------- 渲染 ----------

function renderPreview(id, text, isNeg) {
  const el = document.getElementById(id);
  el.className = 'chips-preview' + (isNeg ? ' neg' : '');
  el.innerHTML = parseTags(text).map((t) => `<span class="mini-chip">${esc(t)}</span>`).join('')
    || '<span class="meta" style="font-size:12px">(空)</span>';
}

function filtered() {
  const { filterTag, filterScope, searchQ } = state;
  let out = state.entries;
  if (searchQ) {
    const ql = searchQ.toLowerCase();
    out = out.filter((e) =>
      e.title.toLowerCase().includes(ql) ||
      e.positive.toLowerCase().includes(ql) ||
      e.negative.toLowerCase().includes(ql) ||
      e.tags.positive.some((t) => t.toLowerCase().includes(ql)) ||
      e.tags.negative.some((t) => t.toLowerCase().includes(ql))
    );
  }
  if (filterTag) {
    const tl = filterTag.toLowerCase();
    out = out.filter((e) => {
      const hp = e.tags.positive.some((t) => t.toLowerCase() === tl);
      const hn = e.tags.negative.some((t) => t.toLowerCase() === tl);
      if (filterScope === 'positive') return hp;
      if (filterScope === 'negative') return hn;
      return hp || hn;
    });
  }
  return out;
}

function render() {
  const rows = filtered();
  countEl.textContent = `${rows.length} 条 · 共 ${state.entries.length} 条`;
  // 空提示:完全无条目 vs 筛选无结果,分别给文案
  emptyEl.hidden = rows.length !== 0;
  if (!rows.length) {
    const p = emptyEl.querySelector('p');
    if (p) p.textContent = state.entries.length ? '没有符合筛选的条目' : '还没有条目';
  }

  const frag = document.createDocumentFragment();
  frag.appendChild(quickCard());
  for (const e of rows) frag.appendChild(card(e));
  gridEl.replaceChildren(frag);
  renderTagChips();
}

function quickCard() {
  const div = document.createElement('div');
  div.className = 'quick-card';
  div.innerHTML = `
    <div class="quick-title">快速记录(回车即保存)</div>
    <input class="q-title" placeholder="标题(可选),留空则取第一个 tag">
    <div class="quick-inputs">
      <input class="q-pos" placeholder="正面 tags,如: 1girl, smile">
      <input class="q-neg" placeholder="负面 tags(可选)">
    </div>
    <span class="quick-hint">内容按逗号拆分为小 tag;可在「词库」中组合后保存</span>`;
  const title = div.querySelector('.q-title');
  const pos = div.querySelector('.q-pos');
  const neg = div.querySelector('.q-neg');
  const submit = async () => {
    const p = pos.value.trim();
    const n = neg.value.trim();
    if (!p && !n) return;
    const first = parseTags(p)[0] || parseTags(n)[0] || '';
    await window.api.entriesCreate({ title: title.value.trim() || first.slice(0, 60), positive: p, negative: n });
    title.value = '';
    pos.value = '';
    neg.value = '';
    toast('已保存');
    refresh();
  };
  for (const el of [title, pos, neg]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return div;
}

function card(e) {
  const art = document.createElement('article');
  art.className = 'entry-card' + (e.pinned ? ' pinned' : '');
  art.dataset.id = e.id;
  const posTags = e.tags.positive, negTags = e.tags.negative;
  art.innerHTML = `
    <div class="card-head">
      <div class="card-title" title="${esc(e.title)}">${esc(e.title || '(未命名条目)')}</div>
      <button class="card-pin" title="${e.pinned ? '取消置顶' : '置顶'}">📌</button>
    </div>
    <div class="tag-section">
      <span class="section-label pos">+ 正面</span>
      <div class="card-chips">
        ${posTags.length ? posTags.map((t) => `<span class="mini-tag" data-tag="${esc(t)}" title="点击筛选">${esc(t)}</span>`).join('') : '<span class="card-empty">(空)</span>'}
      </div>
    </div>
    <div class="tag-section">
      <span class="section-label neg">− 负面</span>
      <div class="card-chips">
        ${negTags.length ? negTags.map((t) => `<span class="mini-tag neg" data-tag="${esc(t)}" title="点击筛选">${esc(t)}</span>`).join('') : '<span class="card-empty">(空)</span>'}
      </div>
    </div>
    <footer class="card-foot">
      <span class="card-time">${fmtTime(e.updatedAt)}</span>
      <button class="card-btn copy-pos" title="复制正面">复制+</button>
      <button class="card-btn copy-neg" title="复制负面">复制−</button>
      <button class="card-btn edit" title="编辑">编辑</button>
      <button class="card-btn del" title="删除">删除</button>
    </footer>`;

  // 事件
  art.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.classList.contains('mini-tag')) {
      toggleFilter(t.dataset.tag);
      return;
    }
  });
  art.querySelector('.card-pin').addEventListener('click', async () => {
    await window.api.entriesUpdate(e.id, { pinned: !e.pinned });
    refresh();
  });
  art.querySelector('.copy-pos').addEventListener('click', async () => {
    if (e.positive) await copyText(e.positive); else toast('正面为空');
  });
  art.querySelector('.copy-neg').addEventListener('click', async () => {
    if (e.negative) await copyText(e.negative); else toast('负面为空');
  });
  art.querySelector('.edit').addEventListener('click', () => openEntryDialog(e));
  art.querySelector('.del').addEventListener('click', async () => {
    if (await confirmBox('删除条目', `确定删除「${e.title || '未命名条目'}」吗?`)) {
      await window.api.entriesDelete(e.id);
      toast('已删除');
      refresh();
    }
  });
  art.querySelector('.card-title').addEventListener('click', () => openEntryDialog(e));
  return art;
}

// 小tag筛选 chips(带计数)
async function renderTagChips() {
  const idx = await window.api.entriesTagIndex({ limit: 60 });
  const chips = idx.map((t) => `
    <button class="chip${state.filterTag && state.filterTag.toLowerCase() === t.tag.toLowerCase() ? ' active' : ''}"
            data-tag="${esc(t.tag)}">${esc(t.tag)}<span class="cnt">${t.count}</span></button>`).join('');
  chipsEl.innerHTML = `<button class="chip${!state.filterTag ? ' active' : ''}" data-tag="">全部</button>${chips}`;
  chipsEl.querySelectorAll('[data-tag]').forEach((b) => {
    b.addEventListener('click', () => toggleFilter(b.dataset.tag));
  });
}

function toggleFilter(tag) {
  state.filterTag = state.filterTag.toLowerCase() === tag.toLowerCase() ? '' : tag;
  render();
}

// ---------- 编辑对话框 ----------

export function openEntryDialog(entry) {
  const dlg = document.getElementById('entry-dialog');
  state.editingId = entry ? entry.id : null;
  document.getElementById('entry-dialog-title').textContent = entry ? '编辑条目' : '新建条目';
  document.getElementById('entry-title').value = entry ? entry.title : '';
  document.getElementById('entry-positive').value = entry ? entry.positive : '';
  document.getElementById('entry-negative').value = entry ? entry.negative : '';
  document.getElementById('entry-delete-btn').hidden = !entry;
  renderPreview('preview-positive', entry ? entry.positive : '', false);
  renderPreview('preview-negative', entry ? entry.negative : '', true);
  dlg.showModal();
  document.getElementById('entry-title').focus();
}

async function saveDialog() {
  const data = {
    title: document.getElementById('entry-title').value.trim(),
    positive: document.getElementById('entry-positive').value.trim(),
    negative: document.getElementById('entry-negative').value.trim(),
  };
  if (!data.positive && !data.negative && !data.title) {
    toast('内容为空,未保存');
    document.getElementById('entry-dialog').close();
    return;
  }
  if (state.editingId) await window.api.entriesUpdate(state.editingId, data);
  else await window.api.entriesCreate(data);
  document.getElementById('entry-dialog').close();
  toast('已保存');
  refresh();
}

async function deleteEditing() {
  if (!state.editingId) return;
  if (await confirmBox('删除条目', '确定删除这条记录吗?')) {
    await window.api.entriesDelete(state.editingId);
    document.getElementById('entry-dialog').close();
    toast('已删除');
    refresh();
  }
}

// 从词库组合跳转新建(词库视图调用)
export function openFromComposer(positive, negative) {
  openEntryDialog(null);
  document.getElementById('entry-positive').value = positive;
  document.getElementById('entry-negative').value = negative;
  renderPreview('preview-positive', positive, false);
  renderPreview('preview-negative', negative, true);
}

// ---------- 批量管理 ----------

// ---------- 数据刷新 ----------

export async function refresh() {
  state.entries = await window.api.entriesList();
  render();
}
