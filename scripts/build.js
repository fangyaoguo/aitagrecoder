'use strict';
// 一键生成:编译渲染进程(vite) + 拷贝主进程/preload 到 dist/electron + 生成图标
// 用法:node scripts/build.js 或 npm run build 或 scripts/build.cmd

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ok = (m) => console.log('[build]', m);
const fail = (m) => { console.error('[build] FAILED:', m); process.exit(1); };

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`${cmd} 退出码 ${r.status}`);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 0. 图标
if (!fs.existsSync(path.join(ROOT, 'build', 'icon.png'))) {
  ok('生成图标…');
  sh('node', ['scripts/make-icon.js']);
}

// 1. 渲染进程
ok('编译渲染进程(vite)…');
sh(process.platform === 'win32' ? 'node_modules\\.bin\\vite.cmd' : 'node_modules/.bin/vite', ['build', '--config', 'vite.config.mjs']);

// 2. 主进程 + preload
ok('拷贝主进程与 preload…');
copyDir(path.join(ROOT, 'src', 'main'), path.join(ROOT, 'dist', 'electron'));
copyDir(path.join(ROOT, 'src', 'preload'), path.join(ROOT, 'dist', 'electron', 'preload'));

ok('构建完成:dist/renderer + dist/electron');
