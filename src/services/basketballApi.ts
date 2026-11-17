import { clearOfflineCache, supabase, supabaseUrlResolved, withOfflineCache } from '../lib/supabase';
import type {
  FootballPlayerSeasonAverage,
  FootballTeamSeasonAverage,
  Game,
  League,
  Player,
  PlayerGameStat,
  PlayerSeasonAverage,
  Season,
  SyncRun,
  Team,
  TeamSeasonAverage,
  TeamStanding,
} from '../types/database';

export async function fetchLeagues(): Promise<{ data: League[]; fromCache: boolean }> {
  return withOfflineCache('leagues', async () => {
    const { data, error } = await supabase
      .from('leagues')
      .select('id, slug, name, short_name, country, sport, source_type, external_id, logo_url, is_public')
      .order('id', { ascending: true });
    if (error) throw error;
    return (data ?? []) as League[];
  });
}

export async function fetchCurrentSeason(leagueId: number): Promise<Season | null> {
  const { data } = await withOfflineCache(`season_${leagueId}`, async () => {
    const { data: rows, error } = await supabase
      .from('seasons')
      .select('id, league_id, name, season_year, is_current')
      .eq('league_id', leagueId)
      .order('is_current', { ascending: false })
      .order('season_year', { ascending: false })
      .limit(1);
    if (error) throw error;
    return (rows?.[0] ?? null) as Season | null;
  });
  return data;
}

export async function fetchLastSync(): Promise<SyncRun | null> {
  try {
    const { data, error } = await supabase
      .from('sync_runs')
      .select('*')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data as SyncRun | null;
  } catch {
    return null;
  }
}

