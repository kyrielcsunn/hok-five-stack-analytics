# 王者五排战报系统 Product Spec

创建日期：2026-06-13
更新日期：2026-06-13

## 1. 项目目标

为 9 位固定朋友的王者荣耀五排战绩建立一个可持续追加的数据系统。系统从每局 2 张截图中提取结构化数据，经管理员校验后入库，并生成：

- 手机优先的群内毒舌战报。
- 脱敏后的静态 Database 探索页。
- 基于样本修正的个人、组合、英雄和位置分析。

第一版的最高优先级是：**可持续、可校验地把对局数据入库**。战报和榜单是入库后的产物。第一版宁可分析保守，也不要导入链路不稳或数据不可追溯。

第一版重点是把 32 局、64 张图跑通，并保证后续可以继续由管理员追加新数据。

## 2. 第一版架构结论

MVP 正式采用 **local-first：单机管理员工具 + 静态朋友站**。

### 2.1 管理员侧

- 运行在管理员本机。
- 使用本地截图文件夹作为输入。
- 使用 Codex-assisted OCR：由 Codex 读取本地截图并生成待审核 JSON。
- 使用本地 Node API 读写 SQLite、截图文件和导入/导出文件。
- 使用 React 管理员 UI 校验、修正、批准入库和编辑已入库对局。

### 2.2 朋友侧

- 发布为静态只读站。
- 读取脱敏后的导出 JSON。
- 不支持朋友上传。
- 不展示原始截图、OCR 原文、对手/路人完整昵称或管理员修正详情。

### 2.3 暂不作为 MVP 主线

- Next.js 服务端应用。
- Supabase Postgres。
- Supabase Storage。
- Vercel 后端部署。
- 朋友自行上传。
- 独立视觉 API provider。

这些能力放入 v2/backlog。MVP 不两头下注。

## 3. 朋友名单

排行榜、战报和整活榜只统计以下朋友：

| 展示名 | 王者昵称 | 备注 |
| --- | --- | --- |
| 净漾银笑幻 | 净漾银笑幻 | 朋友 |
| 异想天开的球 | 异想天开的球 | 朋友 |
| 鸽 | 鸽 | 朋友 |
| 萧瑟仙贝打我 | 萧瑟仙贝打我 | 朋友 |
| 月亮西沉朝阳 | 月亮西沉朝阳 | 朋友 |
| 迪路兽oo | 迪路兽oo | 朋友 |
| 别压力我ok？ | 别压力我ok？ | 朋友 |
| 珍珠罐罐 | 珍珠罐罐 | 朋友 |
| 吧唧小喵 | 吧唧小喵 | 朋友 |

朋友身份以权威朋友表为准。OCR 原名只作为候选，不能直接驱动榜单。

规则：

- `display_name` 用于战报展示。
- `game_nickname` 是当前主昵称。
- `aliases` 保存历史昵称和常见 OCR 误识别。
- 校验页可以把未识别昵称绑定到已有朋友，并加入 alias。
- 不做完整昵称历史系统。
- 对手和路人只用于对局记录、去重和参考，不进入朋友榜单。

## 4. 输入数据

每局输入 2 张截图：

1. 总览/KDA 页
   - 模式，例如 `5v5排位`
   - 时长，例如 `12:11`
   - 日期时间，例如 `2026/06/09 21:46`
   - 胜负
   - 双方比分，例如 `11:25`
   - 双方 10 人昵称
   - 英雄
   - 评分
   - KDA
   - 经济
   - MVP/SVP/金牌/银牌等标记

2. 详细数据页
   - 输出伤害和占比
   - 承受伤害和占比
   - 总经济和占比
   - 参团率

### 4.1 本地文件约定

MVP 要求管理员在导入前按局编号整理截图文件名：

```text
data/screenshots/batch-001/
  001-overview.png
  001-detail.png
  002-overview.png
  002-detail.png
```

允许中文别名：

```text
data/screenshots/batch-001/
  001-总览.png
  001-详情.png
```

规则：

- 同一局使用同一个三位编号。
- 每局应有 `overview` 和 `detail` 两张。
- 脚本优先按文件名配对，不做复杂图片相似度配对。
- 管理员 UI 仍允许轻量手动重配、交换类型、标记缺图。
- 缺图或命名异常的局进入异常状态，不能直接入库。
- 原图只保存在本地，不进 git，不进入静态发布站。

