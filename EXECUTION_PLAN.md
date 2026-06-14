# 王者五排战报系统 Execution Plan

更新日期：2026-06-14

## 0. 使用方式

这个文件是开发执行清单。新开 Codex 窗口时，先让 Codex 读取：

- `specs/product-spec.md`
- `EXECUTION_PLAN.md`

执行规则：

- 每次开始开发前，先确认本文件里的 `当前状态` 和 `下一步`。
- 每个阶段或批量任务开始前，先判断是否存在重复、可拆分、低耦合的工作；在不影响质量的前提下，优先用 sub-agent 并行产出草稿或核对结果。
- 每完成一个可验证任务，勾选对应 checklist。
- 每完成一个阶段，更新 `当前状态`、`下一步`、`已知风险`。
- 不要跳过验证项。
- 不要提前做 v2/backlog。
- 如果实现与 spec 冲突，以 `specs/product-spec.md` 为准，并先更新本文件说明原因。

sub-agent 使用边界：

- 适合并行：批量读图/OCR 草稿、批量核对截图字段、重复性数据整理、独立文件或独立局号的初步检查。
- 不适合并行：需要整体架构判断、跨模块代码修改、正式入库、最终 schema 取舍、会影响用户数据的不可逆操作。
- sub-agent 只产出草稿或核对意见；主线程必须负责复核、规范化、写文件、跑校验和记录最终结论。
- 如果 sub-agent 输出与截图、schema、导入结果或既有代码冲突，以主线程复核和可验证结果为准。

重要边界：

- Codex 不会在后台自动实时勾选 checklist。
- 勾选动作需要在开发过程中由 Codex 主动更新本文件。
- 新窗口只要读取本文件，就能知道已经做了什么、下一步做什么。

## 0.1 新窗口接力摘要（2026-06-14）

工作目录：本轮已切换到 Windows 机器，路径为 `C:\Users\kyrielcsun\hok-five-stack-analytics`（之前是 `/Users/kyrielcsun/Documents/Lab/hok-five-stack-analytics`）。

当前真实库：`data/hok.sqlite`。

当前进度：

- batch-001 30 局正式入库（012/032 rejected）；batch-002 6 局正式入库；batch-003 15 局正式入库（009/017/018 rejected）。真实库现共 **51 局正式对局**：`matches` 51 条、`match_players` 510 条、`review_matches` 56 条、`review_events` 75 条；`review_matches` 状态为 51 条 `imported`、5 条 `rejected`，无待审。
- 当前公开报告期为 `period:all-current`，名称是 “累计 51 局战报”，包含全部 51 局；`public/export/report-data.json` 已是该报告期的导出，`apps/web/dist` 已重新 build。
- 51 局口径下榜单门槛：`best_lineup_min_lane_games = 6`（= ceil(51 \* 10%)），`hero_losing_min_games = 3`（= max(3, ceil(51 \* 5%)) = 3）。
- 本轮已通过的验证：临时库 `import-review-json.js` 18 份成功 + 真实库 18 份成功；`approveReviewMatch` 15 份零错误，`rejectReviewMatch` 3 份零错误；`check:phase2`（8 表 / 9 朋友 / 130 英雄）、`check:phase7`、`check:phase8` 均通过；`node node_modules/vite/bin/vite.js build apps/web` 生成 `apps/web/dist`，`public/export/report-data.json` 与 `apps/web/dist/export/report-data.json` 同步为 51 局口径（748957 字节）。
- batch-003 OCR 录入产物：`data/imports/batch-003` 共 36 张 PNG，按文件名两张一组整理为 18 局；其中 001-008、010-016 为正式候选并已批准；006/016 IMG_8535 / IMG_8555 不是标准详情页，detail 指标保留 `null` 已入库；009/017/018 仅 1 位已知朋友，已 rejected 且不纳入统计。
- Vercel 生产已切到 51 局口径：本轮发布部署 `dpl_He1zzzhpGNuujofd2hSAnkjEyZDr`，主域名 alias `https://hok-five-stack-analytics.vercel.app`，线上 `/`、`/database`、`/matches/match:batch-003:001`、`/export/report-data.json` 均返回 200，线上 JSON 验证为 `period:all-current` / 51 局 / 阵容门槛 6 场 / 必输榜门槛 3 场 / 包含 batch-003 数据。
- 新电脑环境差异：原 node_modules 缺 Windows 原生 rollup 二进制 `@rollup/rollup-win32-x64-msvc`，已用 `npm install @rollup/rollup-win32-x64-msvc --no-save` 临时补齐；`vite` CLI 不在 PATH 上，build 必须用 `node node_modules/vite/bin/vite.js`。Vercel CLI 在新电脑配登录后已可用，账号仍为 `kyrieaiplayer-6650`，`.vercel/project.json` 复用旧链接。
- 历史保留：用户已确认 `吧唧小喵` 是朋友，并已加入 `server/db/friends.js`；`鸽` 在 026 使用明世隐已修正。

新窗口建议第一步：

1. 读取 `specs/product-spec.md` 和本文件。
2. 先查真实库状态，确认仍是 51 局已入库、5 局 rejected、无待审：

```bash
node --experimental-sqlite -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('data/hok.sqlite');
const counts = {};
for (const table of ['review_matches', 'matches', 'match_players', 'review_events']) {
  counts[table] = db.prepare(\`SELECT COUNT(*) AS count FROM \${table}\`).get().count;
}
const statuses = db.prepare(\`SELECT status, COUNT(*) AS count FROM review_matches GROUP BY status ORDER BY status\`).all();
const periods = db.prepare(\`SELECT id, name, json_array_length(match_ids_json) AS match_count FROM report_periods ORDER BY updated_at DESC\`).all();
console.log(JSON.stringify({ counts, statuses, periods }, null, 2));
db.close();
"
```

