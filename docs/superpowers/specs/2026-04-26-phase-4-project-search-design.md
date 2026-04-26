# 阶段 4 项目内检索基础 Design Spec

## 1. 背景

阶段 2 已补强编辑可靠性，阶段 3 已补强阅读与预览能力。当前工作台已经能稳定打开项目、阅读 Markdown、预览常见文本文件，并通过概览入口进入 wiki 内容。

阶段 4 的目标不是做聊天、RAG 或复杂搜索平台，而是先把“在当前项目里快速找到相关内容”做成一个可靠、可解释、可测试的基础能力。它应该直接提升用户日常效率，并为后续问答/RAG 提供清晰的检索契约。

## 2. 目标

本阶段交付项目内关键词搜索基础能力：

- 用户能在项目工作台内输入查询词。
- 系统在当前项目范围内搜索可读文本文件。
- 搜索结果以文件路径、行号、匹配片段和文件类型语义展示。
- 点击搜索结果能打开对应文件，并复用现有文件打开与草稿保护逻辑。
- 搜索状态包含加载、无结果、查询过短、错误等可解释反馈。
- 搜索实现保持轻量，不引入持久化索引、向量检索或模型能力。

## 3. 非目标

本阶段明确不包含：

- 对话式问答、RAG、LLM 总结。
- 向量索引、语义搜索、模糊拼写纠错。
- 跨项目搜索。
- 数据库存储搜索索引。
- 后台增量索引任务。
- 搜索结果高亮同步滚动到编辑器具体行。
- 搜索二进制文件、PDF/DOCX/PPTX/XLSX 正文解析。
- 修改阶段 2 的保存、冲突、草稿保护语义。

## 4. 推荐方案

采用“服务端按需轻量检索 + 前端搜索面板”的方案。

每次搜索请求由服务端在已解析的项目根目录内遍历文件树，筛选可读文本文件，按 UTF-8 文本读取并执行大小写不敏感的关键词匹配。返回结果不依赖数据库索引，因此刷新语义简单：每次搜索都尽量反映当前磁盘内容；如果文件刚保存，下一次搜索自然读取最新内容。

这个方案的取舍：

- 优点：实现风险低、结果可解释、不引入新基础设施、不会提前绑定后续 RAG 架构。
- 缺点：超大项目下响应速度不如持久化索引；后续如果进入 RAG，需要再抽象出可复用索引层。
- 当前判断：阶段 4 更需要建立搜索入口、结果契约和交互闭环，而不是提前建设重索引系统。

## 5. 可搜索范围

搜索范围按文件类型和安全边界控制：

- 只搜索当前项目根目录内的文件。
- 必须复用现有路径安全与项目解析逻辑。
- 搜索文本文件：
  - `.md`
  - `.txt`
  - `.json`
  - `.yaml`
  - `.yml`
- 编辑型 Markdown 文件也纳入搜索：
  - `purpose.md`
  - `schema.md`
  - `wiki/**/*.md`
- 元数据类文件只可在结果范围外保留为不可搜索文件，不读取正文：
  - `.pdf`
  - `.docx`
  - `.pptx`
  - `.xlsx`
- 不支持的文件类型不搜索。
- 超过现有文件预览大小限制的文件不搜索。
- UTF-8 解码失败的文件跳过，并计入搜索摘要的 skipped 统计。

## 6. 查询语义

阶段 4 使用简单、可解释的关键词匹配：

- 查询词 trim 后少于 2 个字符时不发起有效搜索，前端显示查询过短状态。
- 搜索大小写不敏感。
- 多词查询按完整查询字符串匹配，不做分词、AND/OR 语义或模糊匹配。
- 每个文件最多返回有限数量的匹配行，避免单个文件刷屏。
- 整体结果也有上限，避免大项目响应过大。
- 匹配结果按下面优先级排序：
  1. 文件路径包含查询词的结果靠前。
  2. 行号更靠前的结果靠前。
  3. 文件路径字母序稳定排序。

## 7. API 设计

新增路由：

```text
GET /api/projects/[projectId]/search?q=<query>
```

成功响应：

```ts
interface ProjectSearchResponse {
  query: string;
  results: ProjectSearchResult[];
  summary: {
    scannedFiles: number;
    skippedFiles: number;
    matchedFiles: number;
    totalMatches: number;
    truncated: boolean;
  };
}

interface ProjectSearchResult {
  relativePath: string;
  lineNumber: number;
  lineText: string;
  preview: string;
  matchStart: number;
  matchEnd: number;
}
```

错误响应沿用现有 `AppError` / API error JSON 格式。

查询过短不作为服务端错误；服务端可以返回空结果和摘要。前端仍应在 2 字符以下避免请求。

## 8. 服务端模块设计

新增 focused search service：

```text
web/src/lib/server/project-search.ts
```

职责：

- 接收项目根目录和查询词。
- 遍历项目文件树。
- 使用共享 `file-view-policy` 判断扩展名是否可搜索。
- 读取 UTF-8 文本。
- 按行匹配并生成结果。
- 统计 scanned/skipped/matched/truncated。