## 5. MVP 范围

### 5.1 必做

- 本地截图文件夹导入。
- Codex-assisted OCR 生成按单局拆分的待审核 JSON。
- 自动按文件名配对同一局 2 张截图。
- 管理员可手动修正截图配对。
- 自动识别朋友候选、朋友阵营、胜负和基础数据。
- 管理员校验后按单局批准入库。
- 本地 SQLite 存储正式数据和最小修正痕迹。
- 编辑已入库对局。
- 近似去重和疑似重复确认。
- 报告期管理，报告期保存明确 match ids。
- 群内战报静态页。
- 脱敏后的静态 Database 探索页。
- 支持后续继续追加新截图。

### 5.2 暂不做

- 朋友自行上传。
- 微信机器人自动推送。
- 严格因果模型。
- 实时读取王者荣耀官方接口。
- 对手强度建模。
- 复杂权限体系。
- 多管理员同时编辑。
- 复杂 BI、透视表或自定义公式编辑器。
- 完整 HTML 报告快照。

## 6. 技术选型

### 6.1 MVP 技术栈

- 前端：Vite + React。
- 管理员本地服务：Node API。
- 数据库：SQLite，例如 `data/hok.sqlite`。
- 静态发布：Vite build 输出静态站。
- OCR：Codex-assisted OCR，不要求独立 API key。
- 参考数据：`data/reference/heroes.json` 等 JSON 文件。

### 6.2 选择理由

- 当前需求已经收敛为 local-first，不需要 Next.js 的服务端渲染和 Vercel API route。
- SQLite 足够支撑首批 32 局和后续小规模追加。
- 管理员本地 Node API 可以可靠读写 SQLite、本地截图和导入文件。
- 静态朋友站只需要读脱敏 JSON，发布简单。
- 不要求 OpenAI API key、Supabase key、Storage key 或 Vercel 后端配置，降低第一版启动成本。

### 6.3 建议目录

```text
apps/web/                    # React 管理员 UI + 静态朋友站
server/                      # 本地 Node API
scripts/                     # 导入、校验、导出脚本
data/hok.sqlite              # 本地 SQLite，不进 git
data/screenshots/            # 原始截图，不进 git
data/imports/                # Codex OCR 待审核 JSON，不进 git 或只按需要保留样例
data/reference/heroes.json   # 英雄表和默认分路
public/export/               # 脱敏后的静态数据
```

## 7. 数据流程

### 7.1 导入流程

1. 管理员把截图放入本地批次目录。
2. 文件名按局编号区分 overview/detail。
3. Codex 读取本地截图，按单局生成待审核 JSON。
4. 本地导入脚本把待审核 JSON 写入 SQLite 待审表。
5. 管理员打开本地校验 UI。
6. 管理员确认或修正截图配对。
7. 管理员修正朋友身份、英雄、位置、胜负、评分、KDA 等字段。
8. 系统生成去重指纹和相似度提示。
9. 如果疑似重复，管理员确认丢弃、强制导入或用当前数据修正已有对局。
10. 管理员按单局批准入库。
11. 系统保存正式结构化数据、原始 OCR JSON 和最小修正痕迹。
12. 管理员生成报告期并导出脱敏静态数据。
13. 静态站重新构建并发布给朋友查看。

### 7.2 Codex-assisted OCR 边界

- Codex 可以直接读取本地 PNG/JPEG 截图并生成结构化 JSON。
- Codex 不是线上自动 OCR 服务，也不是最终产品运行时依赖。
- 每次导入由管理员在 Codex 中触发或运行相应脚本。
- OCR 输出是预填，不是真相。
- 管理员确认后才进入正式表。
- 如果后续需要朋友自助上传或完全自动化，再改为视觉 API provider。

## 8. OCR / 待审核 JSON

OCR 输出按单局拆分，不生成一个巨大的批次 JSON。

```text
data/imports/batch-001/
  manifest.json
  matches/
    001.review.json
    002.review.json
```

示例结构：