3. 如要发布 Vercel 51 局新版：先在新电脑配登录（`npx vercel login` 或导出 `VERCEL_TOKEN`），然后 `npx vercel --prod --yes`，线上验证桌面 + 手机视口和 console 无 error。
4. 启动本地管理员工具（如需继续审核新批次）：

```bash
node --experimental-sqlite server/index.js
HOK_API_TARGET=http://127.0.0.1:3001 node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5173
```

5. 打开 `http://127.0.0.1:5173/`。

下一步待办：

1. 在新电脑配好 Vercel CLI 登录后，发布 51 局口径到生产，再做线上验证。
2. 如有 batch-004 截图，按 batch-003 流程处理；流水线脚本已就绪。
3. 分路复核仍暂停；剩余 `manual_guess` / `low` 不继续逐项检查，除非榜单/单局出现明显异常。

注意事项：

- 不要在真实库上随手重跑 `scripts/import-review-json.js`；该脚本会 upsert `review_matches` 并把状态写回 `pending_review`。如需验证导入，用临时库：

```bash
tmpdir=$(mktemp -d); HOK_DB_PATH="$tmpdir/hok.sqlite" node --experimental-sqlite scripts/import-review-json.js data/imports/batch-001/matches
```

- 当前环境 `node v24.14.0` 在 PATH 上可直接调用；`vite` CLI 不在 PATH，须用 `node node_modules/vite/bin/vite.js`。
- SQLite 使用 Node 内置 `node:sqlite`，需要 `--experimental-sqlite`，experimental warning 属预期。
- 本轮真实库备份：`data/hok.sqlite.backup-before-batch-003-20260614-211540`（导入 batch-003 前的 36 局快照）。
- 032、batch-001:012、batch-003:009/017/018 持续保持 rejected，不纳入正式库、报告期或导出。
- `apps/web/dist` 与 `public/export/report-data.json` 均为 51 局新口径；线上仍是旧 36 局版本，发布前提醒用户口径变化。

## 1. 当前状态

- 项目阶段：batch-001 30 局 + batch-002 6 局 + batch-003 15 局，共 51 局正式入库；batch-001:012、batch-001:032、batch-003:009/017/018 共 5 局 rejected；真实本地库无待审遗留局。Phase 10 batch-003 追加导入流水线已完成审核入库 + 报告期刷新 + 静态导出 + 前端 build + Vercel 生产发布；线上主域名已切到 51 局口径。
- MVP 架构：local-first，单机管理员工具 + 静态朋友站。
- 技术栈：Vite/React + 本地 Node API + SQLite。
- OCR：Codex-assisted OCR，不要求独立 API key。
- 数据库：本地 SQLite。
- 朋友侧：脱敏静态只读站。
- 管理员侧：本地工作台。
- 本轮已完成：SQLite MVP schema、数据库初始化脚本、9 位朋友 seed、官网全量 `heroes.json`、英雄读取/搜索工具、朋友/英雄 API 查询端点、Phase 2 检查脚本、单局 `review.json` schema、2 局待审样例、review JSON 校验/规范化模块、导入脚本、Phase 3 检查脚本、review match 查询 API、review 截图读取 API、管理员待审列表、单局详情页、截图展示、基础信息编辑、玩家表编辑、朋友身份下拉、英雄输入/下拉、分路/来源/置信度选择、低置信度字段高亮、保存草稿、批准入库、拒绝本局、最小 `review_events` 记录、批准入库硬必填校验、朋友玩家标准英雄/唯一位置/评分/KDA 校验、统计纳入开关 UI 和入库写入、内容型 `dedupe_key`、疑似重复检测、重复批准拦截、重复冲突提示 UI、强制导入原因写入和 `dedupe_override` 事件记录、已入库对局列表/详情/编辑 API、已入库对局编辑 UI、重复冲突“用当前数据修正已有对局”处理、正式对局 `match/edit` 事件记录、Codex OCR prompt、Phase 6 输出目录规范、3 局真实截图待审 JSON 试跑、001-003 OCR 质量抽样、001-032 review JSON 生成和导入校验、batch manifest 全量更新、已知朋友 raw_name/friend_candidate 导入兜底修正、朋友分路重复修正、batch-001 30 局正式入库、012/032 拒绝处理、batch-002 6 局正式入库、Phase 7 榜单计算模块、`/leaderboards` API、`check:phase7`、报告期创建模块、`/report-periods` API、脱敏静态导出模块、`/static-export` API、`period:create`、`export:static`、朋友侧静态站首页/Database/单局详情/支撑跳转、`check:phase8`、朋友站密码门禁移除、Vercel 静态部署配置、`.vercelignore` 上传范围收敛、Vercel 生产发布和线上验证、022-025 `吧唧小喵` 朋友身份确认、026 `鸽/明世隐` 误识别修正、真实库 022-026 五朋友局刷新、报告期 replace、静态导出刷新和生产 build 刷新、Phase 7 新榜单口径、首页榜单大白话说明、尽力/躺赢首页 No.1 展示、生产首页静态优先渲染修复、Vercel 手机视口验证、batch-003 OCR 录入产物生成、batch-003 manifest 明确原图配对、OCR prompt 朋友名单补齐 `吧唧小喵`。
- 历史验证记录（9 位朋友改动前）：`db:init` 可创建 `data/hok.sqlite` 并 seed 8 位朋友；`check:phase2` 返回 8 张表、8 位朋友、130 个英雄，且庄周搜索可用；`check:phase3`、`check:phase4`、`check:phase5`、`check:phase7`、`check:phase8` 均通过；当时真实库 `review_matches` 为 32、`matches` 为 30、`match_players` 为 300、`review_events` 为 32，012/032 已拒绝且无待审；旧口径下真实库榜单可计算 30 局、145 条朋友参赛记录，022-026 在正式表中 `friend_count` 为 4 且 `include_in_lineup_stats` 为 0；旧朋友站浏览器验证通过密码门禁、首页、Database、单局详情、支撑跳转目标和桌面/移动布局；JS 语法检查通过；`build:web` 可生成静态产物。
- 本轮新增验证：9 位朋友源码/review JSON 改动后，使用临时 SQLite 运行 `scripts/import-review-json.js data/imports/batch-001/matches` 成功导入 32 份 review JSON。真实库刷新后已通过 `check:phase2`、`check:phase7`、`check:phase8`、生产 build 和自定义断言；当前真实库为 9 位朋友、36 局正式对局、360 条玩家记录、36 局五朋友局、0 局 4+1。本轮再次通过 `check:phase2`、`check:phase7`、`check:phase8`、`npm run build:web`；真实 `period:all-current` 断言为 36 局、阵容门槛 4 场、英雄必输榜门槛 3 场；本地模拟非 localhost 移动视口和线上 Vercel 手机视口均验证首页、Database、单局 022 可打开，console 无 error。batch-003 生成脚本已跑通，18 个 review JSON 均通过 `assertValidReviewJson`，并用临时 SQLite 运行 `scripts/import-review-json.js data/imports/batch-003/matches` 成功导入 18 份 review JSON；真实库未被修改。

