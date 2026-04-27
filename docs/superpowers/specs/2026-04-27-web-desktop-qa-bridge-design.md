# Web 端复用桌面端问答能力 Design Spec

## 1. 背景

当前 Web 端已经实现了独立的项目问答能力：Web 前端调用 Next.js API，Next.js 服务端自行检索项目文件、构造 prompt，并通过 Web 侧环境变量调用 LLM provider。这个实现能形成最小闭环，但它和桌面端问答不是同一套链路。

桌面端现有问答逻辑位于 `src/components/chat/chat-panel.tsx`，会使用桌面端的项目状态、`llmConfig`、聊天历史、`searchWiki`、可选向量检索、图谱扩展、语言提示和流式 `streamChat()`。因此，如果 Web 端继续保留自己的问答服务，两边会天然出现回答、引用、历史和错误行为不一致。

新的目标是：Web 端问答不再自行实现 RAG/LLM 逻辑，而是作为前端，通过一个极薄的桌面端桥接入口调用桌面端问答能力。桌面端仍是问答逻辑和历史记录的权威来源。

同时，桌面端项目被视为上游项目，不希望大规模改动原有功能。设计必须尽量减少对上游代码的侵入，让后续同步上游更新时冲突可控。

## 2. 目标

- Web 端问答结果由桌面端问答逻辑产生，不再由 Web 服务端独立生成。
- Web 端展示一问一答、流式输出、历史记录和来源引用。
- 问答历史归属桌面端，Web 端只读取和展示，不维护另一份长期历史。
- 桌面端保留现有功能完整性，避免修改现有剪藏服务路由语义。
- 新增桥接能力有清晰边界，便于后续上游同步时单独适配。
- 桌面端和 Web 端在同一项目、同一模型配置、同一会话历史下应尽量得到一致结果。
- 桥接服务只绑定本机地址，避免暴露到局域网或公网。

## 3. 非目标

本阶段不做：

- 不重写桌面端整个聊天系统。
- 不把 Web 端做成新的独立 RAG/LLM 后端。
- 不要求 Web 端直接操作桌面端 UI 组件。
- 不改造现有 `127.0.0.1:19827` 剪藏服务的已有接口语义。
- 不引入远程多用户认证、团队协作或云端同步。
- 不在 Web 端持久化独立聊天历史。
- 不要求第一版支持所有桌面端高级入口，例如 Deep Research、Review 或自动写入 Wiki。

## 4. 方案选择

### 4.1 方案 A：零侵入桌面端，Web 保持独立问答

Web 端只调用桌面端现有 `19827` 接口获取项目状态，问答仍由 Web 自己完成。

优点是几乎不影响上游桌面端项目。缺点是回答、引用、模型配置、历史记录都无法保证与桌面端一致，不满足“桌面端是服务器，Web 端是前端”的目标。

### 4.2 方案 B：独立 Bridge，尽量复刻桌面端问答

新增一个独立 bridge 或 adapter，读取同一项目文件和 `.llm-wiki` 历史，尽量复刻桌面端问答逻辑。

优点是对桌面端侵入小。缺点是它仍然不是桌面端原始问答链路，长期会出现逻辑分叉；桌面端更新检索、prompt 或 provider 时，bridge 需要手动追赶。

### 4.3 方案 C：极小侵入桌面端，新增薄桥接入口

新增一个独立桌面端 Web bridge 服务，例如 `127.0.0.1:19828`。该服务只负责本地 HTTP/SSE 接入。真正的问答逻辑从桌面端 `ChatPanel` 中抽成可复用 service，由桌面端 UI 和 bridge 共同调用。

优点是结果最接近一致，同时不会把 Web 需求塞进现有剪藏服务。缺点是需要对桌面端做少量结构性改动，并处理 Rust bridge 与前端 TypeScript service 之间的事件通信。

本设计采用方案 C。

## 5. 总体架构

系统分成三层：

1. **Web UI 层**
   - 展示会话列表、消息历史、输入框、流式回答和来源引用。
   - 不理解 RAG 细节。
   - 不直接调用 LLM provider。