```json
{
  "source": {
    "batch_id": "batch-001",
    "local_match_no": "001",
    "overview_path": "data/screenshots/batch-001/001-overview.png",
    "detail_path": "data/screenshots/batch-001/001-detail.png"
  },
  "match": {
    "mode": "5v5排位",
    "played_at": "2026-06-09T21:46:00+08:00",
    "duration_seconds": 731,
    "blue_score": 11,
    "red_score": 25,
    "winner_side": "red",
    "friend_side": "red",
    "friend_result": "win",
    "include_in_personal_stats": true,
    "include_in_pair_stats": true,
    "include_in_lineup_stats": true,
    "include_in_for_fun_stats": true,
    "exclude_reason": null
  },
  "players": [
    {
      "side": "red",
      "slot": 1,
      "raw_name": "鸽",
      "friend_candidate": "鸽",
      "is_friend_candidate": true,
      "raw_hero": "庄周",
      "hero_id": "zhuangzhou",
      "hero_name": "庄周",
      "rating": 9.8,
      "kills": 0,
      "deaths": 1,
      "assists": 18,
      "economy": 7289,
      "damage_dealt": 37200,
      "damage_dealt_pct": 12,
      "damage_taken": 78000,
      "damage_taken_pct": 23,
      "team_economy_pct": 17,
      "participation_pct": 72,
      "medals": ["铜牌发育路"],
      "lane": "游走",
      "lane_source": "medal",
      "lane_confidence": "high",
      "is_mvp": false,
      "is_svp": false
    }
  ],
  "field_confidence": {},
  "codex_notes": []
}
```

待审核 JSON 允许字段为 `null`。正式入库前必须补齐硬必填字段。

## 9. 硬必填与软可空

### 9.1 对局硬必填

正式进入统计的对局必须具备：

- 对局时间，或可替代的排序时间。
- 胜负。
- 双方比分。
- `winner_side`。
- `friend_side`。
- `friend_result`。
- 朋友队 3-5 名成员。
- 统计纳入开关。

### 9.2 朋友玩家硬必填

正式进入统计的朋友玩家记录必须具备：

- 朋友身份。
- 标准英雄。
- 唯一位置。
- 评分。
- KDA：击杀、死亡、助攻。

### 9.3 软可空字段

以下字段缺失不阻止入库，但会降低对应榜单或贡献分的置信度：

- 经济绝对值。
- 输出伤害绝对值。
- 承受伤害绝对值。
- 输出占比。
- 承伤占比。
- 经济占比。
- 参团率。
- MVP/SVP/金牌/银牌标记。
- 对手完整昵称。
- 对手完整英雄。

贡献分析优先使用百分比字段。百分比通常比绝对值更适合跨时长对局比较。

## 10. 关键业务规则

### 10.1 统计对象

- 所有榜单只统计 9 位朋友。
- 对手和路人不进入最强、躺赢、坑队友、英雄必输等榜单。
- 对手和路人可以保留在本地正式库中，用于核对和去重。
- 静态发布版匿名化对手和路人。

### 10.2 朋友阵营识别

系统预先录入朋友昵称和 aliases。OCR 后：

- 如果蓝方出现更多朋友，则蓝方为朋友队。
- 如果红方出现更多朋友，则红方为朋友队。
- 如果两边都出现朋友或识别不清，进入管理员校验。
- 管理员确认前，低置信度朋友匹配不能进入朋友榜单。

### 10.3 路人局处理

统计纳入规则拆成多个开关：

- `include_in_personal_stats`：是否进入个人表现、英雄、位置统计。
- `include_in_pair_stats`：是否进入组合和“谁坑谁”统计。
- `include_in_lineup_stats`：是否进入最佳五排阵容推荐。
- `include_in_for_fun_stats`：是否进入娱乐榜。
- `exclude_reason`：排除原因。

默认规则：

- 5 位朋友同队：进入所有统计。
- 4 位朋友 + 1 位路人：进入个人表现和部分组合统计，不进入五排阵容推荐。
- 3 位及以下朋友同队：默认不进入正式统计，只保留本地记录；管理员可手动纳入娱乐观察。
- 字段缺失严重：保留记录，但对应榜单自动跳过。

4+1 局中的路人队友只做背景信息，不进入朋友统计，不参与朋友队平均值。

### 10.4 朋友队平均

- 单局事件比较对象为本局上场朋友。
- 4+1 局中路人不参与朋友队平均。
- 3 人及以下默认不生成正式单局调侃事件。
- 长期榜单按所有纳入统计的朋友局累计。

