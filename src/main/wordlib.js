'use strict';
// 词库数据层:读取 TagToolbox 词库工具箱的 classification_editor_source.sqlite(只读)
// 首次运行:从打包资源 resources/wordlib 拷贝到 userData,并导入画师(artists-*.json)与作品(works.json)

const { app } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {}

const wordlibPath = () => path.join(app.getPath('userData'), 'wordlib', 'classification_editor.sqlite');

function resourceDir() {
  // 开发:项目 resources/wordlib;打包:app.asar 同级的 resources/wordlib(extraResources)
  const dev = path.join(app.getAppPath(), 'resources', 'wordlib');
  if (fs.existsSync(dev)) return dev;
  const pkg = path.join(path.dirname(app.getPath('exe')), 'resources', 'wordlib');
  return pkg;
}

let db = null;

// ---------- 初始化:拷贝 + 导入 ----------

async function ensure() {
  if (db) return db;
  if (!DatabaseSync) throw new Error('node:sqlite 不可用');
  const target = wordlibPath();
  const src = path.join(resourceDir(), 'classification_editor_source.sqlite');
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(src, target);
  }
  await ensureImports(); // 内部负责关闭写连接并以只读模式打开
  return db;
}

// 首次运行导入画师与作品(幂等,以 meta 标记)
async function ensureImports() {
  const rwPath = wordlibPath();
  const rw = new DatabaseSync(rwPath);
  try {
    const m = rw.prepare("SELECT value FROM meta WHERE key='aitag:artists_imported'").get();
    if (m) {
      rw.close();
      db = new DatabaseSync(rwPath, { readOnly: true });
      return;
    }

    rw.exec(`
      CREATE TABLE IF NOT EXISTS artist(
        tag_id TEXT PRIMARY KEY,
        en TEXT NOT NULL,
        zh TEXT NOT NULL DEFAULT '',
        aliases_json TEXT NOT NULL DEFAULT '[]',
        search_text TEXT NOT NULL,
        post_count INTEGER NOT NULL DEFAULT 0,
        origin TEXT NOT NULL DEFAULT '',
        year TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_artist_search ON artist(search_text);
      CREATE TABLE IF NOT EXISTS work(
        id TEXT PRIMARY KEY,
        zh TEXT NOT NULL DEFAULT '',
        tag_count INTEGER NOT NULL DEFAULT 0
      );
    `);

    // 画师(源数据在打包资源目录,与 works.json 同级)
    const dir = path.join(resourceDir(), 'artists');
    const ins = rw.prepare('INSERT OR REPLACE INTO artist(tag_id,en,zh,aliases_json,search_text,post_count,origin,year) VALUES(?,?,?,?,?,?,?,?)');
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        rw.exec('BEGIN');
        for (const a of data.artists || []) {
          const aliases = a.za || [];
          ins.run(
            a.e, a.e, a.z || '',
            JSON.stringify(aliases),
            [a.e, a.z || '', ...aliases].join(' ').toLowerCase(),
            a.p || 0, a.o || '', a.y || ''
          );
        }
        rw.exec('COMMIT');
      }
    }

    // 作品(works.json:id -> 中文名),统计关联 tag 数
    const worksPath = path.join(resourceDir(), 'works.json');
    if (fs.existsSync(worksPath)) {
      const works = JSON.parse(fs.readFileSync(worksPath, 'utf8')).works || {};
      const cnt = rw.prepare("SELECT work_id, COUNT(*) c FROM tag WHERE work_id != '' GROUP BY work_id");
      const counts = {};
      for (const r of cnt.all()) counts[r.work_id] = r.c;
      const insW = rw.prepare('INSERT OR REPLACE INTO work(id,zh,tag_count) VALUES(?,?,?)');
      rw.exec('BEGIN');
      for (const [id, zh] of Object.entries(works)) {
        if (id) insW.run(id, zh, counts[id] || 0);
      }
      rw.exec('COMMIT');
    }

    rw.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('aitag:artists_imported','1')").run();
    rw.close();
    db = new DatabaseSync(wordlibPath(), { readOnly: true });
  } catch (e) {
    try { rw.close(); } catch {}
    throw e;
  }
}

// ---------- 词库查询 ----------

// 整棵分类树(1758 节点)+ 每个节点的直接 tag 数,一次性下发
function getTree() {
  const nodes = db.prepare('SELECT id, parent_id, label, depth FROM taxonomy_node ORDER BY sort_order').all();
  const counts = db.prepare('SELECT node_id, COUNT(*) c FROM tag GROUP BY node_id').all();
  const countMap = Object.fromEntries(counts.map((r) => [r.node_id, r.c]));
  return nodes.map((n) => ({
    id: n.id,
    parentId: n.parent_id,
    label: n.label,
    depth: n.depth,
    count: countMap[n.id] || 0,
  }));
}

const SAFETIES = ['adult', 'sensitive', 'unknown'];
const SOURCES = ['m', 'b', 'n'];
const SOURCE_LABELS = { m: '主站(main)', b: '双语(bilingual)', n: '负面(negative)' };

