# 阶段 7 项目访问权限基础层 Design Spec

## 1. 背景

roadmap 的阶段 7 标题是“多用户 / 权限 / 协作”，但同一节也明确说明：当前产品假设仍然是单用户、自部署、同机访问项目目录。只要这个前提不变，完整多用户平台不是当前主线优先级。

因此，本阶段不直接做团队账号、登录注册、成员邀请、实时协作或审计系统。更稳的下一步是先补一层“项目访问权限基础”：让部署者可以把 Web 工作台切换成只读模式，并让服务端和前端都尊重这个权限边界。

这会为未来多用户和协作留出清晰接口，同时不会破坏当前本地自部署的简单性。

## 2. 自动选择的推荐答案

按照用户要求，本阶段 brainstorming 的问题都采用推荐项，不等待人工确认：

- 阶段 7 范围选择：选择“权限基础层”，不做完整团队协作平台。
- 权限模型选择：选择全局项目访问模式，先支持 `read-write` 和 `read-only`。
- 默认行为选择：默认 `read-write`，保持现有部署不变。
- 前端行为选择：只读模式下文件可读、搜索/问答/Insights 可用，但编辑和保存不可用。
- 服务端行为选择：写入 API 必须强制拒绝只读模式下的保存请求，不能只依赖 UI。

## 3. 目标

- 新增项目访问模式配置：`LLM_WIKI_PROJECT_ACCESS_MODE=read-write|read-only`。
- 默认不配置时保持当前行为，即 `read-write`。
- 项目详情 API 返回当前访问能力，供工作台展示。
- 文件读取在只读模式下仍可打开 Markdown 内容，但不暴露可编辑状态。
- 文件写入 API 在只读模式下返回 403，错误码为 `PROJECT_ACCESS_READ_ONLY`。
- 工作台显示当前访问模式，并让只读文件进入只读预览路径。
- 保留当前搜索、问答、Insights 能力；它们是读取/分析行为，不受只读模式限制。
- 为未来多用户/权限系统保留类型和服务端边界。

## 4. 非目标

本阶段明确不做：

- 用户账号、密码、OAuth、登录页或 session。
- 多用户成员管理、邀请、团队空间。
- 每个项目/文件/section 的细粒度 ACL。
- 实时协同编辑、presence、锁文件。
- 审计日志、操作历史、权限变更历史。
- 反向代理认证、SSO 或生产级 IAM 集成。

## 5. 方案比较

### 方案 A：完整多用户平台

优点是覆盖 roadmap 标题最完整，可以支持团队协作。缺点是范围过大，需要账号体系、session、权限数据库、迁移、UI 流程和安全模型，和当前单用户自部署前提不匹配。

### 方案 B：项目访问权限基础层

优点是低风险、可测试、默认不改变现有行为，同时补上服务端写权限闸门和前端只读体验。未来如果要做多用户，可以复用 `ProjectAccessPolicy` 和写权限检查点。缺点是它不是完整协作系统。

### 方案 C：只写文档，不做代码

优点是最轻。缺点是阶段 7 不会产生真实能力，也不能验证未来权限边界是否可落地。

本阶段采用方案 B。

## 6. 用户体验

默认 `read-write` 模式下，用户体验保持不变。

当部署者设置：

```bash
LLM_WIKI_PROJECT_ACCESS_MODE=read-only
```

工作台表现为：

- 项目仍可打开。
- 文件树、Overview、Search、Ask、Insights 仍可使用。
- `purpose.md`、`schema.md`、`wiki/**/*.md` 仍能阅读。
- 原本可编辑的 Markdown 文件在文件面板中以只读预览呈现，不显示编辑和保存入口。
- Project Info / Workbench State 显示当前访问模式为 read-only。
- 如果客户端仍然尝试 `PUT /api/projects/[projectId]/file`，服务端返回 403 `PROJECT_ACCESS_READ_ONLY`。

## 7. 服务端设计

新增服务端模块：

```text
web/src/lib/server/project-access.ts
```

职责：