### 10.5 胜负字段

同时保留：

- `winner_side`：对局事实，`blue` 或 `red`。
- `friend_side`：朋友阵营，`blue` 或 `red`。
- `friend_result`：朋友视角结果，`win` 或 `loss`。

统计和战报默认使用朋友视角的 `friend_result`。

## 11. 位置与英雄

### 11.1 位置规则

位置是一等字段。所有进入统计的朋友单局记录，入库前必须拥有且仅拥有一个位置。

位置枚举：

- 对抗路
- 中路
- 打野
- 发育路
- 游走

记录字段：

- `lane`
- `lane_source`：`medal`、`manual`、`hero_default`、`manual_guess`
- `lane_confidence`：`high`、`medium`、`low`

规则：

- 有金牌/银牌位置：预填，置信度高。
- 管理员明确修正：置信度高。
- 英雄默认分路：可预填，但置信度中/低。
- 多位置英雄或看不清：管理员必须选一个本局最可能位置，可标为低置信度。
- 不设置 `unknown` 位置进入统计。
- 对手/路人位置可以为空。

### 11.2 英雄标准化

英雄名称必须标准化，不能直接用 OCR 文本驱动榜单。

第一版使用全量 `heroes.json`：

```json
{
  "version": "2026-06-13",
  "last_updated": "2026-06-13",
  "source_note": "手工维护的 MVP 英雄表",
  "heroes": [
    {
      "id": "zhuangzhou",
      "name": "庄周",
      "aliases": [],
      "default_lanes": ["游走", "对抗路"]
    }
  ]
}
```

规则：

- OCR 原文存 `raw_hero`。
- 标准英雄存 `hero_id` 和 `hero_name`。
- 管理员 UI 用搜索/下拉选择标准英雄。
- 常见 OCR 错字加入 alias。
- 静态站和榜单只用标准英雄名。
- 对局入库后，本局位置固定保存，不随英雄表后续变化自动修改。
- 不做完整英雄版本历史表。

## 12. 管理员 UI

管理员 UI 是本地工作台，不是朋友侧展示页。

MVP 必须支持：

- 待审批次列表。
- 单局两张截图并排或上下显示。
- OCR 字段结构化表格。
- 字段可编辑。
- 低置信度字段高亮。
- 朋友身份下拉选择。
- 英雄搜索/下拉选择。
- 位置下拉选择与置信度选择。
- 手动修正截图配对。
- 疑似重复提示。
- 保存草稿。
- 批准入库。
- 拒绝本局。
- 编辑已入库对局。

UI 方向：

- 工作台型 UI，密度高、可扫描、操作明确。
- 不做营销页或炫酷首页。
- 优先准确、省时间、可追溯。

## 13. 静态朋友站

朋友侧采用静态只读发布。

页面：

- `/`：群内战报首页。
- `/database`：脱敏 Database 探索页。
- `/matches/:id`：单局结构化详情。

### 13.1 首页内容顺序

1. 本期概览：场次、胜率、时间范围。
2. 最强个人。
3. 推荐五排阵容。
4. 尽力局之王。
5. 躺赢王。
6. 英雄必输榜。
7. 谁最会坑某人。
8. 逆风发动机。
9. 入口：进入 Database。

每个数据维度后面必须接一段小字说明，用大白话解释该维度衡量什么；复杂指标还需要说明公式思路，而不是只展示一个排名结果。

### 13.2 Database MVP

Database 第一版用于查证和追溯，不做复杂 BI。

筛选：

- 玩家
- 英雄
- 位置
- 胜负
- 日期
- 组合人数
- 最低场次

排序：

- 时间
- 场次
- 胜率
- 可信胜率
- 平均评分
- KDA
- 输出占比
- 承伤占比
- 参团率

支持从榜单结果跳转到支撑该结论的对局列表。

### 13.3 静态导出数据

静态发布版包含：

- 报告期内对局基本信息。
- 朋友队每名朋友的英雄、位置、胜负、评分、KDA。
- 可用的经济、输出/承伤占比、参团率。
- 榜单所需的脱敏支撑数据。
- 匿名化对手/路人摘要。

静态发布版不包含：

- 原始截图。
- OCR 原始 JSON。
- 对手/路人完整昵称。
- 管理员修正记录详情。
- 管理员操作入口。

## 14. 权限与隐私

