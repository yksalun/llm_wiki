# 阶段 2：编辑可靠性补强设计

## 背景

`LLM Wiki Web` 当前 v1 已经具备项目选择、项目工作台、文件树浏览，以及 `purpose.md`、`schema.md`、`wiki/**/*.md` 的读取和手动保存能力。服务端已经有路径安全校验、可写文件策略、`lastModified` 乐观冲突检测，以及同一进程内同一文件写入串行化。

现阶段的主要问题不是“不能编辑”，而是编辑链路还不够可预期：未保存草稿可能在文件切换、快捷 section 切换、项目 reload 或页面刷新时被覆盖；保存冲突只有通用错误提示；保存成功的正反馈偏弱；`reload / retry / refresh` 的语义没有清晰分层。

阶段 2 的目标是把工作台从“能编辑”提升为“适合长期稳定编辑”。

## 目标

1. 用户能明确知道当前文件是否有未保存修改。
2. 会覆盖或清空草稿的操作必须先经过保护流程。
3. 保存成功、保存失败、保存成功但刷新失败、保存冲突必须被清楚区分。
4. 冲突发生时，本地草稿必须保留，并提供可解释的恢复动作。
5. `reload / retry / refresh` 的行为边界保持一致。
6. 关键编辑链路有自动化测试覆盖。

## 非目标

本阶段不实现以下能力：

- 自动保存
- 跨会话草稿持久化
- 富文本编辑器
- diff 对比或三方合并
- 强制覆盖远端文件
- 协同编辑、多用户锁、权限系统
- 搜索、聊天、RAG、图谱

## 推荐方案

采用“轻量可靠性补强”方案：保留现有手动保存模型和文件 API 结构，集中补强编辑会话状态、草稿离开保护、冲突反馈、刷新语义和测试。

不选择“只做前端提示”，因为服务端 malformed JSON 与冲突错误信息仍会留下不一致边界。

不选择“完整版本系统 + diff 冲突处理”，因为它会把阶段 2 做得过重，且 roadmap 已明确本阶段不做协同编辑和复杂冲突合并。

## 现有系统边界

客户端当前由 `ProjectWorkbench` 编排异步请求和交互状态，`workbench-store` 保存 `section / selectedPath / file / draft / dirty / saving`。`FilePanel` 负责展示文件事实、编辑框、保存按钮和提示信息。

服务端 `GET /api/projects/[projectId]/file` 返回 `FileReadResult`，其中包含 `lastModified`。`PUT /api/projects/[projectId]/file` 接收 `relativePath / content / lastModified`，通过 `writeProjectFile` 检查 `lastModified` 是否匹配当前文件 mtime；不匹配时返回 `FILE_WRITE_CONFLICT` 和 HTTP 409。

这些边界保留，不在阶段 2 重写。

## 状态设计

### 编辑会话状态

状态层继续以当前打开文件为中心，但需要补充更明确的语义：

- `dirty`：本地 draft 与当前基线内容不同。
- `saving`：保存请求正在进行。
- `refreshing`：保存成功后或用户请求后正在重新读取当前文件。
- `lastSaveStatus`：最近一次保存结果，区分 `success / failed / conflict / refresh_failed`。
- `lastSavedAt`：最近一次确认保存成功的时间。
- `conflict`：保存冲突摘要，用于提示远端已变化且本地草稿仍保留。

`openFile(file)` 仍然表示“接受远端内容作为新的本地基线”，它会重置 draft、dirty、saving、conflict。

保存失败和保存冲突不得调用 `openFile()`，必须保留当前 draft。

### 草稿保护判断

新增集中判断：

```text
hasBlockingDraft = dirty && file?.mode === "editable" && !saving
```

只有当一个操作会覆盖或清空当前 draft 时，才触发草稿保护。普通查看 Overview、Project Info，或在 Files section 中不改变当前文件的操作不触发保护。

## 用户流程

### 打开另一个文件

如果当前没有未保存草稿，直接打开目标文件。

如果当前存在未保存草稿，先展示保护确认：

- 保存并继续：先保存当前文件；保存成功后打开目标文件。
- 放弃草稿：丢弃当前 draft，打开目标文件。
- 取消：停留在当前文件。

保存失败或冲突时，不继续打开目标文件。

### 切换 Purpose / Schema

`Purpose` 和 `Schema` 会自动打开固定文件，因此它们与“打开另一个文件”共享同一套草稿保护流程。

切到 `Overview`、`Project Info` 不会覆盖当前 draft，不需要保护。

### Reload 项目

项目 reload 会重新加载项目详情和文件树，并清理当前文件状态，因此必须经过草稿保护。

保护动作与打开文件一致：

- 保存并 reload
- 放弃草稿并 reload
- 取消

如果保存请求已经发出，不把 abort 展示为“保存已取消”。保存中禁用 reload，避免出现“请求可能已落盘但 UI 已清空”的不确定状态。

### 页面刷新或离开

当存在未保存草稿时，注册 `beforeunload` 提示。浏览器原生提示文案不可控，因此页面内文案只负责说明当前状态，真正刷新离开由浏览器确认。