## 2. 下一步

暂停点后的推荐执行顺序：

1. 在手机视口下手工打开 `https://hok-five-stack-analytics.vercel.app/`、`/database`、单局详情，确认首页榜单文案、动态门槛、Database 筛选和 console 无 error。（curl 已确认 4 条路由 200，但浏览器侧没人工核过。）
2. batch-003 005-007、010-016 的 `manual_guess`/`low` 分路按用户决策暂不继续逐项检查；如后续榜单/单局明显不合理再回头修。
3. 032、batch-001:012、batch-003:009/017/018 持续保持 rejected，不纳入正式库、报告期或导出。
4. 后续如有新批次（batch-004），仍按 batch-003 同样流程：整理截图 → OCR 生成 review JSON → 临时库验证 → 真实库导入审核 → 刷新报告期/导出/build → 发布。

## 3. 成功标准

MVP 完成时必须满足：

- 32 局、64 张图可以按本地文件夹规范导入。
- Codex 能按单局生成待审核 JSON。
- 管理员 UI 能校验、修正、批准入库。
- SQLite 保存正式数据、OCR 原文和最小修正痕迹。
- 能编辑已入库对局。
- 能生成报告期并导出脱敏静态数据。
- 静态站能展示战报、榜单、Database 和单局详情。
- 静态站不包含原图、OCR 原文、对手/路人完整昵称或管理员修正详情。

## 4. Phase Checklist

### Phase 1: 项目骨架

- [x] 创建前端应用目录，例如 `apps/web`。
- [x] 创建本地 Node API 目录，例如 `server`。
- [x] 创建脚本目录，例如 `scripts`。
- [x] 创建数据目录占位，例如 `data/reference`。
- [x] 配置 `.gitignore`，排除 SQLite、截图、导入中间文件、构建产物和本地 env。
- [x] 配置基础 package scripts。
- [x] 验证：前端 dev server 能启动。
- [x] 验证：Node API 能启动并返回 health check。

### Phase 2: 基础数据和 SQLite

- [x] 设计 SQLite schema。
- [x] 创建 migration 或初始化脚本。
- [x] seed 9 位朋友。
- [x] 创建 `data/reference/heroes.json` 占位。
- [x] 创建英雄读取/查询工具函数。
- [x] 验证：能初始化空数据库。
- [x] 验证：能查询朋友列表和英雄列表。

### Phase 3: Review JSON 输入链路

- [x] 定义单局 `review.json` schema。
- [x] 创建 1-2 局样例 `review.json`。
- [x] 写导入脚本，把 `review.json` 写入待审表。
- [x] 记录 raw review JSON。
- [x] 生成初步 normalized JSON。
- [x] 验证：样例局能进入 `review_matches`。
- [x] 验证：异常 JSON 会报清楚错误，不写坏数据库。

### Phase 4: 管理员校验 UI

- [x] 待审列表页。
- [x] 单局审核页。
- [x] 展示 overview/detail 两张截图。
- [x] 展示并编辑基础对局信息。
- [x] 展示并编辑玩家表。
- [x] 朋友身份下拉。
- [x] 英雄搜索/下拉。
- [x] 位置、位置来源、位置置信度选择。
- [x] 低置信度字段高亮。
- [x] 保存草稿。
- [x] 批准入库。
- [x] 拒绝本局。
- [x] 验证：一局可以从待审进入正式 `matches` 和 `match_players`。

### Phase 5: 校验、去重和编辑

- [x] 实现硬必填校验。
- [x] 实现朋友记录必须有标准英雄、唯一位置、评分、KDA。
- [x] 实现统计纳入开关。
- [x] 实现 dedupe key。
- [x] 实现疑似重复检查。
- [x] 实现重复冲突处理：丢弃、强制导入、修正已有对局。
- [x] 实现已入库对局编辑。
- [x] 实现 `review_events` 最小修正记录。
- [x] 验证：缺硬必填不能批准入库。
- [x] 验证：重复局会被提示或拦截。
- [x] 验证：编辑已入库对局会记录事件。

### Phase 6: Codex-assisted OCR 流程

- [x] 编写 Codex OCR prompt。
- [x] 明确输出 JSON schema。
- [x] 用 2-3 局真实截图试跑。
- [x] 根据错误调整 prompt/schema。
- [x] 固化 `data/imports/batch-xxx/matches/NNN.review.json` 输出规范。
- [x] 验证：真实截图生成的 JSON 能进入待审表。
- [ ] 验证：管理员修正量在可接受范围内。

### Phase 7: 榜单计算

