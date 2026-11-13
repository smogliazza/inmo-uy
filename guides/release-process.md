# 发版流程（Release process）

每次功能迭代或修复都按这个流程走，确保**改了什么、什么时候上线、线上是哪个版本**都有据可查。

Follow this process for every feature iteration or fix, so that **what changed, when it shipped and which version is live** are always on record.

## 记录放在哪里 / Where records live

| 记录<br>*Record* | 位置<br>*Location* | 什么时候更新<br>*When to update* |
|---|---|---|
| 每次改动的说明<br>*Change description* | `CHANGELOG.md` 的 **[未发布]** 部分<br>*the **[未发布]** section of `CHANGELOG.md`* | 每个 PR 合并前<br>*Before every PR merge* |
| 版本号<br>*Version* | `backend/package.json`、`frontend/package.json` 的 `appVersion`（`version` 保留前 3 段供 npm/Prisma 解析）<br>*`appVersion` in both `package.json` files (`version` keeps the first 3 segments for npm/Prisma)* | 发版时<br>*At release* |
| 功能计划与进度<br>*Plan & progress* | `guides/roadmap.md` 的“进度跟踪”表<br>*the 进度跟踪 table in `guides/roadmap.md`* | 开始做 / 做完一项时<br>*When an item starts or finishes* |
| 线上版本<br>*Live version* | `GET https://real-estate-agency-crm.onrender.com/api/health` 返回的 `version`<br>*`version` returned by that endpoint* | 部署后核对<br>*Verify after deploy* |
| 版本标签<br>*Version tag* | git tag `vX.Y.Z.W`，对应 `main` 上的合并提交<br>*git tag `vX.Y.Z.W` on the merge commit on `main`* | 发版时<br>*At release* |
| 试用测试清单<br>*Trial test checklist* | `guides/testing-checklist.md` | 新功能需要客户验证时<br>*When a feature needs customer verification* |

## 版本号规则 / Versioning (`X.Y.Z.W`)

项目采用 **四段式版本号**（`主版本.次版本.修订号.构建/微调号`，例如 `1.0.1.0`）：
The project uses a **4-segment version** (`major.minor.patch.build`, e.g. `1.0.1.0`):
- **第 4 段（构建 / 微调号）** `1.0.1.x`：日常小修补、文案/样式微调、CI 或配置调整，不涉及功能或数据库变更。
  **Segment 4 (build)** `1.0.1.x`: small fixes, copy/style tweaks, CI or config changes — no feature or database change.
- **第 3 段（修订号）** `1.0.x.0`：只修 bug 或安全加固，不加功能，数据库不变。
  **Segment 3 (patch)** `1.0.x.0`: bug or security fixes only — no new features, database unchanged.
- **第 2 段（次版本）** `1.x.0.0`：新增功能；数据库只新增表或字段（迁移必须幂等）。
  **Segment 2 (minor)** `1.x.0.0`: new features; the database only gains tables or columns (migrations must be idempotent).
- **第 1 段（主版本）** `x.0.0.0`：不兼容的改动（删除或重命名字段、改接口、需要人工处理数据），必须提前通知客户。
  **Segment 1 (major)** `x.0.0.0`: breaking changes (dropping/renaming fields, API changes, manual data work) — customers must be told in advance.

## 日常开发（每个改动） / Day-to-day development (every change)

1. 从最新的 `main` 开分支。
   Branch from the latest `main`.
2. 写代码；数据库改动要加**幂等**迁移（`IF NOT EXISTS`），部署时会自动执行。
   Write the code; database changes need an **idempotent** migration (`IF NOT EXISTS`), applied automatically on deploy.
3. 在 `backend/tests/smoke.ts` 增加对应的检查。
   Add a matching check to `backend/tests/smoke.ts`.
4. 在 `CHANGELOG.md` 的 **[未发布]** 下按“新增 / 修复 / 安全 / 变更 / 移除”分类写一两句话，说清楚用户能感受到的变化。
   Under **[未发布]** in `CHANGELOG.md`, write a sentence or two by category (新增 / 修复 / 安全 / 变更 / 移除) saying what users will notice.
5. 如果做的是 roadmap 上的事项，更新 `guides/roadmap.md` 进度表里的状态。
   If it is a roadmap item, update its status in the progress table of `guides/roadmap.md`.
6. 自检 / Self-check:
   ```bash
   cd backend && npx tsc --skipLibCheck --noEmit && API_URL=http://localhost:4000 npm run test:smoke
   cd ../frontend && npx tsc --noEmit -p . && npx next build
   ```
7. 提 PR，描述里列出改动和测试结果。
   Open a PR listing the changes and test results.

## 发版（把若干改动正式上线） / Releasing (shipping a set of changes)

1. 确定版本号（按上面的规则）。
   Pick the version number (rules above).
