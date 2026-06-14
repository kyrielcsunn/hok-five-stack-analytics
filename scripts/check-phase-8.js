import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../server/db/database.js";
import { seedFriends } from "../server/db/friends.js";
import { createReportPeriodFromAllMatches } from "../server/reports/report-periods.js";
import { buildStaticExport, writeStaticExport } from "../server/reports/static-export.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tempDir = await mkdtemp(join(tmpdir(), "hok-phase8-"));
const dbPath = join(tempDir, "phase8.sqlite");
const outputPath = join(tempDir, "report-data.json");
const host = "127.0.0.1";
const port = 4700 + Math.floor(Math.random() * 400);
const baseUrl = `http://${host}:${port}`;
const friendIds = [
  ["friend_ge", "鸽", "鲁班七号", "发育路"],
  ["friend_yixiangtiankaideqiu", "异想天开的球", "庄周", "游走"],
  ["friend_xiaose_xianbei_dawo", "萧瑟仙贝打我", "赵云", "打野"],
  ["friend_jingyang_yinxiaohuan", "净漾银笑幻", "小乔", "中路"],
  ["friend_yueliang_xichen_chaoyang", "月亮西沉朝阳", "夏侯惇", "对抗路"],
];

async function waitForHealth(processHandle) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5000) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Server exited before health check with code ${processHandle.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/health`);

      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error("Timed out waiting for local API health check");
}

async function stopServer(processHandle) {
  if (processHandle.exitCode !== null) {
    return;
  }

  processHandle.kill();
  await new Promise((resolve) => processHandle.once("exit", resolve));
}

function hasObjectKey(value, key) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasObjectKey(item, key));
  }

  return Object.hasOwn(value, key) || Object.values(value).some((item) => hasObjectKey(item, key));
}

function insertMatch(db, index, options = {}) {
  const matchId = `phase8:m${index}`;
  const isWin = index % 2 === 1;
  const timestamp = `2026-06-${String(index).padStart(2, "0")}T20:00:00+08:00`;

  db.prepare(
    `
      INSERT INTO matches (
        id,
        batch_id,
        review_match_id,
        mode,
        played_at,
        duration_seconds,
        blue_score,
        red_score,
        winner_side,
        friend_side,
        friend_result,
        friend_count,
        include_in_personal_stats,
        include_in_pair_stats,
        include_in_lineup_stats,
        include_in_for_fun_stats,
        exclude_reason,
        dedupe_key,
        dedupe_override_reason,
        created_at,
        updated_at
      )
      VALUES (?, 'phase8', NULL, '5v5排位', ?, 900, ?, ?, ?, 'red', ?, ?, 1, 1, ?, 1, ?, ?, NULL, ?, ?)
    `,
  ).run(
    matchId,
    timestamp,
    isWin ? 12 : 24,
    isWin ? 28 : 13,
    isWin ? "red" : "blue",
    isWin ? "win" : "loss",
    options.fourPlusOne ? 4 : 5,
    options.fourPlusOne ? 0 : 1,
    options.fourPlusOne ? "4+1 局，不纳入五排阵容" : null,
    `phase8-dedupe-${index}`,
    timestamp,
    timestamp,
  );

  const insertPlayer = db.prepare(
    `
      INSERT INTO match_players (
        id,
        match_id,
        player_id,
        raw_name,
        side,
        slot,
        is_friend,
        raw_hero,
        hero_id,
        hero_name,
        lane,
        lane_source,
        lane_confidence,
        rating,
        kills,
        deaths,
        assists,
        economy,
        damage_dealt_pct,
        damage_taken_pct,
        team_economy_pct,
        participation_pct,
        medals_json,
        is_mvp,
        is_svp,
        field_sources_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'high', ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, '{}')
    `,
  );

  friendIds.forEach(([playerId, playerName, heroName, lane], friendIndex) => {
    if (options.fourPlusOne && friendIndex === 4) {
      insertPlayer.run(
        `${matchId}:red:5`,
        matchId,
        null,
        "路人小号",
        "red",
        5,
        0,
        "蔡文姬",
        "caiwenji",
        "蔡文姬",
        "游走",
        6,
        1,
        4,
        8,
        6200,
        18,
        16,
        14,
        55,
        0,
        0,
      );
      return;
    }

    const rating = 7 + friendIndex + (isWin ? 1 : 0);

    insertPlayer.run(
      `${matchId}:red:${friendIndex + 1}`,
      matchId,
      playerId,
      playerName,
      "red",
      friendIndex + 1,
      1,
      heroName,
      `hero:${heroName}`,
      heroName,
      lane,
      rating,
      2 + friendIndex,
      isWin ? 2 : 5,
      8 + friendIndex,
      7000 + friendIndex * 500,
      18 + friendIndex * 3,
      20 + friendIndex,
      18 + friendIndex,
      55 + friendIndex * 5,
      isWin && friendIndex === 4 ? 1 : 0,
      !isWin && friendIndex === 4 ? 1 : 0,
    );
  });

  for (let slot = 1; slot <= 5; slot += 1) {
    insertPlayer.run(
      `${matchId}:blue:${slot}`,
      matchId,
      null,
      `SecretOpponent${index}-${slot}`,
      "blue",
      slot,
      0,
      "金蝉",
      "jinchan",
      "金蝉",
      "中路",
      6,
      1,
      3,
      5,
      7000,
      18,
      20,
      18,
      50,
      0,
      0,
    );
  }

  return matchId;
}

const db = await initializeDatabase(dbPath);

try {
  seedFriends(db);
  db.prepare(
    `
      INSERT INTO import_batches (id, local_dir, status, created_at, updated_at)
      VALUES ('phase8', 'data/screenshots/phase8', 'imported', '2026-06-14T00:00:00.000Z', '2026-06-14T00:00:00.000Z')
    `,
  ).run();

  const fullStackMatchIds = [1, 2, 3, 4].map((index) => insertMatch(db, index));
  const fourPlusOneMatchId = insertMatch(db, 5, {
    fourPlusOne: true,
  });
  const periodResult = createReportPeriodFromAllMatches(db, {
    id: "period:phase8",
    name: "Phase 8 fixture",
    description: "Static export fixture",
  });
  const payload = buildStaticExport(db, {
    periodId: "period:phase8",
  });

  assert.equal(periodResult.period.match_count, 5);
  assert.equal(payload.summary.match_count, 5);
  assert.equal(payload.summary.four_plus_one_match_count, 1);
  assert.ok(payload.matches.find((match) => match.id === fourPlusOneMatchId).background_players[0]);
  assert.ok(!payload.leaderboards.leaderboards.best_lineup.supporting_match_ids.includes(fourPlusOneMatchId));
  assert.ok(
    payload.leaderboards.leaderboards.best_lineup.supporting_match_ids.every((matchId) =>
      fullStackMatchIds.includes(matchId),
    ),
  );

  const payloadJson = JSON.stringify(payload);

  assert.equal(payloadJson.includes("SecretOpponent"), false);
  assert.equal(payloadJson.includes("路人小号"), false);
  assert.equal(hasObjectKey(payload, "raw_review_json"), false);
  assert.equal(hasObjectKey(payload, "overview_path"), false);

  await writeStaticExport(payload, outputPath);
  db.close();

  const serverProcess = spawn(process.execPath, ["server/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOK_DB_PATH: dbPath,
      HOST: host,
      PORT: String(port),
    },
    stdio: "ignore",
  });

  try {
    await waitForHealth(serverProcess);

    const periodResponse = await fetch(`${baseUrl}/report-periods`);
    const periodJson = await periodResponse.json();

    assert.equal(periodResponse.status, 200);
    assert.equal(periodJson.report_periods[0].id, "period:phase8");

    const exportResponse = await fetch(`${baseUrl}/static-export?period_id=period%3Aphase8`);
    const exportJson = await exportResponse.json();

    assert.equal(exportResponse.status, 200);
    assert.equal(exportJson.export.summary.match_count, 5);
    assert.equal(JSON.stringify(exportJson).includes("SecretOpponent"), false);

    console.log(
      JSON.stringify(
        {
          database: dbPath,
          output_path: outputPath,
          period_id: payload.period.id,
          match_count: payload.summary.match_count,
          four_plus_one_match_count: payload.summary.four_plus_one_match_count,
          endpoint: "ok",
        },
        null,
        2,
      ),
    );
  } finally {
    await stopServer(serverProcess);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
