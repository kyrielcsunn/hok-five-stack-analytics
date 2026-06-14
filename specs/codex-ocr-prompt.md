# Codex-assisted OCR Prompt

更新日期：2026-06-14

## 目的

把一局王者荣耀战报的 `overview` 和 `detail` 两张截图转成单局待审 JSON。输出只作为管理员预填，不是真相；看不清或无法确认的字段必须填 `null`，并写入 `codex_notes`。

## 输入

- `batch_id`：例如 `batch-001`
- `local_match_no`：三位编号，例如 `001`
- `overview_path`：例如 `data/screenshots/batch-001/001-overview.png`
- `detail_path`：例如 `data/screenshots/batch-001/001-detail.png`
- `data/reference/heroes.json`：当前项目英雄标准表，用于匹配 `hero_id` 和 `hero_name`
- 朋友名单：
  - `净漾银笑幻`
  - `异想天开的球`
  - `鸽`
  - `萧瑟仙贝打我`
  - `月亮西沉朝阳`
  - `迪路兽oo`
  - `别压力我ok？`
  - `珍珠罐罐`
  - `吧唧小喵`

## Prompt

```text
你是这个项目的 Codex-assisted OCR 预处理器。请读取同一局王者荣耀战报的 overview/detail 两张截图，输出严格合法的单局 review JSON。

硬性规则：
1. 只输出 JSON，不输出 Markdown、解释或代码块。
2. JSON 顶层只能有 source、match、players、field_confidence、codex_notes。
3. players 必须正好 10 行，蓝方 slot 1-5 在前，红方 slot 1-5 在后，顺序按截图从上到下。
4. 所有必需字段都必须出现。看不清或不能确认时填 null，不要猜数字。
5. 数字不要带单位：67.4k 写成 67400，25% 写成 25。
6. 时长转成秒，例如 12:10 写成 730。
7. played_at 用 ISO 字符串和 +08:00 时区，例如 2026/06/13 0:37 写成 2026-06-13T00:37:00+08:00。
8. 胜负字段使用朋友视角：
   - winner_side 是事实胜方：blue 或 red。
   - friend_side 是朋友更多的一方：blue 或 red；无法确认填 null。
   - friend_result 是朋友视角：win 或 loss；无法确认填 null。
9. friend_candidate 只能填 9 位朋友名单中的标准展示名；不是朋友填 null。
10. is_friend_candidate 对朋友填 true，不是朋友填 false；无法确认填 null。
11. raw_hero 保存截图中读到的英雄名。先用 data/reference/heroes.json 精确匹配 hero_id 和 hero_name；无法唯一匹配时填 null。
12. lane 只允许：对抗路、中路、打野、发育路、游走。只有截图奖牌明确位置时 lane_source=medal、lane_confidence=high；根据英雄常见默认位置推断时 lane_source=hero_default、lane_confidence=medium；无法判断填 null。
13. include_in_personal_stats、include_in_pair_stats、include_in_lineup_stats、include_in_for_fun_stats：
    - 5 位朋友同队且核心字段可读时全部填 true。
    - 4 位朋友 + 1 位路人时 personal/pair/for_fun 可为 true，lineup 为 false。
    - 3 位及以下朋友、阵营不明或核心字段严重缺失时填 null，并说明原因。
14. MVP/SVP、金牌/银牌/铜牌等标记写入 medals。is_mvp/is_svp 只在截图明确时填 true；没有标记填 false；无法判断填 null。
15. 对手/路人昵称可以保留在本地 review JSON 中，但不要为了补全而编造。
16. 任何低置信度、模糊昵称、可能读错的英雄或奖牌，都写入 codex_notes。

输出 JSON 必须符合 specs/schemas/review-json.schema.json。
```

## 输出目录规范

真实批次输出到本机 ignored 目录，不进 git：

```text
data/imports/batch-001/
  manifest.json
  matches/
    001.review.json
    002.review.json
    003.review.json
```

`manifest.json` 记录本批次试跑范围和 prompt 版本；每个 `*.review.json` 可直接交给 `scripts/import-review-json.js` 导入待审表。

## 验证命令

```bash
HOK_DB_PATH="$(mktemp -d)/hok.sqlite" node scripts/import-review-json.js data/imports/batch-001/matches
```

预期结果：输出 `imported_count` 等于待导入的 `*.review.json` 数量。
