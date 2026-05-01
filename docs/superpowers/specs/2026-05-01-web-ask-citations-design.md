# Web Ask 引用展示与无跳转文件预览 Design Spec

## 1. 背景

Web 子项目的问答入口位于 `web/src/components/workbench/project-question-panel.tsx`。当前实现会调用 `askProjectQuestion()`，在回答下方展示 `lastResponse.sources`，每个来源以项目内手写的列表项呈现。点击来源会调用 `onOpenFile(source.relativePath)`，从 Ask 区域切换到 Files 区域并打开对应文件。

这个行为有两个问题：

- 来源展示不是成熟 AI 引用组件，而是本项目手写 UI。
- 点击来源会离开当前问答上下文，用户查看文件后需要再切回 Ask。

桌面端聊天已有 `<!-- cited: 1, 3 -->` 这种隐藏引用注释。Web 端本次不改桌面端逻辑，但需要明确：这类 HTML 注释是程序元数据，不是给用户看的正文。Web 回答渲染时如果遇到类似注释，应剥离，不展示给用户。

## 2. 目标

- 只改 Web 子项目，不改桌面端 `src/components/chat/*`。
- Web Ask 的来源展示采用市面上成熟的 shadcn 生态 AI 引用组件，不重新造一套引用列表组件。
- 点击来源后仍停留在 Ask 页面，通过右侧预览容器查看文件。
- 文件预览复用现有 Web 能力：`fetchProjectFile()`、`MarkdownReader`、`FilePreview`。
- 保持当前 `ProjectQuestionResponse.sources` 数据契约不变。
- 加入覆盖关键交互的测试。

## 3. 非目标

- 不引入 assistant-ui 的完整 thread/runtime 架构。
- 不重写 Web 问答后端 `answerProjectQuestion()`。
- 不实现逐句 inline citation 自动改写。
- 不改变 Files 面板的编辑、保存、冲突处理逻辑。
- 不在第一版加入外部链接跳转或新窗口打开来源。

## 4. 组件选择

### 4.1 引用展示：AI Elements `Sources`

采用 Vercel AI Elements 的 `Sources` registry 组件作为来源展示主体。它是 shadcn registry 风格组件，面向 AI 回复来源/引用场景，提供：

- `Sources`
- `SourcesTrigger`
- `SourcesContent`
- `Source`

安装路径建议在 Web 子项目执行：

```bash
npx ai-elements@latest add sources
```

该组件依赖 shadcn `Collapsible`。如果 Web 子项目尚未安装 `collapsible`，由 registry 安装或使用 shadcn CLI 补齐。

本项目的来源不是 URL，而是本地项目文件路径和行号。AI Elements 的默认 `Source` 偏链接语义，第一版可以采用以下方式：

- 使用 `Sources` / `SourcesTrigger` / `SourcesContent` 承载整个来源区域。
- 每个本地文件来源用 shadcn 原语渲染为可点击行，保持在 `SourcesContent` 内。
- 该行只做很薄的项目适配：展示 `[id]`、`relativePath`、`lineNumber`、`preview`，点击后打开 Sheet。

这样来源区的展开/收起、结构和 AI 引用语义来自成熟组件，本地文件行为只做必要适配。

### 4.2 文件查看：shadcn `Sheet`

点击来源后打开 shadcn `Sheet` 右侧抽屉，而不是切换到 Files 区域。Sheet 内使用：

- `Sheet`
- `SheetContent`
- `SheetHeader`
- `SheetTitle`
- `SheetDescription`
- `ScrollArea`
- `Skeleton`
- `Alert`

如果 Web 子项目尚未安装 `sheet`，使用 shadcn CLI 添加。

## 5. 交互设计

Ask 面板回答完成后：

1. 回答正文先清理隐藏 HTML 注释，例如 `<!-- cited: 1, 3 -->`。
2. 正文继续使用当前文本展示方式，避免本次扩大为 Markdown 聊天渲染改造。
3. 如果 `lastResponse.sources.length > 0`，在回答下方渲染 AI Elements `Sources`。
4. `SourcesTrigger` 显示来源数量，例如“使用 3 个来源”。
5. `SourcesContent` 展示来源列表。
6. 点击任一来源：
   - 设置当前选中的 source。
   - 打开右侧 `Sheet`。
   - 调用 `fetchProjectFile(projectId, source.relativePath)`。
7. Sheet 加载完成后：
   - Markdown 或可预览文本复用 `MarkdownReader` / `FilePreview`。
   - Sheet 标题显示 `relativePath`。
   - Sheet 描述显示 `第 N 行` 和来源编号。
8. 关闭 Sheet 后，Ask 页面状态保持不变。

第一版不提供“打开到 Files”主动作，避免用户误触后离开当前页面。

## 6. 数据与状态

`ProjectQuestionPanelSession` 新增局部状态：

- `selectedSource: ProjectQuestionSource | null`
- `sourcePreviewOpen: boolean`
- `sourceFile: FileReadResult | null`
- `sourceFileStatus: "idle" | "loading" | "ready" | "error"`
- `sourceFileError: string | null`
- `sourcePreviewAbortRef`

来源预览请求规则：

- 每次点击来源都取消上一条未完成请求。
- projectId 变化或组件卸载时取消请求。
- Sheet 关闭时保留或清空 `sourceFile` 均可，推荐清空，避免下次打开时短暂显示旧文件。
- 预览请求失败只在 Sheet 内展示错误，不影响问答回答和来源列表。

## 7. 错误处理

- 没有 sources：不渲染来源区。
- 来源文件加载中：Sheet 内显示 `Skeleton`。
- 来源文件读取失败：Sheet 内显示 shadcn `Alert`，保留文件路径和错误信息。
- 文件类型不可预览：交给现有 `FilePreview` 的 metadata/unsupported 状态处理。
- 回答里出现隐藏注释：剥离后展示，不报错。

## 8. 测试要求

更新 `web/src/components/workbench/project-question-panel.test.tsx`：

- 回答正文中的 `<!-- cited: 1, 3 -->` 不显示。
- 有 sources 时渲染 AI Sources 区域和来源数量。
- 来源项显示编号、路径、行号和 preview。
- 点击来源会调用 `fetchProjectFile` 或注入的等价预览加载函数，并打开 Sheet。
- 点击来源不会调用 `onOpenFile`，不会切换到 Files。
- 文件加载中显示加载态。
- 文件加载失败时 Sheet 内显示错误 Alert。
- 关闭 Sheet 后仍留在 Ask 面板。

验证命令：

```bash
cd web
npm run typecheck
npm run test -- project-question-panel
```

## 9. 验收标准

- Web Ask 引用展示使用 AI Elements `Sources` 作为来源区域主体。
- Web Ask 中不再展示 `<!-- cited: ... -->`。
- 点击来源不再离开 Ask 页面。
- 点击来源会打开右侧 Sheet，并显示对应文件内容或错误状态。
- 现有 Files 面板行为不回归。
- 测试覆盖引用展示、Sheet 打开、失败状态和不调用 `onOpenFile`。

## 10. 已确认决策

- 只改 Web 端。
- 引用展示采用 Vercel AI Elements `Sources`。
- 文件查看采用 shadcn `Sheet`。
- 不引入完整 assistant-ui runtime。
- 不把 `<!-- cited: ... -->` 展示给用户。
