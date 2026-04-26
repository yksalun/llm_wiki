# 阶段 8 重任务能力基线与适配层 Design Spec

## 1. 背景

roadmap 的阶段 8 标题是“Rust bridge / 重能力下沉”，但同一节明确强调：Rust bridge 不应该作为“为了高级而高级”的技术动作进入路线图。它只有在 Node/Next 层性能明显吃力、检索/索引/解析类任务真实变重、或需要更强本地能力下沉时才值得启动。

当前代码已经具备搜索、项目问答和 Insights 三类本地分析能力。它们都依赖项目文件扫描、文本读取、Markdown 解析和结果归并。经过代码探索，当前最真实的潜在瓶颈不是“缺 Rust”，而是：

- 搜索和 Insights 各自维护相似的项目文本扫描逻辑。
- 项目问答会基于“完整问题 + 关键词”最多触发 6 次完整项目搜索。
- 没有统一的 runtime capabilities 描述，未来如果引入 Rust bridge，缺少清晰替换边界。
- 没有重任务执行元数据，无法先判断哪些任务真正慢。

因此，本阶段不引入 Rust crate、N-API、WASM、FFI、后台 worker 或持久化索引。更稳妥的推荐方案是先落地“重任务能力基线与适配层”：把项目文本扫描抽成共享边界，给搜索和 Insights 复用；为搜索增加多 query 单次扫描能力，减少问答重复扫描；同时暴露保守的 runtime capabilities，明确当前 active engine 仍然是 `node`。

## 2. 自动选择的推荐答案

按照用户要求，本阶段 brainstorming 的问题都采用推荐项，不等待人工确认：

- 阶段 8 范围选择：选择“重任务能力基线与适配层”，不直接引入 Rust bridge。
- 性能处理优先级：先消除当前确定存在的重复扫描，再记录执行元数据。
- 适配边界选择：以项目文本扫描和文本检索为第一条边界，Insights 复用扫描层。
- UI 范围选择：不新增 tab；只在 Project Info 展示轻量 runtime 诊断。
- 完成表述选择：roadmap 只标记“Phase 8 前置基线完成”，不声称 Rust 已落地或 native 加速已启用。

## 3. 目标

- 新增共享项目文本扫描模块，统一处理：
  - 递归遍历项目文件。
  - 根目录 `.llm-wiki` 跳过。
  - 可搜索文本扩展名过滤。
  - 单文件大小上限。
  - 有界 UTF-8 读取。
  - skipped 文件统计。
- 搜索服务改为使用共享扫描层，保持现有响应结构和排序语义。
- 新增多 query 搜索能力，让项目问答在一次项目扫描内处理多个 query。
- 项目问答改为复用多 query 搜索，保持现有 sources、retrieval、truncated 和 prompt 语义。
- Insights 改为使用共享扫描层，保持现有 graph / findings / research prompts 行为。
- 新增重任务 runtime capabilities 类型与服务端模块，当前 active engine 固定为 `node`。
- 项目详情 API 返回 runtime capabilities。
- Search 和 Insights API 返回本次执行元数据，便于后续判断是否存在真实瓶颈。
- Project Info 展示轻量诊断信息：active engine、bridge status、tracked tasks。
- 为未来 Rust bridge 留出可测试边界，但本阶段不引入 native 构建链。

## 4. 非目标

本阶段明确不做：

- Rust crate、N-API、WASM、FFI 或 native binary 分发。
- Tauri bridge 复用到 Next.js 服务端。
- 后台任务队列、worker pool 或长任务调度。
- 持久化搜索索引、向量索引、embedding、重排模型。
- 性能承诺或“已加速”的产品表述。
- 新增用户可见主 section。
- 改变项目搜索、问答、Insights 的业务能力边界。

## 5. 方案比较

### 方案 A：直接引入 Rust bridge

优点是长期可能获得更强本地性能和系统能力。缺点是当前没有真实性能证据，且会立刻带来跨平台构建、部署、测试、错误处理和二进制分发复杂度。对当前 Web 工作台而言，这是高成本、低确定性的提前优化。

### 方案 B：重任务能力基线与 TypeScript 适配层