// 搜索 tag
function searchTags({ q = '', nodeId = null, safety = 'any', source = 'any', sort = 'alpha', limit = 100, offset = 0 } = {}) {
  const conds = [];
  const params = [];
  if (q) {
    conds.push('(search_text LIKE ? OR zh LIKE ? OR en_display LIKE ? OR tag_id LIKE ?)');
    const p = '%' + q.toLowerCase() + '%';
    params.push(p, p, p, p);
  }
  if (nodeId) {
    // 含子孙节点
    const sub = descendantsOf(nodeId);
    const marks = sub.map(() => '?').join(',');
    conds.push(`node_id IN (${marks})`);
    params.push(...sub);
  }
  if (safety !== 'any') { conds.push('safety = ?'); params.push(safety); }
  if (source !== 'any') { conds.push('source = ?'); params.push(source); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const order = sort === 'popular' ? 'ORDER BY post_count DESC' : 'ORDER BY en_display ASC';
  const rows = db.prepare(`SELECT tag_id, zh, en_display, search_text, post_count, main_count, safety, source, node_id FROM tag ${where} ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return rows.map((r) => ({
    id: r.tag_id, en: r.en_display, zh: r.zh, postCount: r.post_count,
    mainCount: r.main_count, safety: r.safety, source: r.source,
    nodeId: r.node_id,
  }));
}

// 按英文名批量定位标签(预设载入时用于自动分槽)
function slotsOfTags(ens) {
  if (!Array.isArray(ens) || !ens.length) return [];
  const uniq = [...new Set(ens.filter((e) => e && e.trim()))];
  if (!uniq.length) return [];
  const marks = uniq.map(() => '?').join(',');
  const rows = db.prepare(`SELECT tag_id, en_display, zh, node_id FROM tag WHERE en_display IN (${marks}) LIMIT 1000`).all(...uniq);
  return rows.map((r) => ({ id: r.tag_id, en: r.en_display, zh: r.zh, nodeId: r.node_id }));
}

function countTags(filters) {
  const r = searchTags({ ...filters, limit: 1, offset: 0 });
  return r.length ? -1 : 0; // 占位,真实计数由前端分页决定
}

// 某节点子节点 id 列表(含自身,用于 subtree 筛选)
function descendantsOf(nodeId, all = null) {
  const nodes = all || db.prepare('SELECT id, parent_id FROM taxonomy_node').all();
  const children = new Map();
  for (const n of nodes) {
    if (!children.has(n.parent_id)) children.set(n.parent_id, []);
    children.get(n.parent_id).push(n.id);
  }
  const out = [];
  const walk = (id) => {
    out.push(id);
    for (const c of children.get(id) || []) walk(c);
  };
  walk(nodeId);
  return out;
}

// 搜索画师
function searchArtists({ q = '', limit = 100, offset = 0 } = {}) {
  const conds = [];
  const params = [];
  if (q) {
    conds.push('search_text LIKE ?');
    params.push('%' + q.toLowerCase() + '%');
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`SELECT tag_id, en, zh, post_count, year FROM artist ${where} ORDER BY post_count DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return rows.map((r) => ({ id: r.tag_id, en: r.en, zh: r.zh, postCount: r.post_count, year: r.year }));
}

// 作品列表(按关联 tag 数排序,可搜索)
function searchWorks({ q = '', limit = 200 } = {}) {
  const conds = [];
  const params = [];
  if (q) {
    conds.push('(zh LIKE ? OR id LIKE ?)');
    const p = '%' + q + '%';
    params.push(p, p);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`SELECT id, zh, tag_count FROM work ${where} ORDER BY tag_count DESC LIMIT ?`).all(...params, limit);
  return rows.map((r) => ({ id: r.id, zh: r.zh, tagCount: r.tag_count }));
}

// 某作品下的 tag
function tagsOfWork(workId) {
  const rows = db.prepare('SELECT tag_id, zh, en_display, post_count, node_id FROM tag WHERE work_id = ? ORDER BY post_count DESC LIMIT 500').all(workId);
  return rows.map((r) => ({ id: r.tag_id, en: r.en_display, zh: r.zh, postCount: r.post_count, nodeId: r.node_id }));
}

// 元信息:分类/标签统计(界面显示用)
function getStats() {
  const tagCount = db.prepare('SELECT COUNT(*) c FROM tag').get().c;
  const artistCount = db.prepare('SELECT COUNT(*) c FROM artist').get().c;
  const workCount = db.prepare('SELECT COUNT(*) c FROM work').get().c;
  return { tagCount, artistCount, workCount };
}

module.exports = {
  ensure, getTree, searchTags, searchArtists, searchWorks, tagsOfWork, slotsOfTags, getStats,
  descendantsOf,
  SAFETIES, SOURCES, SOURCE_LABELS,
  get path() { return wordlibPath(); },
};
