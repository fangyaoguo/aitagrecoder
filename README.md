# AI 标签记录器 (aitagrecorder)

AI 绘画提示词（Tag）记录与管理工具：以条目为单位记录正向 / 负向提示词，内置 TagToolbox 词库（分类浏览、组合导出、预设管理），采用 Google Material 风格界面，数据以 SQLite 本地存储。

## 功能

1. **条目记录** — 每条记录包含标题、正向 tags 与负向 tags；快速记录卡支持标题及正 / 负 tags 输入，回车即存
2. **小 tag 筛选** — 条目内 tag 按逗号拆分并以小 tag 形式展示，点击即筛选；支持 正面 / 负面 / 任意 三种范围及全文搜索
3. **词库工具箱**（界面沿用 TagToolbox 原版布局）— 15 个一级分类、五级分类树（共 152,715 条标签）、三级子分类筛选（子分类 / 子类 / 细类）、中英及别名搜索（合并画师结果）、来源与安全筛选、热度排序、作品筛选、画师库（147,971 位画师）、组合区（15 个一级槽位卡 + 画师槽 + 负面槽，按一级分类自动入槽、支持折叠、拖拽调整及空槽显示）、导出（英文串 / 中文串 / 中英对照 / 负向串 / 画师串）一键复制，并支持保存为新条目
4. **提示词预设管理** — 角色 / 场景 / 服装 / 动作 / 表情 五类预设，支持另存、覆盖升版、载入到组合与删除，可附配图（最多 48 张）并保留版本历史
5. **设置页** — 在应用内查看数据存储位置（数据目录 / 条目数据库 / 词库数据库 / 配图目录），并可一键打开对应文件夹；内置**词库更新**功能，从 Danbooru 同步新标签与热度计数（快速 / 完整两档，实时进度）
6. **Google 风格界面** — Material 设计语言：白色卡片、圆角、胶囊 chips、分段选择、Snackbar 提示
7. **SQLite 数据管理** — 应用数据（条目 / 筛选索引 / 预设）与词库数据均以 SQLite 存储；首次运行自动从打包资源导入词库

## 开发与打包脚本

项目提供统一的 `run.bat` 脚本（双击进入交互菜单，或直接带参数调用）：

| 命令 | 说明 |
|---|---|
| `run.bat dev` | 开发模式：自动安装依赖 → 启动 Vite 热更新 → 启动 Electron（含开发者工具） |
| `run.bat build` | 构建：Vite 编译渲染层 + 拷贝主进程 / preload 至 `dist/` |
| `run.bat package` | 打包：构建后以 electron-builder 产出便携版 exe 至 `release/` |
| `run.bat install` | 仅安装依赖 |
| `run.bat smoke` | 数据层冒烟测试 |

等价 npm 命令：`npm run dev` / `npm run build` / `npm run package`。

## 自动打包与发布 (GitHub Actions)

推送 `v*` 标签后，CI 将自动打包便携版并创建 GitHub Release（见 `.github/workflows/release.yml`）：

```
git tag v1.0.2
git push origin v1.0.2
```

如需手动触发（仅打包并上传构建产物，不创建 Release）：仓库 Actions 页面 → Build & Release → Run workflow。

## 更新日志

### v1.0.2 (2026-08-16)

- **词库更新** — 设置页内置词库在线更新：从 Danbooru 同步新标签与热度计数，快速 / 完整两档可选，实时进度与结果统计；新标签自动归入「未分类(在线新增)」
- **作品筛选优化** — 仅在「全部」与「作品角色」分类下显示；选中作品后支持「加载更多」分页（此前按钮消失、且标签数超过 500 被截断），标题显示作品中文名与标签总数
- **画师槽修复** — 画师模式下点选画师结果直接进入「画师」槽（此前误入「未分类」槽）
- **条目页体验** — 筛选 / 搜索无结果时显示「没有符合筛选的条目」提示（此前为空白）；小 tag 筛选 chips 按归一化名称去重，同 tag 不同大小写不再重复出现
- **清理** — 移除图标生成旧代码（scripts/make-icon.js），图标以已提交的 build/icon.png 为准

## 冒烟测试

```
cmd //c "set ELECTRON_RUN_AS_NODE=&& node_modules\.bin\electron.cmd . --smoke"   # 数据层验证
cmd //c "set ELECTRON_RUN_AS_NODE=&& node_modules\.bin\electron.cmd . --ui-test" # 渲染层+功能流验证
```

## 技术栈

- **Electron** — 内置 Node 22，使用 `node:sqlite`，无原生编译依赖
- **Vite** — 渲染进程构建（原生 ES Module，无前端框架）
- **electron-builder** — 便携版打包（单文件免安装）

## 数据位置

| 数据 | 位置 |
|---|---|
| 应用数据库（条目 / 预设） | `%APPDATA%\aitagrecorder\aitagrecorder.db` |
| 词库数据库（分类 / 标签 / 画师 / 作品） | `%APPDATA%\aitagrecorder\wordlib\classification_editor.sqlite`（首次运行自 `resources/wordlib` 拷贝并导入画师 / 作品） |
| 预设配图 | `%APPDATA%\aitagrecorder\preset-images\` |

亦可通过应用菜单「文件 → 打开数据目录」直达。

## 开发说明

- 主进程：`src/main/`（`main.js` 窗口与 IPC、`db.js` 应用数据层、`wordlib.js` 词库数据层）
- preload：`src/preload/preload.js`（通过 contextBridge 暴露 `window.api`）
- 渲染层：`src/renderer/`（`js/entries.js` 条目视图、`js/wordlib.js` 词库视图、`js/presets.js` 预设对话框）
- 数据库表：`entries` / `entry_tags`（小 tag 筛选索引）/ `presets` / `preset_versions`
