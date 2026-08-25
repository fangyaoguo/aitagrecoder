'use strict';
// 主进程入口:窗口、IPC、词库协议、冒烟测试

const { app, BrowserWindow, ipcMain, clipboard, dialog, Menu, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const db = require('./db');
const wordlib = require('./wordlib');

const isDev = !!process.env.VITE_DEV_SERVER_URL || process.argv.includes('--dev');
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

let win = null;

// ---------- 词库图片协议(presetimg://presets/<文件名>) ----------
async function registerImageProtocol() {
  protocol.handle('presetimg', async (request) => {
    try {
      const url = new URL(request.url);
      const name = path.basename(url.pathname);
      const file = path.join(app.getPath('userData'), 'preset-images', name);
      if (!file.startsWith(app.getPath('userData')) || !fs.existsSync(file)) {
        return new Response('Not Found', { status: 404 });
      }
      return net.fetch(pathToFileURL(file).toString());
    } catch (e) {
      return new Response('Bad Request', { status: 400 });
    }
  });
}

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#f1f3f4',
    title: 'AI 标签记录器',
    autoHideMenuBar: false,
    icon: (() => {
      const p = path.join(app.getAppPath(), 'build', 'icon.png');
      return fs.existsSync(p) ? p : undefined;
    })(),
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
  win.on('closed', () => (win = null));
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开数据目录',
          click: () => shellOpen(app.getPath('userData')),
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '重置缩放', role: 'resetZoom' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: '关于',
              message: 'AI 标签记录器',
              detail:
                '条目化记录 AI 绘画的正向/负向 Tag\n集成词库工具箱(分类词库 + 组合导出 + 提示词预设)\n数据: SQLite(本地)',
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function shellOpen(p) {
  const { shell } = require('electron');
  fs.mkdirSync(p, { recursive: true });
  shell.openPath(p);
}

// ---------- IPC ----------
function registerIpc() {
  // 条目
  ipcMain.handle('entries:list', (_e, opts) => db.listEntries(opts || {}));
  ipcMain.handle('entries:create', (_e, data) => db.createEntry(data || {}));
  ipcMain.handle('entries:update', (_e, id, data) => db.updateEntry(id, data || {}));
  ipcMain.handle('entries:delete', (_e, id) => db.deleteEntry(id));
  ipcMain.handle('entries:tagIndex', (_e, opts) => db.tagIndex(opts || {}));

  // 预设
  ipcMain.handle('presets:list', () => db.listPresets());
  ipcMain.handle('presets:save', (_e, data) => db.savePreset(data || {}));
  ipcMain.handle('presets:history', (_e, id) => db.presetHistory(id));
  ipcMain.handle('presets:delete', (_e, id) => db.deletePreset(id));
  ipcMain.handle('presets:pickImages', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '导入配图(可多选)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    if (res.canceled) return [];
    const dir = path.join(app.getPath('userData'), 'preset-images');
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    for (const f of res.filePaths) {
      const ext = path.extname(f).toLowerCase().replace('.', '') || 'png';
      const name = crypto.randomUUID() + '.' + ext;
      try {
        await fsp.copyFile(f, path.join(dir, name));
        out.push(name);
      } catch (e) { /* 忽略损坏文件 */ }
    }
    return out;
  });
  ipcMain.handle('presets:removeImage', async (_e, name) => {
    try {
      const safe = path.basename(name);
      await fsp.unlink(path.join(app.getPath('userData'), 'preset-images', safe));
    } catch (e) {}
    return true;
  });
  ipcMain.handle('presets:typeLabels', () => db.PRESET_TYPE_LABELS);

  // 词库
  ipcMain.handle('wordlib:ensure', async () => { await wordlib.ensure(); return wordlib.getStats(); });
  ipcMain.handle('wordlib:tree', () => wordlib.getTree());
  ipcMain.handle('wordlib:searchTags', (_e, opts) => wordlib.searchTags(opts || {}));
  ipcMain.handle('wordlib:searchArtists', (_e, opts) => wordlib.searchArtists(opts || {}));
  ipcMain.handle('wordlib:searchWorks', (_e, opts) => wordlib.searchWorks(opts || {}));
  ipcMain.handle('wordlib:tagsOfWork', (_e, id, opts) => wordlib.tagsOfWork(id, opts));
  ipcMain.handle('wordlib:slotsOfTags', (_e, ens) => wordlib.slotsOfTags(ens));
  ipcMain.handle('wordlib:meta', () => ({ safeties: wordlib.SAFETIES, sources: wordlib.SOURCES, sourceLabels: wordlib.SOURCE_LABELS }));
  ipcMain.handle('wordlib:update', async (_e, opts) => {
    await wordlib.ensure();
    return wordlib.updateTagLib({
      mode: (opts && opts.mode) || 'fast',
      onProgress: (p) => { if (win && !win.isDestroyed()) win.webContents.send('wordlib:update-progress', p); },
    });
  });
  ipcMain.handle('wordlib:updateStatus', async () => {
    if (wordlib.isUpdating) return wordlib.updateStatus();   // 词库更新中:isUpdating 锁已保证连接可用
    try { await wordlib.ensure(); } catch {}
    return wordlib.updateStatus();
  });

  // 通用
  ipcMain.handle('app:clipboardWrite', (_e, text) => clipboard.writeText(String(text ?? '')));
  ipcMain.handle('app:dataDir', () => app.getPath('userData'));
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:openPath', (_e, p) => shellOpen(String(p || '')));
}