### 14.1 管理员侧

- 本地运行，不面向公网。
- SQLite、截图、导入中间文件不进 git。
- 管理员页面只在本地 dev 模式使用。

### 14.2 朋友侧

- 静态站公开读取脱敏导出数据。
- 如果后续需要真正安全，再引入后端鉴权。

### 14.3 对手和路人

- 朋友队完整展示。
- 对手默认显示为“对手1-5”。
- 4+1 局同队路人显示为“路人队友”。
- 可以显示对手/路人的英雄和必要对局摘要。
- 不显示对手/路人昵称、头像、ID。

## 15. 数据库模型

SQLite 中使用 `text` 存储 id，时间使用 ISO 字符串或 SQLite datetime 兼容格式。

### 15.1 players

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 主键 |
| display_name | text | 展示名 |
| game_nickname | text | 当前王者昵称 |
| aliases_json | text | 历史昵称或 OCR 常见误识别 |
| is_friend | integer | 是否朋友 |
| created_at | text | 创建时间 |
| updated_at | text | 更新时间 |

### 15.2 import_batches

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 主键 |
| local_dir | text | 本地截图批次目录 |
| status | text | pending, reviewing, partially_imported, imported |
| created_at | text | 创建时间 |
| updated_at | text | 更新时间 |

批次只是容器。入库确认粒度是单局。

### 15.3 screenshots

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 主键 |
| batch_id | text | 批次 |
| local_match_no | text | 文件名局编号 |
| match_id | text nullable | 关联正式对局 |
| local_path | text | 本地相对路径 |
| screenshot_type | text | overview 或 detail |
| ocr_status | text | pending, done, failed |
| created_at | text | 创建时间 |

### 15.4 review_matches

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 主键 |
| batch_id | text | 批次 |
| local_match_no | text | 本地局编号 |
| overview_screenshot_id | text nullable | 总览截图 |
| detail_screenshot_id | text nullable | 详情截图 |
| raw_review_json | text | Codex 生成的待审核 JSON |
| normalized_json | text | 管理员修正后的待入库 JSON |
| status | text | pending_pairing, pending_review, approved, rejected, imported |
| created_at | text | 创建时间 |
| updated_at | text | 更新时间 |

### 15.5 matches

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 主键 |
| batch_id | text | 导入批次 |
| review_match_id | text nullable | 来源待审记录 |
| mode | text | 模式 |
| played_at | text | 对局时间 |
| duration_seconds | integer nullable | 时长 |
| blue_score | integer | 蓝方击杀 |
| red_score | integer | 红方击杀 |
| winner_side | text | blue 或 red |
| friend_side | text | blue 或 red |
| friend_result | text | win 或 loss |
| friend_count | integer | 朋友数量 |
| include_in_personal_stats | integer | 是否纳入个人统计 |
| include_in_pair_stats | integer | 是否纳入组合统计 |
| include_in_lineup_stats | integer | 是否纳入五排阵容推荐 |
| include_in_for_fun_stats | integer | 是否纳入娱乐榜 |
| exclude_reason | text nullable | 排除原因 |
| dedupe_key | text | 去重指纹 |
| dedupe_override_reason | text nullable | 强制导入原因 |
| created_at | text | 创建时间 |
| updated_at | text | 更新时间 |

### 15.6 match_players

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 主键 |
| match_id | text | 对局 |
| player_id | text nullable | 如果是朋友则关联 players |
| raw_name | text | OCR 原始昵称 |
| side | text | blue 或 red |
| slot | integer | 1 到 5 |
| is_friend | integer | 是否朋友 |
| raw_hero | text nullable | OCR 原始英雄名 |
| hero_id | text nullable | 标准英雄 id |
| hero_name | text nullable | 标准英雄名 |
| lane | text nullable | 位置 |
| lane_source | text nullable | medal, manual, hero_default, manual_guess |
| lane_confidence | text nullable | high, medium, low |
| rating | real nullable | 评分 |
| kills | integer nullable | 击杀 |
| deaths | integer nullable | 死亡 |
| assists | integer nullable | 助攻 |
| economy | integer nullable | 经济 |
| damage_dealt | integer nullable | 输出伤害 |
| damage_dealt_pct | real nullable | 输出占比 |
| damage_taken | integer nullable | 承伤 |
| damage_taken_pct | real nullable | 承伤占比 |
| team_economy_pct | real nullable | 经济占比 |
| participation_pct | real nullable | 参团率 |
| medals_json | text | MVP/SVP/金银牌等 |
| is_mvp | integer | 是否 MVP |
| is_svp | integer | 是否 SVP |
| field_sources_json | text | 字段来源和置信度 |

