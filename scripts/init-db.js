import { initializeDatabase, resolveDatabasePath } from "../server/db/database.js";
import { listFriends, seedFriends } from "../server/db/friends.js";

const dbPath = resolveDatabasePath();
const db = await initializeDatabase(dbPath);

seedFriends(db);

const friends = listFriends(db);
db.close();

console.log(`Initialized SQLite database: ${dbPath}`);
console.log(`Seeded friends: ${friends.length}`);
