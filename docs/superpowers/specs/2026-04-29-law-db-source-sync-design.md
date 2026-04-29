# Web 端法规数据库资料源同步 Design Spec

## 1. 背景

当前知识库工程的资料源主要来自项目本地文件，桌面端通过 `raw/sources/` 下的文件进入现有 ingest 队列，再生成 `wiki/*` 页面、搜索索引和知识图谱。现在需要支持把外部 MySQL 数据库中的法规表作为资料源导入知识库。

用户提供的目标数据库中存在 `law` 表。根据截图确认，第一版使用以下字段：

- `myId`：稳定唯一标识，作为同步主键。
- `title`：法规标题，作为本地 Markdown 文件名的主要来源。
- `content`：法规正文，作为 Markdown 正文。
- `url`：原始页面链接，写入 Markdown 元信息。
- `time`：法规时间，写入 Markdown 元信息。
- `insertTime`：入库时间，写入 Markdown 元信息。
- `type`：分类或类型，写入 Markdown 元信息。
- `sourceHtml`：第一版不导入，避免 HTML 噪声和 token 成本。

用户明确要求第一版同步逻辑放在 `web/` 子项目中完成，包括连接数据库、读取数据、写入本地文件；桌面端逻辑暂不修改。

## 2. 目标

- 在 Web 端提供手动同步入口，把 MySQL `law` 表记录同步为当前项目的本地 Markdown source 文件。
- 使用 Drizzle 操作 MySQL，不使用手写 SQL 作为主要访问方式。
- 以 `myId` 做稳定增量同步主键，记录每个 `myId` 已写入哪个文件。
- 本地文件优先以 `title` 命名。
- 支持下次同步时识别新增、更新、未变化记录。
- 不把数据库密码或真实连接信息写死进代码、文档、测试快照或错误信息。
- 不修改桌面端代码，不在第一版触发桌面端 ingest 队列。

## 3. 非目标

第一版不做：

- 不在桌面端新增数据库同步入口。
- 不修改桌面端 ingest 队列、活动面板或资料源视图。
- 不在 Web 端实现完整 ingest，不直接生成 `wiki/*`。
- 不导入 `sourceHtml` 正文。
- 不做自动同步、定时同步或启动时同步。
- 不对外部 `law` 表执行 Drizzle migration。
- 不支持任意用户传入表名或任意写入路径。

## 4. 总体方案

采用“Web 端物化本地 source 文件”的方案。Web API 收到同步请求后，通过现有 `resolveProjectById()` 找到项目根目录，然后连接 MySQL `law` 表，读取 `content` 非空的全表记录。

每条记录写为：

```text
raw/sources/database/law/{safeTitle}.md
```

其中 `{safeTitle}` 从 `title` 清洗得到。若 `title` 为空，则使用 `law-{myId前8位}.md`。若多个记录清洗后文件名冲突，第一条使用 `{title}.md`，后续使用 `{title}-{myId前8位}.md`。同步状态仍始终以 `myId` 为准，而不是以标题或文件名为准。

同步状态写入：

```text
raw/sources/database/law/.sync-state.json
```

`.sync-state.json` 记录 `myId -> title/filePath/contentHash/time/insertTime/syncedAt`。下一次同步时：

- 数据库中出现新 `myId`：创建本地 Markdown 文件，计为新增。
- 数据库中已有 `myId` 且内容 hash 变化：重写对应 Markdown 文件，计为更新。
- 数据库中已有 `myId` 且内容 hash 未变化：跳过。
- 单条记录写入失败：计入失败，不中断整个同步。

同步完成后，Web UI 展示新增、更新、跳过、失败数量和变更文件列表。用户后续可以在桌面端资料源中手动摄入这些 Markdown 文件。

## 5. 数据库访问设计

Web 端已有 PostgreSQL Drizzle 连接用于项目快照；法规库是独立 MySQL 数据源，因此新增独立连接，不复用现有 `DATABASE_URL`。

建议新增文件：

- `web/src/lib/server/law-db/client.ts`
- `web/src/lib/server/law-db/schema.ts`
- `web/src/lib/server/law-db/repo.ts`

实现约束：

- 使用 `drizzle-orm/mysql2`。
- 使用 `mysql2/promise` 创建 MySQL pool。
- 使用 `mysqlTable("law", ...)` 定义外部表字段。
- 只读查询 `myId,title,content,url,time,insertTime,type`。
- 查询条件为 `content IS NOT NULL AND content <> ''`。
- 第一版固定表名 `law`，避免动态表名破坏 Drizzle 静态 schema 边界。
- 不为外部 `law` 表生成或执行 migration。

环境变量：

```env
LAW_DB_HOST=
LAW_DB_PORT=3306
LAW_DB_DATABASE=aifood
LAW_DB_USER=
LAW_DB_PASSWORD=
```

真实密码只能放在本地或部署环境变量中，不进入仓库。

## 6. Markdown 输出格式

每条法规记录生成一个 Markdown 文件。示例：

```md
---
sourceType: mysql-law
myId: "ab480..."
title: "中华人民共和国统计法(2024修正)"
url: "http://..."
lawTime: "2024-09-13"
insertTime: "2026-04-24 10:37:52"
type: ""
contentHash: "sha256:..."
---

# 中华人民共和国统计法(2024修正)

法规正文 content...
```

