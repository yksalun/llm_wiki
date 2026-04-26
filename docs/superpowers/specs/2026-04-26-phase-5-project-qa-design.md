# 阶段 5 项目级问答 Design Spec

## 1. 背景

阶段 4 已经交付项目内关键词搜索，工作台可以在当前项目范围内按需扫描可读文本文件，并返回可解释的文件 / 行级结果。阶段 5 的目标是在这个检索基础上建立项目级问答能力，让用户可以用自然语言询问当前项目，并得到带来源引用的回答。

本阶段不追求完整聊天产品，也不把系统升级成复杂 agent。它只做一个可靠的最小闭环：

1. 用户在当前项目工作台输入问题。
2. 服务端用 Phase 4 搜索能力检索相关上下文。
3. 服务端把问题、上下文和约束提示发送给可配置 LLM provider。
4. 前端展示回答、引用来源和错误 / 空上下文状态。
5. 用户可以从引用来源打开对应文件，继续复用现有草稿保护。

## 2. 目标

- 在工作台新增项目级问答入口。
- 服务端新增问答 API，限定在当前 projectId 对应项目范围内。
- 问答上下文必须来自可解释的项目检索结果，不允许模型自由猜项目内容。
- 回答必须带来源引用，引用指向 `relativePath` 和 `lineNumber`。
- 引用来源可点击打开文件，并通过 `requestOpenRelativePath(relativePath, "Files")` 保留草稿保护。
- LLM provider 通过环境变量配置；未配置时给出明确错误，不让用户误以为问答可用。
- 本阶段保持非流式、无持久聊天历史、无向量索引，避免过早扩大复杂度。

## 3. 非目标

本阶段明确不包含：

- 持久聊天会话。
- 多轮会话保存到 `.llm-wiki` 或数据库。
- 流式输出。
- 向量检索、embedding、重排模型。
- 跨项目问答。
- Agent 工具调用、自动改文件、自动生成 wiki。
- 图谱、Review、Deep Research。
- 多 provider UI 配置页。
- 富文本 / Markdown 复杂回答渲染。

## 4. 推荐方案

采用“Phase 4 搜索增强 + OpenAI Responses API 适配层 + 工作台 Ask section”的方案。

### 4.1 方案取舍

**方案 A：只做确定性检索摘要，不接 LLM。**  
优点是实现简单且完全可测；缺点是不能真正回答自然语言问题，只是搜索结果包装，不满足阶段 5 的核心价值。

**方案 B：服务端检索增强问答，非流式，环境变量配置 provider。**  
优点是范围清晰、能形成真实问答闭环、测试可以 mock fetch、不会引入新数据库表或持久索引。缺点是需要部署者配置 LLM 环境变量，且首版没有流式体验。

**方案 C：完整聊天/RAG 平台，带会话持久化、向量库、流式输出。**  
优点是接近长期产品方向；缺点是阶段过大，会同时引入持久化、检索质量、模型调用、UI 多轮状态等多个风险。

本阶段采用方案 B。它可以验证问答产品闭环，同时保留后续扩展空间。

## 5. 用户体验

### 5.1 工作台入口

在工作台 tab 中新增 `Ask` section，放在 `Overview` 和 `Files` 之间。

`Ask` section 内容为 `ProjectQuestionPanel`：

- 顶部是问题输入框和 Ask 按钮。
- 输入少于 2 个字符时按钮禁用。
- 提交后显示 loading 状态。
- 成功后显示 assistant 回答和 sources 列表。
- sources 每条包含编号、文件路径、行号、片段和 `Open source` 按钮。
- 点击 source 时只调用父级 `onOpenFile(relativePath)`，由 `ProjectWorkbench` 接入 `requestOpenRelativePath(relativePath, "Files")`。
- 错误时显示错误消息和 Retry。

### 5.2 会话范围

本阶段只保留当前页面内的临时问答历史：

- 用户问题和 assistant 回答可以在当前组件状态里显示。
- 页面刷新、切换项目或重载工作台后历史丢失。
- 请求可以携带最近最多 4 条临时消息作为语言上下文，但服务端不得依赖它做事实来源。