### 15.7 review_events

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 主键 |
| target_type | text | review_match, match, match_player |
| target_id | text | 目标 id |
| action | text | approve, reject, edit, dedupe_override |
| changed_fields_json | text nullable | 关键字段修改 |
| note | text nullable | 备注 |
| created_at | text | 创建时间 |

第一版不做复杂版本回放，但必须保留最小修正痕迹。

### 15.8 report_periods

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 主键 |
| name | text | 报告期名称 |
| description | text nullable | 描述 |
| match_ids_json | text | 明确 match ids 列表 |
| source_filter_json | text nullable | 生成时的筛选条件说明 |
| created_at | text | 创建时间 |
| updated_at | text | 更新时间 |

报告期以明确 match ids 为准，保证分享链接稳定。修改已入库对局后，该报告期的榜单会随修正更新，但对局集合不变。

## 16. 去重规则

没有官方对局 ID 时，使用近似去重。

`dedupe_key` 由以下字段生成：

- 模式。
- 对局日期时间。
- 时长。
- 双方比分。
- 朋友队胜负。
- 朋友队成员。
- 朋友队英雄。
- 可识别时加入敌方英雄集合。

相似度检查：

- 日期时间相差小于 5 分钟。
- 朋友昵称集合高度重合。
- 朋友英雄集合高度重合。
- 比分和时长接近。
- 敌方英雄集合高度重合时提高相似度。

处理规则：

- 完全重复默认拦截。
- 疑似重复进入确认界面。
- 管理员可选择丢弃当前待审局、强制导入、或用当前数据修正已有对局。
- 强制导入必须填写 `dedupe_override_reason`。
- 不自动合并两份 OCR 结果，除非管理员明确选择修正已有对局。
- 如果编辑已入库对局影响 dedupe_key，需要重新计算并提示冲突。

## 17. 榜单计算

榜单第一版请求时实时计算，最多做简单前端缓存，不预存榜单结果。

原因：

- 数据量小。
- 已入库数据可编辑。
- 公式和权重仍可能迭代。
- 报告期保存 match ids，不保存结果快照。

所有榜单默认展示：

- 原始场次。
- 原始胜率。
- 样本修正后的可信胜率。
- 计算口径说明。
- 样本不足提示。

本章里的“数据库总局数”默认指当前公开报告期内已正式入库的对局数，即静态站首页概览里的 `match_count`。不包含待审、拒绝或重复拦截的局。

每个榜单模块都要在结果后附一段大白话说明：

- 它衡量的是什么。
- 为什么这个指标只能代表“赛后数据倾向”，不能证明完整游戏过程。
- 如果用了复杂公式，说明主要输入和权重，不要求用户读源码。

### 17.1 榜单严肃程度

榜单分为：

- `serious`：可以当核心分析看。
- `semi_serious`：可参考，但必须显示口径。
- `for_fun`：主要用于群内整活，必须显示样本和代理指标说明。

首页不应把所有榜单呈现成同等可信度。

### 17.2 可信胜率

第一版使用简单贝叶斯平滑：

```text
可信胜率 = (胜场 + 先验场次 * 50%) / (总场次 + 先验场次)
先验场次 = 6
```

例子：

- 2 胜 0 负：可信胜率 = (2 + 3) / (2 + 6) = 62.5%
- 30 胜 18 负：可信胜率 = (30 + 3) / (48 + 6) = 61.1%

### 17.3 个人最强综合分

最强个人主榜按综合分做整体 rank 排序。综合分范围 0 到 100，用于排序，但不是唯一权威。

建议权重：

| 维度 | 权重 | 说明 |
| --- | --- | --- |
| 平均评分 | 45% | 王者荣耀官方评分，第一版最重要 |
| 可信胜率 | 20% | 赢仍然重要，但低于个人表现 |
| MVP/SVP 能力 | 10% | 胜局 MVP 和败局 SVP |
| KDA | 10% | 使用 `(击杀 + 助攻) / max(1, 死亡)`，做上限截断 |
| 综合贡献 | 15% | 输出、承伤、经济、参团率综合 |

