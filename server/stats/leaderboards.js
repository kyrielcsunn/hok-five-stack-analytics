const lanes = ["对抗路", "中路", "打野", "发育路", "游走"];
const priorGames = 6;
const priorWins = priorGames * 0.5;

function bestLineupMinimumGames(matchCount) {
  return Math.ceil(matchCount * 0.1);
}

function heroLosingMinimumGames(matchCount) {
  return Math.max(3, Math.ceil(matchCount * 0.05));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  const validValues = values.filter((value) => Number.isFinite(value));

  if (validValues.length === 0) {
    return null;
  }

  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function trustedWinRate(wins, games) {
  if (!Number.isFinite(games) || games <= 0) {
    return null;
  }

  return (wins + priorWins) / (games + priorGames);
}

function rawWinRate(wins, games) {
  if (!Number.isFinite(games) || games <= 0) {
    return null;
  }

  return wins / games;
}

function normalizePercent(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return clamp(percent, 0, 100);
}

function contributionPercent(row) {
  return mean([
    normalizePercent(row.damage_dealt_pct),
    normalizePercent(row.damage_taken_pct),
    normalizePercent(row.team_economy_pct),
    normalizePercent(row.participation_pct),
  ]);
}

function contributionScore(row) {
  const percent = contributionPercent(row);

  if (!Number.isFinite(percent)) {
    return null;
  }

  return clamp((percent / 30) * 100);
}

function kda(row) {
  return (row.kills + row.assists) / Math.max(1, row.deaths);
}

function ratingScore(rating) {
  return clamp((rating / 16) * 100);
}

function kdaScore(value) {
  return clamp((value / 8) * 100);
}

function positiveGap(average, value) {
  if (!Number.isFinite(average) || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, average - value);
}

function sampleStatus(games, mainCutoff = 5) {
  if (games >= mainCutoff) {
    return "main";
  }

  return "low_sample";
}

function unique(values) {
  return Array.from(new Set(values));
}

function byMatchIdsPlaceholders(matchIds) {
  return matchIds.map(() => "?").join(", ");
}

function parseJsonField(value, fallback) {
  if (!value) {
    return fallback;
  }

  return JSON.parse(value);
}

function loadReportPeriod(db, periodId) {
  if (!periodId) {
    return null;
  }

  const row = db
    .prepare(
      `
        SELECT id, name, description, match_ids_json, source_filter_json, created_at, updated_at
        FROM report_periods
        WHERE id = ?
      `,
    )
    .get(periodId);

  if (!row) {
    throw new Error(`Report period not found: ${periodId}`);
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    match_ids: parseJsonField(row.match_ids_json, []),
    source_filter: parseJsonField(row.source_filter_json, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listAllMatchIds(db) {
  return db
    .prepare(
      `
        SELECT id
        FROM matches
        ORDER BY played_at ASC, id ASC
      `,
    )
    .all()
    .map((row) => row.id);
}

function loadMatchRows(db, matchIds) {
  if (matchIds.length === 0) {
    return [];
  }

  const rows = db
    .prepare(
      `
        SELECT
          id,
          mode,
          played_at,
          blue_score,
          red_score,
          friend_result,
          friend_count,
          include_in_personal_stats,
          include_in_pair_stats,
          include_in_lineup_stats,
          include_in_for_fun_stats
        FROM matches
        WHERE id IN (${byMatchIdsPlaceholders(matchIds)})
      `,
    )
    .all(...matchIds);
  const order = new Map(matchIds.map((matchId, index) => [matchId, index]));

  return rows.sort((left, right) => order.get(left.id) - order.get(right.id));
}

function loadFriendRows(db, matchIds) {
  if (matchIds.length === 0) {
    return [];
  }

  return db
    .prepare(
      `
        SELECT
          matches.id AS match_id,
          matches.mode,
          matches.played_at,
          matches.friend_result,
          matches.friend_count,
          matches.include_in_personal_stats,
          matches.include_in_pair_stats,
          matches.include_in_lineup_stats,
          matches.include_in_for_fun_stats,
          match_players.player_id,
          players.display_name AS player_name,
          match_players.raw_name,
          match_players.hero_id,
          match_players.hero_name,
          match_players.lane,
          match_players.rating,
          match_players.kills,
          match_players.deaths,
          match_players.assists,
          match_players.damage_dealt_pct,
          match_players.damage_taken_pct,
          match_players.team_economy_pct,
          match_players.participation_pct,
          match_players.is_mvp,
          match_players.is_svp
        FROM matches
        JOIN match_players
          ON match_players.match_id = matches.id
        JOIN players
          ON players.id = match_players.player_id
        WHERE matches.id IN (${byMatchIdsPlaceholders(matchIds)})
          AND match_players.is_friend = 1
        ORDER BY matches.played_at ASC, matches.id ASC, match_players.side ASC, match_players.slot ASC
      `,
    )
    .all(...matchIds)
    .map((row) => ({
      ...row,
      include_in_personal_stats: row.include_in_personal_stats === 1,
      include_in_pair_stats: row.include_in_pair_stats === 1,
      include_in_lineup_stats: row.include_in_lineup_stats === 1,
      include_in_for_fun_stats: row.include_in_for_fun_stats === 1,
      is_mvp: row.is_mvp === 1,
      is_svp: row.is_svp === 1,
      kda: kda(row),
      contribution_percent: contributionPercent(row),
      contribution_score: contributionScore(row),
    }));
}

function groupBy(rows, keyFn) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyFn(row);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(row);
  }

  return groups;
}

function aggregatePlayerRows(rows) {
  const games = rows.length;
  const wins = rows.filter((row) => row.friend_result === "win").length;
  const mvpSvpCount = rows.filter((row) =>
    row.friend_result === "win" ? row.is_mvp : row.is_svp,
  ).length;
  const averageRating = mean(rows.map((row) => row.rating));
  const averageKda = mean(rows.map((row) => row.kda));
  const averageContribution = mean(rows.map((row) => row.contribution_score));
  const trustedRate = trustedWinRate(wins, games);

  return {
    games,
    wins,
    losses: games - wins,
    raw_win_rate: round(rawWinRate(wins, games), 4),
    trusted_win_rate: round(trustedRate, 4),
    avg_rating: round(averageRating),
    avg_kda: round(averageKda),
    avg_contribution_score: round(averageContribution),
    mvp_svp_count: mvpSvpCount,
    mvp_svp_rate: round(mvpSvpCount / games, 4),
    match_ids: unique(rows.map((row) => row.match_id)),
    score_parts: {
      rating: round(ratingScore(averageRating)),
      trusted_win_rate: round(trustedRate * 100),
      mvp_svp: round((mvpSvpCount / games) * 100),
      kda: round(kdaScore(averageKda)),
      contribution: round(averageContribution),
    },
  };
}

function buildTrustedWinRates(rows) {
  const entries = Array.from(groupBy(rows, (row) => row.player_id).values())
    .map((playerRows) => {
      const stats = aggregatePlayerRows(playerRows);
      const first = playerRows[0];

      return {
        player_id: first.player_id,
        player_name: first.player_name,
        games: stats.games,
        wins: stats.wins,
        losses: stats.losses,
        raw_win_rate: stats.raw_win_rate,
        trusted_win_rate: stats.trusted_win_rate,
        sample_status: sampleStatus(stats.games),
        supporting_match_ids: stats.match_ids,
      };
    })
    .sort(
      (left, right) =>
        right.trusted_win_rate - left.trusted_win_rate ||
        right.games - left.games ||
        left.player_name.localeCompare(right.player_name, "zh-CN"),
    );

  return {
    severity: "serious",
    calculation_notes: `可信胜率 = (胜场 + ${priorWins}) / (场次 + ${priorGames})。`,
    plain_language_notes:
      "这个榜看谁赢得更稳，会给小样本胜率降温；它只能说明这批赛后数据里的胜负倾向。",
    entries,
  };
}

function buildPersonalStrength(rows) {
  const allEntries = Array.from(groupBy(rows, (row) => row.player_id).values()).map((playerRows) => {
    const stats = aggregatePlayerRows(playerRows);
    const first = playerRows[0];
    const score =
      stats.score_parts.rating * 0.45 +
      stats.score_parts.trusted_win_rate * 0.2 +
      stats.score_parts.mvp_svp * 0.1 +
      stats.score_parts.kda * 0.1 +
      stats.score_parts.contribution * 0.15;

    return {
      player_id: first.player_id,
      player_name: first.player_name,
      score: round(score),
      ...stats,
      sample_status: sampleStatus(stats.games),
      supporting_match_ids: stats.match_ids,
    };
  });

  const sorter = (left, right) =>
    right.score - left.score ||
    right.games - left.games ||
    left.player_name.localeCompare(right.player_name, "zh-CN");

  return {
    severity: "serious",
    calculation_notes:
      "综合分 = 平均评分 45% + 可信胜率 20% + 胜局 MVP/败局 SVP 10% + KDA 10% + 综合贡献 15%。评分按 16 分封顶归一，KDA 按 8 封顶归一，贡献按 30% 份额封顶归一。",
    plain_language_notes:
      "这个榜看整体上谁最能稳定打出个人表现，不只看胜率，也不被一两局高光直接带飞。",
    entries: allEntries.filter((entry) => entry.games >= 5).sort(sorter),
    observation: allEntries.filter((entry) => entry.games < 5).sort(sorter),
  };
}

function buildLaneCandidates(rows) {
  return Array.from(
    groupBy(
      rows.filter((row) => lanes.includes(row.lane)),
      (row) => `${row.lane}\u0000${row.player_id}`,
    ).values(),
  ).map((laneRows) => {
    const stats = aggregatePlayerRows(laneRows);
    const first = laneRows[0];
    const sampleConfidence = Math.min(1, stats.games / 5);
    const score =
      stats.score_parts.rating * 0.55 +
      stats.score_parts.trusted_win_rate * 0.25 +
      stats.score_parts.contribution * 0.1 +
      sampleConfidence * 100 * 0.1;

    return {
      lane: first.lane,
      player_id: first.player_id,
      player_name: first.player_name,
      score: round(score),
      games: stats.games,
      wins: stats.wins,
      raw_win_rate: stats.raw_win_rate,
      trusted_win_rate: stats.trusted_win_rate,
      avg_rating: stats.avg_rating,
      avg_contribution_score: stats.avg_contribution_score,
      sample_confidence: round(sampleConfidence, 4),
      confidence: stats.games >= 5 ? "high" : stats.games >= 3 ? "medium" : "low",
      supporting_match_ids: stats.match_ids,
    };
  });
}

function enumerateLineups(candidatesByLane, laneIndex = 0, usedPlayerIds = new Set(), picks = []) {
  if (laneIndex === lanes.length) {
    return [
      {
        score: picks.reduce((sum, pick) => sum + pick.score, 0),
        picks,
      },
    ];
  }

  const lane = lanes[laneIndex];
  const laneCandidates = candidatesByLane.get(lane) ?? [];
  const lineups = [];

  for (const candidate of laneCandidates) {
    if (usedPlayerIds.has(candidate.player_id)) {
      continue;
    }

    usedPlayerIds.add(candidate.player_id);
    lineups.push(
      ...enumerateLineups(candidatesByLane, laneIndex + 1, usedPlayerIds, [...picks, candidate]),
    );
    usedPlayerIds.delete(candidate.player_id);
  }

  return lineups;
}

function buildBestLineup(rows, matchCount) {
  const minimumGames = bestLineupMinimumGames(matchCount);
  const candidates = buildLaneCandidates(rows);
  const eligibleCandidates = candidates.filter((candidate) => candidate.games >= minimumGames);
  const candidatesByLane = groupBy(eligibleCandidates, (candidate) => candidate.lane);

  for (const laneCandidates of candidatesByLane.values()) {
    laneCandidates.sort(
      (left, right) =>
        right.score - left.score ||
        right.games - left.games ||
        left.player_name.localeCompare(right.player_name, "zh-CN"),
    );
  }

  const lineups = enumerateLineups(candidatesByLane).sort((left, right) => right.score - left.score);
  const bestLineup = lineups[0] ?? null;
  const candidateSorter = (left, right) =>
    right.score - left.score ||
    right.games - left.games ||
    left.player_name.localeCompare(right.player_name, "zh-CN");
  const missingLanes = lanes
    .filter((lane) => (candidatesByLane.get(lane) ?? []).length === 0)
    .map((lane) => {
      const observedCandidates = candidates.filter((candidate) => candidate.lane === lane).sort(candidateSorter);
      const bestObserved = observedCandidates[0];

      return {
        lane,
        minimum_games: minimumGames,
        best_observed_player_name: bestObserved?.player_name ?? null,
        best_observed_games: bestObserved?.games ?? 0,
      };
    });

  return {
    severity: "serious",
    calculation_notes:
      `位置分 = 该位置平均评分 55% + 该位置可信胜率 25% + 综合贡献 10% + 样本信心 10%；入选者该位置至少 ${minimumGames} 场，遍历 5 个位置且每人最多出现一次。`,
    plain_language_notes:
      `这个榜推荐按位置分工最合适的五个人，不证明这五个人同时组队一定最强；本期每个入选者在对应位置至少要打 ${minimumGames} 场。`,
    minimum_games: minimumGames,
    assignments: bestLineup?.picks ?? [],
    total_score: bestLineup ? round(bestLineup.score) : null,
    supporting_match_ids: bestLineup
      ? unique(bestLineup.picks.flatMap((pick) => pick.supporting_match_ids))
      : [],
    candidates_by_lane: Object.fromEntries(
      lanes.map((lane) => [lane, (candidatesByLane.get(lane) ?? []).slice(0, 5)]),
    ),
    missing_lanes: missingLanes,
    sample_warnings: missingLanes.map((lane) =>
      lane.best_observed_player_name
        ? `${lane.lane} 没有人达到 ${minimumGames} 场，最高是 ${lane.best_observed_player_name} ${lane.best_observed_games} 场`
        : `${lane.lane} 暂无候选`,
    ),
  };
}

function rowsByMatch(rows) {
  return Array.from(groupBy(rows, (row) => row.match_id).values());
}

function buildEffortKing(rows) {
  const playerStats = new Map();

  for (const matchRows of rowsByMatch(rows).filter((items) => items[0].friend_result === "loss")) {
    const maxRating = Math.max(...matchRows.map((row) => row.rating));
    const avgRating = mean(matchRows.map((row) => row.rating));
    const avgParticipation = mean(matchRows.map((row) => normalizePercent(row.participation_pct)));

    for (const row of matchRows) {
      const isEvent = row.rating === maxRating || row.is_svp || row.rating >= avgRating + 1;
      const stats = playerStats.get(row.player_id) ?? {
        player_id: row.player_id,
        player_name: row.player_name,
        effort_count: 0,
        loss_games: 0,
        loss_ratings: [],
        loss_participations: [],
        supporting_match_ids: [],
      };

      stats.loss_games += 1;
      stats.loss_ratings.push(row.rating);
      stats.loss_participations.push(normalizePercent(row.participation_pct));

      if (isEvent) {
        stats.effort_count += 1;
        stats.supporting_match_ids.push(row.match_id);
      }

      playerStats.set(row.player_id, stats);
    }
  }

  return {
    severity: "semi_serious",
    calculation_notes:
      "失败局中满足队内评分最高、SVP、或评分高于本局朋友均分 1 分以上，记一次尽力事件。",
    plain_language_notes:
      "这个榜看输了但数据上最像还在扛的人，只反映赛后评分、SVP 和队内相对表现。",
    entries: Array.from(playerStats.values())
      .filter((entry) => entry.effort_count > 0)
      .map(({ loss_ratings: lossRatings, loss_participations: lossParticipations, ...entry }) => ({
        ...entry,
        avg_loss_rating: round(mean(lossRatings)),
        avg_loss_participation_pct: round(mean(lossParticipations)),
        supporting_match_ids: unique(entry.supporting_match_ids),
      }))
      .sort(
        (left, right) =>
          right.effort_count - left.effort_count ||
          right.avg_loss_rating - left.avg_loss_rating ||
          right.avg_loss_participation_pct - left.avg_loss_participation_pct,
      ),
  };
}

function buildLayWinKing(rows) {
  const playerStats = new Map();

  for (const matchRows of rowsByMatch(rows).filter((items) => items[0].friend_result === "win")) {
    const minRating = Math.min(...matchRows.map((row) => row.rating));
    const avgRating = mean(matchRows.map((row) => row.rating));
    const avgDamage = mean(matchRows.map((row) => normalizePercent(row.damage_dealt_pct)));
    const avgParticipation = mean(matchRows.map((row) => normalizePercent(row.participation_pct)));
    const avgKda = mean(matchRows.map((row) => row.kda));

    for (const row of matchRows) {
      const criteria = [
        row.rating === minRating,
        row.rating <= avgRating - 1,
        normalizePercent(row.damage_dealt_pct) < avgDamage,
        normalizePercent(row.participation_pct) < avgParticipation,
        row.kda < avgKda * 0.75,
      ];
      const criteriaCount = criteria.filter(Boolean).length;
      const stats = playerStats.get(row.player_id) ?? {
        player_id: row.player_id,
        player_name: row.player_name,
        lay_win_count: 0,
        low_rating_win_count: 0,
        win_games: 0,
        win_ratings: [],
        supporting_match_ids: [],
      };

      stats.win_games += 1;
      stats.win_ratings.push(row.rating);

      if (row.rating === minRating) {
        stats.low_rating_win_count += 1;
      }

      if (criteriaCount >= 2) {
        stats.lay_win_count += 1;
        stats.supporting_match_ids.push(row.match_id);
      }

      playerStats.set(row.player_id, stats);
    }
  }

  return {
    severity: "for_fun",
    calculation_notes:
      "胜局中命中至少两项代理指标记一次躺赢：朋友最低评分、低于均分 1 分、输出占比低于均值、参团率低于均值、KDA 低于均值 25%。",
    plain_language_notes:
      "这个榜是娱乐向，衡量赢了但赛后数据相对没那么出力的次数，不代表真实游戏里没有关键作用。",
    entries: Array.from(playerStats.values())
      .filter((entry) => entry.lay_win_count > 0)
      .map(({ win_ratings: winRatings, ...entry }) => ({
        ...entry,
        avg_win_rating: round(mean(winRatings)),
        supporting_match_ids: unique(entry.supporting_match_ids),
      }))
      .sort(
        (left, right) =>
          right.lay_win_count - left.lay_win_count ||
          right.low_rating_win_count - left.low_rating_win_count ||
          left.avg_win_rating - right.avg_win_rating,
      ),
  };
}

function buildHeroLosing(rows, matchCount) {
  const minimumGames = heroLosingMinimumGames(matchCount);
  const groupedRows = Array.from(
    groupBy(
      rows.filter((row) => row.hero_name),
      (row) => `${row.player_id}\u0000${row.hero_name}`,
    ).values(),
  );
  const mappedEntries = groupedRows.map((heroRows) => {
    const stats = aggregatePlayerRows(heroRows);
    const first = heroRows[0];

    return {
      player_id: first.player_id,
      player_name: first.player_name,
      hero_id: first.hero_id,
      hero_name: first.hero_name,
      games: stats.games,
      wins: stats.wins,
      losses: stats.losses,
      raw_win_rate: stats.raw_win_rate,
      trusted_win_rate: stats.trusted_win_rate,
      avg_rating: stats.avg_rating,
      supporting_match_ids: stats.match_ids,
    };
  });
  const sorter = (left, right) =>
    left.trusted_win_rate - right.trusted_win_rate ||
    right.losses - left.losses ||
    left.avg_rating - right.avg_rating;

  return {
    severity: "for_fun",
    calculation_notes:
      `只统计朋友玩家 + 标准英雄；主榜要求同一玩家同一英雄至少 ${minimumGames} 场，按可信胜率从低到高排序。`,
    plain_language_notes:
      `这个榜看某人拿某英雄时结果是否明显不顺；本期主榜最低 ${minimumGames} 场，低样本只适合整活参考。`,
    minimum_games: minimumGames,
    entries: mappedEntries.filter((entry) => entry.games >= minimumGames).sort(sorter),
    observation: mappedEntries
      .filter((entry) => entry.games >= 2 && entry.games < minimumGames)
      .sort(sorter),
  };
}

function buildPitPairs(rows) {
  const matchPlayers = new Map();

  for (const matchRows of rowsByMatch(rows)) {
    matchPlayers.set(
      matchRows[0].match_id,
      new Set(matchRows.map((row) => row.player_id)),
    );
  }

  const rowsByPlayer = groupBy(rows, (row) => row.player_id);
  const playerNames = new Map(rows.map((row) => [row.player_id, row.player_name]));
  const playerIds = Array.from(playerNames.keys());
  const entries = [];
  const observation = [];

  for (const affectedPlayerId of playerIds) {
    const affectedRows = rowsByPlayer.get(affectedPlayerId) ?? [];

    for (const teammateId of playerIds) {
      if (affectedPlayerId === teammateId) {
        continue;
      }

      const withRows = affectedRows.filter((row) => matchPlayers.get(row.match_id)?.has(teammateId));
      const withoutRows = affectedRows.filter(
        (row) => !matchPlayers.get(row.match_id)?.has(teammateId),
      );

      if (withRows.length === 0 || withoutRows.length === 0) {
        continue;
      }

      const withWins = withRows.filter((row) => row.friend_result === "win").length;
      const withoutWins = withoutRows.filter((row) => row.friend_result === "win").length;
      const withTrusted = trustedWinRate(withWins, withRows.length);
      const withoutTrusted = trustedWinRate(withoutWins, withoutRows.length);
      const entry = {
        affected_player_id: affectedPlayerId,
        affected_player_name: playerNames.get(affectedPlayerId),
        teammate_id: teammateId,
        teammate_name: playerNames.get(teammateId),
        impact: round(withTrusted - withoutTrusted, 4),
        with_games: withRows.length,
        with_wins: withWins,
        with_trusted_win_rate: round(withTrusted, 4),
        without_games: withoutRows.length,
        without_wins: withoutWins,
        without_trusted_win_rate: round(withoutTrusted, 4),
        supporting_match_ids: unique(withRows.map((row) => row.match_id)),
        comparison_match_ids: unique(withoutRows.map((row) => row.match_id)),
      };

      if (withRows.length >= 3 && withoutRows.length >= 3) {
        entries.push(entry);
      } else {
        observation.push(entry);
      }
    }
  }

  const sorter = (left, right) =>
    left.impact - right.impact ||
    right.with_games - left.with_games ||
    left.affected_player_name.localeCompare(right.affected_player_name, "zh-CN");

  return {
    severity: "for_fun",
    calculation_notes:
      "A 对 B 的影响值 = B 与 A 同队可信胜率 - B 不与 A 同队可信胜率；主榜要求同队和不同队样本都不少于 3 场。",
    plain_language_notes:
      "这个榜看某两个人同队时，被影响者的可信胜率有没有下滑；它只能说明同队样本里的相关性，不是甩锅证据。",
    entries: entries.sort(sorter),
    observation: observation.sort(sorter),
  };
}

function buildHeadwindEngine(rows) {
  const playerStats = new Map();

  for (const matchRows of rowsByMatch(rows).filter((items) => items[0].friend_result === "loss")) {
    const avgRating = mean(matchRows.map((row) => row.rating));
    const avgDeaths = mean(matchRows.map((row) => row.deaths));
    const avgParticipation = mean(matchRows.map((row) => normalizePercent(row.participation_pct)));
    const avgContribution = mean(matchRows.map((row) => row.contribution_score));

    for (const row of matchRows) {
      const score =
        positiveGap(avgRating, row.rating) * 18 +
        Math.max(0, row.deaths - avgDeaths) * 8 +
        positiveGap(avgParticipation, normalizePercent(row.participation_pct)) * 0.25 +
        positiveGap(avgContribution, row.contribution_score) * 0.35;
      const stats = playerStats.get(row.player_id) ?? {
        player_id: row.player_id,
        player_name: row.player_name,
        loss_games: 0,
        collapse_score_total: 0,
        collapse_events: 0,
        supporting_match_ids: [],
      };

      stats.loss_games += 1;
      stats.collapse_score_total += score;

      if (score > 0) {
        stats.collapse_events += 1;
        stats.supporting_match_ids.push(row.match_id);
      }

      playerStats.set(row.player_id, stats);
    }
  }

  return {
    severity: "for_fun",
    calculation_notes:
      "逆风发动机是赛后代理指标，不证明真实逆风时间线；崩盘分来自评分低于朋友均值、死亡高于均值、参团率低于均值、综合贡献低于均值。",
    plain_language_notes:
      "这个榜用赛后数据估算谁更像逆风启动点，没有过程数据，所以不能证明真实节奏是谁带崩的。",
    entries: Array.from(playerStats.values())
      .filter((entry) => entry.collapse_score_total > 0)
      .map((entry) => ({
        ...entry,
        collapse_score_total: round(entry.collapse_score_total),
        avg_collapse_score: round(entry.collapse_score_total / entry.loss_games),
        supporting_match_ids: unique(entry.supporting_match_ids),
      }))
      .sort(
        (left, right) =>
          right.collapse_score_total - left.collapse_score_total ||
          right.avg_collapse_score - left.avg_collapse_score ||
          right.loss_games - left.loss_games,
      ),
  };
}

function matchSummaries(matchRows) {
  return Object.fromEntries(
    matchRows.map((match) => [
      match.id,
      {
        id: match.id,
        mode: match.mode,
        played_at: match.played_at,
        score: `${match.blue_score}:${match.red_score}`,
        friend_result: match.friend_result,
        friend_count: match.friend_count,
      },
    ]),
  );
}

export function calculateLeaderboards(db, options = {}) {
  const period = loadReportPeriod(db, options.periodId);
  const matchIds = unique(options.matchIds ?? period?.match_ids ?? listAllMatchIds(db));
  const matchRows = loadMatchRows(db, matchIds);
  const foundMatchIds = matchRows.map((match) => match.id);
  const friendRows = loadFriendRows(db, foundMatchIds);
  const personalRows = friendRows.filter((row) => row.include_in_personal_stats);
  const pairRows = friendRows.filter((row) => row.include_in_pair_stats);
  const lineupRows = friendRows.filter((row) => row.include_in_lineup_stats);
  const forFunRows = friendRows.filter((row) => row.include_in_for_fun_stats);

  return {
    meta: {
      generated_at: new Date().toISOString(),
      period,
      match_count: matchRows.length,
      friend_player_count: friendRows.length,
      included_match_ids: foundMatchIds,
      ignored_match_ids: matchIds.filter((matchId) => !foundMatchIds.includes(matchId)),
      thresholds: {
        best_lineup_min_lane_games: bestLineupMinimumGames(matchRows.length),
        hero_losing_min_games: heroLosingMinimumGames(matchRows.length),
      },
    },
    support_matches: matchSummaries(matchRows),
    leaderboards: {
      trusted_win_rates: buildTrustedWinRates(personalRows),
      personal_strength: buildPersonalStrength(personalRows),
      best_lineup: buildBestLineup(lineupRows, matchRows.length),
      effort_king: buildEffortKing(forFunRows),
      lay_win_king: buildLayWinKing(forFunRows),
      hero_losing: buildHeroLosing(personalRows, matchRows.length),
      pit_pairs: buildPitPairs(pairRows),
      headwind_engine: buildHeadwindEngine(forFunRows),
    },
  };
}