### 5.3 未配置 provider

如果缺少 LLM 配置，API 返回结构化错误：

- code: `PROJECT_QA_PROVIDER_NOT_CONFIGURED`
- status: 503
- message: 告诉部署者需要配置问答 provider。

前端展示该错误，不回退成假回答。

## 6. 服务端设计

### 6.1 环境变量

新增环境变量读取：

- `LLM_WIKI_OPENAI_API_KEY`：优先使用。
- `OPENAI_API_KEY`：fallback，方便部署者复用已有环境。
- `LLM_WIKI_OPENAI_MODEL`：必填；不设置默认模型，避免代码固化过期模型选择。
- `LLM_WIKI_OPENAI_BASE_URL`：可选，默认 `https://api.openai.com/v1/responses`。

只有当 API key 和 model 同时存在时，问答 provider 才算可用。

### 6.2 类型

在 `web/src/lib/types.ts` 新增共享类型：

```ts
export interface ProjectQuestionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProjectQuestionRequest {
  question: string;
  history?: ProjectQuestionMessage[];
}

export interface ProjectQuestionSource {
  id: number;
  relativePath: string;
  lineNumber: number;
  preview: string;
}

export interface ProjectQuestionResponse {
  question: string;
  answer: string;
  sources: ProjectQuestionSource[];
  retrieval: {
    queries: string[];
    totalMatches: number;
    truncated: boolean;
  };
  model: string;
}
```

### 6.3 检索上下文

新增 `web/src/lib/server/project-question-answer.ts`。

职责：

- 校验 question：trim 后 2 到 500 字符。
- 生成检索 query：
  - 完整问题作为第一查询。
  - 从问题中提取 3 到 40 字符的 token，去重后最多 5 个。
  - 过滤非常常见的英文停用词。
- 调用 `searchProjectFiles(projectRoot, query)`。
- 合并搜索结果，按 `relativePath:lineNumber` 去重，最多保留 8 个 source。
- 组装 prompt，要求模型：
  - 只能基于 sources 回答。
  - 不确定时明确说不知道。
  - 回答中使用 `[1]`、`[2]` 等引用。
  - 不暴露服务器绝对路径。
- 调用 LLM adapter。
- 返回 answer、sources、retrieval summary 和 model。

### 6.4 LLM adapter

新增 `web/src/lib/server/llm-provider.ts`。

职责：

- 读取 provider 配置。
- 构造 OpenAI Responses API 请求。
- 使用 `fetch`，不引入 SDK 依赖。
- 非流式调用。
- 设置合理超时，例如 30 秒。
- 解析响应文本：
  - 优先读取 `output_text`。
  - fallback 遍历 `output[].content[].text`。
- 失败时抛出 `AppError`：
  - 未配置：`PROJECT_QA_PROVIDER_NOT_CONFIGURED`，503。
  - provider 非 2xx：`PROJECT_QA_PROVIDER_ERROR`，502。
  - 响应无法解析：`PROJECT_QA_PROVIDER_INVALID_RESPONSE`，502。

### 6.5 API route

新增：

```text
POST /api/projects/[projectId]/question
```

请求：

```json
{
  "question": "Where is the schema defined?",
  "history": [
    { "role": "user", "content": "What is this project?" },
    { "role": "assistant", "content": "..." }
  ]
}
```

响应沿用 `ProjectQuestionResponse`。

route 职责：

- 解析 JSON。
- 校验 body shape。
- 通过 `resolveProjectById` 获取当前项目。
- 调用 `answerProjectQuestion(project.rootDir, payload)`。
- 成功用 `okJson`，错误用 `errorJson`。

## 7. 前端设计

### 7.1 客户端 API

在 `web/src/lib/client/api.ts` 新增：

```ts
export async function askProjectQuestion(
  projectId: string,
  payload: ProjectQuestionRequest,
  signal?: AbortSignal,
): Promise<ProjectQuestionResponse>
```

