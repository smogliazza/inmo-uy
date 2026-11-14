# 后续执行计划（Roadmap）

本文件列出上线试用之后要做的事情，按优先级分阶段。每一项都写明：目标、要做什么（数据 / 接口 / 页面）、

This file lists what to do after the trial launch, in priority order by stage. Every item states the goal, what to build (data / API / pages), the accounts or material you need to prepare, acceptance criteria, estimated effort and risks. Effort is estimated in person-days (1 person-day = one developer for one day), testing included.
需要你准备的账号或资料、验收标准、预估工作量和风险。工作量按“1 人天 = 一个开发者一天”估算，包含测试。

现有代码约定（后续开发沿用）：
*Existing code conventions (keep following them):*
- 后端路由在 `backend/src/routes/`，跨公司校验用 `backend/src/lib/access.ts` 的 `checkRefs`、`clientScope`、`isManager`。
  *Backend routes live in `backend/src/routes/`; for cross-company checks use `checkRefs`, `clientScope`, `isManager` from `backend/src/lib/access.ts`.*
- 数据库改动：修改 `backend/prisma/schema.prisma`，再在 `backend/prisma/migrations/` 新增**幂等**的迁移（`IF NOT EXISTS`）。部署时会自动执行（`backend/src/release.ts`）。
  *Database changes: edit `backend/prisma/schema.prisma`, then add an **idempotent** migration (`IF NOT EXISTS`) under `backend/prisma/migrations/`. It is applied automatically on deploy (`backend/src/release.ts`).*
- 前端请求统一用 `frontend/src/lib/api.ts` 的 `api()`；新增文案放在 `frontend/src/lib/i18n/extra.ts`，四种语言都要填。
  *Frontend requests go through `api()` in `frontend/src/lib/api.ts`; new strings go in `frontend/src/lib/i18n/extra.ts`, filled for all four languages.*
- 功能开关：前端 `frontend/src/lib/features.ts`，后端读取环境变量。
  *Feature switches: `frontend/src/lib/features.ts` on the frontend; the backend reads env vars.*
- 每完成一项，在 `backend/tests/smoke.ts` 增加对应检查，并在 `CHANGELOG.md` 记录。
  *When an item is done, add a check to `backend/tests/smoke.ts` and record it in `CHANGELOG.md`.*

---

## 版本规划与进度跟踪 / Version plan and progress tracking

当前版本：**1.1.0.0**（2026-10-26，四段式版本号 `X.Y.Z.W`）。每开始或完成一项，就更新下表的状态和对应版本；实际改动记录在 `CHANGELOG.md`。
*Current version: **1.1.0.0** (2026-10-26, 4-segment version `X.Y.Z.W`). Whenever an item starts or finishes, update its status and version in the table below; actual changes are recorded in `CHANGELOG.md`.*
*Status: ⬜ not started · 🟡 in progress · ✅ done · ⏸ postponed*
状态：⬜ 待开始 · 🟡 进行中 · ✅ 已完成 · ⏸ 暂缓

