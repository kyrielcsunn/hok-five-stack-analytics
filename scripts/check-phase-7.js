import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../server/db/database.js";
import { seedFriends } from "../server/db/friends.js";
import { calculateLeaderboards } from "../server/stats/leaderboards.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tempDir = await mkdtemp(join(tmpdir(), "hok-phase7-"));
const dbPath = join(tempDir, "phase7.sqlite");
const port = 4300 + Math.floor(Math.random() * 400);
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;

const friends = {
  a: ["friend_ge", "鸽"],
  b: ["friend_yixiangtiankaideqiu", "异想天开的球"],
  c: ["friend_xiaose_xianbei_dawo", "萧瑟仙贝打我"],
  d: ["friend_jingyang_yinxiaohuan", "净漾银笑幻"],
  e: ["friend_yueliang_xichen_chaoyang", "月亮西沉朝阳"],
  f: ["friend_dilushou_oo", "迪路兽oo"],
  g: ["friend_zhenzhu_guanguan", "珍珠罐罐"],
};
const lanes = ["对抗路", "中路", "打野", "发育路", "游走"];

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

function insertFixtureMatch(db, index, friendKeys, result, ratings) {
  const matchId = `phase7:m${String(index).padStart(2, "0")}`;
  const timestamp = `2026-06-${String(index).padStart(2, "0")}T20:00:00+08:00`;
  const redScore = result === "win" ? 25 : 12;
  const blueScore = result === "win" ? 12 : 25;

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
      VALUES (?, 'phase7', NULL, '5v5排位', ?, 900, ?, ?, ?, 'red', ?, 5, 1, 1, 1, 1, NULL, ?, NULL, ?, ?)
    `,
  ).run(
    matchId,
    timestamp,
    blueScore,
    redScore,
    result === "win" ? "red" : "blue",
    result,
    `phase7-dedupe-${index}`,
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
      VALUES (?, ?, ?, ?, 'red', ?, 1, ?, ?, ?, ?, 'manual', 'high', ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, '{}')
    `,
  );
  const maxRating = Math.max(...friendKeys.map((key) => ratings[key]));

  friendKeys.forEach((key, indexInMatch) => {
    const [playerId, playerName] = friends[key];
    const rating = ratings[key];
    const isCarry = rating >= 10;
    const isLow = rating <= 5.5;
    const heroName = key === "a" ? "鲁班七号" : `${playerName}常用`;
    const kills = isCarry ? 8 : isLow ? 0 : 3;
    const deaths = isLow ? 7 : isCarry ? 2 : 4;
    const assists = isCarry ? 10 : isLow ? 3 : 8;
    const participation = isCarry ? 82 : isLow ? 38 : 64;
    const damage = isCarry ? 32 : isLow ? 11 : 21;

    insertPlayer.run(
      `${matchId}:${indexInMatch + 1}`,
      matchId,
      playerId,
      playerName,
      indexInMatch + 1,
      heroName,
      `hero:${heroName}`,
      heroName,
      lanes[indexInMatch],
      rating,
      kills,
      deaths,
      assists,
      8000 + indexInMatch * 300,
      damage,
      isLow ? 18 : 24,
      isLow ? 15 : 21,
      participation,
      result === "win" && rating === maxRating ? 1 : 0,
      result === "loss" && rating === maxRating ? 1 : 0,
    );
  });

  return matchId;
}

function assertSupport(entries, field = "supporting_match_ids") {
  for (const entry of entries) {
    assert.ok(Array.isArray(entry[field]));
    assert.ok(entry[field].length > 0);
  }
}

const db = await initializeDatabase(dbPath);

