const friendSeeds = [
  ["friend_jingyang_yinxiaohuan", "净漾银笑幻", "净漾银笑幻", []],
  ["friend_yixiangtiankaideqiu", "异想天开的球", "异想天开的球", []],
  ["friend_ge", "鸽", "鸽", []],
  ["friend_xiaose_xianbei_dawo", "萧瑟仙贝打我", "萧瑟仙贝打我", []],
  ["friend_yueliang_xichen_chaoyang", "月亮西沉朝阳", "月亮西沉朝阳", []],
  ["friend_dilushou_oo", "迪路兽oo", "迪路兽oo", ["迪路兽oO", "迪路兽Oo", "迪路兽OO"]],
  ["friend_bieyaliwook", "别压力我ok？", "别压力我ok？", ["别压力我ok?", "别压力我OK？", "别压力我OK?"]],
  ["friend_zhenzhu_guanguan", "珍珠罐罐", "珍珠罐罐", []],
  ["friend_baji_xiaomiao", "吧唧小喵", "吧唧小喵", []],
];

function nowIso() {
  return new Date().toISOString();
}

function parseAliases(row) {
  const { aliases_json: aliasesJson, ...friend } = row;

  return {
    ...friend,
    is_friend: Boolean(row.is_friend),
    aliases: JSON.parse(aliasesJson),
  };
}

export function seedFriends(db) {
  const timestamp = nowIso();
  const insert = db.prepare(`
    INSERT INTO players (
      id,
      display_name,
      game_nickname,
      aliases_json,
      is_friend,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      game_nickname = excluded.game_nickname,
      aliases_json = excluded.aliases_json,
      is_friend = excluded.is_friend,
      updated_at = excluded.updated_at
  `);

  for (const [id, displayName, gameNickname, aliases] of friendSeeds) {
    insert.run(id, displayName, gameNickname, JSON.stringify(aliases), timestamp, timestamp);
  }
}

export function listFriends(db) {
  return db
    .prepare(
      `
        SELECT id, display_name, game_nickname, aliases_json, is_friend
        FROM players
        WHERE is_friend = 1
        ORDER BY rowid
      `,
    )
    .all()
    .map(parseAliases);
}