- [x] 实现报告期 match ids 读取。
- [x] 实现可信胜率。
- [x] 实现个人最强综合分。
- [x] 实现最佳五排阵容。
- [x] 实现尽力局之王。
- [x] 实现躺赢王。
- [x] 实现英雄必输榜。
- [x] 实现谁最会坑某人。
- [x] 实现逆风发动机。
- [x] 验证：每个榜单能返回支撑对局。
- [x] 验证：样本不足时有观察区或提示。
- [x] 按新口径实现推荐五排阵容动态门槛：入选者该位置场次必须达到 `ceil(数据库总局数 * 10%)`。
- [x] 按新口径实现英雄必输榜动态门槛：主榜最低场次为 `max(3, ceil(数据库总局数 * 5%))`。
- [x] 按新口径实现尽力局之王、躺赢王首页只展示 No.1。
- [x] 按新口径为每个首页数据维度展示大白话解释小字。
- [x] 验证：当前 36 局报告期下，阵容门槛为 4 场，英雄必输榜门槛为 3 场。

### Phase 8: 静态导出和朋友站

- [x] 实现报告期创建。
- [x] 实现脱敏导出 JSON。
- [x] 确保导出不包含原图、OCR 原文、对手/路人完整昵称、管理员修正详情。
- [x] 按用户要求移除朋友站密码门禁，静态站可直接打开。
- [x] 实现首页战报。
- [x] 实现 Database 筛选排序。
- [x] 实现单局详情。
- [x] 实现榜单跳转支撑明细。
- [x] 验证：静态 build 后不依赖 SQLite 和本地 Node API。
- [x] 验证：移动端布局可用。
- [x] 修复手机端 Vercel 打不开问题，生产静态站不应因 `/api/health` 探测阻塞首屏。
- [x] 验证：线上手机视口首页、Database、单局详情可打开，console 无 error。

### Phase 9: 首批 32 局导入和发布

- [x] 整理 `data/screenshots/batch-001`。
- [x] 按 `001-overview.png`、`001-detail.png` 命名 64 张图。
- [x] 用 Codex-assisted OCR 生成 32 个 review JSON。
- [x] 管理员逐局审核。（30 局已正式入库，012/032 已拒绝。）
- [x] 解决重复和异常局。
- [x] 创建首个报告期。
- [x] 导出静态数据。
- [x] 构建静态站。
- [x] 按 9 位朋友新口径刷新真实 SQLite、报告期、静态导出和 build 产物。
- [x] 选择发布目标并发布。
- [x] 验证：朋友侧链接可访问。

### Phase 10: batch-003 追加导入

- [x] 确认 `data/screenshots/batch-003` 的 36 张 PNG 按文件名两张一组对应 18 局；其中 006/016 的第二张不是标准详情页，009/017/018 不是五朋友局。
- [x] 在 `data/imports/batch-003/manifest.json` 中明确原图配对，未重命名源截图。
- [x] 用 Codex-assisted OCR 生成 `data/imports/batch-003/matches/*.review.json`。
- [x] 导入 review JSON 到待审队列。
- [x] 管理员逐局审核并批准/拒绝。（001-008、010-016 共 15 局批准入库；009、017、018 拒绝。）
- [x] 刷新 `period:all-current`、`public/export/report-data.json`、`apps/web/dist`。
- [x] 跑 `check:phase2`、`check:phase7`、`check:phase8`、生产 build。
- [x] 发布 Vercel 并验证线上静态站。（2026-06-14 新电脑发布 `dpl_He1zzzhpGNuujofd2hSAnkjEyZDr`，主域名已 alias，线上 4 条路由均 200，导出 JSON 验证为 51 局口径。）

## 5. 需要用户提供

- 已提供：64 张首批截图。
- 已提供：截图已整理到 `data/screenshots/batch-001`，并按局编号命名。
- 已提供：`heroes.json` 全量英雄表，来源为王者荣耀官网 `herolist.json`。
- 已提供：英雄默认分路第一版，按官网职业映射生成，审核时可人工修正。
- 已确认：`吧唧小喵` 是朋友，应加入本批朋友表。
- 已确认：朋友站不要密码门禁，直接打开。
- 已确认：榜单动态门槛使用当前公开报告期正式对局数作为“数据库总局数”。
- 已确认：英雄必输榜主榜门槛使用 `max(3, ceil(数据库总局数 * 5%))`。
- 已确认：“最强个人看整体 rank”指综合分整体排名，不新增王者荣耀段位字段。
- 已提供：`data/screenshots/batch-003`，当前 36 张 PNG；已完成 OCR 录入产物，见 `data/imports/batch-003/manifest.json` 和 `data/imports/batch-003/matches`。
- 已完成：静态站发布到 Vercel。
- 待用户后续配合：复核剩余 `manual_guess` 分路，建议按 3-5 局一组让 Codex 展示截图和当前分路，用户只回复需要修改的局号、朋友名和正确分路。

## 6. 暂不做

- 朋友自行上传。
- Supabase Postgres。
- Supabase Storage。
- Vercel 后端。
- 独立视觉 API key。
- 多管理员协作。
- 微信机器人。
- 复杂 BI。
- 完整英雄版本历史。

## 7. 已知风险