- 从环境变量读取访问模式。
- 生成结构化 `ProjectAccessPolicy`。
- 提供写权限断言。
- 在只读模式下把 `FileReadResult` 转成只读预览语义。

类型：

```ts
export type ProjectAccessMode = "read-write" | "read-only";

export interface ProjectAccessPolicy {
  mode: ProjectAccessMode;
  canRead: true;
  canWrite: boolean;
}
```

规则：

- 未配置或空值：`read-write`。
- `read-write`：`canWrite: true`。
- `read-only`：`canWrite: false`。
- 其他值：抛出 500 `PROJECT_ACCESS_MODE_INVALID`。
- 只读模式写入：抛出 403 `PROJECT_ACCESS_READ_ONLY`。

文件读取：

- `readProjectFile()` 仍负责路径安全、文件分类和内容读取。
- 文件 route 在读出结果后调用 `applyProjectAccessToFile(file, policy)`。
- 如果 `policy.canWrite === false` 且文件原本 `editable === true`，返回：
  - `mode: "preview"`
  - `editable: false`
  - 保留 `content`、`size`、`lastModified`
  - `metadata.accessMode = "read-only"`

文件写入：

- `PUT /api/projects/[projectId]/file` 解析当前项目后读取 access policy。
- 如果没有写权限，直接返回 403，不调用 `writeProjectFile()`。
- 路径安全和写入冲突逻辑保持原样。

项目详情：

- `GET /api/projects/[projectId]` 返回新增字段：

```ts
access: ProjectAccessPolicy
```

项目列表暂不需要展示 access policy，避免扩大 UI 范围。

## 8. 前端设计

`ProjectDetail` 新增：

```ts
access: ProjectAccessPolicy;
```

工作台使用 `detail.access`：

- Workbench State 侧栏显示 access mode。
- Project Info 增加 access mode 和 write access。
- 文件面板不需要新增权限 props，因为服务端已把只读模式下的 editable markdown 转成 `preview`。

客户端保存路径不做额外分支：

- 正常 `read-write` 模式下行为不变。
- 如果 UI 或 stale client 仍发起保存，服务端 403 会通过现有保存失败提示展示。

## 9. 错误处理

- `PROJECT_ACCESS_MODE_INVALID`：500，表示部署配置错误。
- `PROJECT_ACCESS_READ_ONLY`：403，表示当前部署模式不允许写入。
- 现有 `INVALID_REQUEST_BODY`、`FILE_WRITE_CONFLICT`、`FILE_NOT_WRITABLE` 等错误保持原语义。

## 10. 测试要求

服务端：

- 默认环境返回 `read-write` policy。
- `LLM_WIKI_PROJECT_ACCESS_MODE=read-only` 返回只读 policy。
- 无效 access mode 抛出 `PROJECT_ACCESS_MODE_INVALID`。
- 只读 policy 下写权限断言抛出 `PROJECT_ACCESS_READ_ONLY`。
- 只读 policy 下 editable file read result 被转成 preview / non-editable。

API route：

- project detail 返回 access policy。
- read-only 模式下 `GET file` 返回 `mode: "preview"`、`editable: false`。
- read-only 模式下 `PUT file` 返回 403 `PROJECT_ACCESS_READ_ONLY` 且文件内容不变。
- read-write 模式下现有 PUT 行为保持通过。

前端：

- Workbench 在 detail 中显示 read-only access mode。
- read-only file result 不显示编辑/保存入口。
- 现有 draft guard、保存、搜索、问答、Insights 测试不回退。

## 11. 验收标准

- 默认配置下现有工作台行为不变。
- 设置 `LLM_WIKI_PROJECT_ACCESS_MODE=read-only` 后，项目可读但不可保存。
- 服务端写入权限由 API 强制执行。
- 项目详情暴露结构化 access policy。
- 工作台显示访问模式。
- 不引入用户账号、session、多用户数据库或协作机制。
- `npm run test`、`npm run typecheck`、`npm run lint` 通过；lint 允许既有 warning，但不能新增 error。
