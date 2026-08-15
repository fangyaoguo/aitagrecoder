'use strict';
// 词库工具箱视图 —— 按 TagToolbox 原版结构:
// 左:一级分类 chips + 三级子分类行(子分类/子类/细类) + 来源/安全筛选 + 作品筛选 + 合并搜索(tag+画师)
// 右:已选组合 = L1 槽位卡(自动按 L1 入槽,可折叠,可拖拽移动,可显示空槽) + 画师槽 + 负面槽
// 底:导出(英文串/中文串/中英对照/负向串/画师串)一键复制 / 保存为新条目

import { esc, toast, debounce, copyText } from './util.js';
import { openFromComposer } from './entries.js';

// 原版 TagToolbox 槽位定义(L1 与之一一对应)
const FALLBACK_SLOTS = [
  ['visual', '视觉-表现-生成'],
  ['camera', '镜头-构图-结构'],
  ['person', '人物-主体'],
  ['look', '外貌-身体'],
  ['outfit', '服饰-配饰-装扮'],
  ['action', '姿势-动作-交互'],
  ['expression', '情绪-表情-反应'],
  ['scene', '场景-环境-时空'],
  ['object', '物件-装备-载具'],
  ['graphic', '文字-图形-符号-界面'],
  ['reference', '作品-文化-引用'],
  ['adult', '成人-性行为'],
  ['abnormal', '猎奇-非常规'],
  ['negative', '负面提示词'],
  ['character', '作品角色'],
  ['other', '未分类'],
];
const SLOT_COLORS = {
  visual: '#c4a35a', camera: '#9b8fd9', person: '#6aa6e8', look: '#8ec07c',
  expression: '#e08a5a', action: '#c87bb8', outfit: '#5bb8c8', adult: '#d86f8d',
  abnormal: '#a67c52', scene: '#7a9ae0', object: '#b89a72', graphic: '#66aeb2',
  reference: '#9a82c7', character: '#5f9fd6', other: '#9aa3b2',
  negative: '#d96b6b', artist: '#d6a65f',
};

let artistCount = 0;
let wlMeta = null;   // 词库元信息(source/safety 枚举),供筛选 chips 渲染
let treeLoaded = false;

const state = {
  tree: [],
  nodeMap: new Map(),    // nodeId -> node
  children: new Map(),   // parentId -> [node]
  l1: [],                // 一级分类节点
  l1ByKey: new Map(),    // 槽位 key -> L1 节点
  descCount: new Map(),  // 节点 -> 子孙标签数
  typeFilter: 'all',     // 'all' | 槽位 key | 'artist'
  subGroup: 'all',       // 子分类(L2)
  subFilter: 'all',      // 子类(L3)
  leafFilter: 'all',     // 细类(L4)
  searchQ: '',
  source: 'any',
  safety: 'any',
  popular: false,
  work: null,            // 作品筛选
  results: [],
  resultOffset: 0,
  limit: 100,
  selected: [],          // 组合项 {id, en, zh, slot}
  showEmptySlots: false,
  collapsedSlots: new Set(),
  exportMode: 'en',
};

const $ = (id) => document.getElementById(id);
const fmtNum = (n) => Number(n || 0).toLocaleString();
const POSITIVE_SLOTS = FALLBACK_SLOTS.filter(([id]) => id !== 'negative');

