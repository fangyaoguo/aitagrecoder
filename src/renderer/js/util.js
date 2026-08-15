'use strict';
// 通用工具:tag 解析 / 转义 / toast / 时间格式化 / 确认框

export function parseTags(text) {
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

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('snackbar');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000 && now.getDate() === d.getDate()) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (now.getFullYear() === d.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 通用确认框(返回 Promise<boolean>)
export function confirmBox(title, text) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('confirm-dialog');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-text').textContent = text;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener(
      'close',
      () => resolve(dlg.returnValue === 'ok'),
      { once: true }
    );
  });
}

export async function copyText(text) {
  try {
    await window.api.clipboardWrite(text);
    toast('已复制到剪贴板');
  } catch (e) {
    toast('复制失败:' + e.message);
  }
}

// 复制按钮小助手(带钩子,可在复制前改写内容)
export function bindCopy(btn, getText) {
  btn.addEventListener('click', async () => {
    const t = getText();
    if (!t) { toast('没有可复制的内容'); return; }
    await copyText(t);
  });
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