展示必须同时给出拆分维度：平均评分、可信胜率、KDA、MVP/SVP、贡献分、样本场次。

样本少于 5 场的个人进入观察区，不和主榜硬排。

大白话说明：这个榜看的是“整体上谁最能稳定打出个人表现”，不是只看胜率，也不是只看一两局高光。

### 17.4 推荐最佳五排阵容

第一版定位为 **位置适配推荐**，不是严格预测“这五个人一起上胜率最高”。

目标：在五个位置上各推荐一名朋友，每名朋友最多出现一次。

入选硬门槛：

```text
阵容入选最低场次 = ceil(数据库总局数 * 10%)
```

某个玩家要以某个位置入选推荐阵容，必须在该位置实际出场次数达到这个门槛。这个门槛是硬限制，不足场次时不能靠低信心标识补位。

每个玩家在每个位置上的位置分：

| 维度 | 权重 |
| --- | --- |
| 该位置平均评分 | 55% |
| 该位置可信胜率 | 25% |
| 该位置综合贡献 | 10% |
| 样本信心 | 10% |

样本信心：

```text
样本信心 = min(1, 该位置场次 / 5)
```

系统遍历所有合法分配，选择总分最高的 5 人 5 位置组合。

需要展示：

- 推荐阵容。
- 每个位置推荐理由。
- 每个位置样本场次。
- 位置置信度。
- 样本不足提示。

如果某个位置没有达到动态门槛的候选人，首页不推荐完整五排阵容，并展示样本不足原因。

大白话说明：这个榜推荐的是“按位置分工最合适的五个人”，不是证明这五个人同时组队一定胜率最高。

### 17.5 尽力局之王

严肃程度：`semi_serious`。

只统计失败局。

一次“尽力”事件满足至少一项：

- 朋友队内评分最高。
- 获得 SVP。
- 评分高于本局上场朋友平均评分 1 分以上。

榜单排序：

1. 尽力次数。
2. 失败局平均评分。
3. 失败局平均参团率。

首页只展示 No.1，不展示 Top 5。后端或导出数据可以保留完整排序用于排查和支撑跳转。

大白话说明：这个榜看的是“输了但数据上最像还在扛的人”，只能反映赛后评分、SVP 和队内相对表现。

### 17.6 躺赢王

严肃程度：`for_fun`。

只统计胜利局，语气为中度调侃。

一次“躺赢”事件满足至少两项：

- 本局上场朋友中评分最低。
- 评分低于本局上场朋友平均评分 1 分以上。
- 输出占比低于本局上场朋友平均。
- 参团率低于本局上场朋友平均。
- KDA 明显偏低。

榜单排序：

1. 躺赢次数。
2. 胜利局低评分次数。
3. 胜利局平均评分从低到高。

首页只展示 No.1，不展示 Top 5。后端或导出数据可以保留完整排序用于排查和支撑跳转。

大白话说明：这个榜是娱乐向，衡量“赢了但赛后数据相对没那么出力”的次数，不代表真实游戏里没有关键作用。

### 17.7 谁拿某英雄必输

严肃程度：`for_fun` 或样本充足时 `semi_serious`。

统计条件：

- 只统计朋友。
- 玩家 + 英雄组合主榜最低场次 = `max(3, ceil(数据库总局数 * 5%))`。
- 使用可信胜率排序。

榜单字段：

- 玩家。
- 英雄。
- 场次。
- 胜负。
- 原始胜率。
- 可信胜率。
- 平均评分。

排序：

1. 可信胜率从低到高。
2. 败场从高到低。
3. 平均评分从低到高。

大白话说明：这个榜看的是“某人拿某英雄时结果明显不顺”的组合。低样本只能整活参考，样本达标后才进入主榜。

### 17.8 谁最会坑某人

严肃程度：`for_fun`。

定义：A 与 B 同队时，B 的可信胜率明显下降，则 A 被视为更“坑” B。

```text
B 被 A 影响值 = B 与 A 同队可信胜率 - B 不与 A 同队可信胜率
```

值越低，说明 B 和 A 同队时越难赢。

最低样本建议：

- A 与 B 同队不少于 3 场。
- B 不与 A 同队不少于 3 场。