export async function initWordlib() {
  $('wl-loading').textContent = '正在加载词库…';
  try {
    const stats = await window.api.wordlibEnsure();
    artistCount = stats.artistCount;
    wlMeta = await window.api.wordlibMeta();
    $('wl-stats').textContent = `${fmtNum(stats.tagCount)} 标签 · ${fmtNum(artistCount)} 画师 · ${fmtNum(stats.workCount)} 作品`;
    await loadTree();
    $('wl-loading').hidden = true;
  } catch (e) {
    $('wl-loading').textContent = '词库加载失败:' + e.message;
  }

  // 顶部搜索(合并 tag + 画师)
  const search = $('wl-search-input');
  const onSearch = debounce(() => { state.searchQ = search.value.trim(); reloadResults(); }, 200);
  search.addEventListener('input', onSearch);
  $('wl-search-clear').addEventListener('click', () => { search.value = ''; state.searchQ = ''; reloadResults(); });

  // 筛选
  $('wl-source-toggle').addEventListener('click', () => toggleFilterPanel('wl-source-toggle', 'wl-source-chips'));
  $('wl-safety-toggle').addEventListener('click', () => toggleFilterPanel('wl-safety-toggle', 'wl-safety-chips'));
  $('wl-popular').addEventListener('click', () => {
    state.popular = !state.popular;
    $('wl-popular').classList.toggle('active', state.popular);
    reloadResults();
  });
  $('wl-reset').addEventListener('click', resetFilters);

  // 作品搜索
  $('wl-work-search').addEventListener('input', debounce(renderWorks, 200));

  // 加载更多
  $('wl-more').addEventListener('click', () => { state.resultOffset += state.limit; loadMore(); });

  // 组合区(事件委托:移除/折叠/拖拽)
  $('slot-list').addEventListener('click', (e) => {
    const rm = e.target.closest('.remove-tag');
    if (rm) { removeSelection(rm.closest('.picked').dataset.id); return; }
    const head = e.target.closest('.slot-head');
    if (head) {
      const id = head.dataset.toggleSlot;
      if (state.collapsedSlots.has(id)) state.collapsedSlots.delete(id);
      else state.collapsedSlots.add(id);
      renderSlots();
    }
  });
  $('slot-list').addEventListener('dragstart', (e) => {
    const picked = e.target.closest('.picked');
    if (!picked) return;
    state.dragId = picked.dataset.id;
    picked.classList.add('dragging');
    e.dataTransfer.setData('text/plain', state.dragId);
    e.dataTransfer.effectAllowed = 'move';
  });
  $('slot-list').addEventListener('dragend', (e) => {
    state.dragId = null;
    document.querySelectorAll('.slot-body').forEach((b) => b.classList.remove('drag-over'));
    e.target.closest('.picked')?.classList.remove('dragging');
  });
  $('slot-list').addEventListener('dragover', (e) => {
    const body = e.target.closest('.slot-body');
    if (!body || !state.dragId) return;
    const item = state.selected.find((s) => s.id === state.dragId);
    if (item && canMoveToSlot(item, body.dataset.dropSlot)) {
      e.preventDefault();
      body.classList.add('drag-over');
    }
  });
  $('slot-list').addEventListener('dragleave', (e) => {
    e.target.closest('.slot-body')?.classList.remove('drag-over');
  });
  $('slot-list').addEventListener('drop', (e) => {
    const body = e.target.closest('.slot-body');
    if (!body || !state.dragId) return;
    e.preventDefault();
    body.classList.remove('drag-over');
    const item = state.selected.find((s) => s.id === state.dragId);
    if (item && canMoveToSlot(item, body.dataset.dropSlot)) {
      item.slot = body.dataset.dropSlot;
      renderSlots();
      renderExport();
    }
  });

  $('composer-toggle-empty').addEventListener('click', () => {
    state.showEmptySlots = !state.showEmptySlots;
    $('composer-toggle-empty').classList.toggle('active', state.showEmptySlots);
    renderSlots();
  });
  $('composer-clear').addEventListener('click', () => {
    state.selected = [];
    renderResults(document.getElementById('wl-results'));
    renderSlots();
  });

  // 导出
  document.querySelectorAll('.export-head .chip2').forEach((b) => {
    b.addEventListener('click', () => {
      state.exportMode = b.dataset.mode;
      document.querySelectorAll('.export-head .chip2').forEach((x) => x.classList.toggle('active', x === b));
      renderExport();
    });
  });
  $('btn-copy-export').addEventListener('click', async () => {
    const text = exportText();
    if (!text.trim()) { toast('组合为空,无可导出内容'); return; }
    await copyText(text);
  });
  $('btn-save-entry').addEventListener('click', () => {
    const pos = polarityItems('positive').map((s) => s.en).join(', ');
    const neg = polarityItems('negative').map((s) => s.en).join(', ');
    openFromComposer(pos, neg);
  });

  $('btn-presets').addEventListener('click', () => {
    import('./presets.js').then((m) => m.openPresets(renderComposerFromPreset));
  });

  // 首次加载
  renderL1();
  renderFilterChips();
  renderSubTree();
  renderWorks();
  reloadResults();
  renderSlots();
  renderExport();
}

