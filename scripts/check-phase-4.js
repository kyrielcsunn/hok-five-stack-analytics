import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../server/db/database.js";
import { seedFriends } from "../server/db/friends.js";
import { importReviewJsonFiles } from "./import-review-json.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tempDir = await mkdtemp(join(tmpdir(), "hok-phase4-"));
const dbPath = join(tempDir, "phase4.sqlite");
const reviewPaths = [join(tempDir, "001.review.json"), join(tempDir, "002.review.json")];
const screenshotDir = join(projectRoot, "data", "screenshots", "phase4-check");
const port = 3900 + Math.floor(Math.random() * 400);
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lGd3xwAAAABJRU5ErkJggg==",
  "base64",
);

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

async function writeReviewFixture(localMatchNo, reviewPath) {
  const sourceExamplePath = join(
    projectRoot,
    "specs",
    "examples",
    "review-json",
    "batch-001",
    "matches",
    `${localMatchNo}.review.json`,
  );
  const sourceReview = JSON.parse(await readFile(sourceExamplePath, "utf8"));

  sourceReview.source.batch_id = "phase4-check";
  sourceReview.source.local_match_no = localMatchNo;
  sourceReview.source.overview_path = `data/screenshots/phase4-check/${localMatchNo}-overview.png`;
  sourceReview.source.detail_path = `data/screenshots/phase4-check/${localMatchNo}-detail.png`;

  await writeFile(join(screenshotDir, `${localMatchNo}-overview.png`), onePixelPng);
  await writeFile(join(screenshotDir, `${localMatchNo}-detail.png`), onePixelPng);
  await writeFile(reviewPath, JSON.stringify(sourceReview, null, 2));

  return sourceReview;
}

function makeFriendPlayersApprovable(reviewJson) {
  reviewJson.match.include_in_personal_stats ??= true;
  reviewJson.match.include_in_pair_stats ??= true;
  reviewJson.match.include_in_lineup_stats ??= true;
  reviewJson.match.include_in_for_fun_stats ??= true;
  reviewJson.match.exclude_reason ??= null;

  for (const player of reviewJson.players) {
    if (!player.is_friend_candidate) {
      continue;
    }

    player.hero_id ??= `manual:${player.side}:${player.slot}`;
    player.hero_name ??= player.raw_hero ?? "待确认英雄";
  }
}

await mkdir(screenshotDir, { recursive: true });
const sourceReview = await writeReviewFixture("001", reviewPaths[0]);
await writeReviewFixture("002", reviewPaths[1]);

const db = await initializeDatabase(dbPath);

try {
  seedFriends(db);
  await importReviewJsonFiles(db, reviewPaths);
} finally {
  db.close();
}

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

  const listResponse = await fetch(`${baseUrl}/review-matches`);
  assert.equal(listResponse.status, 200);
  const listJson = await listResponse.json();
  assert.equal(listJson.review_matches.length, 2);
  assert.equal(listJson.review_matches[0].id, "phase4-check:001");

  const detailResponse = await fetch(`${baseUrl}/review-matches/phase4-check%3A001`);
  assert.equal(detailResponse.status, 200);
  const detailJson = await detailResponse.json();
  assert.equal(detailJson.review_match.normalized_json.players.length, 10);
  assert.equal(detailJson.review_match.overview_path, sourceReview.source.overview_path);

  const draftJson = detailJson.review_match.normalized_json;
  draftJson.match.mode = "5v5排位-草稿验证";
  draftJson.players[0].lane = "对抗路";
  draftJson.players[0].lane_source = "manual";
  draftJson.players[0].lane_confidence = "high";
  makeFriendPlayersApprovable(draftJson);

  const saveResponse = await fetch(`${baseUrl}/review-matches/phase4-check%3A001`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      normalized_json: draftJson,
    }),
  });
  assert.equal(saveResponse.status, 200);
  const saveJson = await saveResponse.json();
  assert.equal(saveJson.review_match.normalized_json.match.mode, "5v5排位-草稿验证");
  assert.equal(saveJson.review_match.normalized_json.players[0].lane, "对抗路");

  const screenshotResponse = await fetch(
    `${baseUrl}/review-matches/phase4-check%3A001/screenshots/overview`,
  );
  assert.equal(screenshotResponse.status, 200);
  assert.equal(screenshotResponse.headers.get("content-type"), "image/png");
  assert.ok((await screenshotResponse.arrayBuffer()).byteLength > 0);

  const approveResponse = await fetch(`${baseUrl}/review-matches/phase4-check%3A001/approve`, {
    method: "POST",
  });
  assert.equal(approveResponse.status, 200);
  const approveJson = await approveResponse.json();
  assert.equal(approveJson.review_match.status, "imported");
  assert.equal(approveJson.match_id, "match:phase4-check:001");

  const rejectResponse = await fetch(`${baseUrl}/review-matches/phase4-check%3A002/reject`, {
    method: "POST",
  });
  assert.equal(rejectResponse.status, 200);
  const rejectJson = await rejectResponse.json();
  assert.equal(rejectJson.review_match.status, "rejected");

  const verificationDb = await initializeDatabase(dbPath);

  try {
    const importedMatch = verificationDb
      .prepare(
        `
          SELECT id, mode, friend_count
          FROM matches
          WHERE review_match_id = ?
        `,
      )
      .get("phase4-check:001");
    assert.equal(importedMatch.id, "match:phase4-check:001");
    assert.equal(importedMatch.mode, "5v5排位-草稿验证");
    assert.equal(importedMatch.friend_count, 5);

    const matchPlayerCount = verificationDb
      .prepare("SELECT COUNT(*) AS count FROM match_players WHERE match_id = ?")
      .get("match:phase4-check:001");
    assert.equal(matchPlayerCount.count, 10);

    const linkedScreenshots = verificationDb
      .prepare("SELECT COUNT(*) AS count FROM screenshots WHERE match_id = ?")
      .get("match:phase4-check:001");
    assert.equal(linkedScreenshots.count, 2);

    const reviewEvents = verificationDb
      .prepare(
        `
          SELECT action
          FROM review_events
          WHERE target_id IN (?, ?)
          ORDER BY action
        `,
      )
      .all("phase4-check:001", "phase4-check:002");
    assert.deepEqual(
      reviewEvents.map((event) => event.action),
      ["approve", "reject"],
    );
  } finally {
    verificationDb.close();
  }

  console.log(
    JSON.stringify(
      {
        database: dbPath,
        review_matches: listJson.review_matches.length,
        detail_players: detailJson.review_match.normalized_json.players.length,
        draft_save: "ok",
        screenshot_endpoint: "ok",
        approved_match: approveJson.match_id,
        rejected_review_match: rejectJson.review_match.id,
      },
      null,
      2,
    ),
  );
} finally {
  await stopServer(serverProcess);
  await rm(tempDir, { recursive: true, force: true });
  await rm(screenshotDir, { recursive: true, force: true });
}