| 计划版本<br>*Planned version* | 事项<br>*Item* | 状态<br>*Status* | 实际发布版本 / 备注<br>*Released version / notes* |
|---|---|---|---|
| 1.0.1.x | 0.1 试用反馈修复<br>*Fix issues found in the trial* | 🟡 | 持续进行（含单人公司佣金审批 UI 修复）<br>*Ongoing (includes the solo-company commission-approval UI fix)* |
| 1.0.0.0 | 0.2 处理 `manager@` / `agent@xyz.com`<br>*Handle `manager@` / `agent@xyz.com`* | ✅ | 1.0.0.0，删除或停用并匿名化<br>*1.0.0.0: deleted, or deactivated and anonymised* |
| 1.0.1.0 | 版本管理：健康检查返回版本号、发版流程（升级为 4 段式版本号）<br>*Version management: health check returns the version, release process (upgraded to 4-segment versions)* | ✅ | 1.0.1.0 |
| 1.0.1.0 | 安全检查与加固（2026-10）<br>*Security audit and hardening (2026-10)* | ✅ | 1.0.1.0；报告见 `guides/security-audit-2026-10.md`<br>*1.0.1.0; report in `guides/security-audit-2026-10.md`* |
| 1.1.0.0 | 0.3 CI 自动测试<br>*Automated tests in CI* | ✅ | `.github/workflows/ci.yml`（Postgres + 迁移 + 冒烟测试 + 前端构建）<br>*`.github/workflows/ci.yml` (Postgres + migrations + smoke test + frontend build)* |
| 1.1.0.0 | S1 开启 GitHub Dependabot / 安全告警<br>*Enable GitHub Dependabot / security alerts* | ✅ | `.github/dependabot.yml`（前后端 npm + GitHub Actions 每周巡检）<br>*`.github/dependabot.yml` (weekly scans of frontend/backend npm + GitHub Actions)* |
| 1.1.0.0 | S2 登录令牌改为 httpOnly Cookie + CSRF 防护<br>*Move the login token to an httpOnly cookie + CSRF protection* | ✅ | `crm_session` HttpOnly Cookie + `X-CSRF-Protection` 校验 + `/api/auth/logout`<br>*`crm_session` HttpOnly cookie + `X-CSRF-Protection` check + `/api/auth/logout`* |
| 1.1.0.0 | S3 前端 CSP（先只报告，再正式启用）<br>*Frontend CSP (report-only first, then enforced)* | ✅ | `frontend/next.config.ts`（默认 Report-Only，`NEXT_PUBLIC_CSP_ENFORCE=true` 开启强制）<br>*`frontend/next.config.ts` (Report-Only by default; `NEXT_PUBLIC_CSP_ENFORCE=true` enforces)* |
| 1.2.0.0 | S4 Prisma 4 → 当前版本<br>*Prisma 4 → current version* | ✅ | Fork Uruguay: Prisma 7.10.1 con adaptador `pg` (`backend/src/lib/prisma.ts`, `backend/prisma.config.ts`); migraciones y 32 smoke tests verificados en base nueva y en base migrada con Prisma 4 |
| 1.1.0.0 | 0.4 Sentry 错误监控<br>*Sentry error monitoring* | ✅ | `backend/src/lib/sentry.ts` + `frontend/src/lib/sentry.ts`（零外部依赖，按需启用）<br>*`backend/src/lib/sentry.ts` + `frontend/src/lib/sentry.ts` (no external dependency, enabled on demand)* |
| 1.1.0.0 | 0.5 遗留 lint 错误 / 硬编码文案<br>*Leftover lint errors / hard-coded strings* | ✅ | ESLint 0 errors；公开房源页/验证页/财务/设置/升级页四语种补全<br>*ESLint 0 errors; public listing / verify / finance / settings / upgrade pages completed in four languages* |
| 1.1.0.x | 0.6 `SECURITY.md`（说明如何私下报告漏洞）<br>*`SECURITY.md` (how to report a vulnerability privately)* | ✅ | `SECURITY.md` 已添加；仍需管理员开启私下报告（见 0.7）<br>*`SECURITY.md` added; the admin still has to turn on private reporting (see 0.7)* |
| 1.1.0.x | 0.7 GitHub 仓库设置补全：Secret scanning、Push protection、私下报告漏洞、`main` 分支保护（Dependabot 已开）<br>*Finish the GitHub repo settings: secret scanning, push protection, private vulnerability reporting, `main` branch protection (Dependabot is already on)* | ⬜ | 需仓库管理员在 GitHub 设置里操作<br>*The repo admin must do this in GitHub settings* |
| 1.2.0.0 | 0.8 订阅档位门槛：按 `USER_GUIDE.md` 的承诺落地，或调整文案与定价，两者保持一致<br>*Plan-tier gating: deliver what `USER_GUIDE.md` promises, or change the copy and pricing, so the two agree* | ⬜ | 目前代码里只强制了收益预测（ELITE）；需先确定各档位包含什么<br>*Today only revenue projections (ELITE) are enforced in code; first decide what each tier includes* |
| 1.2.0.0 | 0.9 审计日志补到房源、报价、预约、文档的增删改（客户与交易已覆盖）<br>*Extend the audit log to listing, offer, appointment and document writes (clients and transactions are already covered)* | ✅ | 房源、报价、预约、文档的增删改已写入审计日志，文档链接不入日志<br>*Listing, offer, appointment and document writes are now audited; document links are never logged* |
| 1.2.0.0 | 0.10 设置页「即将推出」栏目逐项落地（通知偏好已随 1.3 完成）<br>*Ship the Settings sections still labelled "Coming soon", one by one (notification preferences already shipped with 1.3)* | 🟡 | 安全、CRM、房源、财务、预约、文档栏目已完成并由服务器强制执行；2FA、登录提醒、IP 白名单、营销（等 AI 助手）、访问控制、集成仍标“即将推出”<br>*Security, CRM, Properties, Finance, Appointments and Documents are done and enforced by the server; 2FA, login alerts, the IP whitelist, Marketing (waits for the AI assistant), Access Control and Integrations stay “coming soon”* |
| 1.2.0.0 | 0.11 部署平台升级：收费前升级前端套餐（Hobby 不允许商业使用）、后端换付费实例（免费实例会休眠）<br>*Hosting upgrade: before charging, upgrade the frontend plan (Hobby prohibits commercial use) and move the backend to a paid instance (free instances sleep)* | ⬜ | 收费或接真实客户前必须完成<br>*Must be done before charging or onboarding real customers* |
| 1.2.0.0 | 0.12 冒烟测试补「权限矩阵」：低权限角色、低订阅档位账号的 401 / 403 行为<br>*Add a "permission matrix" to the smoke test: 401 / 403 behaviour for low-privilege roles and low-tier accounts* | ✅ | 冒烟测试新增权限矩阵（角色、套餐档位、401 / 403），共 25 项<br>*The smoke test gains a permission matrix (roles, plan tier, 401 / 403), 25 checks in total* |
| 1.2.0.0 | 1.1 文件上传（R2 + 数据库自动降级）<br>*File upload (R2 with automatic database fallback)* | ✅ | 支持照片直传/排序/设为封面、私密合同 10 分钟签名预览与自动清理<br>*Direct photo upload / reorder / set cover; private contracts with 10-minute signed previews and automatic cleanup* |
| 1.2.0.0 | 1.2 线索自动分配<br>*Automatic lead routing* | ✅ | 支持轮询/最低负载/指定人/挂牌经纪人规则、接单开关与干跑模拟器<br>*Round-robin / lowest-load / named-agent / listing-agent rules, an accepting-leads switch and a dry-run simulator* |
| 1.2.0.0 | 1.3 邮件提醒<br>*Email reminders* | ✅ | 支持新线索/报价/预约前24h/任务逾期邮件提醒与个人通知偏好持久化<br>*Emails for new leads / offers / 24h before appointments / overdue tasks, with persisted personal notification preferences* |
| 1.2.0.0 | 1.4 公开页地址自定义<br>*Custom public page address* | ✅ | 支持自定义 `slug`、`OrgSlugHistory` 旧地址自动跳转、Logo 直传与品牌主题色<br>*Custom `slug`, automatic redirects from old addresses via `OrgSlugHistory`, direct logo upload and brand theme colour* |
| 1.2.0.0 | 1.5 Google 登录<br>*Google sign-in* | ⏸ | 非核心痛点，移至后续按需开启（需 Google OAuth 凭证）<br>*Not a core pain point; postponed and enabled on demand (needs Google OAuth credentials)* |
| 1.2.0.0 | 3.3a 客户与房源 CSV 批量导入<br>*Bulk CSV import of clients and listings* | ✅ | 支持中英西表头自动映射、5行预览、跳过/更新防重策略与模板下载<br>*Automatic header mapping in Chinese / English / Spanish, 5-row preview, skip/update duplicate strategies and template download* |
| 1.3.0.0 | 2.1 邮件群发与序列<br>*Email blasts and sequences* | ⬜ | |
| 1.3.0.0 | 2.2 短信<br>*SMS* | ⬜ | 先提交 Twilio A2P 注册<br>*Submit the Twilio A2P registration first* |
| 1.3.0.0 | 2.3 统一收件箱<br>*Unified inbox* | ⬜ | |
| 1.3.0.0 | 2.4 开放日增强<br>*Open-house enhancements* | ⬜ | |
| 1.4.0.0 | 3.1 DocuSign | ⬜ | |
| 1.4.0.0 | 3.2 Google 日历同步<br>*Google Calendar sync* | ⬜ | |
| 1.4.0.0 | 3.3b MLS / StreetEasy 自动同步<br>*MLS / StreetEasy automatic sync* | ⬜ | 需 REBNY RLS / RESO 数据授权<br>*Needs REBNY RLS / RESO data authorisation* |
| 1.4.0.0 | 3.4 Apple 登录（带校验）<br>*Apple sign-in (with verification)* | ⬜ | |
| 1.4.0.0 | 3.5 交易流程增强<br>*Deal-flow enhancements* | ⬜ | |
| 1.5.0.0 | 4 AI 助手正式上线<br>*AI assistant goes live* | ⏸ | 代码已有，开关关闭（“正在开发”）<br>*Code exists, switch is off (“in development”)* |
| 2.x.0.0 | 5.x 团队管理与移动端<br>*Team management and mobile* | ⬜ | 按客户反馈排序<br>*Ordered by customer feedback* |