function resetFilters() {
  state.source = 'any'; state.safety = 'any'; state.popular = false;
  state.work = null;
  state.typeFilter = 'all'; state.subGroup = 'all'; state.subFilter = 'all'; state.leafFilter = 'all';
  ['wl-source-toggle', 'wl-safety-toggle', 'wl-popular'].forEach((id) => $(id).classList.remove('active'));
  $('wl-source-chips').hidden = true;
  $('wl-safety-chips').hidden = true;
  $('wl-works').hidden = false;
  renderL1();
  renderFilterChips();
  renderSubTree();
  renderWorks();
  reloadResults();
}

// ---------- 分类树与自动分槽 ----------

async function loadTree() {
  state.tree = await window.api.wordlibTree();
  state.nodeMap = new Map();
  state.children = new Map();
  for (const n of state.tree) {
    state.nodeMap.set(n.id, n);
    if (!state.children.has(n.parentId)) state.children.set(n.parentId, []);
    state.children.get(n.parentId).push(n);
  }
  state.l1 = state.children.get(null) || [];
  state.l1ByKey = new Map();
  for (const n of state.l1) state.l1ByKey.set(slotKey(n.id, n.label), n);
  // 子孙标签数(自底向上累加)
  state.descCount = new Map();
  const byDepth = [...state.tree].sort((a, b) => b.depth - a.depth);
  for (const n of byDepth) {
    let c = n.count || 0;
    for (const ch of state.children.get(n.id) || []) c += state.descCount.get(ch.id) || 0;
    state.descCount.set(n.id, c);
  }
  treeLoaded = true;
}

// 节点 id -> 槽位 key:沿父链上溯到 L1 后归一化(与 TagToolbox slotColorKey 同思路)
function slotOfNode(nodeId) {
  if (!nodeId) return 'other';
  let cur = state.nodeMap.get(nodeId);
  if (!cur) return 'other';
  while (cur.parentId !== null && cur.parentId !== undefined) {
    const p = state.nodeMap.get(cur.parentId);
    if (!p) break;
    cur = p;
  }
  return slotKey(cur.id, cur.label);
}

function slotKey(id, label) {
  if (!id) return 'other';
  if (id === 'artist') return 'artist';
  if (/(^|[-_/])negative$/i.test(id) || (label && label.includes('负面'))) return 'negative';
  const stripped = String(id).replace(/^v\d+-/i, '');
  if (SLOT_COLORS[stripped]) return stripped;
  if (label && label.includes('角色')) return 'character';
  return 'other';
}

function nodeIdFilter() {
  if (state.typeFilter === 'all' || state.typeFilter === 'artist') return null;
  let n = state.l1ByKey.get(state.typeFilter);
  if (!n) return null;
  if (state.leafFilter !== 'all') n = state.tree.find((x) => x.id === state.leafFilter);
  else if (state.subFilter !== 'all') n = state.tree.find((x) => x.id === state.subFilter);
  else if (state.subGroup !== 'all') n = state.tree.find((x) => x.id === state.subGroup);
  return n ? n.id : null;
}

// ---------- 一级分类 chips ----------