2. **Web 代理层**
   - 位于 Web 的 Next.js API route。
   - 接收浏览器请求，并转发到桌面端本地 bridge。
   - 负责把桌面端错误转换成 Web UI 可展示的错误。
   - 不构造 prompt，不检索文件，不保存长期历史。

3. **桌面端 Bridge 与问答服务层**
   - Bridge 是本机 HTTP/SSE 服务，只绑定 `127.0.0.1`。
   - 桥接请求进入桌面端后，调用抽出的 `project-chat-service`。
   - `project-chat-service` 复用桌面端现有问答链路，包括检索、上下文构造、历史、模型配置和流式输出。
   - 桌面端继续作为会话和历史记录的权威来源。

推荐新增端口：

```text
127.0.0.1:19828
```

现有 `127.0.0.1:19827` 继续保留给剪藏和项目同步接口使用，不新增问答路由。

## 6. 桌面端设计

### 6.1 新增 `project-chat-service`

新增 `src/lib/project-chat-service.ts`，把 `ChatPanel` 内部真正与问答相关的流程抽成可复用函数。

建议核心函数：

```ts
export interface ProjectChatRequest {
  projectId: string;
  projectPath: string;
  conversationId: string;
  message: string;
  signal?: AbortSignal;
}

export interface ProjectChatCallbacks {
  onToken: (token: string) => void;
  onReferences?: (references: MessageReference[]) => void;
  onDone: (message: DisplayMessage) => void;
  onError: (error: Error) => void;
}

export async function sendProjectChatMessage(
  request: ProjectChatRequest,
  callbacks: ProjectChatCallbacks,
): Promise<void>;
```

该 service 负责：

- 创建或读取目标 conversation。
- 写入 user message。
- 根据项目路径读取 wiki index、purpose 和相关页面。
- 调用 `searchWiki()`，保留桌面端现有 token 检索、向量检索和图谱扩展行为。
- 构造 system prompt、历史消息和语言约束。
- 使用桌面端 `llmConfig` 调用 `streamChat()`。
- 将 token 通过 callback 传出。
- 完成后写入 assistant message、references 和聊天历史。

`ChatPanel` 后续也调用该 service，而不是保留一份独立实现。这样 Web bridge 和桌面 UI 才能共享同一套结果生成逻辑。

### 6.2 新增桌面端 Web Bridge

新增 `src-tauri/src/web_bridge.rs`，启动独立本地服务。

职责：

- 监听 `127.0.0.1:19828`。
- 提供健康检查、会话列表、消息读取、会话创建和流式发送接口。
- 解析 JSON 请求。
- 校验项目 id、项目路径和 conversation id。
- 通过 Tauri event 或 command bridge 把请求交给前端 TypeScript handler。
- 将前端 handler 返回的 token 和完成事件转成 SSE 或 NDJSON 返回给 Web 代理。

不建议把这些接口加入现有 `clip_server.rs`，避免剪藏服务继续膨胀，也减少上游冲突。

### 6.3 Rust 与 TypeScript 的桥接

Rust bridge 不能直接调用 `project-chat-service.ts`。推荐使用事件桥接：

1. Rust 收到 HTTP 请求。
2. Rust 生成 request id，并向 WebView emit `web-bridge:chat-request`。
3. 桌面前端启动时注册 listener。
4. listener 调用 `sendProjectChatMessage()`。
5. 每个 token 通过 Tauri command 或 event 回传给 Rust。
6. Rust 把 token 写入 HTTP streaming response。
7. 完成或失败时，Rust 关闭流。

这部分是本方案中复杂度最高的点，需要单独封装 request registry，避免并发请求互相串流。

## 7. Desktop Bridge HTTP API

### 7.1 健康检查

```text
GET /health
```

响应：

```json
{
  "ok": true,
  "service": "llm-wiki-web-bridge",
  "version": "0.1.0"
}
```

### 7.2 会话列表

```text
GET /projects/:projectId/conversations
```

