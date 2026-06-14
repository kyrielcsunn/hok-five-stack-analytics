import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));

export function getDefaultDatabasePath() {
  return join(projectRoot, "data", "hok.sqlite");
}

export function resolveDatabasePath() {
  return process.env.HOK_DB_PATH ?? getDefaultDatabasePath();
}

export async function ensureDatabaseDirectory(dbPath = resolveDatabasePath()) {
  await mkdir(dirname(dbPath), { recursive: true });
}

export function openDatabase(dbPath = resolveDatabasePath()) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
  return db;
}

export function applySchema(db) {
  db.exec(readFileSync(schemaPath, "utf8"));
}

export async function initializeDatabase(dbPath = resolveDatabasePath()) {
  await ensureDatabaseDirectory(dbPath);
  const db = openDatabase(dbPath);
  applySchema(db);
  return db;
}
