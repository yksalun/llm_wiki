# 阶段 6 项目洞察基础层 Design Spec

## 1. 背景

阶段 5 已经把项目级问答接入工作台：用户可以在当前项目内提问，服务端用项目搜索结果构造上下文，再通过可配置 LLM provider 生成带来源的回答。下一阶段路线图写的是“图谱 / Review / Deep Research”，目标是帮助用户看结构、看关系、看空洞、看风险、做辅助分析。

这个目标很大，不能一次性做成完整 agent 平台。当前最稳妥的下一步是先做一个可解释、可测试、非持久化的“项目洞察基础层”：服务端按需扫描当前项目文件，生成文件关系图、结构发现、风险提示和研究问题建议；前端新增 `Insights` section 展示这些结果，并允许用户打开对应来源文件。

## 2. 目标

- 在工作台新增 `Insights` section，放在 `Ask` 之后、`Files` 之前。
- 服务端新增当前项目范围内的洞察 API。
- 基于文件树和 Markdown 内容构建确定性的项目关系图。
- 发现基础结构问题，例如孤立 wiki 页面、损坏 Markdown 链接、缺少项目入口关系。
- 给出可继续追问或人工审查的研究问题建议。
- 所有来源打开都继续走 `requestOpenRelativePath(relativePath, "Files")`，保留未保存草稿保护。
- 不引入新数据库表、后台任务、向量索引、跨项目分析或 agent 自动执行。

## 3. 非目标

本阶段明确不做：

- 持久化图谱或 review 结果。
- 向量索引、embedding、重排模型。
- 自动生成或修改项目文档。
- LLM Deep Research agent。
- 跨项目图谱。
- 复杂图形可视化库。
- 权限、多用户、审计日志。

## 4. 推荐方案

采用“确定性项目洞察 + 工作台 Insights section”的方案。

### 方案 A：直接做 LLM Review / Deep Research

优点是看起来更智能；缺点是依赖 provider、成本和不确定性都高，而且没有稳定结构数据作为基础，容易退化成模型猜测。

### 方案 B：确定性项目洞察基础层

优点是完全可测试、无需新 provider、不会引入持久化复杂度；可以先把关系图、空洞、风险和研究建议做成稳定数据结构，后续 LLM review 可以复用。缺点是首版分析能力偏规则化。

### 方案 C：引入完整图数据库或前端图谱库

优点是长期可扩展；缺点是当前阶段过重，会把核心风险从“洞察是否有价值”转移到基础设施和可视化复杂度上。

本阶段采用方案 B。

## 5. 用户体验

工作台新增 `Insights` tab。

页面内容分四块：

- Summary：显示可分析文件数、Markdown 文件数、关系边数、发现数量、研究建议数量。
- Project graph：用紧凑列表展示文件节点和链接边，不做复杂画布。
- Findings：显示结构空洞和风险，按 `risk`、`warning`、`info` 分类。
- Research prompts：显示后续可以追问或人工审查的问题。

每个带来源的 finding 和 research prompt 都提供 `Open source`，点击后打开对应文件并保留 draft guard。

## 6. 服务端设计

新增：

```text
GET /api/projects/[projectId]/insights
```

route 职责：

- 读取 `LLM_WIKI_PROJECT_ROOTS`。
- 通过 `resolveProjectById` 限定当前项目。
- 调用 `buildProjectInsights(project.rootDir)`。
- 成功用 `okJson`，错误用 `errorJson`。

新增 service：

```text
web/src/lib/server/project-insights.ts
```

核心规则：

- 扫描当前项目内可读文本文件，跳过 `.llm-wiki`。
- Markdown 文件参与链接解析。
- 节点以文件为主，节点 id 使用稳定的 `file:<relativePath>`。
- 边来自 Markdown 链接：
  - 支持 `[text](relative.md)`。
  - 支持 `./relative.md`、`../relative.md`、`wiki/page.md`。
  - 忽略 `http://`、`https://`、`mailto:`、锚点-only 链接。
  - 目标规范化后必须仍在项目相对路径范围内。
- 若链接目标存在，生成 `links-to` edge。
- 若链接目标不存在，生成 broken link finding。
- wiki 下除 `wiki/index.md` 外，没有入边的 Markdown 文件生成 orphan finding。
- 如果项目 Markdown 之间没有任何有效边，生成“项目关系还未显式连接”的 finding。

## 7. 类型设计

在 `web/src/lib/types.ts` 新增：

```ts
export interface ProjectInsightNode {
  id: string;
  label: string;
  kind: "file";
  relativePath: string;
}

export interface ProjectInsightEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: "links-to";
  label: string;
  sourceLineNumber: number;
}

export interface ProjectInsightFinding {
  id: string;
  severity: "info" | "warning" | "risk";
  title: string;
  message: string;
  relativePath?: string;
  lineNumber?: number;
}

export interface ProjectInsightResearchPrompt {
  id: string;
  title: string;
  question: string;
  reason: string;
  sourceIds: string[];
}

export interface ProjectInsightsResponse {
  summary: {
    analyzedFiles: number;
    markdownFiles: number;
    graphNodes: number;
    graphEdges: number;
    findings: number;
    researchPrompts: number;
  };
  graph: {
    nodes: ProjectInsightNode[];
    edges: ProjectInsightEdge[];
  };
  findings: ProjectInsightFinding[];
  researchPrompts: ProjectInsightResearchPrompt[];
}
```

`WorkbenchSection` 增加 `"Insights"`。

## 8. 前端设计

新增 client API：

```ts
fetchProjectInsights(projectId: string, signal?: AbortSignal): Promise<ProjectInsightsResponse>
```

新增组件：

```text
web/src/components/workbench/project-insights-panel.tsx
```

组件职责：

- 加载 insights。
- 显示 loading / error / ready。
- error 支持 Retry。
- 渲染 summary、graph、findings、research prompts。
- `Open source` 调用父级 `onOpenFile(relativePath)`。

Workbench 集成：

- registry sections 改为 `Overview / Ask / Insights / Files / Purpose / Schema / Project Info`。
- `section === "Insights"` 渲染 `ProjectInsightsPanel`。
- source open 走 `requestOpenRelativePath(relativePath, "Files")`。

## 9. 错误处理

- unknown project：沿用 `PROJECT_NOT_FOUND` 404。
- 根目录不可读或扫描失败：返回结构化 500，由 `errorJson` 处理。
- 单个文件读取失败：跳过该文件，不阻断整个 insights。
- 损坏链接是 finding，不是 API 错误。

## 10. 测试要求

服务端：

- graph 节点和边来自 Markdown 相对链接。
- broken link 生成 risk finding。
- wiki orphan 页面生成 warning finding。
- 无有效 Markdown 边时生成 info finding 和 research prompt。
- 跳过 `.llm-wiki`。

API route：

- 成功返回 insights。
- unknown project 返回 404。

前端：

- loading / success / error retry。
- 渲染 summary、edge、finding、research prompt。
- `Open source` 调用父级回调。

Workbench：

- registry sections 包含 `Insights`。
- Insights source open 使用现有 draft guard。

## 11. 验收标准

- 工作台存在 `Insights` section。
- 当前项目可生成非持久化 graph / findings / research prompts。
- 所有来源打开保留 draft guard。
- 不引入新持久化、新索引、后台任务或 agent。
- `npm run test`、`npm run typecheck`、`npm run lint` 通过；lint 允许既有 warning，但不能新增 error。
