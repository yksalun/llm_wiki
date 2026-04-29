# LLM Wiki Web

这是 `llm_wiki` 仓库里的独立 Web 子项目，目标是把现有项目目录桥接成一个可部署的 Web 工作台。

当前版本已经从最短闭环扩展为可日常使用的项目工作台，重点能力包括：

- 扫描白名单项目根目录
- 打开已有项目
- 浏览文件树
- 读取文件内容
- 编辑并保存 `purpose.md`
- 编辑并保存 `schema.md`
- 编辑并保存 `wiki/**/*.md`
- 项目内搜索
- 项目洞察
- 通过桌面端 Bridge 展示项目级问答
- 把项目快照和同步记录写入 PostgreSQL

当前仍明确**不做**：

- ingest
- review
- deep research
- 多用户权限体系
- 通用 Rust 重任务运行时
- 把项目正文整体迁入数据库

## 技术栈

- Next.js 16
- TypeScript
- Tailwind CSS
- shadcn/ui
- Zustand
- Motion for React
- PostgreSQL
- Drizzle ORM

## 目录说明

这个 Web 子项目不会改动你原来的项目目录结构。真正的项目正文仍然放在磁盘里，Web 只是去“桥接”和“编辑”它。

当前保留并依赖的结构：

- `purpose.md`
- `schema.md`
- `raw/sources/`
- `wiki/`
- `.llm-wiki/`

可写范围只限下面三类：

- `purpose.md`
- `schema.md`
- `wiki/**/*.md`

像 `raw/sources/demo.pdf` 这类文件，v1 只显示元信息，不进入编辑态。

## 环境变量

至少要配置两个环境变量：

```bash
LLM_WIKI_PROJECT_ROOTS=/srv/llm-wiki-projects,/data/wiki-labs
DATABASE_URL=postgres://app:password@127.0.0.1:5432/llm_wiki_web
```

### 桌面端问答 Bridge

使用项目级问答前，需要先启动桌面端应用，并在桌面端打开同一个项目。Web 服务端会通过桌面端本地 Bridge 获取会话、历史记录和流式回答。

默认 Bridge 地址是 `http://127.0.0.1:19828`。如果需要覆盖，可以在 Web 服务端环境变量里配置：

```bash
LLM_WIKI_DESKTOP_BRIDGE_URL=http://127.0.0.1:19828
```

Web 端不再使用自己的 `LLM_WIKI_OPENAI_*` 配置生成问答回答，也不再通过 `OPENAI_API_KEY` fallback 生成项目级问答回答。模型配置、会话历史、问答逻辑和流式输出都以桌面端共享问答 service 为准。

### 法规数据库资料源同步

Web 端可以手动从外部 MySQL `law` 表同步法规资料源到当前项目目录。同步只生成本地 Markdown source 文件：

```text
raw/sources/database/law/*.md
```

第一版不会自动触发桌面端 ingest，也不会生成 `wiki/*` 页面。同步后需要在桌面端资料源流程中继续摄入这些 Markdown 文件。

需要配置：

```bash
LAW_DB_HOST=
LAW_DB_PORT=3306
LAW_DB_DATABASE=aifood
LAW_DB_USER=
LAW_DB_PASSWORD=
```

不要把真实密码提交到仓库。错误提示也不会返回密码或完整连接串。

说明：

- `LLM_WIKI_PROJECT_ROOTS`
  这是白名单根目录列表，多个目录用英文逗号分隔。
- `DATABASE_URL`
  这是 PostgreSQL 连接串。
- `LLM_WIKI_DESKTOP_BRIDGE_URL`
  这是桌面端本地问答 Bridge 地址；未配置时默认使用 `http://127.0.0.1:19828`。

建议把 Web 应用和项目目录部署在同一台服务器上，这样服务端可以直接访问这些目录。

## 本地开发

### 1. 安装依赖

```bash
cd web
npm install
```

### 2. 生成并执行数据库迁移

```bash
cd web
npm run db:generate
npm run db:migrate
```

### 3. 启动开发环境

```bash
cd web
npm run dev
```

默认会启动 Next.js 开发服务器。打开浏览器后：

- `/` 是项目选择页
- `/projects/[projectId]` 是项目工作台页

## 生产部署

### 1. 准备环境变量

在服务器上至少保证：

- `LLM_WIKI_PROJECT_ROOTS` 指向真实项目根目录
- `DATABASE_URL` 指向真实 PostgreSQL

### 2. 执行迁移

```bash
cd web
npm run db:generate
npm run db:migrate
```

### 3. 构建并启动

```bash
cd web
npm run build
npm run start
```

如果你要挂到 Nginx、Caddy 或其他反向代理后面，直接把它当成普通 Next.js 应用处理即可。

## 常用命令

```bash
cd web
npm run typecheck
npm test
npm run db:generate
npm run db:migrate
npm run build
npm run start
```

## v1 能力边界

### 已支持

- 首页扫描白名单根目录
- 首页展示项目列表和扫描 warning
- 项目页展示概览、搜索、问答、洞察、文件、目标、结构和项目信息
- 文件树浏览
- Markdown 预览与编辑
- 手动保存
- 非可编辑文件的元信息展示
- 路径安全校验
- 项目快照与同步记录入库
- 项目级问答入口、会话历史和流式回答展示；问答能力由桌面端本地 Bridge 代理

### 还没做

- 自动保存
- 保存冲突的高级处理
- 富文本编辑器
- Review、Deep Research
- 多用户登录与权限

## 一眼看懂的数据边界

可以把它理解成两层：

- 文件系统：放项目正文，是事实来源
- PostgreSQL：放项目快照、同步记录和应用层元数据

也就是说：

- 文档内容还在原来的项目目录里
- Web 应用不会把正文整体搬进数据库
- 数据库主要负责“索引、快照、状态”

## 排障建议

如果首页打不开，优先检查：

- `LLM_WIKI_PROJECT_ROOTS` 是否配置正确
- 白名单目录是否真的存在、是否有权限访问
- `DATABASE_URL` 是否能连通 PostgreSQL
- 数据库迁移是否已经执行

如果项目页打不开，优先检查：

- `projectId` 是否有效
- 对应项目目录是否仍存在
- `purpose.md`、`schema.md`、`wiki/` 是否符合预期

如果保存失败，优先检查：

- 当前文件是否在允许写入的范围内
- 文件是否被外部修改导致时间戳不一致
- 服务端是否仍能访问项目目录