该模块不负责：

- 解析 HTTP 请求。
- 解析 projectId。
- 修改数据库。
- 修改文件。
- 做持久化索引。

新增路由：

```text
web/src/app/api/projects/[projectId]/search/route.ts
```

职责：

- 解析 `q` 参数。
- 通过 `resolveProjectById` 获取项目根目录。
- 调用 `searchProjectFiles`。
- 返回 JSON。
- 将路径、安全和搜索错误转为现有 API error 结构。

## 9. 前端设计

新增搜索面板组件：

```text
web/src/components/workbench/project-search.tsx
```

它放在工作台主 tab 下方、section 内容上方，保持操作型工具的紧凑布局。

组件职责：

- 输入框接收查询词。
- 查询词少于 2 字符时显示提示，不请求 API。
- 查询变化后短延迟触发搜索，减少每次敲键请求。
- 搜索中显示 loading 状态。
- 无结果显示空状态。
- 错误显示可重试的错误状态。
- 显示结果列表：路径、行号、片段、匹配行。
- 点击结果调用 `onOpenFile(relativePath)`，由 `ProjectWorkbench` 复用现有 `requestOpenRelativePath(path, "Files")`。

不在本阶段做：

- 结果高亮滚动到具体行。
- 搜索结果常驻跨 section 状态。
- 搜索历史。
- 键盘全局快捷键。

## 10. 客户端 API

在 `web/src/lib/client/api.ts` 增加：

```ts
export async function searchProject(
  projectId: string,
  query: string,
  signal?: AbortSignal,
): Promise<ProjectSearchResponse>
```

该函数复用现有 `requestJson`，错误类型沿用 `ClientApiError`。

## 11. 类型设计

在 `web/src/lib/types.ts` 增加共享类型：

```ts
export interface ProjectSearchResult {
  relativePath: string;
  lineNumber: number;
  lineText: string;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface ProjectSearchResponse {
  query: string;
  results: ProjectSearchResult[];
  summary: {
    scannedFiles: number;
    skippedFiles: number;
    matchedFiles: number;
    totalMatches: number;
    truncated: boolean;
  };
}
```

## 12. 状态与数据流

```text
ProjectSearch 输入 q
  -> 2 字符以下：本地提示，不请求
  -> 2 字符以上：AbortController 取消上一请求
  -> fetch /api/projects/[projectId]/search?q=...
  -> search route resolveProjectById
  -> searchProjectFiles 扫描可搜索文本
  -> 返回结果
  -> ProjectSearch 渲染结果
  -> 用户点击结果
  -> ProjectWorkbench.requestOpenRelativePath(relativePath, "Files")
  -> 复用阶段 2 草稿保护和文件打开链路
```

## 13. 错误处理

服务端：

- projectId 不存在：沿用 404。
- q 缺失或为空：返回空结果摘要。
- 单个文件读取失败：跳过该文件，增加 skippedFiles，不让整个搜索失败。
- 项目解析、路径安全、根目录访问失败：返回现有结构化错误。

前端：

- 查询过短：显示输入提示。
- loading：显示搜索中状态。
- no results：显示无结果状态。
- API error：显示错误消息和 retry 按钮。
- 新请求发起时取消旧请求，忽略 aborted 请求的结果。

## 14. 测试要求

服务端测试：

- `searchProjectFiles` 能找到 Markdown / text / JSON / YAML 中的行级匹配。
- 搜索大小写不敏感。
- 超过限制或不可读 UTF-8 文件被跳过并计数。
- 结果上限触发 `truncated`。

API route 测试：

- `/search?q=wiki` 返回结果。
- 不存在项目返回 404。
- 短查询返回空结果摘要。

前端测试：

- `ProjectSearch` 2 字符以下不调用搜索。
- 成功结果渲染路径、行号、片段。
- 点击结果调用 `onOpenFile(relativePath)`。
- loading、empty、error 状态可见。

集成验证：

- `npm run test`
- `npm run typecheck`
- `npm run lint`

## 15. 验收标准

- 工作台内有项目搜索入口。
- 用户输入 2 个及以上字符能获得项目内稳定搜索结果。
- 结果显示文件路径、行号和可读上下文。
- 点击结果能打开对应文件，并保留未保存草稿保护。
- 搜索只覆盖当前阶段定义的文本范围。
- 搜索失败、无结果、查询过短、加载中都有明确状态。
- 不引入持久化索引、RAG、向量搜索或聊天能力。
- 阶段完成后更新 `web/docs/web-roadmap-next-phases.md` 的阶段 4 状态。

## 16. 已采用的设计决策

- 推荐方案：服务端按需轻量检索。
- 搜索范围：当前项目内可读文本文件。
- 查询方式：大小写不敏感的完整字符串匹配。
- 索引策略：本阶段不持久化索引，每次搜索读取当前磁盘内容。
- 结果定位：本阶段打开文件并展示行级上下文，不做编辑器滚动定位。
- 后续兼容：搜索响应结构可作为阶段 5 RAG 的候选上下文来源，但阶段 4 不实现 RAG。