优点是符合 roadmap 的“瓶颈驱动”原则：先定义边界、消除已知重复扫描、暴露 runtime 状态和执行元数据，再根据证据决定是否引入 Rust。它可以保持当前部署简单性，同时让未来替换 engine 有明确接口。缺点是不会带来 native 加速。

### 方案 C：只写文档，不改代码

优点是最轻。缺点是阶段 8 不会产生真实工程边界，也无法为后续瓶颈判断提供执行数据。

本阶段采用方案 B。

## 6. 用户体验

普通用户使用搜索、Ask 和 Insights 的路径保持不变。

唯一可见变化在 Project Info：

- `Heavy task engine` 显示 `node`。
- `Bridge status` 显示 `not configured`。
- `Tracked heavy tasks` 显示 `project-search, project-insights`。

Search 和 Insights 面板不新增显眼 UI。API 响应会带执行元数据，主要用于开发者排查和后续阶段判断瓶颈。前端可以继续忽略这些字段，不影响现有体验。

## 7. 服务端设计

### 7.1 共享文本扫描层

新增：

```text
web/src/lib/server/project-text-scan.ts
```

职责：

- 输入项目根目录。
- 递归输出可分析文本文件。
- 保持 async generator 形式，避免为了复用而一次性把所有文件内容读入内存。
- 跳过不可搜索扩展名、超大文件、无效 UTF-8 文件、读取失败文件。
- 对根级 `.llm-wiki` 目录保持跳过。
- 为调用方提供 `skippedFiles` 计数。

建议接口：

```ts
export interface ProjectTextFile {
  relativePath: string;
  content: string;
  size: number;
  extension: string;
}

export interface ProjectTextScanStats {
  skippedFiles: number;
}

export interface ProjectTextScanResult {
  files: AsyncGenerator<ProjectTextFile>;
  stats: ProjectTextScanStats;
}

export function scanProjectTextFiles(projectRoot: string): ProjectTextScanResult;
```

`stats.skippedFiles` 会在 generator 消费过程中累加。调用方必须在消费完成后读取最终统计。

### 7.2 搜索适配

`project-search.ts` 保持导出：

```ts
export async function searchProjectFiles(projectRoot: string, query: string): Promise<ProjectSearchResponse>
```

新增导出：

```ts
export async function searchProjectFilesForQueries(
  projectRoot: string,
  queries: string[],
): Promise<ProjectSearchResponse[]>
```

规则：

- 单 query 行为必须与现有 `searchProjectFiles()` 保持兼容。
- 多 query 搜索只扫描项目一次。
- 每个 query 仍独立得到自己的 `ProjectSearchResponse`。
- query 长度校验、排序、per-file cap、global cap、truncated、Unicode match offset 都保持原语义。
- 空 query 或过短/过长 query 返回零扫描 summary，不影响其他有效 query。

### 7.3 问答检索优化

`project-question-answer.ts` 当前会对每个 query 调一次 `searchProjectFiles()`。本阶段改为：

```ts
const searchResponses = await searchProjectFilesForQueries(projectRoot, queries);
```

后续 source 去重、source 顺序、`MAX_SOURCES`、`totalMatches`、`truncated` 保持现有语义。

这一步是本阶段最直接的性能收益：对同一个问题，最多 6 次完整项目扫描降低为 1 次完整项目扫描。

### 7.4 Insights 复用扫描层

`project-insights.ts` 改为使用 `scanProjectTextFiles()`。

必须保持现有行为：

- `.llm-wiki` 不进入 graph。
- 只分析可搜索文本文件。
- Markdown 文件参与链接解析。
- 超大或无效 UTF-8 的可搜索文件不阻断整个 insights。
- 如果 Markdown 链接指向一个“存在但因过大或不可读被跳过”的文件，不误报为 broken link。

### 7.5 Runtime capabilities

新增：

```text
web/src/lib/server/heavy-task-runtime.ts
```

职责：

- 返回当前重任务 runtime capabilities。
- 当前 active engine 固定为 `node`。
- 当前 bridge status 固定为 `not-configured`。
- 当前 tracked tasks 至少包含 `project-search` 和 `project-insights`。

