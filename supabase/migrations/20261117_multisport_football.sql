-- Multi-sport support (starting with Football / Premier League)

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'basketball';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leagues_sport_check'
      AND conrelid = 'public.leagues'::regclass
  ) THEN
    ALTER TABLE public.leagues
      ADD CONSTRAINT leagues_sport_check
      CHECK (sport = ANY (ARRAY['basketball'::text, 'football'::text]));
  END IF;
END $$;

ALTER TABLE public.team_standings
  ADD COLUMN IF NOT EXISTS played smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draws smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goals_for integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goals_against integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goal_diff integer NOT NULL DEFAULT 0;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS sport_stats jsonb;

ALTER TABLE public.player_game_stats
  ADD COLUMN IF NOT EXISTS sport_stats jsonb;

-- Partial index to quickly filter leagues by sport
CREATE INDEX IF NOT EXISTS leagues_sport_idx
  ON public.leagues (sport, id);

-- Football player season averages (aggregated from player_game_stats.sport_stats)
CREATE OR REPLACE VIEW public.football_player_season_averages
WITH (security_invoker = true) AS
SELECT
  p.id AS player_id,
  p.league_id,
  g.season_id,
  p.team_id,
  p.full_name,
  p.jersey_number,
  p."position",
  p.headshot_url,
  t.name AS team_name,
  t.short_name AS team_short_name,
  t.abbreviation AS team_abbreviation,
  t.primary_color AS team_primary_color,
  t.logo_url AS team_logo_url,
  (COUNT(*) FILTER (WHERE NOT pgs.did_not_play))::integer AS gp,
  (COUNT(*) FILTER (WHERE pgs.starter AND NOT pgs.did_not_play))::integer AS starts,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'goals')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS goals,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'assists')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS assists,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'shots')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS shots,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'shots_on_target')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS shots_on_target,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'yellow_cards')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS yellow_cards,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'red_cards')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS red_cards,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'fouls_committed')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS fouls_committed,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'fouls_suffered')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS fouls_suffered,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'saves')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS saves,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'goals_conceded')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS goals_conceded,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'goals')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS goals_pg,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'assists')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS assists_pg,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'shots')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS shots_pg,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'shots_on_target')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS sot_pg
FROM public.player_game_stats pgs
JOIN public.games g ON g.id = pgs.game_id
JOIN public.leagues l ON l.id = g.league_id
JOIN public.players p ON p.id = pgs.player_id
LEFT JOIN public.teams t ON t.id = p.team_id
WHERE l.sport = 'football'
  AND g.status = 'final'
GROUP BY
  p.id, p.league_id, g.season_id, p.team_id,
  p.full_name, p.jersey_number, p."position", p.headshot_url,
  t.name, t.short_name, t.abbreviation, t.primary_color, t.logo_url;

