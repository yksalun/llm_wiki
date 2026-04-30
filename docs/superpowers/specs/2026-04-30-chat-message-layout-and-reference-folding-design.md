# 聊天消息布局与引用折叠设计

日期：2026-04-30

## 背景

Web 端问答已经改为使用 `assistant-ui` 渲染消息列表、Markdown 正文、流式回答和历史会话。当前消息列表仍采用统一的左侧卡片布局，用户问题和 AI 回答在视觉上不够区分。AI 回答里的引用文件列表全部展开显示，引用较多时会拉长聊天窗口，影响阅读正文和后续对话。

本设计只调整 Web 端聊天窗口展示层，不修改桌面端 API、Web API route、消息数据结构或流式协议。

## 目标

1. 用户自己的消息靠右显示，AI 返回消息靠左显示。
2. 用户消息和 AI 消息的气泡样式有清晰差异，同时兼容亮色和暗色主题。
3. AI 消息引用超过 3 条时默认折叠，只展示前 3 条。
4. 折叠状态显示引用总数和当前展示数量。
5. 用户点击展开按钮后展示全部引用；再次点击可以收起。
6. 引用按钮仍调用 `onOpenFile(relativePath)` 打开文件。

## 非目标

- 不解析或改写 AI 正文中的 `<!-- cited: 1, 9 -->` 标记。
- 不改变桌面端返回的 `references` 数据。
- 不新增 Web 端引用持久化状态。
- 不改变会话加载、发送、停止生成和历史记录逻辑。

## 消息布局

`ChatMessage` 根据 `message.role` 决定布局：

- `user`：外层容器使用右对齐，消息气泡靠右，最大宽度限制在聊天区域的约 78%，避免长文本铺满整行。
- `assistant`：外层容器使用左对齐，消息气泡靠左，最大宽度同样限制在约 78%。
- `system`：按 AI 侧处理，靠左显示。

为测试和可维护性，消息根节点增加稳定属性：

- `data-message-role={message.role}`
- `data-message-align="right"` 或 `"left"`

这些属性不参与业务逻辑，只用于语义标记和组件测试断言。

## 引用折叠

引用列表仍从 `message.metadata.custom.references` 读取。渲染规则如下：

- 引用数量为 0：不显示引用区域。
- 引用数量为 1-3：直接显示全部引用，不显示折叠按钮。
- 引用数量大于 3：默认显示前 3 条，并显示摘要 `引用 N 条，已显示 3 条`。
- 折叠按钮文案：
  - 折叠状态：`展开全部`
  - 展开状态：`收起`
- 展开状态显示全部引用，摘要改为 `引用 N 条，已显示 N 条`。

折叠状态保存在单条 `ChatMessage` 内部。消息列表刷新或切换会话时可以重置为默认折叠，这符合“默认折叠显示”的目标，也避免跨会话泄漏 UI 状态。

## 测试计划

组件测试覆盖：

- 用户消息渲染为右对齐，AI 消息渲染为左对齐。
- AI 消息引用超过 3 条时默认只显示 3 条，并显示引用总数摘要。
- 点击 `展开全部` 后显示全部引用。
- 点击 `收起` 后回到只显示 3 条。
- 展开后点击引用仍调用 `onOpenFile(relativePath)`。

命令验证：

- `npm run test -- src/components/workbench/project-question-panel.test.tsx`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

## 实施边界

预计只修改：

- `web/src/components/workbench/project-question-panel.tsx`
- `web/src/components/workbench/project-question-panel.test.tsx`

不修改桌面端、Web API route、依赖和全局主题变量。
