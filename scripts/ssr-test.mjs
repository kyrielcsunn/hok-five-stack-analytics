import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";

// Stub window/location for non-localhost branch
globalThis.window = { location: { hostname: "hok-five-stack-analytics.vercel.app", pathname: "/" } };
globalThis.location = globalThis.window.location;

// Build doesn't expose the source as a node-importable module, so we test the data shape
// by mimicking what StaticHome does at the top of the function (synchronous accesses).
const data = JSON.parse(readFileSync("public/export/report-data.json", "utf8"));

function safeAccess(label, fn) {
  try {
    const v = fn();
    console.log("OK", label, "=>", typeof v, Array.isArray(v) ? `[len ${v.length}]` : "");
  } catch (err) {
    console.log("FAIL", label, "=>", err.message);
  }
}

const boards = data.leaderboards.leaderboards;
safeAccess("boards.personal_strength.entries", () => boards.personal_strength.entries);
safeAccess("boards.personal_strength.observation", () => boards.personal_strength.observation);
safeAccess("boards.effort_king.entries", () => boards.effort_king.entries);
safeAccess("boards.lay_win_king.entries", () => boards.lay_win_king.entries);
safeAccess("boards.hero_losing.entries", () => boards.hero_losing.entries);
safeAccess("boards.hero_losing.observation", () => boards.hero_losing.observation);
safeAccess("boards.pit_pairs.entries", () => boards.pit_pairs.entries);
safeAccess("boards.pit_pairs.observation", () => boards.pit_pairs.observation);
safeAccess("boards.headwind_engine.entries", () => boards.headwind_engine.entries);
safeAccess("boards.best_lineup.assignments", () => boards.best_lineup.assignments);
safeAccess("boards.best_lineup.sample_warnings", () => boards.best_lineup.sample_warnings);
safeAccess("data.summary", () => data.summary);
safeAccess("data.period.name", () => data.period.name);

// Check matches structure
console.log("\n--- matches sanity ---");
const m = data.matches?.[0];
if (m) {
  console.log("first match keys:", Object.keys(m));
  console.log("friend_players len:", m.friend_players?.length);
  console.log("first friend_player:", m.friend_players?.[0]);
}

// Check player_records (may be expected by some pages)
console.log("\n--- player_records ---");
console.log("len:", data.player_records?.length);
console.log("first:", data.player_records?.[0] && Object.keys(data.player_records[0]));

// Specifically inspect entry fields used in render
console.log("\n--- effort_king[0] keys ---");
console.log(Object.keys(boards.effort_king.entries[0] || {}));
console.log("\n--- lay_win_king[0] keys ---");
console.log(Object.keys(boards.lay_win_king.entries[0] || {}));
console.log("\n--- headwind_engine[0] keys ---");
console.log(Object.keys(boards.headwind_engine.entries[0] || {}));
console.log("\n--- hero_losing entries[0] keys ---");
console.log(Object.keys(boards.hero_losing.entries[0] || {}));
console.log("\n--- pit_pairs entries[0] keys ---");
console.log(Object.keys(boards.pit_pairs.entries[0] || {}));
