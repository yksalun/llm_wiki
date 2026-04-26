# UI 中文化与深色主题 Design Spec

## 1. 背景

当前 Web 工作台已经完成项目列表、项目工作台、文件浏览、编辑、搜索、问答、Insights 和 runtime 诊断等核心能力，但浏览器可见 UI 仍大量使用英文文案。同时，代码里已经存在 Tailwind dark variant 和 `.dark` 变量块，但页面主体、卡片、边框、提示和输入区域仍大量依赖 `bg-white/*`、`border-black/*`、浅色渐变与 `color-scheme: light`，所以仅给根节点添加 `.dark` 并不能得到可用的深色体验。

本次目标是把当前项目的 UI 层面显示成中文，不在浏览器可见界面出现英文文案，并加入可切换的深色主题。用户已确认范围：只处理浏览器可见 UI 文案；不重命名内部 TypeScript 类型、API 字段、枚举值、测试名称、路由路径、文件路径或数据契约。

## 2. 自动采用的推荐答案

- 中文化范围：只覆盖浏览器可见 UI，包括标题、说明、按钮、标签、空态、错误态、加载态、placeholder、aria-label、tab 显示名、状态值显示名和日期格式。
- 内部契约：保留 `WorkbenchSection`、`ProjectStatus`、`ProjectAccessMode`、`FileViewMode`、`HeavyTaskName` 等英文枚举值，只通过显示映射输出中文。
- 项目数据：项目名、项目 ID、文件名、相对路径、用户文件内容、搜索结果预览、问答回答、Insights 返回的业务内容不强行翻译。
- 错误消息：常见客户端兜底错误文案改为中文；服务端原始错误 message 若直接展示，使用中文标题和上下文承载，不改 API 错误结构。
- 主题策略：加入浅色 / 深色手动切换，并持久化到 `localStorage`。默认先使用本地保存值；无保存值时可回落到系统偏好。
- 视觉方向：浅色保留当前纸质工作台气质；深色采用低眩光的墨色工作台，不引入大面积紫蓝渐变或装饰性光斑。

## 3. 目标

- 根布局语言改为 `zh-CN`，metadata 改为中文。
- 所有项目列表页与项目工作台页的浏览器可见英文文案改为中文。
- 所有内部英文枚举值、状态值、权限值和任务名在 UI 层有中文显示映射。
- 添加可访问的主题切换按钮，用户可以在浅色和深色之间切换。
- 主题选择跨刷新保留，并在首屏尽量避免明显闪烁。
- 补齐深色主题语义变量，使页面背景、卡片、边框、提示、输入框、骨架屏、按钮周边和阅读/编辑区域在深色下可读。
- 更新组件测试，使关键 UI 文案断言改为中文，并新增主题切换的基础测试。

## 4. 非目标

本次明确不做：

- 国际化框架、多语言切换、翻译文件加载或 locale 路由。
- 翻译用户项目内容、Markdown 文件内容、文件路径、文件名、项目名、模型回答或搜索结果摘录。
- 重命名 API 字段、后端错误码、数据库字段、路由路径、内部 enum literal 或 store 状态。
- 改动搜索、问答、Insights、文件保存或权限行为。
- 引入第三方主题库。
- 做自动保存、协作、多用户权限或新的产品功能。

## 5. 方案比较

### 方案 A：直接替换组件里的所有字符串

优点是最快，改动直观。缺点是会把状态值、模式值、任务名等显示逻辑散落在组件里，后续新增 UI 时容易再次显示英文，也容易误改内部契约。

### 方案 B：显示层映射 + 组件文案中文化 + 语义主题变量

优点是边界清楚：内部值保持英文，UI 输出集中映射；主题样式通过语义变量和少量 dark 变体落地，避免每个组件单独硬编码深色。缺点是需要一次性整理多个组件和测试。

### 方案 C：引入完整 i18n 和主题系统

优点是长期扩展性好。缺点是当前只有中文 UI 需求，完整 i18n 会带来过重的目录结构、provider、key 管理和测试改动。

本次采用方案 B。

## 6. 中文显示设计

### 6.1 显示映射

新增显示标签模块，例如：

```text
web/src/lib/display-labels.ts
```

它负责把内部契约值转换成中文显示值：

- `WorkbenchSection`：`Overview` → `概览`，`Ask` → `问答`，`Insights` → `洞察`，`Files` → `文件`，`Purpose` → `目标`，`Schema` → `结构`，`Project Info` → `项目信息`。
- `ProjectStatus`：`ready` → `就绪`，`incomplete` → `不完整`。
- `ProjectAccessMode`：`read-write` → `可读写`，`read-only` → `只读`。
- `FileViewMode`：`editable` → `可编辑`，`preview` → `预览`，`metadata` → `元数据`，`unsupported` → `不支持`。
- `HeavyTaskEngine`：`node` → `内置运行时`。
- `HeavyTaskBridgeStatus`：`not-configured` → `未配置`。
- `HeavyTaskName`：`project-search` → `项目搜索`，`project-insights` → `项目洞察`。

组件只能在显示位置使用这些映射。事件值、tab `value`、API payload、store 状态继续使用原英文值。

### 6.2 页面文案覆盖

需要中文化的主要区域：