// ---------- 冒烟测试:验证 DB/词库可用后退出 ----------
async function runSmoke() {
  const results = [];
  try {
    db.open();
    const e = db.createEntry({ title: '冒烟测试', positive: '1girl, long hair, smile', negative: 'bad hands, blurry' });
    results.push(`entries.create ok id=${e.id} tags=${JSON.stringify(e.tags)}`);
    const idx = db.tagIndex();
    results.push(`tagIndex top=${idx[0] && idx[0].tag} (${idx.length} tags)`);
    results.push(`tagFilter(long_hair)=${db.listEntries({ tag: 'long hair' }).length}`);
    db.deleteEntry(e.id);
    results.push('entries.delete ok');

    const wl = await wordlib.ensure();
    results.push('wordlib.ensure ok');
    const stats = wordlib.getStats();
    results.push(`stats tags=${stats.tagCount} artists=${stats.artistCount} works=${stats.workCount}`);
    const tree = wordlib.getTree();
    const l1 = tree.filter((n) => !n.parentId);
    results.push(`tree nodes=${tree.length} l1=${l1.length} [${l1.slice(0, 4).map((n) => n.label).join('/')}...]`);
    const tags = wordlib.searchTags({ q: 'hair', sort: 'popular', limit: 3 });
    results.push(`searchTags(q=hair) -> ${tags.map((t) => t.en).join(', ')}`);
    const arts = wordlib.searchArtists({ q: 'mak', limit: 2 });
    results.push(`searchArtists(q=mak) -> ${arts.map((a) => a.en).join(', ')}`);
    const works = wordlib.searchWorks({ q: 'compass', limit: 2 });
    results.push(`searchWorks(q=compass) -> ${works.map((w) => w.zh || w.id).join(', ')}`);

    // 词库更新管线(离线:注入 fake fetcher + 临时库副本,绝不触网)
    const { DatabaseSync } = require('node:sqlite');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aitag-wl-'));
    try {
      const tmpDb = path.join(tmpDir, 'wl.sqlite');
      fs.copyFileSync(wordlib.path, tmpDb);   // ensure() 已跑过,拷贝一份作测试库
      // 预置一条旧格式存量记录(category=4 挂在未分类),验证更新时自动归位到作品角色
      const preDb = new DatabaseSync(tmpDb);
      preDb.prepare(`INSERT INTO tag(tag_id, zh, en_display, zh_aliases_json, en_aliases_json, search_text, source, safety, post_count, main_count, nsfw_count, category, status, work_id, node_id)
        VALUES('legacy_char','','legacy_char','[]','[]','legacy_char','b','unknown',5,5,0,4,'classified','','online-import')`).run();
      preDb.close();
      const pages = [
        [
          { id: 1, name: 'smoke_new_tag_a', post_count: 42, category: 0, words: ['alias_a'], is_deprecated: false },
          { id: 2, name: 'smoke_new_char', post_count: 7, category: 4, words: [], is_deprecated: false },
          { id: 4, name: 'smoke_new_artist', post_count: 11, category: 1, words: [], is_deprecated: false },
        ],
        [
          { id: 3, name: 'long_hair', post_count: 999999, category: 0, words: [], is_deprecated: false },
        ],
      ];
      let call = 0;
      const fakeFetch = async () => pages[Math.min(call++, pages.length - 1)];
      const u1 = await wordlib.updateTagLib({ mode: 'fast', dbPath: tmpDb, fetcher: fakeFetch, pageDelayMs: 1 });
      const u2 = await wordlib.updateTagLib({ mode: 'fast', dbPath: tmpDb, fetcher: fakeFetch, pageDelayMs: 1 });
      results.push(`update r1 new=${u1.newTags} upd=${u1.updatedTags} r2(幂等) new=${u2.newTags} upd=${u2.updatedTags}`);
      const tdb = new DatabaseSync(tmpDb, { readOnly: true });
      const tNew = tdb.prepare("SELECT * FROM tag WHERE tag_id='smoke_new_tag_a'").get();
      const tChar = tdb.prepare("SELECT * FROM tag WHERE tag_id='smoke_new_char'").get();
      const tCharNode = tdb.prepare("SELECT label FROM taxonomy_node WHERE id = ?").get(tChar.node_id);
      const tArtist = tdb.prepare("SELECT * FROM artist WHERE tag_id='smoke_new_artist'").get();
      const tArtistInTag = tdb.prepare("SELECT COUNT(*) c FROM tag WHERE tag_id='smoke_new_artist'").get().c;
      const tLegacyNode = tdb.prepare("SELECT label FROM taxonomy_node WHERE id = ?").get(tdb.prepare("SELECT node_id FROM tag WHERE tag_id='legacy_char'").get().node_id);
      const tHot = tdb.prepare('SELECT post_count, zh FROM tag WHERE tag_id = ?').get('long_hair');
      const tNode = tdb.prepare("SELECT label, depth FROM taxonomy_node WHERE id='online-import'").get();
      const tMeta = tdb.prepare("SELECT value FROM meta WHERE key='aitag:update_stats'").get();
      tdb.close();
      results.push(`update newTag source=${tNew.source} node=${tNew.node_id} charNode=${tCharNode.label} artistInArtist=${!!tArtist} artistNotInTag=${tArtistInTag === 0} legacy=${tLegacyNode.label} hot=${tHot.post_count} zh-preserved=${tHot.zh} node=${tNode.label}/${tNode.depth} meta=${!!tMeta}`);
      const con = await Promise.allSettled([
        wordlib.updateTagLib({ mode: 'fast', dbPath: tmpDb, fetcher: fakeFetch, pageDelayMs: 1 }),
        wordlib.updateTagLib({ mode: 'fast', dbPath: tmpDb, fetcher: fakeFetch, pageDelayMs: 1 }),
      ]);
      results.push(`update 并发拒绝:${con[0].status === 'fulfilled' && con[1].status === 'rejected' ? 'ok' : 'FAIL'}`);
      const after = wordlib.searchTags({ q: 'long_hair', limit: 1 });
      results.push(`update 后只读恢复 searchTags=${after.length === 1 ? 'ok' : 'FAIL'}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const p = db.savePreset({ type: 'character', name: '测试预设', positive: 'silver hair, sailor suit' });
    results.push(`presets.save ok id=${p.id} v${p.version}`);
    db.savePreset({ id: p.id, positive: 'silver hair, sailor suit, blue eyes', overwrite: true });
    const h = db.presetHistory(p.id);
    results.push(`presets.overwrite history=${h.length} versions`);
    db.deletePreset(p.id);
    results.push('presets.delete ok');
  } catch (err) {
    console.error('[smoke] FAILED:', err);
    process.exit(1);
  }
  console.log('[smoke] ' + results.join('\n[smoke] '));
  app.exit(0);
}

// ---------- 真实网络词库更新(可选:--update-real,需网络) ----------
async function runUpdateReal() {
  try {
    await wordlib.ensure();
    const mode = process.argv.includes('--full') ? 'full' : 'fast';
    const res = await wordlib.updateTagLib({ mode });
    console.log('[update-real]', JSON.stringify(res));
    console.log('[update-real] 词库统计:', JSON.stringify(wordlib.getStats()));
    app.exit(0);
  } catch (e) {
    console.error('[update-real] FAILED:', e);
    process.exit(1);
  }
}

// ---------- UI 测试:加载渲染层并检查 JS 报错 ----------
async function runUiTest() {
  registerImageProtocol();
  db.open();
  registerIpc();
  buildMenu();
  const testWin = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const errors = [];
  testWin.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push(message); // error 级别
  });
  testWin.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`did-fail-load ${code} ${desc}`));
  const started = Date.now();
  await testWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // 等待渲染层完成初始加载与词库初始化
  await new Promise((r) => setTimeout(r, 6000));
  const rendererCheck = await testWin.webContents.executeJavaScript(`(async () => {
    const api = window.api;
    // 1. 创建条目并检查小 tag 筛选 chips
    const e = await api.entriesCreate({ title: 'UI测试条目', positive: '1girl, long hair, smile', negative: 'blurry, lowres' });
    await api.entriesUpdate(e.id, { pinned: true });
    await new Promise(r => setTimeout(r, 400));
    const chips = [...document.querySelectorAll('#tag-chips .chip')].map(c => c.dataset.tag);
    // 2. 用词库 API 搜索
    const wl = await api.wordlibSearchTags({ q: 'smile', sort: 'popular', limit: 5 });
    const arts = await api.wordlibSearchArtists({ q: 'mizuki', limit: 3 });
    // 3. 视图切换
    document.querySelector('.nav-item[data-view="wordlib"]').click();
    await new Promise(r => setTimeout(r, 500));
    const wlVisible = !document.getElementById('view-wordlib').classList.contains('active')
      ? 'FAIL' : document.getElementById('view-wordlib').classList.contains('active') ? 'ok' : 'FAIL';
    // 3b. 作品筛选显隐(仅「全部」/「作品角色」显示)+ 画师模式点选进入画师槽
    const wlFixes = await (async () => {
      const works = document.getElementById('wl-works');
      const clickType = async (type) => {
        document.querySelector('#wl-l1 [data-type="' + type + '"]').click();
        await new Promise((r) => setTimeout(r, 400));
      };
      await clickType('all');
      const allShown = !works.hidden;
      await clickType('character');
      const characterShown = !works.hidden;
      await clickType('scene');
      const sceneHidden = works.hidden;
      await clickType('artist');
      const artistHidden = works.hidden;
      const input = document.getElementById('wl-search-input');
      input.value = 'mizuki';
      input.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 1000));
      const row = document.querySelector('#wl-results .result-row');
      if (row) row.click();
      await new Promise((r) => setTimeout(r, 400));
      const artistSlotPicks = document.querySelectorAll('#slot-list [data-slot="artist"] .picked').length;
      const otherSlotPicks = document.querySelectorAll('#slot-list [data-slot="other"] .picked').length;
      document.getElementById('wl-search-clear').click();
      document.getElementById('composer-clear').click();
      await clickType('all');
      // 作品分页:选中最热作品,验证 total / 加载更多 / 追加
      const topWorks = await api.wordlibSearchWorks({ limit: 5 });
      const topWork = topWorks[0];
      const res1 = await api.wordlibTagsOfWork(topWork.id, { limit: 100, offset: 0 });
      const contractOk = typeof res1.total === 'number' && Array.isArray(res1.rows)
        && res1.rows.length === Math.min(100, res1.total);
      const workChip = [...document.querySelectorAll('#wl-work-chips [data-work]')]
        .find((c) => c.dataset.work === topWork.id);
      workChip.click();
      await new Promise((r) => setTimeout(r, 600));
      const moreBtn = document.getElementById('wl-more');
      const moreShown = !moreBtn.hidden;
      const summary = document.getElementById('wl-results-summary').textContent;
      const expectedMore = res1.total > 100;
      const totalStr = res1.total.toLocaleString();
      const uiOk = moreShown === expectedMore && summary.includes('共 ' + totalStr + ' 条');
      let pagedRows = null;
      if (expectedMore) {
        moreBtn.click();
        await new Promise((r) => setTimeout(r, 600));
        pagedRows = document.querySelectorAll('#wl-results .result-row').length;
      }
      const workPagingOk = contractOk && uiOk && (!expectedMore || pagedRows > 100);
      document.getElementById('wl-reset').click();
      await new Promise((r) => setTimeout(r, 400));
      const ok = allShown && characterShown && sceneHidden && artistHidden && artistSlotPicks >= 1 && otherSlotPicks === 0 && workPagingOk;
      return {
        ok: ok ? 'ok' : 'FAIL', allShown, characterShown, sceneHidden, artistHidden, artistSlotPicks, otherSlotPicks,
        workPaging: { ok: workPagingOk ? 'ok' : 'FAIL', work: topWork.zh || topWork.id, total: res1.total, moreShown, expectedMore, pagedRows, summary },
      };
    })();
    // 4. 设置页:词库更新卡片存在 + 更新状态可查询
    document.querySelector('.nav-item[data-view="settings"]').click();
    await new Promise(r => setTimeout(r, 400));
    const upCard = !!document.getElementById('wl-update-card');
    const upBtn = !!document.getElementById('btn-wl-update');
    const upModes = document.querySelectorAll('#wl-update-mode option').length;
    const upStatus = await api.wordlibUpdateStatus();
    document.querySelector('.nav-item[data-view="entries"]').click();
    // 5. 清理
    await api.entriesDelete(e.id);
    return {
      chips,
      tagSearch: wl.slice(0, 3).map(t => t.en),
      artists: arts.map(a => a.en),
      wlVisible,
      wlFixes,
      settingsUpdate: upCard && upBtn && upModes === 2 && typeof upStatus.updating === 'boolean' ? 'ok' : 'FAIL',
    };
  })()`).catch((e) => {
    errors.push('executeJavaScript 异常: ' + (e && e.stack || e));
    return null;
  });
  if (rendererCheck && rendererCheck.wlFixes && rendererCheck.wlFixes.ok !== 'ok') {
    errors.push('wlFixes FAIL:' + JSON.stringify(rendererCheck.wlFixes));
  }
  console.log('[uitest] renderer:', JSON.stringify(rendererCheck));
  console.log(`[uitest] elapsed ${Date.now() - started}ms`);
  if (errors.length) {
    console.log('[uitest] console errors:\n' + errors.join('\n'));
    app.exit(1);
  } else {
    console.log('[uitest] OK 无 JS 错误');
    app.exit(0);
  }
}

// ---------- 截图:输出界面截图到 build/shots/(用于布局调试) ----------
async function runShot() {
  registerImageProtocol();
  db.open();
  registerIpc();
  const shotWin = new BrowserWindow({
    width: 1360, height: 860, show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  const outDir = path.join(app.getAppPath(), 'build', 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  const errors = [];
  shotWin.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push(message);
  });
  await shotWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 5000));
  const shot = async (name) => {
    await new Promise((r) => setTimeout(r, 600));
    let img = await shotWin.webContents.capturePage();
    for (let i = 0; img.isEmpty() && i < 5; i++) {
      await new Promise((r) => setTimeout(r, 400));
      img = await shotWin.webContents.capturePage();
    }
    fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
    console.log('[shot]', name, 'ok');
  };
  const flow = await shotWin.webContents.executeJavaScript(`(async () => {
    const api = window.api;
    const ids = [];
    for (let i = 1; i <= 6; i++) {
      const e = await api.entriesCreate({
        title: i === 1 ? '银发水手服少女' : '示例条目 ' + i,
        positive: '1girl, silver hair, long hair, sailor suit, smile, blush, looking at viewer, masterpiece',
        negative: 'bad anatomy, lowres, blurry, watermark',
      });
      ids.push(e.id);
    }
    window.__shotIds = ids;
    return 'seeded';
  })()`);
  // 空提示显隐检查:有数据时 entries-empty 必须真正隐藏(此前 .empty-hint{display:flex} 覆盖了 hidden 属性)
  const emptyHintCheck = await shotWin.webContents.executeJavaScript(`(() => {
    const el = document.getElementById('entries-empty');
    return {
      attrHidden: el.hidden,
      display: getComputedStyle(el).display,
      gridCards: document.querySelectorAll('#entries-grid .entry-card').length,
    };
  })()`);
  console.log('[shot] empty-hint:', JSON.stringify(emptyHintCheck));
  // 快速记录卡溢出检查:窄窗口(1000)与默认窗口(1360)各测一次
  const quickCheckJs = `(() => {
    const card = document.querySelector('.quick-card');
    const cr = card.getBoundingClientRect();
    const inputs = [...card.querySelectorAll('input')].map((i) => {
      const r = i.getBoundingClientRect();
      return { left: Math.round(r.left - cr.left), right: Math.round(r.right - cr.right), w: Math.round(r.width) };
    });
    return {
      cardW: Math.round(cr.width),
      inputs,
      overflow: inputs.some((i) => i.left < -1 || i.right > cr.width + 1),
    };
  })()`;
  shotWin.setSize(1000, 760);
  await new Promise((r) => setTimeout(r, 500));
  const quickNarrow = await shotWin.webContents.executeJavaScript(quickCheckJs);
  console.log('[shot] quick-card-overflow@1000:', JSON.stringify(quickNarrow));
  await shot('entries');
  shotWin.setSize(1360, 860);
  await new Promise((r) => setTimeout(r, 500));
  const quickWide = await shotWin.webContents.executeJavaScript(quickCheckJs);
  console.log('[shot] quick-card-overflow@1360:', JSON.stringify(quickWide));
  const editCheck = await shotWin.webContents.executeJavaScript(`(async () => {
    document.getElementById('btn-new-entry').click();
    await new Promise(r => setTimeout(r, 500));
    const el = document.getElementById('entry-positive');
    el.value = '1girl, silver hair, sailor suit, smile';
    el.dispatchEvent(new Event('input'));
    document.getElementById('entry-negative').value = 'bad anatomy, lowres';
    document.getElementById('entry-negative').dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 400));
    const dlg = document.getElementById('entry-dialog');
    const rect = dlg.getBoundingClientRect();
    const cx = Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2);
    const cy = Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2);
    // 新建模式下「删除」按钮必须真正隐藏(此前 .gbtn{display:inline-flex} 覆盖了 hidden 属性)
    const delBtn = document.getElementById('entry-delete-btn');
    const r = { open: dlg.open, w: Math.round(rect.width), h: Math.round(rect.height), centered: cx < 4 && cy < 4, deleteBtnDisplay: getComputedStyle(delBtn).display };
    document.getElementById('entry-dialog').close();
    return r;
  })()`);
  console.log('[shot] entry-dialog:', JSON.stringify(editCheck));
  await shot('entry-dialog');
  await shotWin.webContents.executeJavaScript(`(async () => {
    document.querySelector('.nav-item[data-view="wordlib"]').click();
    await new Promise(r => setTimeout(r, 2500));
    const s = document.getElementById('wl-search-input');
    s.value = 'hair';
    s.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 1200));
    return 'wordlib-searched';
  })()`);
  await shot('wordlib-search');
  // 选中一级分类 + 点选结果入槽 + 双语导出(验证原版槽位卡/三级子分类/双语栏)
  const composerCheck = await shotWin.webContents.executeJavaScript(`(async () => {
    document.getElementById('wl-search-clear').click();
    document.getElementById('wl-reset').click();
    await new Promise(r => setTimeout(r, 600));
    // 1. 选中「外貌-身体」一级分类,应出现子分类/子类/细类三级行
    const l1btns = [...document.querySelectorAll('#wl-l1 .chip')];
    const look = l1btns.find(b => b.textContent.includes('外貌'));
    look.click();
    await new Promise(r => setTimeout(r, 900));
    const rows = [...document.querySelectorAll('#wl-subtree .sub-tree-row')].map(r => r.querySelector('.sub-tree-label').textContent);
    // 2. 点选第一个结果 -> 自动入槽
    const first = document.querySelector('#wl-results .result-row');
    if (first) first.click();
    await new Promise(r => setTimeout(r, 500));
    const slots = [...document.querySelectorAll('#slot-list .slot-card')].map(c => c.dataset.slot + ':' + c.querySelector('.slot-count').textContent);
    // 3. 中英对照模式
    document.querySelector('.export-head .chip2[data-mode="bilingual"]').click();
    await new Promise(r => setTimeout(r, 400));
    const panesVisible = !document.getElementById('bilingual-panes').hidden;
    document.querySelector('.export-head .chip2[data-mode="en"]').click();
    return { subtreeRows: rows, slots, panesVisible, picked: document.querySelectorAll('.picked').length };
  })()`);
  console.log('[shot] composer-check:', JSON.stringify(composerCheck));
  await shot('wordlib-slot');
  // 3. 清空组合 -> 应清空选中并恢复空槽提示
  const clearCheck = await shotWin.webContents.executeJavaScript(`(async () => {
    document.getElementById('composer-clear').click();
    await new Promise(r => setTimeout(r, 400));
    return {
      count: document.getElementById('composer-count').textContent,
      picked: document.querySelectorAll('.picked').length,
      emptyState: document.querySelector('.slot-empty-state') ? 'yes' : 'no',
    };
  })()`);
  console.log('[shot] composer-clear:', JSON.stringify(clearCheck));
  // 4. 设置页:数据目录显示
  const settingsCheck = await shotWin.webContents.executeJavaScript(`(async () => {
    document.querySelector('.nav-item[data-view="settings"]').click();
    await new Promise(r => setTimeout(r, 400));
    const dir = document.getElementById('set-data-dir').textContent;
    const db = document.getElementById('set-db-path').textContent;
    const visible = document.getElementById('view-settings').classList.contains('active');
    return {
      visible,
      hasDir: dir.length > 5,
      hasDb: db.endsWith('aitagrecorder.db'),
      hasUpdateCard: !!document.getElementById('wl-update-card'),
      updateModes: document.querySelectorAll('#wl-update-mode option').length,
    };
  })()`);
  console.log('[shot] settings-check:', JSON.stringify(settingsCheck));
  await shot('settings');
  await shotWin.webContents.executeJavaScript(`(async () => {
    document.querySelector('.nav-item[data-view="wordlib"]').click();
    await new Promise(r => setTimeout(r, 300));
    return 'back-to-wordlib';
  })()`);
  const presetCheck = await shotWin.webContents.executeJavaScript(`(async () => {
    document.getElementById('wl-search-clear').click();
    document.getElementById('wl-reset').click();
    await new Promise(r => setTimeout(r, 600));
    document.getElementById('btn-presets').click();
    await new Promise(r => setTimeout(r, 1200));
    return {
      dialogOpen: document.getElementById('preset-dialog').open,
      types: document.querySelectorAll('#preset-types .chip').length,
      list: document.getElementById('preset-list').children.length,
    };
  })()`);
  console.log('[shot] preset-check:', JSON.stringify(presetCheck));
  await shot('presets');
  await shotWin.webContents.executeJavaScript(`(async () => {
    document.getElementById('preset-dialog-close').click();
    const ids = window.__shotIds || [];
    for (const id of ids) await api.entriesDelete(id);
    return 'cleaned';
  })()`);
  if (errors.length) console.log('[shot] console errors:\n' + errors.join('\n'));
  console.log('[shot] done ->', outDir);
  app.exit(0);
}

// ---------- 启动 ----------
app.commandLine.appendSwitch('js-flags', '--disable-warnings-as-errors');
process.on('uncaughtException', (e) => console.error('[main] uncaught:', e));

app.whenReady().then(async () => {
  if (process.argv.includes('--smoke')) return runSmoke();
  if (process.argv.includes('--ui-test')) return runUiTest();
  if (process.argv.includes('--shot')) return runShot();
  if (process.argv.includes('--update-real')) return runUpdateReal();
  registerImageProtocol();
  db.open();
  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => db.close());
