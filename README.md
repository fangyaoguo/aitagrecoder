# AI 标签记录器 (aitagrecorder)

AI 绘画 Tag 记录器：**条目化**记录正向 / 负向提示词，集成 **TagToolbox 词库工具箱**（分类词库浏览、组合导出、提示词预设管理），Google 风格界面，SQLite 本地存储。

## 功能

1. **条目记录** — 每条记录 = 标题 + 正面 tags + 负面 tags（一条记录正负一体）；快速记录卡支持标题 + 正/负 tags 回车即存
2. **小 tag 筛选** — 条目内 tag 按逗号拆分为小 tag，点击小 tag 即可筛选；支持 正面/负面/任意 范围与全文搜索
3. **词库工具箱**（集成自 `D:\downloads\TagToolbox-1.0.0`，页面按原版结构）— 15 个一级分类 × 5 级分类树（152,715 标签）、三级子分类筛选行（子分类/子类/细类）、中英/别名搜索（合并画师结果）、来源与安全筛选、热度排序、作品筛选、画师库（147,971 画师）、组合区（15 个 L1 槽位卡 + 画师槽 + 负面槽，自动按 L1 入槽、可折叠、可拖拽移动、可显示空槽）、导出（英文串/中文串/中英对照/负向串/画师串）一键复制、**保存为新条目**直通记录
4. **提示词预设管理** — 角色/场景/服装/动作/表情 五类，另存/覆盖升版/载入到组合/删除，配图（最多 48 张）与版本历史
5. **设置页** — 应用内查看数据存储位置（数据目录/条目数据库/词库数据库/配图目录），一键打开对应文件夹
6. **Google 风格** — Material 设计语言：白色卡片、圆角、胶囊 chips、分段选择、Snackbar
7. **SQLite 管理数据** — 应用数据（条目/筛选索引/预设）与词库数据均用 SQLite；首次运行自动从打包资源导入词库

## 一键脚本

**单个 `run.bat` 全部搞定**（双击进入菜单，或带参数直接执行）：

| 命令 | 作用 |
|---|---|
| `run.bat dev` | 开发测试：自动装依赖 → 启动 vite 热更新 → 启动 Electron（含开发者工具） |
| `run.bat build` | 生成：vite 编译渲染层 + 拷贝主进程/preload 到 `dist/` + 生成图标 |
| `run.bat package` | 打包：build + electron-builder 产出便携版 exe 到 `release/` |
| `run.bat install` | 仅安装依赖 |
| `run.bat smoke` | 数据层冒烟测试 |

等价 npm 命令：`npm run dev` / `npm run build` / `npm run package`。

## 冒烟测试

```
cmd //c "set ELECTRON_RUN_AS_NODE=&& node_modules\.bin\electron.cmd . --smoke"   # 数据层验证
cmd //c "set ELECTRON_RUN_AS_NODE=&& node_modules\.bin\electron.cmd . --ui-test" # 渲染层+功能流验证
```

## 技术栈

- **Electron**（内置 Node 22.18，使用 `node:sqlite`，零原生编译依赖）
- **Vite** — 渲染进程构建（原生 ES Module，无前端框架）
- **electron-builder** — 便携版（单文件免安装）

## 数据位置

| 数据 | 位置 |
|---|---|
| 应用数据库（条目/预设） | `%APPDATA%\aitagrecorder\aitagrecorder.db` |
| 词库数据库（分类/标签/画师/作品） | `%APPDATA%\aitagrecorder\wordlib\classification_editor.sqlite`（首次运行自 `resources/wordlib` 拷贝并导入画师/作品） |
| 预设配图 | `%APPDATA%\aitagrecorder\preset-images\` |

应用菜单「文件 → 打开数据目录」可直达。

## 词库数据来源

词库源自 `D:\downloads\TagToolbox-1.0.0`（分类编辑器 source DB r184 + 画师/作品分片），已内置于 `resources/wordlib/`（约 58 MB），应用离线自包含。

## 开发说明

- 主进程：`src/main/`（`main.js` 窗口与 IPC、`db.js` 应用数据层、`wordlib.js` 词库数据层）
- preload：`src/preload/preload.js`（contextBridge 暴露 `window.api`）
- 渲染层：`src/renderer/`（`js/entries.js` 条目视图、`js/wordlib.js` 词库视图、`js/presets.js` 预设对话框）
- 数据库表：`entries` / `entry_tags`（小 tag 筛选索引）/ `presets` / `preset_versions`