样本不足可以展示在娱乐观察区，但不进入正式榜单。

### 17.9 逆风发动机

严肃程度：`for_fun`。

截图没有过程数据，第一版不判断真实逆风时间线，改用赛后代理指标。

只统计失败局。

单局崩盘分由以下指标组成：

| 维度 | 方向 |
| --- | --- |
| 评分低于本局上场朋友平均 | 越低越高 |
| 死亡数高于本局上场朋友平均 | 越高越高 |
| 参团率低于本局上场朋友平均 | 越低越高 |
| 输出或承伤贡献低于位置预期 | 越低越高 |

展示时必须说明：这是“赛后代理指标”，不是严格因果证明。

## 18. 毒舌文案规则

战报风格为中度毒舌，但只吐槽游戏数据和局部表现。

允许调侃：

- 评分。
- 死亡数。
- 参团率。
- 英雄胜率。
- 连败。
- 躺赢。
- 尽力。

禁止调侃：

- 人格。
- 智商。
- 外貌。
- 职业。
- 收入。
- 家庭。
- 疾病。
- 现实隐私。

规则：

- 避免永久性标签，例如“你就是废物”。
- 使用局部表现描述，例如“这几局像是在给对面上强度”。
- 首页避免连续多个负面模块都集中点名同一个人。
- 可提供语气档位：温和 / 中度毒舌 / 火力全开。
- 第一版默认中度毒舌。
- 火力全开也不能越过红线。

## 19. 报告期

报告期用于固定“这期战报说的是哪批对局”。

规则：

- 报告期保存明确 `match_ids` 列表。
- 可记录生成时的筛选条件作为说明。
- 默认首页展示最新报告期。
- 管理员可以从当前筛选结果生成新报告期。
- 分享链接带 `period_id`。
- 不保存完整 HTML 快照。
- 修改已入库对局后，报告期内的榜单会随修正更新，但对局集合不变。

## 20. MVP 验收标准

第一版完成标准：

1. 32 局、64 张图按本地文件夹规范整理完成。
2. Codex 能按单局生成待审核 JSON。
3. 本地导入脚本能把待审核 JSON 写入 SQLite 待审表。
4. 管理员 UI 能展示两张截图和结构化字段。
5. 管理员能修正截图配对、朋友身份、英雄、位置、胜负、评分、KDA。
6. 进入统计的朋友记录必须有标准英雄、唯一位置、评分和 KDA。
7. 管理员可以逐局批准入库，不被异常局阻塞整个批次。
8. 系统保留原始 OCR JSON、正式确认数据和最小修正痕迹。
9. 能拦截明显重复对局，并提示疑似重复。
10. 管理员可以编辑已入库对局。
11. 能创建报告期，报告期保存明确 match ids。
12. 能导出脱敏静态数据。
13. 静态站能生成手机优先的群内战报。
14. 静态站能展示个人最强、最佳五排阵容、尽力局、躺赢、英雄必输、坑某人、逆风发动机。
15. Database 页支持基础筛选、排序和榜单支撑明细跳转。
16. 静态站不包含原始截图、OCR 原文、对手/路人完整昵称或管理员修正详情。
17. 后续可以继续追加新截图。

## 21. Backlog / v2

- 朋友自行上传截图。
- 朋友上传后自己确认 OCR。
- 独立视觉 API provider。
- 多 OCR provider fallback。
- Supabase Postgres。
- Supabase Storage。
- Vercel 后端部署。
- 真正的后端鉴权。
- 朋友账号体系。
- 每周/月自动生成战报。
- 微信群自动推送。
- 微信群分享图。
- 对手强度分析。
- 英雄版本变更历史。
- 更细的位置期望模型。
- 更复杂的组合分析。
- 数据导出 CSV。
- 管理员操作日志后台。
- 复杂 BI 和透视表。

## 22. 后续需要补齐

- 32 局完整截图。
- 首批截图文件命名和目录整理。
- `heroes.json` 全量英雄表。
- 英雄默认分路第一版。
- SQLite schema migration。
- Codex OCR 输出 prompt 和 JSON 规范。
- 管理员 UI 具体设计稿。
- 静态站发布目标，例如 GitHub Pages 或静态 Vercel。
- `.gitignore`，确保 SQLite、截图和本地导入文件不进 git。