该函数使用 `requestJson`，POST JSON 到 `/api/projects/[projectId]/question`。

### 7.2 ProjectQuestionPanel

新增：

```text
web/src/components/workbench/project-question-panel.tsx
```

Props：

```ts
interface ProjectQuestionPanelProps {
  projectId: string;
  onOpenFile: (relativePath: string) => void;
  askFn?: typeof askProjectQuestion;
}
```

组件状态：

- `messages`: 临时 user/assistant 消息。
- `question`: 当前输入。
- `status`: idle/loading/error。
- `lastResponse`: 最近一次回答，含 sources。
- `errorMessage`: 错误展示。

UI 原则：

- 操作型、紧凑、可扫描。
- 不新增独立 landing 或说明页。
- 不把聊天面板放进另一个装饰 card 里；作为 `Ask` section 的主工具面。
- sources 的 `Open source` 按钮优先使用现有 Button。

## 8. 数据流

```text
ProjectQuestionPanel submit
  -> askProjectQuestion(projectId, { question, history })
  -> POST /api/projects/[projectId]/question
  -> resolveProjectById
  -> answerProjectQuestion(project.rootDir, payload)
  -> searchProjectFiles for generated queries
  -> build cited source context
  -> call OpenAI Responses API adapter
  -> return answer + sources
  -> ProjectQuestionPanel renders answer and sources
  -> source click
  -> ProjectWorkbench.requestOpenRelativePath(relativePath, "Files")
```

## 9. 错误处理

服务端：

- 无效 projectId：沿用 404 `PROJECT_NOT_FOUND`。
- body 非 JSON：400 `INVALID_REQUEST_BODY`。
- question 缺失或过短 / 过长：400 `INVALID_REQUEST_BODY`。
- provider 未配置：503 `PROJECT_QA_PROVIDER_NOT_CONFIGURED`。
- provider 请求失败：502 `PROJECT_QA_PROVIDER_ERROR`。
- 无检索 sources：返回 200，answer 为“当前项目中没有找到足够上下文回答这个问题。”，不调用 provider。

前端：

- 输入过短：禁用 Ask 按钮。
- loading：禁用按钮，显示 asking 状态。
- error：展示错误和 Retry。
- no sources：显示回答和空 sources 状态。

## 10. 测试要求

服务端单元测试：

- 检索 query 生成和去重。
- 无 sources 时不调用 provider。
- 有 sources 时 prompt 包含 sources 和引用要求。
- provider 未配置时抛出 503。
- provider 响应解析支持 `output_text` 和 `output[].content[].text`。

API route 测试：

- 成功 POST 返回 answer 和 sources。
- invalid body 返回 400。
- unknown project 返回 404。
- provider 未配置返回 503。

前端测试：

- 输入过短时按钮禁用。
- submit 后调用 `askFn(projectId, payload, signal)`。
- 成功后渲染回答和 source。
- 点击 source 调用 `onOpenFile(relativePath)`。
- error + Retry 能重新请求。

集成验证：

- `npm run test`
- `npm run typecheck`
- `npm run lint`

## 11. 验收标准

- 工作台存在 `Ask` section。
- 用户可以在当前项目内提出问题。
- 服务端用 Phase 4 搜索结果构建上下文。
- 回答带来源引用。
- 来源可点击打开对应文件，并保留草稿保护。
- 未配置 LLM provider 时给出明确错误。
- 不引入持久聊天历史、向量索引、RAG 数据库或后台任务。
- 阶段完成后更新 `web/docs/web-roadmap-next-phases.md` 的阶段 5 状态。

## 12. 已采用的设计决策

- 推荐方案：服务端检索增强问答，非流式。
- LLM provider：OpenAI Responses API 形态，通过环境变量配置，不固化默认模型。
- 检索来源：复用 Phase 4 `searchProjectFiles()`。
- 上下文规模：最多 8 条 sources。
- UI 入口：新增 `Ask` section。
- 历史策略：仅当前页面内临时历史，不持久化。
- 回答定位：本阶段打开文件并展示来源行号，不做编辑器滚动定位。