- 项目列表页：页眉、侧栏、项目卡片、结构标记、状态徽章、更新时间、加载/错误/空态。
- 工作台页：页眉、tab 显示名、reload/retry、侧栏状态、项目信息诊断。
- 项目概览：行动卡片、结构快照、按钮和缺失提示。
- 文件树：标题、说明、空态。
- 文件面板：打开/加载/错误/空态、阅读/编辑切换、保存/重置、保存状态、冲突提示、文件 facts。
- 文件预览：只读预览、元数据、空文件、不支持预览。
- 搜索面板：输入 placeholder、aria-label、状态、摘要、结果按钮、行号。
- 问答面板：输入 placeholder、aria-label、状态、按钮、错误、来源按钮、行号。
- Insights 面板：标题、加载/错误/空态、摘要指标、分组标题、来源按钮、行号、数量格式。
- 草稿保护：未保存草稿提示、保存并继续、放弃草稿、取消。

日期和时间显示使用 `zh-CN`。数量单位使用中文，例如 `3 个匹配`、`已扫描 12 个文件`。

## 7. 深色主题设计

### 7.1 Provider

新增主题组件：

```text
web/src/components/theme/theme-provider.tsx
web/src/components/theme/theme-toggle.tsx
```

`ThemeProvider` 职责：

- 在客户端维护 `light | dark`。
- 读取并写入 `localStorage`。
- 将 `dark` class 同步到 `document.documentElement`。
- 设置 `data-theme`，方便调试和测试。
- 在无保存值时读取 `prefers-color-scheme` 作为初始偏好。

`ThemeToggle` 职责：

- 使用 lucide `Sun` / `Moon` 图标。
- 显示中文按钮文案，例如当前为浅色时显示 `深色`，当前为深色时显示 `浅色`。
- 提供中文 `aria-label`，例如 `切换为深色主题`。
- 不影响现有 AppShell aside 内容。

### 7.2 样式令牌

`globals.css` 补齐浅色和深色的语义变量：

- `--paper-base`
- `--paper-panel`
- `--paper-elevated`
- `--paper-muted`
- `--paper-accent`
- `--paper-border`
- `--ink-strong`
- `--ink-soft`
- `--shadow-panel`
- `--tone-warning-*`
- `--tone-success-*`

`html` 的 `color-scheme` 根据主题切换。`body` 背景在深色下使用低对比纹理和墨色底，不沿用浅色米纸渐变。

### 7.3 组件样式

把关键组件中的浅色硬编码替换为主题感知样式：

- `bg-white/*` 替换为 `bg-[color:var(--paper-panel)]`、`bg-[color:var(--paper-muted)]` 或 dark variant。
- `border-black/*` 替换为 `border-[color:var(--paper-border)]`。
- `text-amber-*`、`text-emerald-*` 等提示色保留语义，但补 dark 可读性。
- skeleton 使用主题变量，不在深色下显示浅灰块。
- textarea、input、pre、alert 和 file tree hover/active 状态都必须在深色下可读。

## 8. 数据流

主题数据流：

1. `RootLayout` 包裹 `ThemeProvider`。
2. `ThemeProvider` 初始化主题并同步到 `<html>`。
3. `ThemeToggle` 读取主题状态并触发切换。
4. CSS 通过 `.dark` 和语义变量渲染深色样式。

显示文案数据流：

1. 后端和客户端 API 继续返回英文契约值。
2. 组件在显示处调用 `display-labels`。
3. 用户操作仍把英文契约值传给 tab、store、API 或路由。

## 9. 错误处理

- `localStorage` 不可用时，主题仍在当前页面内可切换；读写异常被忽略，不阻断渲染。
- 系统偏好读取不可用时默认浅色。
- API 返回英文错误消息时，中文标题说明当前动作失败，原始 message 放在详情区域。
- 未知内部状态值如果未来出现，显示函数回退到原值，避免 UI 崩溃；当前已知值必须全部有中文映射。

## 10. 测试要求

- `display-labels` 覆盖所有当前状态、section、模式、权限和任务名。
- `ThemeProvider` / `ThemeToggle` 覆盖：
  - 默认渲染。
  - 点击后切换 `.dark`。
  - 按钮中文文案和 aria-label 更新。
- 现有组件测试更新为中文断言：
  - 文件面板阅读/编辑切换。
  - 草稿保护。
  - 工作台权限与 Project Info。
  - 搜索、问答、Insights、文件预览、项目概览。
- 运行 `npm run test`、`npm run typecheck`、`npm run lint`。
- 前端变更完成后启动本地 dev server，用浏览器检查浅色和深色两种主题的主要页面不出现明显英文 UI 文案和不可读区域。

## 11. 验收标准

- 浏览器可见 UI 文案已中文化；不包含由应用自身硬编码输出的英文标签、按钮、状态、标题、placeholder 或空态。
- 项目数据、文件路径、文件内容、API 字段和内部枚举不被翻译或重命名。
- 用户可以在浅色和深色主题之间切换。
- 刷新后主题选择保留。
- 深色主题下项目列表、工作台、文件树、文件面板、搜索、问答、Insights、Project Info、输入框和提示信息均可读。
- 关键组件测试、类型检查和 lint 通过。