-- Football team season averages (standings + match team metrics from games.sport_stats)
CREATE OR REPLACE VIEW public.football_team_season_averages
WITH (security_invoker = true) AS
WITH team_matches AS (
  SELECT
    g.league_id,
    g.season_id,
    g.home_team_id AS team_id,
    g.home_score AS gf,
    g.away_score AS ga,
    NULLIF((g.sport_stats->'home'->>'possession_pct'), '')::numeric AS possession_pct,
    NULLIF((g.sport_stats->'home'->>'shots'), '')::numeric AS shots,
    NULLIF((g.sport_stats->'home'->>'shots_on_target'), '')::numeric AS sot,
    NULLIF((g.sport_stats->'home'->>'corners'), '')::numeric AS corners,
    NULLIF((g.sport_stats->'home'->>'fouls'), '')::numeric AS fouls,
    COALESCE(NULLIF((g.sport_stats->'home'->>'yellow_cards'), '')::integer, 0) AS yellow_cards,
    COALESCE(NULLIF((g.sport_stats->'home'->>'red_cards'), '')::integer, 0) AS red_cards
  FROM public.games g
  JOIN public.leagues l ON l.id = g.league_id
  WHERE l.sport = 'football' AND g.status = 'final'
  UNION ALL
  SELECT
    g.league_id,
    g.season_id,
    g.away_team_id AS team_id,
    g.away_score AS gf,
    g.home_score AS ga,
    NULLIF((g.sport_stats->'away'->>'possession_pct'), '')::numeric AS possession_pct,
    NULLIF((g.sport_stats->'away'->>'shots'), '')::numeric AS shots,
    NULLIF((g.sport_stats->'away'->>'shots_on_target'), '')::numeric AS sot,
    NULLIF((g.sport_stats->'away'->>'corners'), '')::numeric AS corners,
    NULLIF((g.sport_stats->'away'->>'fouls'), '')::numeric AS fouls,
    COALESCE(NULLIF((g.sport_stats->'away'->>'yellow_cards'), '')::integer, 0) AS yellow_cards,
    COALESCE(NULLIF((g.sport_stats->'away'->>'red_cards'), '')::integer, 0) AS red_cards
  FROM public.games g
  JOIN public.leagues l ON l.id = g.league_id
  WHERE l.sport = 'football' AND g.status = 'final'
),
agg AS (
  SELECT
    tm.team_id,
    tm.league_id,
    tm.season_id,
    COUNT(*)::integer AS gp_tracked,
    ROUND(AVG(tm.gf), 2) AS gf_pg,
    ROUND(AVG(tm.ga), 2) AS ga_pg,
    ROUND(AVG(tm.possession_pct), 1) AS possession_avg,
    ROUND(AVG(tm.shots), 1) AS shots_pg,
    ROUND(AVG(tm.sot), 1) AS sot_pg,
    ROUND(AVG(tm.corners), 1) AS corners_pg,
    ROUND(AVG(tm.fouls), 1) AS fouls_pg,
    SUM(tm.yellow_cards)::integer AS yellow_cards,
    SUM(tm.red_cards)::integer AS red_cards,
    (COUNT(*) FILTER (WHERE tm.ga = 0))::integer AS clean_sheets
  FROM team_matches tm
  GROUP BY tm.team_id, tm.league_id, tm.season_id
)
SELECT
  t.id AS team_id,
  t.league_id,
  s.id AS season_id,
  t.name AS team_name,
  t.short_name AS team_short_name,
  t.abbreviation AS team_abbreviation,
  t.primary_color,
  t.alternate_color,
  t.logo_url,
  ts.playoff_seed AS rank,
  GREATEST(COALESCE(ts.played::integer, 0), COALESCE(agg.gp_tracked, 0)) AS played,
  COALESCE(ts.wins::integer, 0) AS wins,
  COALESCE(ts.draws::integer, 0) AS draws,
  COALESCE(ts.losses::integer, 0) AS losses,
  COALESCE(ts.points::integer, 0) AS points,
  COALESCE(ts.goals_for::integer, 0) AS goals_for,
  COALESCE(ts.goals_against::integer, 0) AS goals_against,
  COALESCE(ts.goal_diff::integer, 0) AS goal_diff,
  COALESCE(ts.win_pct, 0::numeric) AS win_pct,
  COALESCE(agg.gf_pg, 0::numeric) AS gf_pg,
  COALESCE(agg.ga_pg, 0::numeric) AS ga_pg,
  agg.possession_avg,
  agg.shots_pg,
  agg.sot_pg,
  agg.corners_pg,
  agg.fouls_pg,
  COALESCE(agg.yellow_cards, 0) AS yellow_cards,
  COALESCE(agg.red_cards, 0) AS red_cards,
  COALESCE(agg.clean_sheets, 0) AS clean_sheets
FROM public.teams t
JOIN public.leagues l ON l.id = t.league_id AND l.sport = 'football'
JOIN public.seasons s ON s.league_id = t.league_id AND s.is_current = true
LEFT JOIN public.team_standings ts ON ts.team_id = t.id AND ts.season_id = s.id
LEFT JOIN agg ON agg.team_id = t.id AND agg.season_id = s.id;

GRANT SELECT ON public.football_player_season_averages TO anon, authenticated;
GRANT SELECT ON public.football_team_season_averages TO anon, authenticated;