export async function triggerCloudSync(
  daysBack = 2,
  daysAhead = 3,
  sport: 'basketball' | 'football' = 'basketball',
  leagueCode = 'eng.1',
): Promise<{ ok: boolean; games_synced?: number; stats_synced?: number }> {
  const endpoint = sport === 'football' ? 'sync-football' : 'sync-nba';
  const payload =
    sport === 'football'
      ? { league: leagueCode, days_back: Math.max(daysBack, 5), days_ahead: Math.max(daysAhead, 14) }
      : { days_back: daysBack, days_ahead: daysAhead };

  const resp = await fetch(`${supabaseUrlResolved.replace(/\/$/, '')}/functions/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`Sync HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as {
    ok: boolean;
    games_synced?: number;
    stats_synced?: number;
  };
  if (json.ok) {
    clearOfflineCache();
  }
  return json;
}

export async function fetchAvailableGameDates(leagueId: number): Promise<string[]> {
  const { data } = await withOfflineCache(`game_dates_${leagueId}`, async () => {
    const { data: rows, error } = await supabase
      .from('games')
      .select('game_date')
      .eq('league_id', leagueId)
      .order('game_date', { ascending: false });
    if (error) throw error;
    const unique = Array.from(new Set((rows ?? []).map((r) => r.game_date as string)));
    return unique;
  });
  return data;
}

export async function fetchGamesByDate(
  leagueId: number,
  gameDate: string,
): Promise<{ data: Game[]; fromCache: boolean }> {
  return withOfflineCache(`games_${leagueId}_${gameDate}`, async () => {
    const { data, error } = await supabase
      .from('games')
      .select(`
        id, league_id, season_id, game_date, tipoff_at, status, status_detail,
        period, clock, home_team_id, away_team_id, home_score, away_score,
        home_linescores, away_linescores, venue, odds, sport_stats,
        home_team:teams!games_home_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url),
        away_team:teams!games_away_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url)
      `)
      .eq('league_id', leagueId)
      .eq('game_date', gameDate)
      .order('tipoff_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as Game[];
  });
}

export async function fetchGameById(gameId: number): Promise<Game | null> {
  const { data, error } = await supabase
    .from('games')
    .select(`
      id, league_id, season_id, game_date, tipoff_at, status, status_detail,
      period, clock, home_team_id, away_team_id, home_score, away_score,
      home_linescores, away_linescores, venue, odds, sport_stats,
      home_team:teams!games_home_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url),
      away_team:teams!games_away_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url)
    `)
    .eq('id', gameId)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as unknown as Game | null;
}

export async function fetchGameBoxScore(gameId: number): Promise<PlayerGameStat[]> {
  const { data } = await withOfflineCache(`boxscore_${gameId}`, async () => {
    const { data: rows, error } = await supabase
      .from('player_game_stats')
      .select(`
        *,
        player:players(id, full_name, jersey_number, position, headshot_url)
      `)
      .eq('game_id', gameId)
      .order('did_not_play', { ascending: true })
      .order('starter', { ascending: false })
      .order('pts', { ascending: false });
    if (error) throw error;
    return (rows ?? []) as unknown as PlayerGameStat[];
  });
  return data;
}

export async function fetchStandings(
  seasonId: number,
): Promise<{ data: TeamStanding[]; fromCache: boolean }> {
  return withOfflineCache(`standings_${seasonId}`, async () => {
    const { data, error } = await supabase
      .from('team_standings')
      .select(`
        *,
        team:teams(*)
      `)
      .eq('season_id', seasonId)
      .order('playoff_seed', { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as TeamStanding[];
  });
}

export async function fetchTeams(leagueId: number): Promise<Team[]> {
  const { data } = await withOfflineCache(`teams_${leagueId}`, async () => {
    const { data: rows, error } = await supabase
      .from('teams')
      .select('*')
      .eq('league_id', leagueId)
      .eq('is_active', true)
      .order('city', { ascending: true });
    if (error) throw error;
    return (rows ?? []) as Team[];
  });
  return data;
}

export async function fetchSeasonAverages(
  leagueId: number,
  seasonId: number,
): Promise<{ data: PlayerSeasonAverage[]; fromCache: boolean }> {
  return withOfflineCache(`averages_${leagueId}_${seasonId}`, async () => {
    const { data, error } = await supabase
      .from('player_season_averages')
      .select('*')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .order('ppg', { ascending: false });
    if (error) throw error;
    return (data ?? []) as PlayerSeasonAverage[];
  });
}

export async function fetchTeamSeasonAverages(
  leagueId: number,
  seasonId: number,
): Promise<{ data: TeamSeasonAverage[]; fromCache: boolean }> {
  return withOfflineCache(`team_averages_${leagueId}_${seasonId}`, async () => {
    const { data, error } = await supabase
      .from('team_season_averages')
      .select('*')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .order('ppg', { ascending: false });
    if (error) throw error;
    return (data ?? []) as TeamSeasonAverage[];
  });
}

export async function fetchFootballSeasonAverages(
  leagueId: number,
  seasonId: number,
): Promise<{ data: FootballPlayerSeasonAverage[]; fromCache: boolean }> {
  return withOfflineCache(`fb_averages_${leagueId}_${seasonId}`, async () => {
    const { data, error } = await supabase
      .from('football_player_season_averages')
      .select('*')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .order('goals', { ascending: false });
    if (error) throw error;
    return (data ?? []) as FootballPlayerSeasonAverage[];
  });
}

export async function fetchFootballTeamSeasonAverages(
  leagueId: number,
  seasonId: number,
): Promise<{ data: FootballTeamSeasonAverage[]; fromCache: boolean }> {
  return withOfflineCache(`fb_team_averages_${leagueId}_${seasonId}`, async () => {
    const { data, error } = await supabase
      .from('football_team_season_averages')
      .select('*')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .order('points', { ascending: false });
    if (error) throw error;
    return (data ?? []) as FootballTeamSeasonAverage[];
  });
}

export async function fetchPlayers(leagueId: number): Promise<Player[]> {
  const { data } = await withOfflineCache(`players_${leagueId}`, async () => {
    const { data: rows, error } = await supabase
      .from('players')
      .select(`
        id, league_id, team_id, full_name, jersey_number, position,
        height_display, weight_display, age, country, headshot_url, status,
        team:teams(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url)
      `)
      .eq('league_id', leagueId)
      .eq('is_active', true)
      .order('full_name', { ascending: true });
    if (error) throw error;
    return (rows ?? []) as unknown as Player[];
  });
  return data;
}

export async function fetchPlayerProfileAndLogs(
  playerId: number,
  sport: 'basketball' | 'football' = 'basketball',
): Promise<{
  player: Player | null;
  average: PlayerSeasonAverage | null;
  footballAverage: FootballPlayerSeasonAverage | null;
  logs: PlayerGameStat[];
}> {
  const { data } = await withOfflineCache(`player_detail_${sport}_${playerId}`, async () => {
    const [playerRes, avgRes, fbAvgRes, logsRes] = await Promise.all([
      supabase
        .from('players')
        .select(`
          id, league_id, team_id, full_name, jersey_number, position,
          height_display, weight_display, age, country, headshot_url, status,
          team:teams(*)
        `)
        .eq('id', playerId)
        .maybeSingle(),
      sport === 'football'
        ? Promise.resolve({ data: null })
        : supabase
            .from('player_season_averages')
            .select('*')
            .eq('player_id', playerId)
            .limit(1)
            .maybeSingle(),
      sport === 'football'
        ? supabase
            .from('football_player_season_averages')
            .select('*')
            .eq('player_id', playerId)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('player_game_stats')
        .select(`
          *,
          game:games(
            id, game_date, home_team_id, away_team_id, home_score, away_score,
            home_team:teams!games_home_team_id_fkey(id, abbreviation, logo_url),
            away_team:teams!games_away_team_id_fkey(id, abbreviation, logo_url)
          )
        `)
        .eq('player_id', playerId)
        .eq('did_not_play', false)
        .order('id', { ascending: false })
        .limit(15),
    ]);

    if (playerRes.error) throw playerRes.error;
    const logs = ((logsRes.data ?? []) as unknown as PlayerGameStat[]).sort((a, b) =>
      (b.game?.game_date ?? '').localeCompare(a.game?.game_date ?? ''),
    );

    return {
      player: (playerRes.data ?? null) as unknown as Player | null,
      average: (avgRes.data ?? null) as PlayerSeasonAverage | null,
      footballAverage: (fbAvgRes.data ?? null) as FootballPlayerSeasonAverage | null,
      logs,
    };
  });
  return data;
}

export async function fetchTeamRosterAndGames(
  teamId: number,
  sport: 'basketball' | 'football' = 'basketball',
): Promise<{
  players: Player[];
  games: Game[];
  teamAverage: TeamSeasonAverage | null;
  playerAverages: PlayerSeasonAverage[];
  footballTeamAverage: FootballTeamSeasonAverage | null;
  footballPlayerAverages: FootballPlayerSeasonAverage[];
}> {
  const { data } = await withOfflineCache(`team_detail_v3_${sport}_${teamId}`, async () => {
    const [rosterRes, gamesRes, teamAvgRes, playerAvgsRes, fbTeamAvgRes, fbPlayerAvgsRes] =
      await Promise.all([
        supabase
          .from('players')
          .select('id, league_id, team_id, full_name, jersey_number, position, height_display, weight_display, age, country, headshot_url, status')
          .eq('team_id', teamId)
          .eq('is_active', true)
          .order('full_name', { ascending: true }),
        supabase
          .from('games')
          .select(`
            id, league_id, season_id, game_date, tipoff_at, status, status_detail,
            period, clock, home_team_id, away_team_id, home_score, away_score,
            home_linescores, away_linescores, venue, odds, sport_stats,
            home_team:teams!games_home_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url),
            away_team:teams!games_away_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url)
          `)
          .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
          .order('game_date', { ascending: false })
          .limit(12),
        sport === 'football'
          ? Promise.resolve({ data: null })
          : supabase
              .from('team_season_averages')
              .select('*')
              .eq('team_id', teamId)
              .limit(1)
              .maybeSingle(),
        sport === 'football'
          ? Promise.resolve({ data: [] })
          : supabase
              .from('player_season_averages')
              .select('*')
              .eq('team_id', teamId)
              .gt('gp', 0)
              .order('ppg', { ascending: false }),
        sport === 'football'
          ? supabase
              .from('football_team_season_averages')
              .select('*')
              .eq('team_id', teamId)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        sport === 'football'
          ? supabase
              .from('football_player_season_averages')
              .select('*')
              .eq('team_id', teamId)
              .gt('gp', 0)
              .order('goals', { ascending: false })
              .order('shots_on_target', { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);
    if (rosterRes.error) throw rosterRes.error;
    if (gamesRes.error) throw gamesRes.error;
    return {
      players: (rosterRes.data ?? []) as Player[],
      games: (gamesRes.data ?? []) as unknown as Game[],
      teamAverage: (teamAvgRes.data ?? null) as TeamSeasonAverage | null,
      playerAverages: (playerAvgsRes.data ?? []) as PlayerSeasonAverage[],
      footballTeamAverage: (fbTeamAvgRes.data ?? null) as FootballTeamSeasonAverage | null,
      footballPlayerAverages: (fbPlayerAvgsRes.data ?? []) as FootballPlayerSeasonAverage[],
    };
  });
  return data;
}

export interface GameBettingContext {
  homeStanding: TeamStanding | null;
  awayStanding: TeamStanding | null;
  homeTeamAvg: TeamSeasonAverage | null;
  awayTeamAvg: TeamSeasonAverage | null;
  homeRecentGames: Game[];
  awayRecentGames: Game[];
  keyPlayers: PlayerSeasonAverage[];
  playerRecentLogs: PlayerGameStat[];
}

export interface FootballGameBettingContext {
  homeStanding: TeamStanding | null;
  awayStanding: TeamStanding | null;
  homeTeamAvg: FootballTeamSeasonAverage | null;
  awayTeamAvg: FootballTeamSeasonAverage | null;
  homeRecentGames: Game[];
  awayRecentGames: Game[];
  keyPlayers: FootballPlayerSeasonAverage[];
  playerRecentLogs: PlayerGameStat[];
}

export async function fetchFootballGameBettingContext(
  game: Game,
): Promise<FootballGameBettingContext> {
  const { data } = await withOfflineCache(`fb_bet_ctx_v1_${game.id}`, async () => {
    const teamSelect =
      'id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url';
    const [standingsRes, teamAvgsRes, homeGamesRes, awayGamesRes, playersRes] = await Promise.all([
      supabase
        .from('team_standings')
        .select('*, team:teams(*)')
        .eq('season_id', game.season_id)
        .in('team_id', [game.home_team_id, game.away_team_id]),
      supabase
        .from('football_team_season_averages')
        .select('*')
        .in('team_id', [game.home_team_id, game.away_team_id]),
      supabase
        .from('games')
        .select(
          `id, league_id, season_id, game_date, tipoff_at, status, status_detail, period, clock,
           home_team_id, away_team_id, home_score, away_score, home_linescores, away_linescores, venue, odds, sport_stats,
           home_team:teams!games_home_team_id_fkey(${teamSelect}),
           away_team:teams!games_away_team_id_fkey(${teamSelect})`,
        )
        .eq('season_id', game.season_id)
        .eq('status', 'final')
        .neq('id', game.id)
        .lte('game_date', game.game_date)
        .or(`home_team_id.eq.${game.home_team_id},away_team_id.eq.${game.home_team_id}`)
        .order('game_date', { ascending: false })
        .limit(6),
      supabase
        .from('games')
        .select(
          `id, league_id, season_id, game_date, tipoff_at, status, status_detail, period, clock,
           home_team_id, away_team_id, home_score, away_score, home_linescores, away_linescores, venue, odds, sport_stats,
           home_team:teams!games_home_team_id_fkey(${teamSelect}),
           away_team:teams!games_away_team_id_fkey(${teamSelect})`,
        )
        .eq('season_id', game.season_id)
        .eq('status', 'final')
        .neq('id', game.id)
        .lte('game_date', game.game_date)
        .or(`home_team_id.eq.${game.away_team_id},away_team_id.eq.${game.away_team_id}`)
        .order('game_date', { ascending: false })
        .limit(6),
      supabase
        .from('football_player_season_averages')
        .select('*')
        .eq('season_id', game.season_id)
        .in('team_id', [game.home_team_id, game.away_team_id])
        .gt('gp', 0)
        .order('goals', { ascending: false })
        .order('shots_on_target', { ascending: false })
        .limit(10),
    ]);

    const keyPlayers = (playersRes.data ?? []) as FootballPlayerSeasonAverage[];
    const playerIds = keyPlayers.map((p) => p.player_id);
    let playerRecentLogs: PlayerGameStat[] = [];
    if (playerIds.length > 0) {
      const logsRes = await supabase
        .from('player_game_stats')
        .select(`
          *,
          game:games(id, game_date, status, home_team_id, away_team_id, home_score, away_score)
        `)
        .in('player_id', playerIds)
        .eq('did_not_play', false)
        .neq('game_id', game.id)
        .order('id', { ascending: false })
        .limit(100);

      playerRecentLogs = ((logsRes.data ?? []) as unknown as Array<
        PlayerGameStat & { game?: { status?: string; game_date?: string } }
      >).filter(
        (r) =>
          (!r.game?.status || r.game.status === 'final') &&
          (!r.game?.game_date || r.game.game_date <= game.game_date),
      );
    }

    const standings = (standingsRes.data ?? []) as unknown as TeamStanding[];
    const teamAvgs = (teamAvgsRes.data ?? []) as FootballTeamSeasonAverage[];
    return {
      homeStanding: standings.find((s) => s.team_id === game.home_team_id) ?? null,
      awayStanding: standings.find((s) => s.team_id === game.away_team_id) ?? null,
      homeTeamAvg: teamAvgs.find((t) => t.team_id === game.home_team_id) ?? null,
      awayTeamAvg: teamAvgs.find((t) => t.team_id === game.away_team_id) ?? null,
      homeRecentGames: (homeGamesRes.data ?? []) as unknown as Game[],
      awayRecentGames: (awayGamesRes.data ?? []) as unknown as Game[],
      keyPlayers,
      playerRecentLogs,
    };
  });
  return data;
}

export async function fetchGameBettingContext(game: Game): Promise<GameBettingContext> {
  const { data } = await withOfflineCache(`bet_ctx_v3_${game.id}`, async () => {
    const teamSelect =
      'id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url';
    const [standingsRes, teamAvgsRes, homeGamesRes, awayGamesRes, playersRes] = await Promise.all([
      supabase
        .from('team_standings')
        .select('*, team:teams(*)')
        .eq('season_id', game.season_id)
        .in('team_id', [game.home_team_id, game.away_team_id]),
      supabase
        .from('team_season_averages')
        .select('*')
        .in('team_id', [game.home_team_id, game.away_team_id]),
      supabase
        .from('games')
        .select(
          `id, league_id, season_id, game_date, tipoff_at, status, status_detail, period, clock,
           home_team_id, away_team_id, home_score, away_score, home_linescores, away_linescores, venue, odds,
           home_team:teams!games_home_team_id_fkey(${teamSelect}),
           away_team:teams!games_away_team_id_fkey(${teamSelect})`,
        )
        .eq('season_id', game.season_id)
        .eq('status', 'final')
        .neq('id', game.id)
        .lte('game_date', game.game_date)
        .or(`home_team_id.eq.${game.home_team_id},away_team_id.eq.${game.home_team_id}`)
        .order('game_date', { ascending: false })
        .limit(6),
      supabase
        .from('games')
        .select(
          `id, league_id, season_id, game_date, tipoff_at, status, status_detail, period, clock,
           home_team_id, away_team_id, home_score, away_score, home_linescores, away_linescores, venue, odds,
           home_team:teams!games_home_team_id_fkey(${teamSelect}),
           away_team:teams!games_away_team_id_fkey(${teamSelect})`,
        )
        .eq('season_id', game.season_id)
        .eq('status', 'final')
        .neq('id', game.id)
        .lte('game_date', game.game_date)
        .or(`home_team_id.eq.${game.away_team_id},away_team_id.eq.${game.away_team_id}`)
        .order('game_date', { ascending: false })
        .limit(6),
      supabase
        .from('player_season_averages')
        .select('*')
        .eq('season_id', game.season_id)
        .in('team_id', [game.home_team_id, game.away_team_id])
        .gt('gp', 0)
        .order('ppg', { ascending: false, nullsFirst: false })
        .limit(10),
    ]);

    const keyPlayers = (playersRes.data ?? []) as PlayerSeasonAverage[];
    const playerIds = keyPlayers.map((p) => p.player_id);

    let playerRecentLogs: PlayerGameStat[] = [];
    if (playerIds.length > 0) {
      const logsRes = await supabase
        .from('player_game_stats')
        .select(`
          *,
          game:games(id, game_date, status, home_team_id, away_team_id, home_score, away_score)
        `)
        .in('player_id', playerIds)
        .eq('did_not_play', false)
        .neq('game_id', game.id)
        .order('id', { ascending: false })
        .limit(100);

      playerRecentLogs = ((logsRes.data ?? []) as unknown as Array<
        PlayerGameStat & { game?: { status?: string; game_date?: string } }
      >).filter(
        (r) =>
          (!r.game?.status || r.game.status === 'final') &&
          (!r.game?.game_date || r.game.game_date <= game.game_date),
      );
    }

    const standings = (standingsRes.data ?? []) as unknown as TeamStanding[];
    const teamAvgs = (teamAvgsRes.data ?? []) as TeamSeasonAverage[];
    return {
      homeStanding: standings.find((s) => s.team_id === game.home_team_id) ?? null,
      awayStanding: standings.find((s) => s.team_id === game.away_team_id) ?? null,
      homeTeamAvg: teamAvgs.find((t) => t.team_id === game.home_team_id) ?? null,
      awayTeamAvg: teamAvgs.find((t) => t.team_id === game.away_team_id) ?? null,
      homeRecentGames: (homeGamesRes.data ?? []) as unknown as Game[],
      awayRecentGames: (awayGamesRes.data ?? []) as unknown as Game[],
      keyPlayers,
      playerRecentLogs,
    };
  });
  return data;
}