生成规则：

- Markdown 正文只使用 `content`。
- `sourceHtml` 不写入文件。
- frontmatter 中保留可追溯元信息。
- `contentHash` 基于会影响本地 Markdown 的字段计算，至少包含 `title/content/url/time/insertTime/type`。
- 文件名清洗必须移除 Windows 和 POSIX 不安全字符，并限制长度，避免超长路径。

## 7. 同步状态格式

同步状态文件路径：

```text
raw/sources/database/law/.sync-state.json
```

示例：

```json
{
  "version": 1,
  "records": {
    "ab480...": {
      "title": "中华人民共和国统计法(2024修正)",
      "filePath": "raw/sources/database/law/中华人民共和国统计法(2024修正).md",
      "contentHash": "sha256:...",
      "lawTime": "2024-09-13",
      "insertTime": "2026-04-24 10:37:52",
      "syncedAt": "2026-04-29T00:00:00.000Z"
    }
  }
}
```

状态文件只作为同步加速和增量判断使用。即使状态文件缺失或损坏，也应该可以通过重新扫描目标目录和重新写入来恢复；第一版可以在状态损坏时备份旧状态并执行全量重算。

## 8. Web API 与 UI

新增 API：

```text
POST /api/projects/[projectId]/sources/law-db/sync
```

API 职责：

- 使用 `resolveProjectById()` 验证项目存在并解析项目根目录。
- 固定写入当前项目下的 `raw/sources/database/law/`。
- 调用 MySQL Drizzle repo 读取法规记录。
- 调用同步模块写入 Markdown 和 `.sync-state.json`。
- 返回同步统计和变更文件列表。

返回示例：

```json
{
  "ok": true,
  "summary": {
    "read": 1200,
    "created": 100,
    "updated": 5,
    "skipped": 1090,
    "failed": 5
  },
  "changedFiles": [
    "raw/sources/database/law/中华人民共和国统计法(2024修正).md"
  ],
  "failures": []
}
```

UI 入口放在 Web 项目工作台中，第一版可以放在 `Files` 或 `Project Info` 附近，提供按钮：

```text
同步法规数据库
```

点击后显示 loading 状态、成功统计和错误提示。UI 文案应明确说明：同步只生成本地 source 文件，不会自动生成 wiki 页面。

## 9. 安全与边界

- 数据库连接信息只来自服务端环境变量。
- 错误信息不得包含密码、完整连接串或数据库请求细节。
- API 不接受客户端传入数据库 host、用户名、密码、表名或写入目录。
- 文件写入必须限制在当前项目根目录下的 `raw/sources/database/law/`。
- 写入路径应经过现有路径安全工具或等价校验，防止路径逃逸。
- 单条记录失败不应影响其他记录同步。
- Web 同步接口应运行在 Next.js `nodejs` runtime。

## 10. 错误处理

- 数据库配置缺失：返回明确配置错误。
- MySQL 连接失败：返回连接失败，但不暴露敏感配置。
- 表字段缺失或类型异常：返回法规表结构错误。
- `.sync-state.json` 读取失败：备份损坏状态并继续全量重算。
- 单条记录 `myId` 缺失：跳过并计入失败。
- 单条记录 `title` 为空：使用 `law-{myId前8位}.md`。
- 单条记录写入失败：计入失败，继续处理下一条。

## 11. 测试要求

建议覆盖：

- `law-db` repo：
  - 只查询 `content` 非空记录。
  - 字段映射正确。
  - 连接错误转换为安全错误。
- `law-source-sync`：
  - title 文件名清洗。
  - 空 title fallback。
  - 同名 title 冲突追加 `myId` 前 8 位。
  - `.sync-state.json` 增量判断。
  - 新增、更新、跳过、失败计数。
  - `sourceHtml` 不进入 Markdown。
- API route：
  - 未知 project 返回现有项目错误。
  - 数据库配置缺失返回明确错误。
  - 同步成功返回统计结果。
  - 不允许写出项目目录。
- UI：
  - 按钮触发同步。
  - loading 状态。
  - 成功统计展示。
  - 错误提示展示。

## 12. 验收标准

- Web 端点击“同步法规数据库”后，会在当前项目下生成 `raw/sources/database/law/*.md`。
- 生成文件优先以 `title` 命名。
- 同名 title 不互相覆盖。
- `.sync-state.json` 记录 `myId` 与本地文件路径关系。
- 第二次同步未变化记录全部跳过。
- 数据库某条 `title/content/url/time/insertTime/type` 更新后，只更新对应 `myId` 的本地 Markdown 文件。
- `sourceHtml` 不进入 Markdown 正文。
- 桌面端代码无改动。
- 密码不写进代码、文档、测试快照、README 示例值或错误信息。

## 13. 已确认决策

- 采用方案 A：数据库记录物化成本地 source 文件。
- 同步入口放在 Web 端，不放在桌面端。
- 第一版手动同步，不做自动同步。
- 第一版同步 `law` 全表中 `content` 非空记录。
- 使用 `myId` 作为唯一同步主键。
- 本地 Markdown 文件优先使用 `title` 作为文件名。
- 标题冲突时追加 `myId` 前 8 位。
- 不导入 `sourceHtml`。
- MySQL 访问使用 Drizzle。
- 第一版不触发 ingest，不生成 `wiki/*`。
