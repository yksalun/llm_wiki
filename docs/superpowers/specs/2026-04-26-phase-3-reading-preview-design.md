# 阶段 3：阅读与预览能力补强设计

## 背景

阶段 2 已经补强了编辑可靠性：未保存草稿保护、保存状态反馈、冲突恢复语义和关键测试已经落地。当前工作台可以更可信地长期编辑 `purpose.md`、`schema.md` 和 `wiki/**/*.md`，因此下一步应强化内容消费体验，而不是直接进入搜索或问答。

当前 `FilePanel` 对 editable Markdown 仍以 textarea 为主；只读 preview 文件使用原始 `<pre>` 文本；metadata / unsupported 文件只展示基础提示和元信息。项目概览已经有文件数、目录数和快捷入口，但还不能帮助用户快速建立阅读上下文。

阶段 3 的目标是把工作台从“能看内容”提升为“看内容舒服、看结构清楚、看文件更顺手”。

## 目标

1. Markdown 默认具备清晰的阅读视图，内容更像文档，而不是原始文本。
2. editable Markdown 支持显式的阅读 / 编辑切换，并复用阶段 2 的可靠保存链路。
3. 只读文本类文件的 preview 比当前 `<pre>` 更易扫读。
4. 文件面板展示更有用的上下文信息：路径、模式、大小、更新时间、保存状态。
5. 项目概览增强结构摘要和常用阅读入口，帮助用户更快理解项目。
6. 常见阅读路径从“进入项目”到“打开目标文件”更顺滑。
7. 阅读增强有自动化测试覆盖，不破坏阶段 2 的草稿保护和保存语义。

## 非目标

本阶段不实现以下能力：

- 搜索索引或搜索入口
- 聊天、RAG、问答
- 图谱、Review、Deep Research
- 富文本编辑器
- 自动保存或协同编辑
- 通用二进制文件查看器
- PDF / DOCX / PPTX / XLSX 内容解析
- 复杂 Markdown 编辑器或实时并排 diff

## 推荐方案

采用“阅读优先 + 轻量编辑切换”方案。

默认把 Markdown 当作可阅读内容展示，用户需要修改时显式进入编辑模式。这样可以直接提升阶段 3 的核心价值，同时保留阶段 2 已经稳定下来的手动保存链路。

不选择“编辑与预览并排”，因为它会压缩阅读宽度，并把阶段 3 推向编辑器增强。

不选择“多面板信息工作台”，因为它的信息密度更适合后续搜索、图谱或项目分析阶段，本阶段会显得过重。

## 现有系统边界

客户端工作台仍由 `ProjectWorkbench` 编排项目加载、文件打开、保存和草稿保护。`FilePanel` 是主要文件展示入口，当前已经接收文件内容、draft、保存状态、冲突状态和草稿保护提示。

服务端文件分类由 `file-policy.ts` 决定：

- `purpose.md`、`schema.md`、`wiki/**/*.md` 是 editable。
- `.md`、`.txt`、`.json`、`.yaml`、`.yml` 是 preview。
- `.pdf`、`.docx`、`.pptx`、`.xlsx` 是 metadata。
- 超过大小限制、不支持扩展名或 invalid UTF-8 是 unsupported。

阶段 3 保留这些分类，不扩展成通用文件查看器。

## 设计原则

1. 阅读是默认路径，编辑是显式动作。
2. 可编辑文件进入编辑模式后，仍然使用阶段 2 的保存、冲突和草稿保护语义。
3. 预览能力以 Markdown 和安全文本为主，不解析二进制文档。
4. 文件上下文信息应该帮助阅读，而不是堆满元数据。
5. 组件边界保持清晰：渲染组件负责展示，工作台组件负责状态编排。

## 用户流程

### 打开 editable Markdown

用户从文件树、Purpose、Schema 或 Overview 打开 Markdown 文件后，默认进入阅读视图。

阅读视图包含：

- 文件标题和相对路径
- 模式、大小、更新时间、保存状态
- 渲染后的 Markdown 正文
- `Edit` 动作

点击 `Edit` 后进入编辑视图，显示当前 textarea 和保存按钮。编辑视图中的保存、重置、冲突、刷新失败和草稿保护行为继续沿用阶段 2。

如果当前文件有未保存草稿，不能无提示切回会丢失上下文的状态。阅读 / 编辑切换本身不切换文件，不应触发离开保护。

### 打开只读 Markdown 或文本文件

只读 preview 文件默认展示增强阅读视图。

- Markdown preview 使用同一套 Markdown 阅读组件。
- `.txt` 以可换行的文本阅读块展示。
- `.json`、`.yaml`、`.yml` 使用 monospace 结构化文本块展示，保持水平滚动和行距。

只读文件不显示保存按钮，只显示文件上下文和只读状态。

### 打开 metadata 文件

metadata 文件继续不解析内容，但展示更清楚的文件摘要：

