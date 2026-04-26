# LLM Wiki Web

这是 `llm_wiki` 仓库里的独立 Web 子项目，目标是把现有项目目录桥接成一个可部署的 Web 工作台。

这一版是 `v1`，重点只做最短闭环：

- 扫描白名单项目根目录
- 打开已有项目
- 浏览文件树
- 读取文件内容
- 编辑并保存 `purpose.md`
- 编辑并保存 `schema.md`
- 编辑并保存 `wiki/**/*.md`
- 把项目快照和同步记录写入 PostgreSQL

这一版明确**不做**：

- ingest
- chat
- search
- graph
- review
- deep research
- 多用户权限体系
- Rust bridge
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

项目级问答还需要配置：

```bash
LLM_WIKI_OPENAI_API_KEY=sk-...
LLM_WIKI_OPENAI_MODEL=your-model
# 可选；默认 https://api.openai.com/v1/responses
LLM_WIKI_OPENAI_BASE_URL=https://api.openai.com/v1/responses
```

也可以用 `OPENAI_API_KEY` 作为 API key fallback。未配置时，Ask section 会显示 provider 未配置错误。

说明：

- `LLM_WIKI_PROJECT_ROOTS`
  这是白名单根目录列表，多个目录用英文逗号分隔。
- `DATABASE_URL`
  这是 PostgreSQL 连接串。

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
- 项目页展示 `Overview / Files / Purpose / Schema / Project Info`
- 文件树浏览
- Markdown 预览与编辑
- 手动保存
- 非可编辑文件的元信息展示
- 路径安全校验
- 项目快照与同步记录入库

### 还没做

- 自动保存
- 保存冲突的高级处理
- 富文本编辑器
- 搜索、问答、图谱、Review、Deep Research
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