### 保存

保存成功后：

- draft 与基线同步。
- `dirty` 变为 false。
- 显示保存成功反馈和确认时间。

保存失败后：

- 保留 draft。
- 显示错误原因。
- 保存按钮可再次重试。

保存成功但刷新失败后：

- 用本次保存的 draft 建立本地基线。
- `dirty` 变为 false。
- 显示 warning：文件已保存，但工作台未能重新读取最新内容。

保存冲突后：

- 保留 draft。
- `dirty` 保持 true。
- 显示明确冲突提示：远端文件已在读取后变化。
- 提供“重新加载远端内容”动作；执行前如果仍有本地 draft，需要再次确认会丢弃本地草稿。

## 服务端设计

本阶段保留 `lastModified` 作为主要乐观冲突字段，不引入完整 revision 表。

需要补强：

1. malformed JSON 请求体返回 400 `INVALID_REQUEST_BODY`，不走 500。
2. `FILE_WRITE_CONFLICT` 的错误 payload 增加可恢复信息：
   - `relativePath`
   - `currentLastModified`
3. `FileWriteRequest` 的创建语义保持现状：允许 `lastModified: null` 创建可写策略允许的文件，但前端本阶段不新增创建入口。

`version`、ETag、`If-Match` 不列为阶段 2 验收范围。只有在现有 `lastModified` 冲突检测无法稳定覆盖本阶段测试时，才允许补充一个向后兼容的轻量 `version` 字段；该字段不能扩展成本阶段的 diff、覆盖写或协同协议。

## 组件设计

### `ProjectWorkbench`

继续作为页面级编排组件，但需要减少散落的保护判断：

- 所有可能覆盖 draft 的入口先经过统一 guard。
- `openRelativePath`、`handleSectionChange`、`reloadProject` 明确区分用户意图和实际执行动作。
- 保存冲突对 `ClientApiError.code === "FILE_WRITE_CONFLICT"` 单独处理。

### `workbench-store`

扩展编辑会话状态，并增加可测试 helper 或 store action：

- 标记保存成功
- 标记保存失败
- 标记保存冲突
- 标记刷新失败
- 清理 notice/conflict

`dirty` 的计算仍然来自 draft 与基线内容的比较，不引入独立布尔真相源。

### `FilePanel`

展示更明确的状态反馈：

- 当前文件是否已同步
- 最近保存成功时间
- 保存失败/冲突/warning
- 对冲突提供恢复动作入口

不把 `FilePanel` 变成状态编排者，它只接收状态和回调。

## 错误处理

错误信息按用户可理解的语义分层：

- 保存失败：请求未完成保存，草稿仍在本地。
- 保存冲突：远端已变化，草稿仍在本地，需要用户选择如何恢复。
- 保存成功但刷新失败：文件已写入，工作台本地状态已用保存草稿同步，但没有拿到服务端重读结果。
- 打开文件失败：当前请求失败，不覆盖已有草稿。
- 项目 reload 失败：项目详情或树加载失败，不声称当前草稿已保存。

## 测试策略

### Store 单元测试

覆盖：

- draft 与基线一致时 dirty 为 false。
- 保存成功后重置 dirty 和冲突状态。
- 保存失败保留 draft。
- 冲突状态保留 draft。
- clear/reset 行为不会留下 saving 或 conflict。

### 服务端测试

覆盖：

- malformed JSON 返回 400 `INVALID_REQUEST_BODY`。
- stale write 返回 409 `FILE_WRITE_CONFLICT`。
- 冲突错误 payload 包含当前文件版本信息。
- 现有不可写路径、路径安全、并发同文件写入测试继续通过。

### 工作台交互测试

优先抽出可测试 helper，覆盖：

- dirty 下打开其他文件必须先经过 guard。
- dirty 下切 Purpose/Schema 必须先经过 guard。
- dirty 下 reload 必须先经过 guard。
- 保存成功后继续原始意图。
- 保存失败或冲突后不继续原始意图。
- beforeunload 仅在存在未保存草稿时启用。

如果组件测试依赖缺失，阶段 2 先用 helper 单元测试锁定关键决策，再补必要的轻量组件测试。

## 验收标准

阶段 2 完成时必须满足：

1. 用户修改 editable 文件后，界面明确显示未保存状态。
2. 文件切换、Purpose/Schema 切换、项目 reload、页面刷新不会无提示丢失草稿。
3. 保存成功、保存失败、保存冲突、保存成功但刷新失败都有不同反馈。
4. 冲突发生时，本地草稿保留，并提供重新加载远端内容的恢复动作。
5. reload/retry/refresh 的文案和行为边界可解释。
6. 关键编辑状态和保存路径有自动化测试。
7. `web/docs/web-roadmap-next-phases.md` 在阶段完成后标记阶段 2 已完成，并指向本 spec 与 implementation plan。

## 后续阶段衔接

阶段 2 完成后，阶段 3 可以在稳定编辑底座上增强 Markdown 阅读、只读预览和项目概览。阶段 2 不提前实现预览模式重构，但会避免让编辑状态和未来预览状态互相缠绕。