- 文件类型
- 扩展名
- 大小
- 为什么只显示 metadata

### 打开 unsupported 文件

unsupported 文件继续明确说明不能预览的原因，例如文件过大、扩展名不支持或 invalid UTF-8。

### 项目概览阅读入口

项目概览增强为“阅读入口”而不是分析 dashboard：

- 显示项目结构摘要：文件数、目录数、Markdown 文件数、只读 preview 文件数、metadata 文件数。
- 保留 Purpose、Schema、Files、Wiki 快捷入口。
- 如果存在 wiki 目录，突出“从 wiki 开始阅读”的入口。

## 组件设计

### `FilePanel`

`FilePanel` 继续作为文件面板入口，但拆出内部展示组件：

- `FileFacts`：展示文件上下文。
- `MarkdownReader`：渲染 Markdown 阅读视图。
- `TextPreview`：渲染普通文本或结构化文本。
- `MetadataPreview`：渲染 metadata 文件摘要。
- `UnsupportedPreview`：渲染 unsupported 文件摘要。
- `EditableMarkdownPanel`：承载阅读 / 编辑切换和 textarea 保存链路。

如果文件是 editable，`FilePanel` 需要维护局部 view mode：

```text
fileView = "read" | "edit"
```

当打开新文件时，默认回到 `read`。如果用户开始编辑并产生 dirty draft，保持在 `edit`，避免保存状态被隐藏。

### `MarkdownReader`

Markdown reader 只负责安全、轻量的 Markdown 展示：

- headings
- paragraphs
- unordered / ordered lists
- blockquote
- inline code
- fenced code block
- links
- horizontal rule
- table 的基础展示可以在实现中用轻量规则支持；如果依赖成本过高，本阶段允许先以 code/pre 形式展示表格源码。

优先使用项目已有依赖。如果 `web` 子项目没有 Markdown 渲染库，允许新增 `react-markdown` 与 `remark-gfm` 到 `web/package.json`，但必须同步 lockfile 并用测试覆盖基础渲染。

### `ProjectOverview`

概览增强只做结构摘要和阅读入口，不做搜索、标签、图谱或智能分析。

新增统计应从已有 tree 递归计算，不新增服务端 API。

## 状态与数据流

服务端 API 不需要新增接口。`FileReadResult` 已经包含阶段 3 所需的核心字段：

- `relativePath`
- `mode`
- `content`
- `editable`
- `size`
- `lastModified`
- `metadata`

客户端数据流保持：

```text
ProjectWorkbench -> fetchProjectFile -> FilePanel -> reader / editor components
```

阅读模式不改变 draft。编辑模式使用现有 draft。保存成功后 `openFile(refreshedFile)` 建立新基线，阅读视图展示最新内容。

## 错误处理

阶段 3 不改变服务端错误模型。文件打开失败、保存失败、保存冲突、刷新失败继续沿用阶段 2 的 notice 和保存状态反馈。

阅读渲染自身必须降级安全：

- content 为 null 时展示空状态，而不是抛异常。
- Markdown 渲染失败时展示原始文本 fallback。
- invalid date 展示原始 `lastModified` 值。

## 测试策略

### 单元测试

新增或扩展测试覆盖：

- Markdown reader 能渲染 heading、paragraph、list、code block。
- text preview 对 `.txt` 和结构化文本保持可读布局。
- metadata / unsupported 预览展示原因和关键字段。
- project overview 统计 Markdown、preview、metadata、unsupported 文件数量。
- editable 文件默认 read，进入 edit 后 textarea 保存链路仍可用。

### 回归测试

继续运行阶段 2 的 store 和 draft guard 测试，确保阅读增强不破坏：

- dirty 状态
- 保存反馈
- 冲突状态
- pending draft guard

### 全量验证

阶段完成前运行：

- `npm run test`
- `npm run typecheck`
- `npm run lint`

## 验收标准

阶段 3 完成时必须满足：

1. editable Markdown 默认以阅读视图打开。
2. 用户可以显式进入编辑视图并继续使用阶段 2 的保存可靠性能力。
3. Markdown 阅读体验明显优于原始 textarea / pre 展示。
4. 只读文本文件的 preview 比当前更清楚。
5. metadata 和 unsupported 文件有清晰摘要和原因。
6. 项目概览提供更有用的结构摘要与阅读入口。
7. 常见阅读路径从进入项目到打开文件更顺。
8. 自动化测试覆盖阅读组件、概览统计和阶段 2 回归路径。
9. `web/docs/web-roadmap-next-phases.md` 在阶段完成后标记阶段 3 已完成，并指向本 spec 与 implementation plan。

## 后续阶段衔接

阶段 3 完成后，阶段 4 可以在更顺的阅读落点上实现项目内检索。搜索结果可以直接打开文件并落到阅读视图；本阶段不实现结果定位，但会让文件阅读区域成为后续定位的稳定目标。