- Codex-assisted OCR 不是稳定线上 OCR 服务，适合 MVP 和管理员本地导入。
- mini sub-agent 可以加速读图，但小模型草稿只作为辅助线索；最终 review JSON 必须由主线程复核并通过 schema/import 校验。
- 朋友站已改为无密码直达，静态导出数据会被能访问链接的人看到；导出仍需保持脱敏，不包含原图、OCR 原文、对手/路人完整昵称或管理员修正详情。
- 位置数据必须人工兜底，因为英雄默认分路和截图奖牌都可能不完整。
- batch-003 的 006/016 缺标准详情页，detail 指标为 `null`；009/017/018 仅 1 位已知朋友，已在 review JSON 标为建议拒绝候选。后续导入真实库前不要把这 5 局当成完整五朋友数据。
- 榜单样本仍偏小，必须显示样本数、动态门槛、置信度和大白话口径说明。
- 推荐五排阵容使用 10% 动态硬门槛后，某个位置可能没有合格候选；这种情况下应该展示样本不足，而不是强行拼完整阵容。
- 生产首页已改为非 localhost 静态优先渲染；后续如果新增朋友站入口或 API 探测逻辑，必须继续避免阻塞静态首屏。
- Phase 3 只校验待审 JSON 的结构、类型和关键枚举，不校验英雄是否已存在于全量 `heroes.json`；当前英雄表已补齐官网全量英雄，但默认分路是按官网职业映射得到的 MVP 第一版，仍需管理员在审核页确认。
- 新入库对局已使用内容型 `dedupe_key`；如果旧本地库里存在 Phase 4 临时 source key，对应旧局仍可被疑似重复检查兜底，后续如需严格统一可补一次迁移。
- 当前开发环境 PATH 没有全局 `node`/`npm`；本轮使用 Codex bundled Node，并直接调用本地 Vite CLI 完成验证。后续常规开发建议安装或配置本机 Node/npm。
- 当前 SQLite 实现使用 Node 内置 `node:sqlite`，在 Node v24.14.0 下可用但仍输出 experimental warning；后续如需更稳运行时，可换成明确的 SQLite npm 依赖。

## 8. OCR 接力记录（2026-06-13）

当前 OCR 目标是 `data/screenshots/batch-001` 的 001-032。生成入口是 `data/imports/batch-001/generate-review-json.js`，输出目录是 `data/imports/batch-001/matches`。当前已有 `001.review.json` 至 `032.review.json`，并已通过临时库导入校验。

本地环境注意：当前 PATH 没有全局 `node`，可使用 Codex bundled Node：`/Users/kyrielcsun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`。

001-003 抽样结论：核心对局时间、胜负、比分、朋友侧、朋友身份、KDA、评分和经济可接受；剩余主要是低优先级对手昵称、个别奖牌归属或低置信字段，适合进入管理员审核流。

004-032：已写入 `generate-review-json.js` 并生成 review JSON。脚本已支持 `hero: null`、`friendCandidate` 别名覆盖、`match.mode`、`includeInStats: null`、单项统计开关覆盖和 `excludeReason`。001-032 已通过临时 SQLite 导入校验，`imported_count` 为 32。

011-032：主线程已人工读图并持久化到脚本。match-level 断点如下：

| 局号 | 模式 | 时间 | 时长 | 比分 | 朋友侧 | 结果 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 011 | 5v5排位 | 2026-06-04T21:36:00+08:00 | 12:12 | 蓝 30 / 红 9 | 蓝 | win | 蓝方五朋友；东皇太一最高评分 15.3，MVP 归属需按截图复核，影的奖牌/MVP 有重叠感。 |
| 012 | 指挥官模式 | 2026-06-04T20:31:00+08:00 | 11:57 | 蓝 25 / 红 10 | 蓝 | win | 仅识别到 1 位朋友“鸽”，已拒绝，不纳入五排/4+1 统计。 |
| 013 | 5v5排位 | 2026-06-01T22:26:00+08:00 | 17:21 | 蓝 20 / 红 13 | 红 | loss | 红方五朋友；`迪路兽oO` 标准化为 `迪路兽oo`；元流之子疑似中路法系。 |
| 014 | 5v5排位 | 2026-05-31T16:01:00+08:00 | 17:45 | 蓝 20 / 红 28 | 蓝 | loss | 蓝方五朋友；元流之子疑似打野/刺客；干将莫邪疑似 SVP。 |
| 015 | 5v5排位 | 2026-05-30T23:26:00+08:00 | 13:33 | 蓝 27 / 红 8 | 红 | loss | 红方五朋友；`迪路兽oO` 标准化为 `迪路兽oo`；夏洛特疑似 SVP。 |
| 016 | 5v5排位 | 2026-05-30T21:00:00+08:00 | 10:23 | 蓝 14 / 红 24 | 红 | win | 红方五朋友；`迪路兽oO` 标准化为 `迪路兽oo`；小乔最高评分 11.8，MVP。 |

017-032：主线程已人工读图并持久化到脚本。用户已确认 `吧唧小喵` 是朋友；022-025 的生成脚本和 review JSON 已改为五朋友局。026 已视觉复核为 `鸽` 使用明世隐，之前“路人队友明世隐”是 OCR/人工整理误判；生成脚本和 review JSON 已修正。真实 SQLite、报告期、静态导出和 build 产物已按这些修正刷新。