2. 修改 `backend/package.json` 和 `frontend/package.json` 的 `appVersion`（4 段式 `X.Y.Z.W`）及 `version`（前 3 段 `X.Y.Z`）。`package-lock.json` 里只改 `version`（3 段），不要重新生成整个文件。
   Set `appVersion` (4-segment `X.Y.Z.W`) and `version` (first 3 segments) in `backend/package.json` and `frontend/package.json`. In `package-lock.json` change only the 3-segment `version`; do not regenerate the file.
3. 在 `CHANGELOG.md` 中把 **[未发布]** 改成 `## [X.Y.Z.W] — YYYY-MM-DD · 一句话概括`，再在上面新建一个空的 **[未发布]**。
   In `CHANGELOG.md`, rename **[未发布]** to `## [X.Y.Z.W] — YYYY-MM-DD · one-line summary` and add a fresh empty **[未发布]** above it.
4. 合并 PR 到 `main` / Merge the PR into `main`:
   - 前端由 GitHub Action 触发 Vercel 部署；
     *The frontend deploys to Vercel via a GitHub Action;*
   - 后端由 Render 自动部署，启动前会自动完成数据库迁移。
     *The backend deploys automatically on Render, running database migrations before start.*
5. 核对线上版本 / Verify the live version:
   ```bash
   curl https://real-estate-agency-crm.onrender.com/api/health   # version 应为 X.Y.Z.W
   ```
   在 Render 日志里搜索 `[release]`，确认迁移成功。
   Search the Render logs for `[release]` to confirm the migrations succeeded.
6. 打版本标签（在本地执行） / Tag the release (run locally):
   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z.W -m "vX.Y.Z.W — 一句话概括"
   git push origin vX.Y.Z.W
   ```
   可选：在 GitHub 的 Releases 页面用这个标签创建 Release，正文复制 CHANGELOG 中该版本的内容。
   Optional: create a GitHub Release from the tag and paste that version's CHANGELOG text as the body.
7. 在 `CHANGELOG.md` 该版本下补一行“已部署，线上已确认”（可以放进下一个 PR）。
   Add a line “deployed, confirmed live” under that version in `CHANGELOG.md` (may go in the next PR).

## Fork Uruguay: deploy en el Droplet (fase F4)

En el fork, empujar el tag `vX.Y.Z.W` dispara el workflow **Release** (`.github/workflows/release.yml`):

1. revisa que el tag coincida con `appVersion`;
2. publica las imágenes en GHCR;
3. hace el deploy por SSH con `deploy/deploy.sh`;
4. verifica `GET /api/health`.

Si la versión nueva no responde, `deploy.sh` **vuelve sola a la anterior** y el workflow queda en rojo.
Volver a mano: en el servidor, `cd /opt/inmo-uy && ./deploy.sh vANTERIOR`. Alta del servidor:
`guides/droplet-setup.md`; backups: `guides/restore.md`. Render y Vercel siguen funcionando para quien los use.

## 出问题时回滚 / Rolling back

- **前端**：在 Vercel 控制台把上一次部署设为 Production（Promote）。
  *Frontend*: promote the previous deployment to Production in the Vercel dashboard.
- **后端**：在 Render 控制台选择上一次部署，点 Rollback。
  *Backend*: pick the previous deployment in the Render dashboard and click Rollback.
  - 迁移只新增、不删除，所以旧版本代码可以直接运行在新的数据库上。
    *Migrations only add, never delete, so older code runs fine on the newer database.*
- 回滚后在 CHANGELOG 里记录原因，修复后发一个修订版本。
  After a rollback, record the reason in the CHANGELOG and ship a patch release once fixed.

## 版本历史 / Version history

| 版本<br>*Version* | 日期<br>*Date* | 概括<br>*Summary* | git 标签<br>*git tag* |
|---|---|---|---|
| 1.1.0.0 | 2026-10-26 | 核心痛点闭环（文件直传、线索自动分配、邮件提醒、品牌短链、CSV 批量导入）与安全加固（httpOnly Cookie/CSRF、CSP、CI、Sentry）<br>*Core pain points closed (direct file upload, automatic lead routing, email reminders, branded short links, CSV bulk import) plus security hardening (httpOnly cookie/CSRF, CSP, CI, Sentry)* | `v1.1.0.0` |
| 1.0.1.0 | 2026-10-22 | 安全加固（依赖升级、密码重置令牌哈希、安全响应头等）与版本管理<br>*Security hardening (dependency upgrades, hashed password-reset tokens, security headers) and version management* | `v1.0.1.0`（原 `1.0.1`）<br>*(was `1.0.1`)* |
| 1.0.0.0 | 2026-10-22 | 试用版首发：安全修复、自动迁移、网站获客、交易自动化<br>*First trial release: security fixes, automatic migrations, website lead capture, deal automation* | `v1.0.0.0` → `a892a82`（原 `1.0.0`）<br>*(was `1.0.0`)* |