响应：

```json
{
  "ok": true,
  "conversations": [
    {
      "id": "conv_...",
      "title": "问题标题",
      "createdAt": 1710000000000,
      "updatedAt": 1710000000000
    }
  ]
}
```

### 7.3 消息历史

```text
GET /projects/:projectId/conversations/:conversationId/messages
```

响应：

```json
{
  "ok": true,
  "messages": [
    {
      "id": "1",
      "role": "user",
      "content": "这个项目的 schema 在哪里？",
      "timestamp": 1710000000000,
      "conversationId": "conv_..."
    },
    {
      "id": "2",
      "role": "assistant",
      "content": "schema 定义在 ...",
      "timestamp": 1710000001000,
      "conversationId": "conv_...",
      "references": [
        {
          "title": "schema",
          "path": "wiki/schema.md"
        }
      ]
    }
  ]
}
```

### 7.4 创建会话

```text
POST /projects/:projectId/conversations
```

响应：

```json
{
  "ok": true,
  "conversation": {
    "id": "conv_...",
    "title": "新会话",
    "createdAt": 1710000000000,
    "updatedAt": 1710000000000
  }
}
```

### 7.5 流式发送消息

```text
POST /projects/:projectId/conversations/:conversationId/messages/stream
```

请求：

```json
{
  "message": "这个项目的 schema 在哪里？",
  "projectPath": "F:/path/to/project"
}
```

响应使用 SSE，事件示例：

```text
event: token
data: {"text":"schema"}

event: token
data: {"text":" 定义在"}

event: references
data: {"references":[{"title":"schema","path":"wiki/schema.md"}]}

event: done
data: {"message":{"id":"2","role":"assistant","content":"schema 定义在 ...","timestamp":1710000001000,"conversationId":"conv_...","references":[{"title":"schema","path":"wiki/schema.md"}]}}
```

错误事件：

```text
event: error
data: {"code":"LLM_PROVIDER_ERROR","message":"模型请求失败"}
```

## 8. Web 端设计

### 8.1 Web API 代理

Web 端保留自己的 API route，但职责改为代理。

建议接口：

```text
GET  /api/projects/:projectId/question/conversations
GET  /api/projects/:projectId/question/conversations/:conversationId/messages
POST /api/projects/:projectId/question/conversations
POST /api/projects/:projectId/question/conversations/:conversationId/messages/stream
```

这些 route 负责：

- 通过 Web project registry 校验 `projectId`。
- 把项目路径随请求转发给 desktop bridge。
- 连接 `http://127.0.0.1:19828`。
- 对非流式接口返回 JSON。
- 对流式接口透传 SSE。
- 将连接失败转换成明确错误，例如 `DESKTOP_BRIDGE_UNAVAILABLE`。

旧的 Web 独立问答 API 可以保留兼容一段时间，但 UI 应迁移到新的 bridge API。后续确认不再需要后再删除旧实现。

### 8.2 Web UI 行为

Web 问答面板应从“单次问答卡片”升级为紧凑聊天界面：

- 左侧或顶部显示会话列表。
- 主区域显示当前会话消息历史。
- 底部输入框支持提问。
- 生成中显示流式文本。
- 支持停止生成。
- assistant 消息显示来源引用。
- 点击来源打开 Web 文件面板中的对应文件。

Web 端不把消息持久化到自己的数据库或 localStorage。刷新后重新从 desktop bridge 拉取会话和消息。

### 8.3 错误状态

Web UI 需要区分：

- 桌面端 bridge 未启动：提示“请先打开桌面端应用，并确认 Web Bridge 已运行”。
- 项目不匹配：提示“桌面端当前项目与网页项目不一致，请在桌面端打开同一项目”。
- 模型配置错误：展示 desktop 返回的 LLM 配置错误。
- 生成中断：保留已生成文本，允许重试。
- 网络流断开：提示连接中断，允许重新发送。

## 9. 数据一致性

桌面端是会话和历史记录的权威来源。

Web 端只负责展示这些数据：

