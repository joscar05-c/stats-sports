export interface League {
  id: number;
  slug: string;
  name: string;
  short_name: string;
  country: string | null;
  source_type: 'api' | 'manual';
  logo_url: string | null;
  is_public: boolean;
}

export interface Season {
  id: number;
  league_id: number;
  name: string;
  season_year: number;
  is_current: boolean;
}

export interface Team {
  id: number;
  league_id: number;
  external_id: string | null;
  name: string;
  short_name: string;
  abbreviation: string;
  city: string | null;
  conference: string | null;
  division: string | null;
  primary_color: string | null;
  alternate_color: string | null;
  logo_url: string | null;
}

export interface Player {
  id: number;
  league_id: number;
  team_id: number | null;
  full_name: string;
  jersey_number: string | null;
  position: string | null;
  height_display: string | null;
  weight_display: string | null;
  age: number | null;
  country: string | null;
  headshot_url: string | null;
  status: string;
  team?: Team | null;
}

export interface TeamStanding {
  id: number;
  league_id: number;
  season_id: number;
  team_id: number;
  conference: string | null;
  playoff_seed: number | null;
  wins: number;
  losses: number;
  win_pct: number;
  games_behind: string | null;
  home_record: string | null;
  away_record: string | null;
  last_ten: string | null;
  streak: string | null;
  ppg: number | null;
  oppg: number | null;
  diff: number | null;
  team: Team;
}

export interface Game {
  id: number;
  league_id: number;
  season_id: number;
  game_date: string;
  tipoff_at: string;
  status: 'scheduled' | 'live' | 'final' | 'postponed';
  status_detail: string | null;
  period: number;
  clock: string | null;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  home_linescores: number[] | null;
  away_linescores: number[] | null;
  venue: string | null;
  home_team: Team;
  away_team: Team;
}

export interface PlayerGameStat {
  id: number;
  game_id: number;
  team_id: number;
  player_id: number;
  minutes: number;
  pts: number;
  reb: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  plus_minus: number;
  starter: boolean;
  did_not_play: boolean;
  dnp_reason: string | null;
  player?: Pick<Player, 'id' | 'full_name' | 'jersey_number' | 'position' | 'headshot_url'>;
  game?: Pick<Game, 'id' | 'game_date' | 'home_team_id' | 'away_team_id' | 'home_score' | 'away_score'> & {
    home_team?: Pick<Team, 'id' | 'abbreviation' | 'logo_url'>;
    away_team?: Pick<Team, 'id' | 'abbreviation' | 'logo_url'>;
  };
}

export interface PlayerSeasonAverage {
  player_id: number;
  league_id: number;
  season_id: number;
  team_id: number | null;
  full_name: string;
  jersey_number: string | null;
  position: string | null;
  headshot_url: string | null;
  team_name: string | null;
  team_short_name: string | null;
  team_abbreviation: string | null;
  team_primary_color: string | null;
  team_logo_url: string | null;
  gp: number;
  mpg: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  topg: number;
  plus_minus_avg: number;
  fg_pct: number | null;
  tp_pct: number | null;
  ft_pct: number | null;
  efg_pct: number | null;
  ts_pct: number | null;
  double_doubles: number;
  triple_doubles: number;
  total_pts: number;
  total_reb: number;
  total_ast: number;
}

export interface SyncRun {
  id: number;
  source: string;
  league_slug: string;
  status: string;
  games_synced: number;
  stats_synced: number;
  message: string | null;
  ran_at: string;
}
