'use strict';
// 应用 SQLite 数据层:条目(entries) + 小tag索引(entry_tags) + 预设(presets) + 版本历史(preset_versions)
// 使用 Electron 内置 node:sqlite(无需原生模块编译)

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('[db] node:sqlite 不可用:', e.message);
}

const dbPath = () => path.join(app.getPath('userData'), 'aitagrecorder.db');
let db = null;

// ---------- 工具 ----------

// 把逗号分隔的 tag 串解析成小 tag 列表(去空、保序、去重)
function parseTags(text) {
  const seen = new Set();
  const out = [];
  if (!text) return out;
  for (const raw of String(text).split(/[,，]/)) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- 初始化 ----------

function open() {
  if (db) return db;
  if (!DatabaseSync) {
    throw new Error('node:sqlite 不可用，请升级 Electron 版本');
  }
  const p = dbPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  db = new DatabaseSync(p);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      positive TEXT NOT NULL DEFAULT '',
      negative TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entry_tags(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      polarity TEXT NOT NULL CHECK(polarity IN ('positive','negative')),
      tag TEXT NOT NULL,
      tag_norm TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_entry_tags_norm ON entry_tags(tag_norm);
    CREATE INDEX IF NOT EXISTS idx_entry_tags_entry ON entry_tags(entry_id);
    CREATE TABLE IF NOT EXISTS presets(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      positive TEXT NOT NULL DEFAULT '',
      negative TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      images TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS preset_versions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preset_id INTEGER NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      positive TEXT NOT NULL DEFAULT '',
      negative TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function close() {
  if (db) { try { db.close(); } catch {} db = null; }
}

// 重建某条目的 entry_tags 索引(保存/删除时调用)
function reindexEntry(entryId, positive, negative) {
  db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(entryId);
  const ins = db.prepare(
    'INSERT INTO entry_tags(entry_id, polarity, tag, tag_norm, position) VALUES(?,?,?,?,?)'
  );
  const push = (text, polarity) => {
    parseTags(text).forEach((t, i) => ins.run(entryId, polarity, t, t.toLowerCase(), i));
  };
  push(positive, 'positive');
  push(negative, 'negative');
}

// ---------- 条目 CRUD ----------

function listEntries({ q = '', tag = '', polarity = 'any', pinnedOnly = false } = {}) {
  const rows = db
    .prepare('SELECT * FROM entries ORDER BY pinned DESC, updated_at DESC')
    .all();
  let out = rows.map((r) => ({
    id: r.id,
    title: r.title,
    positive: r.positive,
    negative: r.negative,
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: {
      positive: parseTags(r.positive),
      negative: parseTags(r.negative),
    },
  }));
  if (q) {
    const ql = q.toLowerCase();
    out = out.filter(
      (e) =>
        e.title.toLowerCase().includes(ql) ||
        e.positive.toLowerCase().includes(ql) ||
        e.negative.toLowerCase().includes(ql) ||
        e.tags.positive.some((t) => t.toLowerCase().includes(ql)) ||
        e.tags.negative.some((t) => t.toLowerCase().includes(ql))
    );
  }
  if (tag) {
    const tl = tag.toLowerCase();
    out = out.filter((e) => {
      const hasPos = e.tags.positive.some((t) => t.toLowerCase() === tl);
      const hasNeg = e.tags.negative.some((t) => t.toLowerCase() === tl);
      if (polarity === 'positive') return hasPos;
      if (polarity === 'negative') return hasNeg;
      return hasPos || hasNeg;
    });
  }
  if (pinnedOnly) out = out.filter((e) => e.pinned);
  return out;
}

function getEntry(id) {
  return listEntries().find((e) => e.id === id) || null;
}

function createEntry({ title = '', positive = '', negative = '', pinned = false } = {}) {
  const t = nowIso();
  const res = db
    .prepare('INSERT INTO entries(title, positive, negative, pinned, created_at, updated_at) VALUES(?,?,?,?,?,?)')
    .run(String(title).trim(), String(positive).trim(), String(negative).trim(), pinned ? 1 : 0, t, t);
  const id = Number(res.lastInsertRowid);
  reindexEntry(id, positive, negative);
  return getEntry(id);
}

function updateEntry(id, { title, positive, negative, pinned } = {}) {
  const cur = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!cur) return null;
  const n = {
    title: title !== undefined ? String(title).trim() : cur.title,
    positive: positive !== undefined ? String(positive).trim() : cur.positive,
    negative: negative !== undefined ? String(negative).trim() : cur.negative,
    pinned: pinned !== undefined ? (pinned ? 1 : 0) : cur.pinned,
  };
  db.prepare('UPDATE entries SET title=?, positive=?, negative=?, pinned=?, updated_at=? WHERE id=?')
    .run(n.title, n.positive, n.negative, n.pinned, nowIso(), id);
  reindexEntry(id, n.positive, n.negative);
  return getEntry(id);
}

function deleteEntry(id) {
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  return true;
}

// ---------- 小tag筛选索引 ----------

// 返回全部小 tag 及命中条目数(用于筛选 chips)
function tagIndex({ q = '', limit = 80 } = {}) {
  let rows;
  if (q) {
    rows = db
      .prepare(
        `SELECT tag_norm, MIN(tag) AS tag, COUNT(*) AS c
         FROM (SELECT DISTINCT entry_id, tag_norm, tag FROM entry_tags WHERE tag_norm LIKE ?)
         GROUP BY tag_norm ORDER BY c DESC LIMIT ?`
      )
      .all('%' + q.toLowerCase() + '%', limit);
  } else {
    rows = db
      .prepare(
        `SELECT tag_norm, MIN(tag) AS tag, COUNT(*) AS c
         FROM (SELECT DISTINCT entry_id, tag_norm, tag FROM entry_tags)
         GROUP BY tag_norm ORDER BY c DESC LIMIT ?`
      )
      .all(limit);
  }
  return rows.map((r) => ({ tag: r.tag, count: r.c }));
}

// ---------- 预设 ----------

const PRESET_TYPES = ['character', 'scene', 'outfit', 'action', 'expression'];
const PRESET_TYPE_LABELS = {
  character: '角色',
  scene: '场景',
  outfit: '服装',
  action: '动作',
  expression: '表情',
};

function listPresets() {
  const rows = db.prepare('SELECT * FROM presets ORDER BY type, updated_at DESC').all();
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    notes: r.notes,
    positive: r.positive,
    negative: r.negative,
    artist: r.artist,
    version: r.version,
    images: JSON.parse(r.images || '[]'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

function savePreset({ id, type, name, notes, positive, negative, artist, images, overwrite = false }) {
  const t = nowIso();
  if (!id) {
    const res = db
      .prepare('INSERT INTO presets(type,name,notes,positive,negative,artist,version,images,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?)')
      .run(type, String(name).trim(), String(notes || ''), String(positive || ''), String(negative || ''), String(artist || ''), JSON.stringify(images || []), t, t);
    const nid = Number(res.lastInsertRowid);
    db.prepare('INSERT INTO preset_versions(preset_id,version,positive,negative,artist,created_at) VALUES(?,1,?,?,?,?)')
      .run(nid, String(positive || ''), String(negative || ''), String(artist || ''), t);
    return getPreset(nid);
  }
  const cur = db.prepare('SELECT * FROM presets WHERE id=?').get(id);
  if (!cur) return null;
  const version = overwrite ? cur.version + 1 : cur.version;
  db.prepare('UPDATE presets SET type=?,name=?,notes=?,positive=?,negative=?,artist=?,version=?,images=?,updated_at=? WHERE id=?')
    .run(type || cur.type, String(name).trim() || cur.name, String(notes ?? cur.notes), String(positive ?? cur.positive), String(negative ?? cur.negative), String(artist ?? cur.artist), version, JSON.stringify(images ?? JSON.parse(cur.images || '[]')), t, id);
  if (overwrite) {
    db.prepare('INSERT INTO preset_versions(preset_id,version,positive,negative,artist,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, version, String(positive ?? cur.positive), String(negative ?? cur.negative), String(artist ?? cur.artist), t);
  }
  return getPreset(id);
}

function getPreset(id) {
  const r = db.prepare('SELECT * FROM presets WHERE id=?').get(id);
  if (!r) return null;
  return {
    id: r.id, type: r.type, name: r.name, notes: r.notes,
    positive: r.positive, negative: r.negative, artist: r.artist,
    version: r.version, images: JSON.parse(r.images || '[]'),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function presetHistory(id) {
  return db
    .prepare('SELECT id, version, positive, negative, artist, created_at FROM preset_versions WHERE preset_id=? ORDER BY version DESC')
    .all(id)
    .map((r) => ({ ...r }));
}

function deletePreset(id) {
  db.prepare('DELETE FROM presets WHERE id=?').run(id);
  return true;
}

module.exports = {
  open, close,
  parseTags,
  listEntries, getEntry, createEntry, updateEntry, deleteEntry,
  tagIndex,
  listPresets, savePreset, getPreset, presetHistory, deletePreset,
  PRESET_TYPES, PRESET_TYPE_LABELS,
};
