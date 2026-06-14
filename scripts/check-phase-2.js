import assert from "node:assert/strict";
import { initializeDatabase, resolveDatabasePath } from "../server/db/database.js";
import { listFriends, seedFriends } from "../server/db/friends.js";
import { findHeroById, listHeroes, searchHeroes } from "../server/reference/heroes.js";

const dbPath = resolveDatabasePath();
const db = await initializeDatabase(dbPath);

seedFriends(db);

const tables = db
  .prepare(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `,
  )
  .all()
  .map((row) => row.name);

const friends = listFriends(db);
const heroes = listHeroes();
const zhuangzhou = findHeroById("zhuangzhou");
const searchedHeroes = searchHeroes("庄");

assert.equal(friends.length, 9);
assert.ok(heroes.length >= 1);
assert.equal(zhuangzhou?.name, "庄周");
assert.ok(searchedHeroes.some((hero) => hero.id === "zhuangzhou"));

db.close();

console.log(
  JSON.stringify(
    {
      database: dbPath,
      table_count: tables.length,
      friend_count: friends.length,
      hero_count: heroes.length,
      hero_search_count: searchedHeroes.length,
    },
    null,
    2,
  ),
);