类型放在 `web/src/lib/types.ts`：

```ts
export type HeavyTaskEngine = "node";
export type HeavyTaskBridgeStatus = "not-configured";
export type HeavyTaskName = "project-search" | "project-insights";

export interface HeavyTaskCapability {
  task: HeavyTaskName;
  engine: HeavyTaskEngine;
  bridgeStatus: HeavyTaskBridgeStatus;
}

export interface ProjectRuntimeCapabilities {
  activeEngine: HeavyTaskEngine;
  bridgeStatus: HeavyTaskBridgeStatus;
  heavyTasks: HeavyTaskCapability[];
}
```

`ProjectDetail` 新增：

```ts
runtime: ProjectRuntimeCapabilities;
```

### 7.6 执行元数据

新增共享类型：

```ts
export interface HeavyTaskExecutionMetadata {
  task: HeavyTaskName;
  engine: HeavyTaskEngine;
  durationMs: number;
}
```

`ProjectSearchResponse` 新增可选字段：

```ts
execution?: HeavyTaskExecutionMetadata;
```

`ProjectInsightsResponse` 新增可选字段：

```ts
execution?: HeavyTaskExecutionMetadata;
```

执行时间由 route 层包裹测量，使用 `performance.now()` 或 `Date.now()`，只要求非负整数或小数，不把它作为测试速度断言。service 层可以继续返回不带 execution 的领域结果，避免把内部调用也强制绑定到 HTTP 计时语义。

## 8. 前端设计

前端只需要消费 `ProjectDetail.runtime`。

`ProjectInfoPanel` 增加：

- `Heavy task engine`
- `Bridge status`
- `Tracked heavy tasks`

不新增主导航 section，不在 Search/Ask/Insights 面板加入性能数字，避免普通用户误解为性能承诺。

现有 `ProjectDetail` 测试 fixture 需要补 runtime 字段。

## 9. 错误处理

- 文本扫描层对单个文件读取失败继续跳过，不让单文件问题阻断搜索或 Insights。
- route 级 unknown project、配置错误等继续使用现有 `errorJson()`。
- runtime capabilities 当前不读取环境变量，因此不存在部署配置错误。
- 执行元数据生成失败不应发生；如果计时 API 不可用，使用 `Date.now()` fallback。

## 10. 测试要求

服务端文本扫描：

- 只产出可搜索文本文件。
- 根级 `.llm-wiki` 被跳过。
- 超大文件被跳过并计入 skipped。
- 无效 UTF-8 文件被跳过并计入 skipped。
- 有界读取会关闭 file handle。

搜索：

- 单 query 搜索行为保持通过现有 tests。
- 多 query 搜索只扫描一次项目文本文件。
- 多 query 中无效 query 返回零扫描 summary，不影响有效 query。
- 结果排序、truncated 和 match offset 不回退。

问答：

- answerProjectQuestion 使用多 query 搜索结果。
- sources 去重、source id 重排、retrieval.truncated 保持现有语义。

Insights：

- 复用扫描层后 graph、broken link、orphan、无关系边和 `.llm-wiki` tests 继续通过。
- 跳过文件不造成误报 broken link。

Runtime/API/UI：

- `getProjectRuntimeCapabilities()` 返回 node / not-configured。
- project detail route 返回 runtime capabilities。
- search route 和 insights route 返回 execution metadata。
- Project Info 展示 engine、bridge status、tracked tasks。

## 11. 验收标准

- 不引入 Rust、native bridge、FFI、WASM、后台任务或持久化索引。
- 搜索和 Insights 共用项目文本扫描层。
- 项目问答对多个 query 只触发一次项目文本扫描。
- 项目详情暴露结构化 runtime capabilities，active engine 为 `node`。
- Search 和 Insights API 返回 execution metadata。
- Project Info 展示重任务 runtime 诊断。
- 现有搜索、问答、Insights 行为不回退。
- `npm run test`、`npm run typecheck`、`npm run lint` 通过；lint 允许既有 warning，但不能新增 error。
- roadmap 明确标记 Phase 8 为“前置基线完成”，不声称 Rust bridge 已落地。