| 局号 | 模式 | 时间 | 时长 | 比分 | 朋友侧 | 结果 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 017 | 5v5排位 | 2026-05-30T20:41:00+08:00 | 14:11 | 蓝 24 / 红 31 | 红 | win | 红方五朋友；`鸽`、`迪路兽oO`、`异想天开的球`、`萧瑟仙贝打我`、`珍珠罐罐`。 |
| 018 | 5v5排位 | 2026-05-30T00:47:00+08:00 | 21:45 | 蓝 30 / 红 33 | 红 | win | 红方五朋友；`珍珠罐罐` 按朋友计入。 |
| 019 | 5v5排位 | 2026-05-30T00:32:00+08:00 | 10:00 | 蓝 24 / 红 8 | 蓝 | win | 蓝方五朋友；`迪路兽oO` 标准化为 `迪路兽oo`。 |
| 020 | 5v5排位 | 2026-05-30T00:15:00+08:00 | 14:07 | 蓝 31 / 红 12 | 红 | loss | 红方五朋友失败；`珍珠罐罐` 和 `迪路兽oO` 按朋友计入。 |
| 021 | 5v5排位 | 2026-05-30T00:02:00+08:00 | 08:46 | 蓝 20 / 红 3 | 蓝 | win | 蓝方五朋友；扁鹊截图有银牌发育路奖牌，但为保证朋友分路唯一，按中路人工猜测写入。 |
| 022 | 5v5排位 | 2026-05-28T22:23:00+08:00 | 18:24 | 蓝 25 / 红 26 | 蓝 | loss | 蓝方五朋友；`吧唧小喵` 已确认为朋友，貂蝉分路暂按打野 `manual_guess` 低置信写入，待复核。 |
| 023 | 5v5排位 | 2026-05-28T22:09:00+08:00 | 11:16 | 蓝 1 / 红 23 | 蓝 | loss | 蓝方五朋友；`吧唧小喵` 已确认为朋友，蔡文姬默认游走。 |
| 024 | 5v5排位 | 2026-05-28T21:50:00+08:00 | 13:40 | 蓝 15 / 红 16 | 红 | win | 红方五朋友；`吧唧小喵` 已确认为朋友，芈月分路暂按打野 `manual_guess` 低置信写入，待复核。 |
| 025 | 5v5排位 | 2026-05-28T21:27:00+08:00 | 19:43 | 蓝 26 / 红 28 | 蓝 | loss | 蓝方五朋友；`吧唧小喵` 已确认为朋友，后羿默认发育路。 |
| 026 | 5v5排位 | 2026-05-30T22:48:00+08:00 | 16:21 | 蓝 27 / 红 19 | 蓝 | win | 蓝方五朋友；首行是 `鸽` 使用明世隐，已修正误识别。为满足朋友分路唯一，鸽/明世隐分路暂按中路 `manual_guess` 低置信写入，待复核；后羿分路按发育路人工猜测写入。 |
| 027 | 5v5排位 | 2026-05-28T20:40:00+08:00 | 12:36 | 蓝 18 / 红 25 | 红 | win | 红方五朋友；多名辅助/战士分路可能冲突，需管理员复核。 |
| 028 | 5v5排位 | 2026-05-31T14:51:00+08:00 | 08:10 | 蓝 11 / 红 17 | 红 | win | 红方五朋友；分路按人工猜测保证唯一性，需管理员复核。 |
| 029 | 5v5排位 | 2026-05-31T15:02:00+08:00 | 11:09 | 蓝 29 / 红 15 | 红 | loss | 红方五朋友失败；后羿分路按发育路人工猜测写入。 |
| 030 | 5v5排位 | 2026-05-31T15:16:00+08:00 | 10:20 | 蓝 12 / 红 15 | 红 | win | 红方五朋友；鲁班七号分路按发育路人工猜测写入。 |
| 031 | 5v5排位 | 2026-05-31T15:30:00+08:00 | 10:00 | 蓝 8 / 红 20 | 红 | win | 红方五朋友；后羿分路按发育路人工猜测写入。 |
| 032 | 5v5排位 | 2026-06-09T21:46:00+08:00 | 12:11 | 蓝 11 / 红 25 | 红 | win | 红方五朋友；已视觉确认与 005 为同一局截图，已拒绝，不强制导入。 |

2026-06-14 继续记录：为满足正式入库校验，已修正 002、004、005、007-010、013、015、018-020 的朋友分路重复，修正项均标为 `manual_guess`。真实本地库已批准 30 局，012 和 032 已拒绝；Phase 7 榜单计算已完成并通过 `check:phase7`。当时策略是进入 Phase 8 报告期创建、脱敏导出和朋友侧静态站，022-026 的 4+1 留到后续专题处理；该策略已被下一条“暂停接力记录”里的用户确认覆盖。

2026-06-14 暂停接力记录：用户确认优先发布 Vercel 静态站、取消朋友站密码门禁，并确认 `吧唧小喵` 是朋友。已完成源码/JSON 层改动：移除 React 密码门禁和相关样式、添加 `vercel.json`、`server/db/friends.js` 新增 `friend_baji_xiaomiao`、`scripts/check-phase-2.js` 改为 9 位朋友、`scripts/check-phase-8.js` 改用其他路人名做脱敏测试、`specs/product-spec.md` 和 `specs/codex-ocr-prompt.md` 更新为 9 位朋友且无密码门禁、`data/imports/batch-001/generate-review-json.js` 和 022-026 review JSON 更新为新口径。当时已验证：用临时 SQLite 运行 `scripts/import-review-json.js data/imports/batch-001/matches` 成功导入 32 份 review JSON。当时尚未完成：真实 `data/hok.sqlite` 未写回 9 位朋友和 022-026 修正，`period:batch-001:first-30` 未 replace，`public/export/report-data.json` 和 `apps/web/dist` 未重新生成，Phase 检查和生产 build 未重新跑；这些事项已在下一条记录中完成。

2026-06-14 继续记录：已备份真实库为 `data/hok.sqlite.backup-before-9-friends-20260614-143047`，并用现有 `updateImportedMatch` 路径把 022-026 写回正式表，同时同步更新对应 `review_matches.raw_review_json` / `normalized_json`。真实库现在为 9 位朋友、30 局正式对局、300 条玩家记录、42 条 review events；022-026 均为五朋友局。已 `--replace` 刷新 `period:batch-001:first-30`，重新导出 `public/export/report-data.json`，重新 build `apps/web/dist`。验证通过：`check:phase2`、`check:phase7`、`check:phase8`、生产 build、自定义真实库/导出断言。本地 preview 验证 `/`、`/database`、`/matches/match:batch-001:022` 和 `/export/report-data.json` 均返回 200；源码无密码门禁文本，build 中的 `password` 仅来自 React 对 HTML input 类型的通用运行时代码。已调整 `.gitignore`，确保脱敏导出 JSON 能随 Git/Vercel 构建发布。