function renderL1() {
  const el = $('wl-l1');
  let html = `<button class="chip${state.typeFilter === 'all' ? ' active' : ''}" data-type="all">全部</button>`;
  for (const [key, fallbackLabel] of FALLBACK_SLOTS) {
    const n = state.l1ByKey.get(key);
    html += `<button class="chip${state.typeFilter === key ? ' active' : ''}" data-type="${key}">${esc(n ? n.label : fallbackLabel)}<span class="cnt">${n ? fmtNum(state.descCount.get(n.id)) : ''}</span></button>`;
  }
  html += `<button class="chip${state.typeFilter === 'artist' ? ' active' : ''}" data-type="artist">画师<span class="cnt">${fmtNum(artistCount)}</span></button>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-type]').forEach((b) => {
    b.addEventListener('click', () => {
      state.typeFilter = b.dataset.type;
      state.subGroup = 'all'; state.subFilter = 'all'; state.leafFilter = 'all';
      renderL1();
      renderSubTree();
      reloadResults();
    });
  });
}

// ---------- 三级子分类行(子分类 / 子类 / 细类) ----------

function shortChipLabel(label) {
  const text = String(label || '').trim();
  const slash = text.lastIndexOf('/');
  return slash >= 0 ? text.slice(slash + 1).trim() || text : text;
}

function renderSubTree() {
  const el = $('wl-subtree');
  const l1 = state.l1ByKey.get(state.typeFilter);
  const show = state.typeFilter !== 'all' && state.typeFilter !== 'artist' && l1;
  el.hidden = !show;
  // 画师模式无作品/子树
  $('wl-works').hidden = state.typeFilter === 'artist';
  if (!show) { el.innerHTML = ''; return; }

  const rows = [];
  const l2 = state.children.get(l1.id) || [];
  const mkChip = (id, label, count, cur, filterName) => `
    <button class="chip${cur === id ? ' active' : ''}" data-${filterName}="${esc(id)}">${esc(shortChipLabel(label))}<span class="cnt">${count ? fmtNum(count) : ''}</span></button>`;

  // 子分类(L2)
  rows.push({ label: '子分类', chips: mkChip('all', '全部', '', state.subGroup, 'group') + l2.map((n) => mkChip(n.id, n.label, state.descCount.get(n.id) || 0, state.subGroup, 'group')).join('') });

  // 子类(L3)
  const group = l2.find((n) => n.id === state.subGroup);
  if (group) {
    const l3 = state.children.get(group.id) || [];
    rows.push({ label: '子类', chips: mkChip('all', '全部', '', state.subFilter, 'filter') + l3.map((n) => mkChip(n.id, n.label, state.descCount.get(n.id) || 0, state.subFilter, 'filter')).join('') });
    // 细类(L4)
    const sub = l3.find((n) => n.id === state.subFilter);
    if (sub) {
      const l4 = state.children.get(sub.id) || [];
      rows.push({ label: '细类', chips: mkChip('all', '全部', '', state.leafFilter, 'leaf') + l4.map((n) => mkChip(n.id, n.label, state.descCount.get(n.id) || 0, state.leafFilter, 'leaf')).join('') });
    }
  }

  el.innerHTML = rows.map((r) => `
    <div class="sub-tree-row">
      <span class="sub-tree-label">${r.label}</span>
      <div class="wl-filter-chips">${r.chips}</div>
    </div>`).join('');

  el.querySelectorAll('[data-group]').forEach((b) => {
    b.addEventListener('click', () => {
      state.subGroup = b.dataset.group === 'all' ? 'all' : b.dataset.group;
      state.subFilter = 'all'; state.leafFilter = 'all';
      renderSubTree();
      reloadResults();
    });
  });
  el.querySelectorAll('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      state.subFilter = b.dataset.filter === 'all' ? 'all' : b.dataset.filter;
      state.leafFilter = 'all';
      renderSubTree();
      reloadResults();
    });
  });
  el.querySelectorAll('[data-leaf]').forEach((b) => {
    b.addEventListener('click', () => {
      state.leafFilter = b.dataset.leaf === 'all' ? 'all' : b.dataset.leaf;
      renderSubTree();
      reloadResults();
    });
  });
}

// ---------- 筛选面板 ----------

function toggleFilterPanel(toggleId, chipsId) {
  const t = $(toggleId);
  t.classList.toggle('active');
  $(chipsId).hidden = !t.classList.contains('active');
}

async function renderFilterChips() {
  const srcEl = $('wl-source-chips');
  const sources = (wlMeta && wlMeta.sources) || ['m', 'b', 'n'];
  const labels = (wlMeta && wlMeta.sourceLabels) || {};
  const short = (s) => String(labels[s] || s).replace(/\s*\(.*\)$/, '').trim();   // '主站(main)' -> '主站'
  srcEl.innerHTML = sources.map((s) => `
    <button class="chip${state.source === s ? ' active' : ''}" data-source="${s}">${esc(short(s))}</button>`).join('');
  srcEl.querySelectorAll('[data-source]').forEach((b) => {
    b.addEventListener('click', () => {
      state.source = state.source === b.dataset.source ? 'any' : b.dataset.source;
      renderFilterChips();
      reloadResults();
    });
  });
  const safEl = $('wl-safety-chips');
  const safeties = (wlMeta && wlMeta.safeties) || ['adult', 'sensitive', 'unknown'];
  const safLabels = { adult: '成人', sensitive: '敏感', unknown: '未知' };
  safEl.innerHTML = safeties.map((s) => `
    <button class="chip${state.safety === s ? ' active' : ''}" data-safety="${s}">${safLabels[s] || s}</button>`).join('');
  safEl.querySelectorAll('[data-safety]').forEach((b) => {
    b.addEventListener('click', () => {
      state.safety = state.safety === b.dataset.safety ? 'any' : b.dataset.safety;
      renderFilterChips();
      reloadResults();
    });
  });
}

// ---------- 作品筛选 ----------

async function renderWorks() {
  const q = $('wl-work-search').value.trim();
  const works = await window.api.wordlibSearchWorks({ q, limit: 80 });
  const el = $('wl-work-chips');
  el.innerHTML = works.map((w) => `
    <button class="work-chip${state.work === w.id ? ' active' : ''}" data-work="${esc(w.id)}"
            title="${esc(w.zh)} · ${w.tagCount} tags">${esc(w.zh || w.id)}</button>`).join('');
  el.querySelectorAll('[data-work]').forEach((b) => {
    b.addEventListener('click', () => {
      state.work = state.work === b.dataset.work ? null : b.dataset.work;
      renderWorks();
      reloadResults();
    });
  });
}

// ---------- 结果(合并 tag + 画师) ----------

async function reloadResults() {
  state.resultOffset = 0;
  state.results = [];
  await loadMore(true);
}

async function loadMore(reset) {
  const el = $('wl-results');
  const q = state.searchQ;
  let rows = [];
  let totalText = '';

  if (state.typeFilter === 'artist') {
    // 画师模式:独立画师库
    rows = await window.api.wordlibSearchArtists({ q, limit: state.limit, offset: state.resultOffset });
    totalText = '独立画师词库';
  } else if (state.work) {
    // 作品模式:该作品的标签(按热度),本地过滤搜索词
    const tags = await window.api.wordlibTagsOfWork(state.work);
    rows = q
      ? tags.filter((t) => (t.en + ' ' + (t.zh || '')).toLowerCase().includes(q.toLowerCase()))
      : tags;
    rows = reset ? rows.slice(0, state.limit) : rows;
    totalText = `${state.work} 下的标签`;
    $('wl-more').hidden = true;
  } else {
    rows = await window.api.wordlibSearchTags({
      q,
      nodeId: nodeIdFilter(),
      safety: state.safety,
      source: state.source,
      sort: state.popular ? 'popular' : 'alpha',
      limit: state.limit,
      offset: state.resultOffset,
    });
    // 搜索词存在时合并画师结果(仅第一页)
    if (q && state.resultOffset === 0) {
      const artists = await window.api.wordlibSearchArtists({ q, limit: 20 });
      rows = rows.concat(artists.map((a) => ({ ...a, kind: 'artist' })));
    }
    totalText = '';
  }

  if (reset) state.results = rows;
  else state.results = state.results.concat(rows);

  const more = rows.length >= state.limit && !state.work;
  $('wl-more').hidden = !more;
  $('wl-results-summary').textContent =
    totalText || `搜索结果 ${state.results.length} 条${more ? '+' : ''}`;
  renderResults(el);
}

function renderResults(el) {
  if (!state.results.length) {
    el.innerHTML = '<div class="empty-tip">没有结果。换一个词试试,或切换上方分类。</div>';
    return;
  }
  el.innerHTML = state.results.map((r) => {
    const key = r.kind === 'artist' ? 'artist' : slotOfNode(r.nodeId);
    const sel = state.selected.some((s) => s.id === r.id);
    return `
    <button class="result-row${sel ? ' selected' : ''}" data-id="${esc(r.id)}" data-slot="${key}"
            data-node="${esc(r.nodeId || '')}" data-en="${esc(r.en)}" data-zh="${esc(r.zh || '')}">
      <span class="dot" style="background:${SLOT_COLORS[key] || SLOT_COLORS.other}"></span>
      <span class="result-main">
        <span class="result-zh">${esc(r.zh || r.en)}</span>
        <span class="result-en">${esc(r.en)}</span>
      </span>
      <span class="result-meta">
        ${r.postCount ? `<span class="result-count">${fmtNum(r.postCount)}</span>` : ''}
        ${r.safety && r.safety !== 'unknown' ? `<span class="safety-badge safety-${esc(r.safety)}">${r.safety === 'adult' ? '成人' : '敏感'}</span>` : ''}
        <span class="check">${sel ? '✓' : '+'}</span>
      </span>
    </button>`;
  }).join('');

  el.querySelectorAll('.result-row').forEach((row) => {
    row.addEventListener('click', () => {
      const item = { id: row.dataset.id, en: row.dataset.en, zh: row.dataset.zh, nodeId: row.dataset.node };
      const key = row.dataset.slot;
      const idx = state.selected.findIndex((s) => s.id === item.id);
      if (idx >= 0) state.selected.splice(idx, 1);
      else state.selected.push({ ...item, slot: key });
      renderResults(el);
      renderSlots();
    });
  });
}

// ---------- 组合(槽位卡) ----------

// 组合槽顺序:正向 L1 槽(原版顺序) + 画师槽 + 负面槽(末位)
function composerSlots() {
  return [...POSITIVE_SLOTS.map(([id, label]) => ({ id, label })), { id: 'artist', label: '画师' }, { id: 'negative', label: '负面提示词' }];
}

function polarityItems(polarity) {
  return state.selected.filter((s) => polarityOf(s.slot) === polarity);
}

function polarityOf(slot) {
  if (slot === 'artist') return 'artist';
  if (slot === 'negative') return 'negative';
  return 'positive';
}

function canMoveToSlot(item, slotId) {
  if (item.slot === 'artist') return slotId === 'artist';
  if (item.slot === 'negative') return slotId === 'negative';
  return slotId !== 'artist';
}

function removeSelection(id) {
  const i = state.selected.findIndex((s) => s.id === id);
  if (i < 0) return;
  state.selected.splice(i, 1);
  renderResults(document.getElementById('wl-results'));
  renderSlots();
}

function renderSlots() {
  const list = $('slot-list');
  const fragment = [];
  let rendered = 0;
  for (const slot of composerSlots()) {
    const items = state.selected.filter((s) => s.slot === slot.id);
    if (!state.showEmptySlots && !items.length) continue;
    rendered += 1;
    const collapsed = state.collapsedSlots.has(slot.id);
    fragment.push(`
      <section class="slot-card${collapsed ? ' is-collapsed' : ''}" data-slot="${slot.id}">
        <button class="slot-head" data-toggle-slot="${slot.id}" aria-expanded="${!collapsed}">
          <span class="slot-swatch" style="background:${SLOT_COLORS[slot.id]}"></span>
          <span class="slot-title">${esc(slot.label)}</span>
          <span class="slot-count">${items.length} 词</span>
        </button>
        <div class="slot-body" data-drop-slot="${slot.id}">
          ${items.length
            ? items.map((s) => `
                <span class="picked${s.slot === 'negative' ? ' neg' : s.slot === 'artist' ? ' art' : ''}"
                      data-slot="${s.slot}" data-id="${esc(s.id)}" draggable="true" title="${esc(s.en)}">
                  <span class="zh">${esc(s.zh || s.en)}</span>
                  <span class="en">${esc(s.en)}</span>
                  <button class="remove-tag" type="button" title="移除">×</button>
                </span>`).join('')
            : '<span class="slot-empty">拖入或从左侧点选</span>'}
        </div>
      </section>`);
  }
  if (!rendered) {
    fragment.push('<div class="slot-empty-state"><p>点选左侧标签会按 L1 自动入槽;画师进入独立画师槽。</p></div>');
  }
  list.innerHTML = fragment.join('');
  const total = state.selected.length;
  $('composer-count').textContent = `共 ${total} 词`;
  renderExport();
}

// 预设载入:批量查库定位节点后自动入槽
async function renderComposerFromPreset(p) {
  if (p.positive === undefined && p.negative === undefined && p.artist === undefined) return;
  const all = [...(p.positive || []), ...(p.negative || []), ...(p.artist || [])];
  const foundMap = new Map();
  if (all.length) {
    const found = await window.api.wordlibSlotsOfTags(all.map((s) => s.en));
    for (const f of found) foundMap.set(f.en, f);
  }
  state.selected = [];
  for (const s of p.positive || []) {
    const f = foundMap.get(s.en);
    const nodeId = f ? f.nodeId : null;
    state.selected.push({ id: f ? f.id : s.en, en: s.en, zh: f && f.zh ? f.zh : (s.zh || ''), nodeId, slot: nodeId ? slotOfNode(nodeId) : 'other' });
  }
  for (const s of p.negative || []) state.selected.push({ id: s.en, en: s.en, zh: s.zh || '', slot: 'negative' });
  for (const s of p.artist || []) state.selected.push({ id: s.en, en: s.en, zh: s.zh || '', slot: 'artist' });
  renderResults(document.getElementById('wl-results'));
  renderSlots();
}

// ---------- 导出 ----------

function exportText() {
  const mode = state.exportMode;
  const pos = polarityItems('positive');
  const neg = polarityItems('negative');
  const art = polarityItems('artist');
  if (mode === 'zh') return pos.map((s) => s.zh || s.en).join(', ');
  if (mode === 'bilingual') return pos.map((s) => (s.zh && s.zh !== s.en) ? `${s.en} (${s.zh})` : s.en).join(', ');
  if (mode === 'negative') return neg.map((s) => s.en).join(', ');
  if (mode === 'artist') return art.map((s) => s.en).join(', ');
  return pos.map((s) => s.en).join(', ');
}

function renderExport() {
  $('export-summary').textContent =
    `正向 ${polarityItems('positive').length} · 负面 ${polarityItems('negative').length} · 画师 ${polarityItems('artist').length}`;
  $('export-box').value = exportText();
  // 双语模式:双栏中英对照
  const bilingual = state.exportMode === 'bilingual';
  $('bilingual-panes').hidden = !bilingual;
  if (bilingual) {
    const pos = polarityItems('positive');
    $('bilingual-zh').textContent = pos.map((s) => s.zh || s.en).join(', ');
    $('bilingual-en').textContent = pos.map((s) => s.en).join(', ');
  }
}

export function composerState() {
  return {
    positive: polarityItems('positive').map(({ id, en, zh }) => ({ id, en, zh })),
    negative: polarityItems('negative').map(({ id, en, zh }) => ({ id, en, zh })),
    artist: polarityItems('artist').map(({ id, en, zh }) => ({ id, en, zh })),
  };
}

// 词库在线更新完成后刷新(设置页调用):重载树并重渲染 L1/子树/筛选/结果
export async function refreshWordlib() {
  if (!treeLoaded) return;
  try {
    await loadTree();
    renderL1();
    renderSubTree();
    renderFilterChips();
    renderWorks();
    reloadResults();
  } catch (e) {
    console.error('[wordlib] 刷新失败', e);
  }
}