try {
  seedFriends(db);
  db.prepare(
    `
      INSERT INTO import_batches (id, local_dir, status, created_at, updated_at)
      VALUES ('phase7', 'data/screenshots/phase7', 'imported', '2026-06-14T00:00:00.000Z', '2026-06-14T00:00:00.000Z')
    `,
  ).run();

  const matchIds = [
    insertFixtureMatch(db, 1, ["a", "b", "c", "d", "e"], "win", {
      a: 7,
      b: 5,
      c: 12,
      d: 9,
      e: 8,
    }),
    insertFixtureMatch(db, 2, ["a", "b", "c", "d", "e"], "loss", {
      a: 4,
      b: 6,
      c: 12,
      d: 7,
      e: 5,
    }),
    insertFixtureMatch(db, 3, ["a", "b", "c", "d", "e"], "loss", {
      a: 4,
      b: 6,
      c: 11,
      d: 8,
      e: 5,
    }),
    insertFixtureMatch(db, 4, ["b", "c", "d", "f", "g"], "win", {
      b: 5,
      c: 12,
      d: 8,
      f: 9,
      g: 7,
    }),
    insertFixtureMatch(db, 5, ["b", "c", "d", "f", "g"], "win", {
      b: 5.5,
      c: 13,
      d: 9,
      f: 8,
      g: 7,
    }),
    insertFixtureMatch(db, 6, ["b", "c", "d", "f", "g"], "loss", {
      b: 8,
      c: 12,
      d: 6,
      f: 5,
      g: 4,
    }),
    insertFixtureMatch(db, 7, ["a", "b", "c", "f", "g"], "loss", {
      a: 4,
      b: 5,
      c: 11,
      f: 6,
      g: 5,
    }),
    insertFixtureMatch(db, 8, ["a", "b", "c", "f", "g"], "loss", {
      a: 4,
      b: 5,
      c: 10,
      f: 6,
      g: 5,
    }),
  ];

  db.prepare(
    `
      INSERT INTO report_periods (
        id,
        name,
        description,
        match_ids_json,
        source_filter_json,
        created_at,
        updated_at
      )
      VALUES ('period:phase7', 'Phase 7 fixture', NULL, ?, '{}', '2026-06-14T00:00:00.000Z', '2026-06-14T00:00:00.000Z')
    `,
  ).run(JSON.stringify(matchIds.slice(0, 6)));

  const allResult = calculateLeaderboards(db);
  assert.equal(allResult.meta.match_count, 8);
  assert.equal(allResult.meta.thresholds.best_lineup_min_lane_games, 1);
  assert.equal(allResult.meta.thresholds.hero_losing_min_games, 3);
  assert.equal(allResult.leaderboards.best_lineup.assignments.length, 5);
  assert.equal(allResult.leaderboards.best_lineup.minimum_games, 1);
  assert.equal(allResult.leaderboards.hero_losing.minimum_games, 3);
  assert.ok(allResult.leaderboards.trusted_win_rates.entries.length >= 5);
  assert.ok(allResult.leaderboards.personal_strength.entries.length >= 5);
  assert.ok(allResult.leaderboards.effort_king.entries.length > 0);
  assert.ok(allResult.leaderboards.lay_win_king.entries.length > 0);
  assert.ok(allResult.leaderboards.hero_losing.entries.length > 0);
  assert.ok(allResult.leaderboards.pit_pairs.entries.length > 0);
  assert.ok(allResult.leaderboards.headwind_engine.entries.length > 0);
  assertSupport(allResult.leaderboards.personal_strength.entries);
  assertSupport(allResult.leaderboards.effort_king.entries);
  assertSupport(allResult.leaderboards.lay_win_king.entries);
  assertSupport(allResult.leaderboards.hero_losing.entries);
  assertSupport(allResult.leaderboards.pit_pairs.entries);
  assertSupport(allResult.leaderboards.headwind_engine.entries);
  assert.ok(allResult.leaderboards.personal_strength.plain_language_notes.includes("整体"));
  assert.ok(allResult.leaderboards.best_lineup.plain_language_notes.includes("至少要打 1 场"));
  assert.ok(allResult.leaderboards.hero_losing.plain_language_notes.includes("最低 3 场"));

  const heroLoser = allResult.leaderboards.hero_losing.entries.find(
    (entry) => entry.player_name === "鸽" && entry.hero_name === "鲁班七号",
  );
  assert.ok(heroLoser);
  assert.equal(heroLoser.games, 5);

  const pitEntry = allResult.leaderboards.pit_pairs.entries.find(
    (entry) => entry.affected_player_name === "异想天开的球" && entry.teammate_name === "鸽",
  );
  assert.ok(pitEntry);
  assert.ok(pitEntry.impact < 0);

  const periodResult = calculateLeaderboards(db, {
    periodId: "period:phase7",
  });
  assert.equal(periodResult.meta.period.id, "period:phase7");
  assert.equal(periodResult.meta.match_count, 6);
  assert.equal(periodResult.meta.thresholds.best_lineup_min_lane_games, 1);
  assert.equal(periodResult.meta.thresholds.hero_losing_min_games, 3);

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

    const response = await fetch(`${baseUrl}/leaderboards?period_id=period%3Aphase7`);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.leaderboards.meta.period.id, "period:phase7");
    assert.equal(json.leaderboards.meta.match_count, 6);
    assert.equal(json.leaderboards.meta.thresholds.best_lineup_min_lane_games, 1);
    assert.equal(json.leaderboards.meta.thresholds.hero_losing_min_games, 3);
    assert.equal(json.leaderboards.leaderboards.best_lineup.assignments.length, 5);

    console.log(
      JSON.stringify(
        {
          database: dbPath,
          all_match_count: allResult.meta.match_count,
          period_match_count: periodResult.meta.match_count,
          best_lineup_slots: allResult.leaderboards.best_lineup.assignments.length,
          hero_losing_entries: allResult.leaderboards.hero_losing.entries.length,
          pit_pair_entries: allResult.leaderboards.pit_pairs.entries.length,
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