2026-06-14 发布记录：当前 PATH 下 `node v24.16.0`、`npm 11.13.0` 可用；全局 `vercel` 命令不可用，但 `npx vercel` 可用并已完成设备登录，账号为 `kyrieaiplayer-6650`。首次 `npx vercel --yes` 自动链接 `kyrielcsun-lab/hok-five-stack-analytics` 并发布到生产，但上传体积为 218MB，确认主要来自本地 `data/screenshots/`。已新增 `.vercelignore` 排除截图、导入中间文件、SQLite、`node_modules` 和本地 build 产物；随后执行 `npx vercel --prod --yes`，最终生产部署为 `dpl_HkxA3VYKWE6kSBYxdAZi1yh7GKAZ`，生产域名 `https://hok-five-stack-analytics.vercel.app`。已用 `npx vercel rm dpl_BPdt5dq7EZEhqAtBJcxscQfmzXq1 --safe --yes` 删除第一次 218MB 上传产生的旧 deployment，当前生产别名保留在最终部署。线上验证通过：`/`、`/database`、`/matches/match%3Abatch-001%3A022`、`/export/report-data.json` 均返回 200；浏览器验证首页渲染“首批 30 局战报”、Database 可从首页打开、榜单“支撑对局 30”可跳转到带 `matches=` 的 Database 筛选、单局 022 页面可直达且显示朋友队/匿名对手与路人；线上 DOM 无截图 `<img>`、无截图路径、无 raw review JSON，console 无 error/warning。

2026-06-14 分路复核记录 1：用户确认 002、004、005 当前分路口径无问题。已备份真实库为 `data/hok.sqlite.backup-before-lane-confirm-002-004-005-20260614`，并将 002 月亮西沉朝阳/孙策=打野、004 鸽/典韦=打野、004 萧瑟仙贝打我/东皇太一=对抗路、005 月亮西沉朝阳/孙策=打野 从 `manual_guess/low` 更新为 `manual/high`；同步更新对应 review JSON、`review_matches.raw_review_json` / `normalized_json` 和 `data/imports/batch-001/generate-review-json.js`，新增 4 条 `match_player/edit` review events。已 `--replace` 刷新 `period:batch-001:first-30`，导出 `public/export/report-data.json`，重新 build 并发布到 Vercel 生产部署 `dpl_Aw8iGv1SGpsQ9CTzubM4t5fQsRV9`。验证通过：`check:phase2`、`check:phase7`、`check:phase8`、生产 build、线上 JSON 和浏览器首页检查。032 明确保持 `review_matches.status = rejected`，`matches` 中无 `match:batch-001:032`，报告期和公开导出均不包含 032。

2026-06-14 分路复核记录 2：用户确认 007-010 当前分路口径无问题，并判断后续分路先不继续逐项检查。已备份真实库为 `data/hok.sqlite.backup-before-lane-confirm-007-010-20260614`，并将 007 鸽/影=打野、007 萧瑟仙贝打我/东皇太一=对抗路、008 月亮西沉朝阳/王昭君=游走、009 萧瑟仙贝打我/嫦娥=发育路、010 鸽/哪吒=打野 从 `manual_guess/low` 更新为 `manual/high`；同步更新对应 review JSON、`review_matches.raw_review_json` / `normalized_json` 和 `data/imports/batch-001/generate-review-json.js`，新增 5 条 `match_player/edit` review events。验证通过：`check:phase2`、`check:phase7`、生产 build。剩余 `manual_guess` / `low` 为 29 项，涉及 013、015、018-031；按用户决策暂不继续检查。032 继续保持 `review_matches.status = rejected`，`matches` 中无 `match:batch-001:032`。

2026-06-14 需求刷新记录：用户提出并确认新的榜单和导入要求。当时已更新 `specs/product-spec.md` 和本文件，但尚未改实现代码；该状态已被下一条“本轮暂停记录”覆盖。确认口径：数据库总局数指当前公开报告期内已正式入库的对局数；推荐五排阵容入选者必须在对应位置达到 `ceil(数据库总局数 * 10%)` 场；最强个人按综合分整体 rank；每个首页数据维度都要展示大白话说明和必要公式思路；尽力局之王、躺赢王首页只展示 No.1；英雄必输榜主榜最低场次为 `max(3, ceil(数据库总局数 * 5%))`。当时真实库已观察为 36 局正式对局、38 条 review_matches、360 条 match_players、57 条 review_events，公开报告期 `period:all-current` 为“累计 36 局战报”。当时线上 Vercel 桌面/curl 访问首页和静态 JSON 返回 200，但手机端打不开，优先怀疑生产首页被本地管理员 API `/api/health` 探测阻塞；该问题已在下一条记录中修复。`data/screenshots/batch-003` 当前有 36 张 PNG，按文件名顺序疑似 18 局 overview/detail 交替配对，下一步需要生成 batch-003 review JSON 并走审核入库流程。

2026-06-14 本轮暂停记录：已完成 Phase 7 新口径实现和 Phase 8 手机端首屏修复。代码层改动包括：`server/stats/leaderboards.js` 增加报告期动态门槛、榜单大白话说明和门槛 meta；`apps/web/src/main.jsx` 首页展示榜单说明、尽力/躺赢只显示 No.1，并让非 localhost 根路径静态优先渲染；`scripts/check-phase-7.js` 增加动态门槛和说明断言。已刷新 `public/export/report-data.json`，重新 `npm run build:web`，并发布 Vercel 生产部署 `dpl_CHZtvAgRT3HU2xDgYTqZjFEKM8jD`，生产别名仍为 `https://hok-five-stack-analytics.vercel.app`。验证通过：`check:phase2`、`check:phase7`、`check:phase8`、真实 36 局门槛断言（阵容 4 场、英雄必输 3 场）、本地模拟非 localhost 移动视口、线上 Vercel 手机视口首页/Database/单局 022、线上 JSON 门槛检查，console 无 error。按用户要求，本轮暂停在 batch-003 扫描/OCR/入库之前；新窗口接力时从 `data/screenshots/batch-003` 配对确认开始，不要先生成或导入 batch-003。