- conversations
- messages
- assistant references
- streaming tokens

当 Web 用户发送消息时，desktop 端必须写入同一套聊天 store 和持久化文件。这样用户回到桌面端时，应该能看到 Web 端刚产生的会话历史。

如果 Web 和 desktop 同时对同一个 conversation 发送消息，第一版可以采用简单防护：同一 conversation 同一时间只允许一个 active stream。后续再考虑队列或冲突合并。

## 10. 安全与约束

- Bridge 只绑定 `127.0.0.1`。
- 不监听 `0.0.0.0`。
- 不接受跨项目任意路径操作。Web 代理必须传入已注册项目路径，desktop bridge 也要校验项目 id/path 是否匹配。
- HTTP CORS 只允许本机 Web 开发地址，或第一版使用严格 origin 白名单。
- 错误响应不能泄露 API key 或完整 provider request body。
- 流式请求必须支持取消，避免用户关闭页面后继续消耗模型调用。

## 11. 测试要求

### 11.1 桌面端

- `project-chat-service` 单元测试：
  - greeting 不触发检索。
  - 普通问题触发 `searchWiki()`、图谱扩展和 `streamChat()`。
  - 正确写入 user 和 assistant message。
  - references 能随 assistant message 保存。
  - abort signal 能停止生成。

- bridge handler 测试：
  - `/health` 返回 ok。
  - 会话列表和消息读取返回 desktop store 数据。
  - stream 接口按顺序输出 token、references、done。
  - 错误时输出 error event。
  - 并发 request id 不串流。

### 11.2 Web 端

- Web API 代理测试：
  - desktop bridge 可用时正确转发。
  - bridge 不可用时返回 `DESKTOP_BRIDGE_UNAVAILABLE`。
  - unknown project 返回现有 project not found 错误。
  - stream route 能透传 SSE。

- Web UI 测试：
  - 加载会话列表。
  - 创建会话。
  - 加载消息历史。
  - 发送消息时显示流式输出。
  - done 后显示 assistant 消息和 references。
  - 点击 reference 打开文件。
  - bridge 错误状态有中文提示。

### 11.3 手工验证

- 打开桌面端应用并打开项目。
- 打开 Web 项目页。
- 在 Web 问答面板提问。
- 确认 Web 端流式输出。
- 确认来源引用可打开文件。
- 回到桌面端，确认同一会话历史可见。
- 关闭桌面端 bridge 后，Web 显示清晰错误。

## 12. 迁移计划

1. 先新增 `project-chat-service`，让桌面端 `ChatPanel` 改为调用它，确保桌面端行为不变。
2. 新增 desktop bridge，但默认只提供 `/health` 和会话读取接口。
3. 增加 stream 消息接口，完成 Rust 与 TypeScript 的事件桥接。
4. Web 端新增 bridge client 和代理 route。
5. Web 问答 UI 迁移到 bridge API。
6. 保留旧 Web 独立问答实现作为临时 fallback，但默认不再使用。
7. 稳定后再清理旧 Web 独立问答代码和旧环境变量文档。

## 13. 验收标准

- Web 问答不再调用 Web 自己的 LLM provider。
- Web 问答的回答由 desktop 侧问答 service 生成。
- Web 支持流式输出。
- Web 能展示 desktop 侧会话历史。
- Web 端发送的问题能写入 desktop 聊天历史。
- 来源引用能在 Web 文件面板中打开。
- desktop 原有 `19827` 剪藏接口行为不变。
- 新增 bridge 代码有独立边界，便于后续同步上游时处理冲突。
- desktop bridge 不可用时，Web 有明确中文错误提示。

## 14. 已确认决策

- 采用方案 C：极小侵入 desktop，新增薄桥接入口。
- 不扩展现有 `127.0.0.1:19827` 剪藏服务作为问答接口。
- 新增独立 Web bridge，推荐端口 `127.0.0.1:19828`。
- Web 端只做代理和展示，不维护独立问答历史。
- 文档、spec 和后续 plan 使用中文。
