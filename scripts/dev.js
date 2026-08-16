'use strict';
// 一键开发测试:启动 vite 渲染进程 + Electron 主进程(HMR 热更新)
// 用法:run.bat dev / npm run dev

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const PORT = 5173;
const URL = `http://localhost:${PORT}`;

const VITE_JS = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const ELECTRON_EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const ok = (msg) => console.log('[dev]', msg);

function waitFor(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(timeoutMs = 60000) {
  // 校验响应内容是否为本应用的页面,避免端口被其它服务占用时误判
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const body = await new Promise((resolve, reject) => {
        const req = http.get(URL, (r) => {
          let data = '';
          r.on('data', (c) => (data += c));
          r.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(1500, () => { req.destroy(); reject(new Error('timeout')); });
      });
      if (body.includes('AI 标签记录器') || body.includes('vite')) return true;
    } catch {}
    await waitFor(300);
  }
  return false;
}

// 干净的 Electron 环境:防止外部 ELECTRON_RUN_AS_NODE 污染导致以 Node 模式运行
function electronEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.npm_config_electron_mirror;
  return env;
}

async function main() {
  // 1. 依赖检查
  if (!fs.existsSync(ELECTRON_EXE) || !fs.existsSync(VITE_JS)) {
    ok('未安装依赖,自动执行 npm install…');
    await new Promise((resolve) => {
      const inst = spawn('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: true });
      inst.on('exit', resolve);
    });
  }

  // 2. 启动 vite(直接走 node,免 .cmd 中介)
  ok('启动 vite 渲染进程…');
  const vite = spawn(process.execPath, [VITE_JS, '--config', 'vite.config.mjs'], { cwd: ROOT, stdio: 'inherit' });
  vite.on('exit', (code) => {
    ok(`vite 已退出(${code})`);
    process.exit(code ?? 0);
  });

  if (!(await waitForServer())) {
    ok('vite 启动超时,请检查 5173 端口占用后重试');
    vite.kill();
    process.exit(1);
  }
  ok(`vite 就绪:${URL}`);

  // 4. 启动 Electron(直接走 exe)
  ok('启动 Electron…');
  const electron = spawn(ELECTRON_EXE, ['.'], { cwd: ROOT, stdio: 'inherit', env: electronEnv() });
  electron.on('exit', (code) => {
    ok(`Electron 已退出(${code})`);
    vite.kill();
    process.exit(code ?? 0);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