2026-06-14 batch-003 OCR 录入记录：用户确认本批不需要再由用户审核读图录入，直接由 Codex 完成 OCR 产物；同时要求 OCR 录入后只更新执行报告，剩余事项新窗口继续。本窗口已生成 `data/imports/batch-003/generate-review-json.js`、`data/imports/batch-003/manifest.json`、`data/imports/batch-003/matches/001.review.json` 至 `018.review.json`。已跑 `node data/imports/batch-003/generate-review-json.js`，18 份 JSON 通过 `assertValidReviewJson`；已用临时 SQLite 跑 `HOK_DB_PATH="$(mktemp -d)/hok.sqlite" node --experimental-sqlite scripts/import-review-json.js data/imports/batch-003/matches`，`imported_count = 18`。本窗口未写入真实 `data/hok.sqlite`，未批准/拒绝审核队列，未刷新报告期、静态导出、build 或 Vercel。

| 局号 | 原图配对 | 分类 | 备注 |
| --- | --- | --- | --- |
| 001 | IMG_8524 / IMG_8525 | 正式候选 | 红方五朋友胜。 |
| 002 | IMG_8526 / IMG_8527 | 正式候选 | 蓝方五朋友败。 |
| 003 | IMG_8528 / IMG_8529 | 正式候选 | 红方五朋友胜；曜分路为低置信人工猜测。 |
| 004 | IMG_8530 / IMG_8531 | 正式候选 | 蓝方五朋友败；廉颇分路为低置信人工猜测。 |
| 005 | IMG_8532 / IMG_8533 | 正式候选 | 红方五朋友胜；后羿按截图中路奖牌，庄周/孙策低置信分路。 |
| 006 | IMG_8534 / IMG_8535 | 正式候选，缺详情 | IMG_8535 不是标准详情页，detail 指标为 `null`。 |
| 007 | IMG_8536 / IMG_8537 | 正式候选 | 红方五朋友败；后羿按截图中路奖牌，明世隐低置信分路。 |
| 008 | IMG_8538 / IMG_8539 | 正式候选 | 红方五朋友败。 |
| 009 | IMG_8540 / IMG_8541 | 建议拒绝 | 仅识别到 1 位已知朋友 `别压力我ok？`，且缺标准详情页。 |
| 010 | IMG_8542 / IMG_8543 | 正式候选 | 红方五朋友胜；后羿按截图中路奖牌，庄周低置信分路。 |
| 011 | IMG_8544 / IMG_8545 | 正式候选 | 蓝方五朋友胜；后羿按截图中路奖牌，庄周低置信分路。 |
| 012 | IMG_8546 / IMG_8547 | 正式候选 | 蓝方五朋友败；哪吒低置信打野。 |
| 013 | IMG_8548 / IMG_8549 | 正式候选 | 红方五朋友胜。 |
| 014 | IMG_8550 / IMG_8551 | 正式候选 | 红方五朋友胜；蒙恬低置信游走。 |
| 015 | IMG_8552 / IMG_8553 | 正式候选 | 红方五朋友败；比分是击杀数，胜负按截图失败标识记录。 |
| 016 | IMG_8554 / IMG_8555 | 正式候选，缺详情 | IMG_8555 不是标准详情页，detail 指标为 `null`。 |
| 017 | IMG_8556 / IMG_8557 | 建议拒绝 | 仅识别到 1 位已知朋友 `别压力我ok？`。 |
| 018 | IMG_8558 / IMG_8559 | 建议拒绝 | 仅识别到 1 位已知朋友 `别压力我ok？`。 |

2026-06-14 batch-003 入库 + 发布记录（新电脑首次工作）：用户切换到 Windows 机器 `C:\Users\kyrielcsun\hok-five-stack-analytics`，全局 `node v24.14.0` 在 PATH，`vite` 不在 PATH（须用 `node node_modules/vite/bin/vite.js`），node_modules 缺 Windows 原生 `@rollup/rollup-win32-x64-msvc`，已用 `npm install @rollup/rollup-win32-x64-msvc --no-save` 临时补齐。已备份真实库到 `data/hok.sqlite.backup-before-batch-003-20260614-211540`。已跑 `node --experimental-sqlite scripts/import-review-json.js data/imports/batch-003/matches`，18 份 review JSON 写入真实审核队列。新增 `scripts/batch-003-approve-reject.mjs`（直接调用 `approveReviewMatch` / `rejectReviewMatch`）批量处理：001-008、010-016 共 15 局已批准入库，009/017/018 共 3 局已 rejected，零错误。`scripts/create-report-period.js --id=period:all-current --name="累计 51 局战报" --replace` 把公开报告期刷新到 51 局，描述更新为包含 batch-001/002/003。`scripts/export-static-data.js` 导出 `public/export/report-data.json`（748957 字节，friend_player_count = 255）。`node node_modules/vite/bin/vite.js build apps/web` 通过，`apps/web/dist/export/report-data.json` 已同步刷新。验证通过：`check:phase2`（8 表 / 9 朋友 / 130 英雄 / 庄周搜索 1）、`check:phase7`、`check:phase8`；51 局口径下 `best_lineup_min_lane_games = 6`、`hero_losing_min_games = 3`，`ignored_match_ids` 为空。用户确认 Vercel CLI 已登录后，`npx vercel whoami` 返回 `kyrieaiplayer-6650`，`npx vercel --prod --yes` 上传 775.7KB 完成生产部署 `dpl_He1zzzhpGNuujofd2hSAnkjEyZDr`，主域名 alias `https://hok-five-stack-analytics.vercel.app`。线上验证：`/`、`/database`、`/matches/match:batch-003:001`、`/export/report-data.json` 均 200；线上 JSON 解析为 `period:all-current` / 51 局 / 阵容门槛 6 场 / 必输榜门槛 3 场，包含 batch-003 数据。手机视口浏览器侧人工核验仍由用户后续完成。