### Fases de la especificación Uruguay (fork)

| Fase | Contenido | Estado | Notas |
|---|---|---|---|
| F0 | Prisma 4 → 7 | ✅ | PR #1 |
| F1 | Sistema de módulos | ✅ | PR #2 |
| F2 | Localización Uruguay | ✅ | PR #3–#4 |
| F3 | Propiedades Uruguay (precios por operación, campos nuevos) | ✅ | PR #5 |
| F4 | Infraestructura (Droplet, Caddy, release, backups) | ✅ | PR #6 |
| F5 | Sitio público por dominio: índice, filtros, mapa, ficha, SEO | 🟡 | En revisión; Lighthouse en `guides/lighthouse/f5/` |
| F6 | Migrador desde inmobiliariaya | ⬜ | |
| F7 | Gestión de alquileres | ⬜ | Necesita las reglas de negocio del dueño |
| F8 | CRM: bandeja de consultas, matching, `/busco`, `/publicar`, exportación | ⬜ | |
| F9 | QA de punta a punta | ⬜ | |

---

## 阶段 0：试用期间（上线后 1–2 周） / Stage 0: during the trial (1–2 weeks after launch)

| # | 事项<br>*Item* | 工作量<br>*Effort* |
|---|---|---|
| 0.1 | 收集试用反馈，按 `guides/testing-checklist.md` 逐项跟进修复<br>*Collect trial feedback and fix item by item following `guides/testing-checklist.md`* | 持续 / ongoing |
| 0.2 | 处理 `manager@xyz.com` / `agent@xyz.com`（改密码或删除，等你确认）<br>*Handle `manager@xyz.com` / `agent@xyz.com` (change the password or delete, pending your confirmation)* | 0.1 |
| 0.3 | 自动化测试接入 CI：GitHub Actions 中启动 Postgres，运行迁移和冒烟测试，并执行前端 `tsc` 和 `next build`，每个 PR 自动跑<br>*Wire automated tests into CI: GitHub Actions starts Postgres, runs migrations and the smoke test, plus frontend `tsc` and `next build`, on every PR* | 1 |
| 0.4 | 错误监控：接入 Sentry（`.env.example` 里已预留 `SENTRY_DSN`），前后端都上报<br>*Error monitoring: integrate Sentry (`SENTRY_DSN` is already reserved in `.env.example`), reporting from both frontend and backend* | 0.5 |
| 0.5 | 修复遗留的 lint 错误（`marketing/page.tsx`、`reports/page.tsx`）和 i18n 扫描出的约 280 处硬编码文案<br>*Fix the leftover lint errors (`marketing/page.tsx`, `reports/page.tsx`) and the ~280 hard-coded strings found by the i18n scan* | 2 |
| 0.6 | 新增 `SECURITY.md`，说明如何私下报告漏洞（与仓库的 Private vulnerability reporting 配合）<br>*Add `SECURITY.md` explaining how to report a vulnerability privately (works with the repo's private vulnerability reporting)* | 0.2 |
| 0.7 | GitHub 仓库设置补全：Secret scanning、Push protection、私下报告漏洞、`main` 分支保护（要求 PR，不勾“不允许绕过”）、合并后自动删除分支、Actions 权限设为只读<br>*Finish the GitHub repo settings: secret scanning, push protection, private vulnerability reporting, `main` branch protection (require PRs, do not tick "do not allow bypassing"), auto-delete head branches, Actions permissions set to read-only* | 0.2（业主操作 / owner） |
| 0.8 | 订阅档位门槛：目前代码里只强制了收益预测（ELITE）；`USER_GUIDE.md` 承诺的营销 AI、MLS、自定义品牌没有强制，佣金列表对所有档位开放。先确定各档位的内容，再让代码与文档一致<br>*Plan-tier gating: today only revenue projections (ELITE) are enforced; the marketing AI, MLS and custom branding promised in `USER_GUIDE.md` are not, and the commission list is open to every tier. First decide what each tier includes, then make code and docs agree* | 1–2（决定后 / after the decision） |
| 0.9 | 审计日志（`backend/src/lib/audit.ts` 的 `audit()`）补到房源、报价、预约、文档的增删改，记录前后快照（客户与交易已覆盖）<br>*Extend the audit log (`audit()` in `backend/src/lib/audit.ts`) to listing, offer, appointment and document writes with before/after snapshots (clients and transactions are already covered)* | 1 |
| 0.10 | 设置页「即将推出」栏目逐项落地（页面 `frontend/src/app/settings/page.tsx` 的 `COMING_SOON`）：①安全：会话超时、密码过期，在登录与鉴权里强制执行；②业务模块策略（CRM 必填字段与自动归档、房源审核与照片数量）逐项落库并在路由里强制；③外观的侧栏位置 / 密度 / 日期 / 数字格式，先做全局偏好存储；④访问控制矩阵要么真正驱动鉴权，要么移除栏目；集成随各集成落地。**只有“后端保存 + 后端执行”都做完，才能从 `COMING_SOON` 移除**<br>*Ship the Settings sections still in `COMING_SOON` (`frontend/src/app/settings/page.tsx`) one by one: (1) security: session timeout and password expiry, enforced in login and auth; (2) module policies (CRM required fields and auto-archive, listing approval and photo counts), each persisted and enforced in the routes; (3) the Appearance sidebar position / density / date / number format, starting with a global preference store; (4) the access-control matrix must either truly drive authorization or be removed; integrations ship with each integration. **A section may leave `COMING_SOON` only once both backend saving and backend enforcement are done***<br>**进展 / Progress（2026-11）**：①中的会话时长、密码长度与特殊字符、密码过期、改密码后退出已由后端保存并强制执行；2FA、登录提醒、IP 白名单仍标「即将推出」。<br>*Of (1), session length, password length and special character, password expiry and sign-out on password change are saved and enforced by the backend; 2FA, login alerts and IP whitelist stay marked “coming soon”.*<br>**进展 / Progress（2026-11，续）**：②中的 CRM（必填字段、客户上限、可见范围、查重）、房源（谁能新建、必填、照片数量、描述长度）、预约（防重复、缓冲、工作时间）、文档（格式、大小）、财务（财年、佣金可见）已落库并强制执行，见 `backend/src/lib/policies.ts`；自动归档、房源审核、MLS 同步等没有对应的服务器能力，已从界面移除。<br>*Of (2), CRM (required fields, client limit, visibility, duplicate check), Properties (who can create, required fields, photo counts, description length), Appointments (double booking, buffer, workday), Documents (formats, size) and Finance (fiscal year, commission visibility) are persisted and enforced, see `backend/src/lib/policies.ts`; auto-archive, listing approval, MLS sync and the like have no server capability and were removed from the screen.* | 约 7–9 / about 7–9 |
| 0.11 | 部署平台升级：前端套餐升级（Hobby 仅限个人非商业用途）、后端换付费实例（免费实例闲置 15 分钟休眠，唤醒约 1 分钟）；迁移到其他平台作为上线稳定后的独立项目评估<br>*Hosting upgrade: upgrade the frontend plan (Hobby is for personal, non-commercial use only) and move the backend to a paid instance (free instances sleep after 15 minutes idle and take about 1 minute to wake); evaluate moving to another platform as a separate project once launch has stabilised* | 配置级 / configuration |
| 0.12 | 冒烟测试补权限矩阵：用经纪人、经理、低订阅档位账号验证 401 与 403 不混用、不越权可见、不被误登出<br>*Add the permission matrix to the smoke test: with agent, manager and low-tier accounts, verify that 401 and 403 are not mixed up, nothing is over-visible, and nobody is wrongly logged out* | 1 |

**验收**：PR 上能看到 CI 测试结果；线上报错能在 Sentry 里看到。
*Acceptance: CI results are visible on PRs; production errors show up in Sentry.*

---

## 阶段 1：核心体验补全（约 2–3 周） / Stage 1: completing the core experience (about 2–3 weeks)

### 1.1 文件真正上传（照片、合同文档） / Real file upload (photos, contract documents)
- **现状**：照片和文档只能填链接。
  *Today: photos and documents can only be entered as links.*
- **目标**：直接从电脑或手机上传，文件存到 Cloudflare R2（`.env.example` 里已有 R2 变量）。
  *Goal: upload straight from a computer or phone, storing files in Cloudflare R2 (the R2 variables are already in `.env.example`).*
- **数据**：`MediaAsset` 和 `Document` 已有 `url`、`sizeBytes`、`mimeType` 字段，无需改表；新增 `storageKey` 字段，用于删除文件。
  *Data: `MediaAsset` and `Document` already have `url`, `sizeBytes`, `mimeType`, so no table change; add a `storageKey` column used to delete files.*
- **接口**：`POST /api/uploads/presign`（返回预签名上传地址，限制类型和大小：图片 ≤ 15MB，PDF ≤ 25MB），上传完成后再调用现有的 `POST /api/media` 和 `POST /api/documents`。删除记录时同时删除 R2 里的文件。
  *API: `POST /api/uploads/presign` (returns a presigned upload URL, limiting type and size: images ≤ 15MB, PDFs ≤ 25MB); after upload, call the existing `POST /api/media` and `POST /api/documents`. Deleting a record also deletes the file in R2.*
- **安全**：合同等文档放在私有存储桶，查看时由后端生成 10 分钟有效的临时链接；房源照片可以放公开存储桶。
  *Security: contracts and similar documents live in a private bucket and are viewed through 10-minute temporary links generated by the backend; listing photos may use a public bucket.*
- **页面**：房源照片支持拖拽上传和排序；文档页支持上传，并可预览 PDF。
  *Pages: listing photos support drag-and-drop upload and reordering; the documents page supports upload and PDF preview.*
- **需要你准备**：Cloudflare 账号，创建两个存储桶（公开、私有）和 API Token。
  *You need to prepare: a Cloudflare account, two buckets (public, private) and an API token.*
- **验收**：上传照片后公开页能显示；文档只有本公司有权限的人能打开；删除后文件同时被清理。
  *Acceptance: an uploaded photo shows on the public page; only authorised people in the company can open a document; deleting a record also cleans up the file.*
- **工作量**：4 人天。
  *Effort: 4 person-days.*

### 1.2 线索自动分配 / Automatic lead routing
- **现状**：只能由经理手动指派。
  *Today: only a manager can assign manually.*
- **目标**：网站和开放日来的线索按规则自动分给经纪人（参考 splash-lead-router）。
  *Goal: leads from the website and open houses are assigned to agents by rule (modelled on splash-lead-router).*
- **数据**：新表 `LeadRoutingRule`（orgId、优先级、条件：来源 / 区域 / 预算区间 / 房源类型、分配方式：指定人 / 轮询 / 负载最少、是否启用）；`User` 新增 `acceptingLeads Boolean` 和 `maxActiveLeads Int?`。
  *Data: new table `LeadRoutingRule` (orgId, priority, conditions: source / area / budget range / property type, assignment mode: named agent / round-robin / least load, enabled flag); `User` gains `acceptingLeads Boolean` and `maxActiveLeads Int?`.*
- **逻辑**：放在 `backend/src/lib/routing.ts`。网站咨询默认仍然分给挂牌经纪人；规则按优先级依次匹配，命中后分配并通知；全部没命中时分给公司管理员。
  *Logic: in `backend/src/lib/routing.ts`. Website inquiries still default to the listing agent; rules are matched in priority order, and on a hit the lead is assigned and notified; if nothing matches it goes to the company admin.*
- **页面**：设置中新增“线索分配”页，可增删、排序规则，并能用一条示例线索测试会分给谁。
  *Pages: a new “Lead routing” page in Settings to add, delete and reorder rules and to test with a sample lead who it would be assigned to.*
- **验收**：配置轮询后，连续 3 条线索依次分给 3 个人；停止接单的经纪人不会被分到。
  *Acceptance: with round-robin configured, 3 consecutive leads go to 3 different people; agents who stopped accepting leads are never assigned.*
- **工作量**：4 人天。
  *Effort: 4 person-days.*

### 1.3 线索 / 预约的邮件提醒 / Email reminders for leads and appointments
- **现状**：只有站内通知。`backend/src/lib/email.ts` 已支持 Resend 和 SendGrid。
  *Today: in-app notifications only. `backend/src/lib/email.ts` already supports Resend and SendGrid.*
- **目标**：新线索、预约前 24 小时、任务逾期时，同时给经纪人发邮件；每个人可以在设置里关闭。
  *Goal: email the agent as well for new leads, 24 hours before appointments and when tasks are overdue; each person can turn this off in Settings.*
- **数据**：`User` 新增 `notificationPrefs Json`。
  *Data: `User` gains `notificationPrefs Json`.*
- **需要你准备**：Resend 账号，以及已验证的发件域名（配置 `EMAIL_API_KEY`、`EMAIL_FROM`）。
  *You need to prepare: a Resend account and a verified sending domain (configure `EMAIL_API_KEY`, `EMAIL_FROM`).*
- **工作量**：2 人天。
  *Effort: 2 person-days.*

### 1.4 公开页地址自定义 / Custom public page address
- 允许公司管理员修改 `slug`（例如改成 `premier-realty`），需要校验格式和唯一性。改名后旧地址跳转到新地址：新表 `OrgSlugHistory` 记录旧地址。
  *Let company admins change the `slug` (e.g. to `premier-realty`), validating format and uniqueness. After a rename the old address redirects to the new one: a new table `OrgSlugHistory` records old addresses.*
- 同一个页面允许上传 Logo、设置主题色。
  *The same page lets them upload a logo and set a theme colour.*
- **工作量**：1.5 人天。
  *Effort: 1.5 person-days.*

### 1.5 Google 登录（真正可用） / Google sign-in (actually working)
- **现状**：按钮显示“即将推出”；后端接口在生产环境需要配置 `GOOGLE_CLIENT_ID` 才能使用。
  *Today: the button shows “coming soon”; in production the backend endpoint needs `GOOGLE_CLIENT_ID` configured.*
- **做法**：前端接入 Google Identity Services，拿到 `idToken` 后调用 `/api/oauth/google`。已有账号需要先用密码登录，再在“设置 → 账号”里绑定 Google（新增 `POST /api/oauth/google/link` 接口，需登录后调用）。
  *Approach: integrate Google Identity Services on the frontend and call `/api/oauth/google` with the `idToken`. Existing accounts must first sign in with a password, then link Google under Settings → Account (a new `POST /api/oauth/google/link` endpoint, called while signed in).*
- **需要你准备**：Google Cloud 的 OAuth Client ID，以及授权的域名。
  *You need to prepare: a Google Cloud OAuth Client ID and the authorised domains.*
- **工作量**：2 人天。Apple 登录见 3.4。
  *Effort: 2 person-days. See 3.4 for Apple sign-in.*

---

## 阶段 2：获客与沟通（约 3–4 周） / Stage 2: lead generation and communication (about 3–4 weeks)

### 2.1 邮件群发与培育序列 / Email blasts and nurture sequences
- **目标**：按客户筛选条件（类型、优先级、来源、标签）批量发邮件；支持自动序列，例如新线索第 0 / 2 / 7 / 14 天各发一封。
  *Goal: send email in bulk by client filters (type, priority, source, tags); support automatic sequences, e.g. one email each on day 0 / 2 / 7 / 14 for a new lead.*
- **数据**：新表 `Campaign`（名称、渠道、模板、受众条件、状态、计划时间）、`CampaignRecipient`（发送状态、打开、点击、退订）、`Sequence` 和 `SequenceStep`、`SequenceEnrollment`；`Client` 新增 `emailOptOut`。
  *Data: new tables `Campaign` (name, channel, template, audience conditions, status, scheduled time), `CampaignRecipient` (delivery status, opens, clicks, unsubscribes), `Sequence`, `SequenceStep`, `SequenceEnrollment`; `Client` gains `emailOptOut`.*
- **合规**：每封邮件必须带退订链接（CAN-SPAM 要求）；退订的客户自动排除；发送频率要限制。
  *Compliance: every email must carry an unsubscribe link (CAN-SPAM); unsubscribed clients are excluded automatically; sending frequency must be limited.*
- **后端**：发送任务需要一个后台队列。Render 免费版会休眠，所以这时需要升级到付费实例，或使用 Render Cron Job，或改用 Upstash QStash 这类托管队列。
  *Backend: sending needs a background queue. Render's free tier sleeps, so this requires upgrading to a paid instance, using a Render Cron Job, or a managed queue such as Upstash QStash.*
- **页面**：营销页新增“群发”和“序列”标签页、模板编辑器（支持 `{{firstName}}` 等变量）和发送报表。
  *Pages: the Marketing page gains “Blasts” and “Sequences” tabs, a template editor (with variables such as `{{firstName}}`) and a sending report.*
- **需要你准备**：Resend 或 SendGrid 账号，并完成发件域名的 SPF / DKIM 配置。
  *You need to prepare: a Resend or SendGrid account with the sending domain's SPF / DKIM configured.*
- **工作量**：8 人天。
  *Effort: 8 person-days.*

### 2.2 短信（以及可选的 WhatsApp） / SMS (and optionally WhatsApp)
- **目标**：在客户页直接给客户发短信，并接收回复；与时间线打通。
  *Goal: text clients straight from the client page and receive replies, linked to the timeline.*
- **服务商**：Twilio。美国的短信必须先完成 A2P 10DLC 注册，审核约 1–3 周，**要尽早提交**。
  *Provider: Twilio. US SMS requires A2P 10DLC registration first; review takes about 1–3 weeks, so **submit early**.*
- **数据**：新表 `Message`（clientId、方向、渠道、内容、状态、服务商消息 ID）；`Client` 新增 `smsOptOut`。客户回复 STOP 时自动退订。
  *Data: new table `Message` (clientId, direction, channel, content, status, provider message ID); `Client` gains `smsOptOut`. A client replying STOP is unsubscribed automatically.*
- **接口**：`POST /api/messages/sms`（发送）；`POST /api/webhooks/twilio`（接收回复，需要校验 Twilio 签名）。
  *API: `POST /api/messages/sms` (send); `POST /api/webhooks/twilio` (receive replies; the Twilio signature must be verified).*
- **页面**：客户详情新增“消息”标签页；顶部显示未读消息数。
  *Pages: a “Messages” tab on client detail; an unread-message count at the top.*
- **工作量**：5 人天，不含审核等待时间。
  *Effort: 5 person-days, excluding review wait time.*
- **风险**：短信合规（TCPA）——必须有客户同意的记录。网站表单需要加同意勾选框，并保存同意时间。
  *Risk: SMS compliance (TCPA) — a record of client consent is mandatory. Website forms need a consent checkbox and the consent time must be saved.*

### 2.3 统一收件箱 / Unified inbox
- 把邮件回复、短信、网站咨询汇总到一个页面，可以按经纪人分配。依赖 2.1 和 2.2。
  *Collect email replies, SMS and website inquiries on one page, assignable by agent. Depends on 2.1 and 2.2.*
- 邮件回复的接收需要使用服务商的入站解析（Resend 或 SendGrid Inbound）。
  *Receiving email replies needs the provider's inbound parsing (Resend or SendGrid Inbound).*
- **工作量**：5 人天。
  *Effort: 5 person-days.*

### 2.4 开放日模式增强 / Open-house mode enhancements
- 签到页增加：是否已有经纪人、预算、购房时间、同意接收联系等问题；生成可直接打印的二维码 PDF。
  *Add to the sign-in page: whether they already have an agent, budget, purchase timeline and consent to be contacted; generate a print-ready QR code PDF.*
- 开放日结束后，自动给当天签到的人生成跟进任务；启用 2.1 后可以自动发感谢邮件。
  *After the open house, automatically create follow-up tasks for everyone who signed in that day; once 2.1 is live, thank-you emails can be sent automatically.*
- **工作量**：2 人天。
  *Effort: 2 person-days.*

---

## 阶段 3：交易与外部集成（约 3–4 周） / Stage 3: deals and external integrations (about 3–4 weeks)

### 3.1 DocuSign 电子签 / DocuSign e-signature
- **现状**：`backend/src/routes/integrations.ts` 里是模拟接口。
  *Today: `backend/src/routes/integrations.ts` holds a mock endpoint.*
- **做法**：使用 DocuSign eSignature REST API 和 JWT 授权（`.env.example` 里已预留变量）。从交易的文档中选择文件，设置签署人后发送；通过 Webhook（DocuSign Connect）回写签署状态，更新 `Document.signedAt`，并通知经纪人。
  *Approach: use the DocuSign eSignature REST API with JWT auth (variables already reserved in `.env.example`). Pick a file from the deal's documents, set the signers and send; write the status back via a webhook (DocuSign Connect), update `Document.signedAt` and notify the agent.*
- **需要你准备**：DocuSign 开发者账号，正式上线时需要 Go-Live 审核。
  *You need to prepare: a DocuSign developer account; going live requires a Go-Live review.*
- **工作量**：5 人天。依赖 1.1 文件上传。
  *Effort: 5 person-days. Depends on 1.1 file upload.*

### 3.2 Google 日历同步 / Google Calendar sync
- **做法**：OAuth 授权后，预约单向同步到 Google 日历（新增、修改、取消）。之后可以做双向同步，用 watch channel 接收变更。
  *Approach: after OAuth authorisation, sync appointments one-way to Google Calendar (create, edit, cancel). Two-way sync can follow, receiving changes through a watch channel.*
- **数据**：新表 `CalendarConnection`（userId、refreshToken 加密存储、calendarId）；`Appointment` 新增 `externalEventId`。
  *Data: new table `CalendarConnection` (userId, encrypted refreshToken, calendarId); `Appointment` gains `externalEventId`.*
- **工作量**：4 人天（单向），双向另加 3 人天。
  *Effort: 4 person-days (one-way); two-way adds 3 more.*

### 3.3 房源数据导入（MLS / StreetEasy / Zillow） / Listing data import (MLS / StreetEasy / Zillow)
- **现状**：“Zillow 自动填充”是模拟数据。
  *Today: “Zillow auto-fill” is mock data.*
- **现实情况**：Zillow 已经停止公开 API；纽约地区主要是 REBNY RLS 和 StreetEasy 的数据源，都需要经纪公司向数据方申请授权。
  *Reality: Zillow has stopped its public API; in New York the main sources are REBNY RLS and StreetEasy, and both require the brokerage to apply to the data owner for authorisation.*
- **做法**：先实现 **CSV 或 Excel 批量导入房源和客户**（不依赖第三方，马上就能用）；拿到 RLS 或 RESO Web API 授权后，再做定时同步。
  *Approach: first build **CSV or Excel bulk import of listings and clients** (no third-party dependency, usable immediately); once RLS or RESO Web API authorisation arrives, add scheduled sync.*
- **工作量**：CSV 导入 3 人天；RESO 同步 6 人天，需等授权。
  *Effort: CSV import 3 person-days; RESO sync 6 person-days, pending authorisation.*

### 3.4 Apple 登录（带校验） / Apple sign-in (with verification)
- 使用 Apple 公钥校验 `identityToken`（例如 `apple-signin-auth` 库），从校验后的 token 里读取邮箱，不再信任请求体里的数据；之后重新开放 `/api/oauth/apple`。
  *Verify the `identityToken` with Apple's public keys (e.g. the `apple-signin-auth` library), read the email from the verified token instead of trusting the request body, then reopen `/api/oauth/apple`.*
- **需要你准备**：Apple Developer 账号，配置 Services ID 和 Key。
  *You need to prepare: an Apple Developer account with a Services ID and Key configured.*
- **工作量**：1.5 人天。
  *Effort: 1.5 person-days.*

### 3.5 交易流程增强 / Deal-flow enhancements
- 过户清单模板可以按公司自定义：新表 `ChecklistTemplate`，按交易类型区分（买方、卖方、租赁、Co-op 等）。
  *Closing-checklist templates customisable per company: new table `ChecklistTemplate`, by deal type (buyer, seller, rental, co-op, etc.).*
- 交易详情页：用时间轴展示各个关键日期，并在到期前提醒。
  *Deal detail page: show key dates on a timeline and remind before they fall due.*
- 双方经纪人分佣：一笔交易可以有多个佣金记录，按比例拆分（数据结构已支持多条记录）。
  *Split commission between both agents: one deal can have several commission records split by percentage (the data model already supports multiple records).*
- **工作量**：5 人天。
  *Effort: 5 person-days.*

---

## 阶段 4：AI 助手正式上线（约 1–2 周，可与阶段 2、3 并行） / Stage 4: AI assistant goes live (about 1–2 weeks, can run in parallel with stages 2 and 3)

- **现状**：代码已完成（`backend/src/lib/ai.ts`，共 8 个技能），目前通过开关关闭。
  *Today: the code is complete (`backend/src/lib/ai.ts`, 8 skills) and switched off.*
- **上线前要做**：
  *Before launch:*
  1. 内部评测：每个技能准备 10–20 条真实场景，检查内容是否准确、是否有编造信息、是否违反公平住房规定；必要时调整提示词。
     *Internal evaluation: prepare 10–20 real scenarios per skill, check that content is accurate, free of invented facts and Fair Housing compliant; adjust prompts if needed.*
  2. 用量和费用控制：新表 `AiUsage`（每次调用的 token 数和费用），按公司设置每月额度，超出后提示升级套餐。
     *Usage and cost control: new table `AiUsage` (tokens and cost per call), a monthly quota per company, with an upgrade prompt once exceeded.*
  3. 生成结果只作为草稿：一键填入房源描述或邮件草稿，用户确认后才保存。
     *Output is only a draft: one click fills the listing description or email draft, saved only after the user confirms.*
  4. 隐私：在隐私政策中说明会把哪些客户数据发给 AI 服务商。
     *Privacy: the privacy policy must state which client data is sent to the AI provider.*
- **开启方式**：后端设置 `AI_ASSISTANT_ENABLED=true` 和 `ANTHROPIC_API_KEY`，前端设置 `NEXT_PUBLIC_AI_ASSISTANT_ENABLED=true`。
  *How to enable: set `AI_ASSISTANT_ENABLED=true` and `ANTHROPIC_API_KEY` on the backend and `NEXT_PUBLIC_AI_ASSISTANT_ENABLED=true` on the frontend.*
- **工作量**：4 人天（不含评测时间）。
  *Effort: 4 person-days (excluding evaluation time).*

---

## 阶段 5：团队管理与移动端（按需） / Stage 5: team management and mobile (as needed)

| # | 事项<br>*Item* | 说明<br>*Description* | 工作量<br>*Effort* |
|---|---|---|---|
| 5.1 | 业绩目标与排行榜<br>*Performance goals and leaderboard* | 月度目标（带看数、报价数、成交额），仪表盘进度条，排行榜<br>*Monthly goals (showings, offers, closed volume), dashboard progress bars, leaderboard* | 3 |
| 5.2 | 报表增强<br>*Better reports* | 线索来源转化率、平均成交周期、经纪人对比；支持导出 Excel<br>*Lead-source conversion, average time to close, agent comparison; Excel export* | 4 |
| 5.3 | 移动端体验<br>*Mobile experience* | 先完善 PWA（`manifest.json` 已有）：离线缓存、添加到主屏幕、推送通知；再评估是否开发原生 App<br>*Polish the PWA first (`manifest.json` exists): offline cache, add to home screen, push notifications; then decide whether to build a native app* | 4（PWA） |
| 5.4 | 一键拨号与通话记录<br>*One-tap dialing and call log* | 用 Twilio Voice 网页拨号，自动记录通话时长，可选录音（需事先告知对方）<br>*Dial from the web with Twilio Voice, log call duration automatically, optional recording (the other party must be told beforehand)* | 5 |
| 5.5 | 账号安全<br>*Account security* | 管理员强制两步验证（TOTP），登录设备管理<br>*Mandatory two-step verification (TOTP) for admins, signed-in device management* | 3 |

---

## 建议排期 / Suggested schedule

| 周次<br>*Week* | 内容<br>*Content* |
|---|---|
| 第 1–2 周<br>*Weeks 1–2* | 阶段 0；同时提交 Twilio A2P 10DLC 注册、DocuSign 开发者账号申请<br>*Stage 0; in parallel submit the Twilio A2P 10DLC registration and the DocuSign developer account application* |
| 第 3–5 周<br>*Weeks 3–5* | 阶段 1（文件上传 → 线索分配 → 邮件提醒 → 公开页地址自定义 → Google 登录）<br>*Stage 1 (file upload → lead routing → email reminders → custom public address → Google sign-in)* |
| 第 6–9 周<br>*Weeks 6–9* | 阶段 2（群发与序列 → 短信 → 收件箱 → 开放日增强）<br>*Stage 2 (blasts and sequences → SMS → inbox → open-house enhancements)* |
| 第 10–13 周<br>*Weeks 10–13* | 阶段 3（DocuSign → 日历同步 → CSV 导入 → Apple 登录 → 交易增强）<br>*Stage 3 (DocuSign → calendar sync → CSV import → Apple sign-in → deal enhancements)* |
| 穿插进行<br>*Interleaved* | 阶段 4：AI 评测与上线<br>*Stage 4: AI evaluation and launch* |
| 之后<br>*Afterwards* | 阶段 5，按客户反馈排序<br>*Stage 5, ordered by customer feedback* |

## 需要你提前准备的账号 / Accounts to prepare in advance

| 用途<br>*Purpose* | 服务<br>*Service* | 对应阶段<br>*Stage* |
|---|---|---|
| 错误监控<br>*Error monitoring* | Sentry | 0 |
| 文件存储<br>*File storage* | Cloudflare R2 | 1.1 |
| 邮件<br>*Email* | Resend 或 SendGrid，并配置发件域名 DNS<br>*Resend or SendGrid, with sending-domain DNS configured* | 1.3、2.1 |
| Google 登录和日历<br>*Google sign-in and calendar* | Google Cloud OAuth | 1.5、3.2 |
| 短信和电话<br>*SMS and calls* | Twilio，并完成 A2P 10DLC 注册<br>*Twilio, with A2P 10DLC registration completed* | 2.2、5.4 |
| 电子签<br>*E-signature* | DocuSign 开发者账号，正式使用需 Go-Live<br>*DocuSign developer account; production use needs Go-Live* | 3.1 |
| 房源数据<br>*Listing data* | REBNY RLS 或 MLS 数据授权<br>*REBNY RLS or MLS data authorisation* | 3.3 |
| Apple 登录<br>*Apple sign-in* | Apple Developer 账号<br>*Apple Developer account* | 3.4 |
| AI | Anthropic API Key | 4 |
| 后台任务<br>*Background jobs* | Render 付费实例或 Cron Job<br>*Render paid instance or Cron Job* | 2.1 起 / from 2.1 |
