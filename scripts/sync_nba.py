#!/usr/bin/env python3
"""
Synchronize NBA teams, standings, rosters, games, and player box scores
from ESPN's public JSON endpoints into Supabase (PostgreSQL).

Zero external pip dependencies — uses Python 3 standard library only.

Usage:
  # 1) Direct sync to Supabase (used by GitHub Actions or local with service_role key):
  SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
    python scripts/sync_nba.py --days-back 3 --days-ahead 2

  # 2) Generate idempotent SQL files for seeding via MCP / psql:
  python scripts/sync_nba.py --mode sql --sql-dir ./seed_sql --start-date 2026-10-20 --end-date 2026-11-15
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ESPN_BASE = "https://site.api.espn.com/apis"
LEAGUE_SLUG = "nba"
EXTERNAL_SOURCE = "espn"
HEADERS = {
    "User-Agent": "CourtVisionStats/1.0 (+https://github.com)",
    "Accept": "application/json",
}


def fetch_json(url: str, retries: int = 3, timeout: int = 15) -> dict[str, Any]:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            last_err = err
            if attempt < retries - 1:
                time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"Failed fetching {url}: {last_err}")


def safe_int(val: Any, default: int = 0) -> int:
    if val is None or val == "" or val == "--":
        return default
    try:
        s = str(val).strip()
        if s.startswith("+"):
            s = s[1:]
        return int(float(s))
    except (ValueError, TypeError):
        return default


def safe_float(val: Any) -> float | None:
    if val is None or val == "" or val == "--" or val == "-":
        return None
    try:
        return float(str(val).strip())
    except (ValueError, TypeError):
        return None


def parse_line_num(val: Any) -> float | None:
    if val is None or val == "" or val == "--":
        return None
    s = str(val).strip()
    if not s:
        return None
    if s.upper() in ("PK", "EVEN"):
        return 0.0
    if s[0] in ("o", "u", "O", "U"):
        s = s[1:]
    try:
        return float(s)
    except ValueError:
        return None


def parse_american_odds(val: Any) -> int | None:
    if val is None or val == "" or val == "--":
        return None
    s = str(val).strip().upper()
    if not s:
        return None
    if s == "EVEN":
        return 100
    try:
        return int(round(float(s.lstrip("+"))))
    except ValueError:
        return None


def extract_game_odds(
    odds_list: list[dict[str, Any]] | None,
    predictor: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    entry = odds_list[0] if odds_list else None
    if not entry and not predictor:
        return None

    payload: dict[str, Any] = {}
    if isinstance(entry, dict):
        prov = entry.get("provider") or {}
        ps = entry.get("pointSpread") or {}
        home_ps = ps.get("home") or {}
        away_ps = ps.get("away") or {}
        tot = entry.get("total") or {}
        over_tot = tot.get("over") or {}
        under_tot = tot.get("under") or {}
        ml = entry.get("moneyline") or {}
        home_ml = ml.get("home") or {}
        away_ml = ml.get("away") or {}
        home_team_odds = entry.get("homeTeamOdds") or {}
        away_team_odds = entry.get("awayTeamOdds") or {}

        home_spread = parse_line_num((home_ps.get("close") or {}).get("line"))
        if home_spread is None:
            raw_spread = safe_float(entry.get("spread"))
            if raw_spread is not None:
                if away_team_odds.get("favorite") and raw_spread > 0:
                    home_spread = raw_spread
                elif home_team_odds.get("favorite") and raw_spread > 0:
                    home_spread = -raw_spread
                else:
                    home_spread = raw_spread

        away_spread = parse_line_num((away_ps.get("close") or {}).get("line"))
        if away_spread is None and home_spread is not None:
            away_spread = -home_spread

        open_home_spread = parse_line_num((home_ps.get("open") or {}).get("line"))
        over_under = parse_line_num((over_tot.get("close") or {}).get("line")) or safe_float(
            entry.get("overUnder")
        )
        open_over_under = parse_line_num((over_tot.get("open") or {}).get("line"))

        payload.update(
            {
                "provider": prov.get("displayName") or prov.get("name") or "Sportsbook",
                "details": entry.get("details"),
                "home_spread": home_spread,
                "away_spread": away_spread,
                "open_home_spread": open_home_spread,
                "home_spread_odds": parse_american_odds((home_ps.get("close") or {}).get("odds"))
                or parse_american_odds(home_team_odds.get("spreadOdds")),
                "away_spread_odds": parse_american_odds((away_ps.get("close") or {}).get("odds"))
                or parse_american_odds(away_team_odds.get("spreadOdds")),
                "over_under": over_under,
                "open_over_under": open_over_under,
                "over_odds": parse_american_odds((over_tot.get("close") or {}).get("odds"))
                or parse_american_odds(entry.get("overOdds")),
                "under_odds": parse_american_odds((under_tot.get("close") or {}).get("odds"))
                or parse_american_odds(entry.get("underOdds")),
                "home_moneyline": parse_american_odds((home_ml.get("close") or {}).get("odds"))
                or parse_american_odds(home_team_odds.get("moneyLine")),
                "away_moneyline": parse_american_odds((away_ml.get("close") or {}).get("odds"))
                or parse_american_odds(away_team_odds.get("moneyLine")),
                "open_home_moneyline": parse_american_odds((home_ml.get("open") or {}).get("odds")),
                "open_away_moneyline": parse_american_odds((away_ml.get("open") or {}).get("odds")),
            }
        )

    if isinstance(predictor, dict):
        hp = safe_float((predictor.get("homeTeam") or {}).get("gameProjection"))
        ap = safe_float((predictor.get("awayTeam") or {}).get("gameProjection"))
        if hp is not None:
            payload["home_win_prob"] = hp
        if ap is not None:
            payload["away_win_prob"] = ap

    cleaned = {k: v for k, v in payload.items() if v is not None}
    return cleaned or None


def parse_split_pair(val: Any) -> tuple[int, int]:
    if not val or "-" not in str(val):
        return 0, 0
    parts = str(val).split("-", 1)
    return safe_int(parts[0]), safe_int(parts[1])


def normalize_color(hex_val: str | None) -> str | None:
    if not hex_val:
        return None
    c = hex_val.strip().lstrip("#")
    if len(c) in (3, 6):
        return f"#{c.lower()}"
    return None


def fetch_teams_and_standings() -> tuple[list[dict[str, Any]], list[dict[str, Any]], int, str]:
    teams_json = fetch_json(f"{ESPN_BASE}/site/v2/sports/basketball/nba/teams")
    standings_json = fetch_json(f"{ESPN_BASE}/v2/sports/basketball/nba/standings")

    conf_by_team: dict[str, str] = {}
    standings_rows: list[dict[str, Any]] = []

    season_year = 2027
    season_name = "2026-27"

    for child in standings_json.get("children", []):
        raw_conf = child.get("name", "")
        conf = "East" if "East" in raw_conf else "West" if "West" in raw_conf else raw_conf
        season_info = child.get("standings", {}).get("season")
        if isinstance(season_info, dict):
            season_year = safe_int(season_info.get("year"), season_year)
            season_name = season_info.get("displayName") or season_name
        elif isinstance(season_info, int):
            season_year = season_info
            season_name = f"{season_year - 1}-{str(season_year)[-2:]}"

        for entry in child.get("standings", {}).get("entries", []):
            t = entry.get("team", {})
            tid = str(t.get("id", ""))
            if not tid:
                continue
            conf_by_team[tid] = conf
            stats_map = {
                s.get("name"): s.get("displayValue") or s.get("value")
                for s in entry.get("stats", [])
                if s.get("name")
            }
            standings_rows.append(
                {
                    "team_external_id": tid,
                    "conference": conf,
                    "playoff_seed": safe_int(stats_map.get("playoffSeed"), 0) or None,
                    "wins": safe_int(stats_map.get("wins"), 0),
                    "losses": safe_int(stats_map.get("losses"), 0),
                    "win_pct": round(safe_float(stats_map.get("winPercent")) or 0.0, 3),
                    "games_behind": str(stats_map.get("gamesBehind") or "-"),
                    "home_record": str(stats_map.get("Home") or "-"),
                    "away_record": str(stats_map.get("Road") or "-"),
                    "last_ten": str(stats_map.get("Last Ten Games") or "-"),
                    "streak": str(stats_map.get("streak") or "-"),
                    "ppg": safe_float(stats_map.get("avgPointsFor")),
                    "oppg": safe_float(stats_map.get("avgPointsAgainst")),
                    "diff": safe_float(stats_map.get("differential")),
                }
            )

    team_rows: list[dict[str, Any]] = []
    for item in teams_json["sports"][0]["leagues"][0]["teams"]:
        t = item["team"]
        tid = str(t["id"])
        logos = t.get("logos") or []
        logo_url = logos[0].get("href") if logos else None
        team_rows.append(
            {
                "external_source": EXTERNAL_SOURCE,
                "external_id": tid,
                "name": t.get("displayName") or t.get("name"),
                "short_name": t.get("shortDisplayName") or t.get("name"),
                "abbreviation": t.get("abbreviation"),
                "city": t.get("location"),
                "conference": conf_by_team.get(tid),
                "primary_color": normalize_color(t.get("color")),
                "alternate_color": normalize_color(t.get("alternateColor")),
                "logo_url": logo_url,
                "is_active": bool(t.get("isActive", True)),
            }
        )

    return team_rows, standings_rows, season_year, season_name


def extract_athletes_from_roster(roster_json: dict[str, Any], team_ext_id: str) -> list[dict[str, Any]]:
    raw_athletes = roster_json.get("athletes") or []
    flat: list[dict[str, Any]] = []
    for entry in raw_athletes:
        if isinstance(entry, dict) and "items" in entry:
            flat.extend(entry["items"])
        elif isinstance(entry, dict):
            flat.append(entry)

    out: list[dict[str, Any]] = []
    for a in flat:
        pid = str(a.get("id", ""))
        if not pid:
            continue
        pos = (a.get("position") or {}).get("abbreviation") or (a.get("position") or {}).get("name")
        headshot = (a.get("headshot") or {}).get("href")
        birth = a.get("birthPlace") or {}
        status = (a.get("status") or {}).get("type") or "active"
        full_name = a.get("fullName") or a.get("displayName") or f"{a.get('firstName', '')} {a.get('lastName', '')}".strip()
        out.append(
            {
                "external_source": EXTERNAL_SOURCE,
                "external_id": pid,
                "team_external_id": team_ext_id,
                "first_name": a.get("firstName"),
                "last_name": a.get("lastName"),
                "full_name": full_name,
                "jersey_number": str(a.get("jersey")) if a.get("jersey") is not None else None,
                "position": pos,
                "height_display": a.get("displayHeight"),
                "weight_display": a.get("displayWeight"),
                "age": safe_int(a.get("age"), 0) or None,
                "country": birth.get("country"),
                "headshot_url": headshot,
                "status": str(status).lower(),
                "is_active": True,
            }
        )
    return out


def fetch_all_rosters(team_ids: list[str]) -> dict[str, dict[str, Any]]:
    players_by_ext_id: dict[str, dict[str, Any]] = {}

    def _one(tid: str) -> list[dict[str, Any]]:
        data = fetch_json(f"{ESPN_BASE}/site/v2/sports/basketball/nba/teams/{tid}/roster")
        return extract_athletes_from_roster(data, tid)

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for plist in ex.map(_one, team_ids):
            for p in plist:
                players_by_ext_id[p["external_id"]] = p

    return players_by_ext_id


def map_game_status(status_obj: dict[str, Any]) -> tuple[str, str]:
    st_type = status_obj.get("type") or {}
    state = st_type.get("state", "pre")
    name = st_type.get("name", "")
    detail = st_type.get("shortDetail") or st_type.get("detail") or ""
    if "POSTPONED" in name or "CANCELED" in name:
        return "postponed", detail
    if state == "in":
        return "live", detail
    if state == "post" or st_type.get("completed"):
        return "final", detail
    return "scheduled", detail


def fetch_games_and_boxscores(
    dates: list[dt.date],
    valid_team_ids: set[str],
    players_by_ext_id: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int, str]:
    games: list[dict[str, Any]] = []
    game_meta_for_boxscore: list[dict[str, Any]] = []
    detected_year = 2027
    detected_name = "2026-27"

    def _fetch_day(d: dt.date) -> tuple[dt.date, dict[str, Any]]:
        ymd = d.strftime("%Y%m%d")
        return d, fetch_json(f"{ESPN_BASE}/site/v2/sports/basketball/nba/scoreboard?dates={ymd}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        day_results = list(ex.map(_fetch_day, dates))

    seen_game_ids: set[str] = set()
    for day_date, sb in day_results:
        for lg in sb.get("leagues", []):
            s = lg.get("season") or {}
            if s.get("year"):
                detected_year = safe_int(s.get("year"), detected_year)
            if s.get("displayName"):
                detected_name = s.get("displayName")

        for ev in sb.get("events", []):
            ev_id = str(ev.get("id", ""))
            if not ev_id or ev_id in seen_game_ids:
                continue

            season_type = (ev.get("season") or {}).get("type")
            if season_type not in (2, 3, None):
                # Skip preseason/all-star exhibition games that may involve non-NBA teams
                continue

            comps = ev.get("competitions") or []
            if not comps:
                continue
            comp = comps[0]
            competitors = comp.get("competitors") or []
            home = next((c for c in competitors if c.get("homeAway") == "home"), None)
            away = next((c for c in competitors if c.get("homeAway") == "away"), None)
            if not home or not away:
                continue

            home_tid = str((home.get("team") or {}).get("id", ""))
            away_tid = str((away.get("team") or {}).get("id", ""))
            if home_tid not in valid_team_ids or away_tid not in valid_team_ids:
                continue

            seen_game_ids.add(ev_id)
            st_obj = comp.get("status") or ev.get("status") or {}
            status, status_detail = map_game_status(st_obj)

            home_lines = [safe_int(ls.get("value"), 0) for ls in (home.get("linescores") or [])]
            away_lines = [safe_int(ls.get("value"), 0) for ls in (away.get("linescores") or [])]
            venue = ((comp.get("venue") or {}).get("fullName")) or None
            sb_odds = extract_game_odds(comp.get("odds"))

            g_row = {
                "external_source": EXTERNAL_SOURCE,
                "external_id": ev_id,
                "game_date": day_date.isoformat(),
                "tipoff_at": ev.get("date") or f"{day_date.isoformat()}T00:00:00Z",
                "status": status,
                "status_detail": status_detail,
                "period": safe_int(st_obj.get("period"), 0),
                "clock": st_obj.get("displayClock"),
                "home_team_ext_id": home_tid,
                "away_team_ext_id": away_tid,
                "home_score": safe_int(home.get("score"), 0),
                "away_score": safe_int(away.get("score"), 0),
                "home_linescores": home_lines or None,
                "away_linescores": away_lines or None,
                "venue": venue,
                "odds": sb_odds,
            }
            games.append(g_row)
            today_pet = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date().isoformat()
            if status in ("final", "live") or sb_odds is not None or g_row["game_date"] >= today_pet:
                game_meta_for_boxscore.append(g_row)

    stats_rows: list[dict[str, Any]] = []

    def _fetch_box(g: dict[str, Any]) -> list[dict[str, Any]]:
        eid = g["external_id"]
        summ = fetch_json(f"{ESPN_BASE}/site/v2/sports/basketball/nba/summary?event={eid}")
        pick_odds = extract_game_odds(summ.get("pickcenter"), summ.get("predictor"))
        if pick_odds:
            merged = dict(g.get("odds") or {})
            for k, v in pick_odds.items():
                if v is not None:
                    merged[k] = v
            g["odds"] = merged or None

        if g["status"] not in ("final", "live"):
            return []

        bx = summ.get("boxscore") or {}
        out_rows: list[dict[str, Any]] = []
        for team_blk in bx.get("players", []):
            tid = str((team_blk.get("team") or {}).get("id", ""))
            if tid not in valid_team_ids:
                continue
            stat_groups = team_blk.get("statistics") or []
            if not stat_groups:
                continue
            grp = stat_groups[0]
            names = grp.get("names") or grp.get("labels") or []
            idx = {n.upper(): i for i, n in enumerate(names)}
            for ath_row in grp.get("athletes", []):
                ath = ath_row.get("athlete") or {}
                pid = str(ath.get("id", ""))
                if not pid:
                    continue
                if pid not in players_by_ext_id:
                    pos = (ath.get("position") or {}).get("abbreviation")
                    headshot = (ath.get("headshot") or {}).get("href")
                    players_by_ext_id[pid] = {
                        "external_source": EXTERNAL_SOURCE,
                        "external_id": pid,
                        "team_external_id": tid,
                        "first_name": ath.get("firstName"),
                        "last_name": ath.get("lastName"),
                        "full_name": ath.get("displayName") or ath.get("shortName") or f"Player {pid}",
                        "jersey_number": str(ath.get("jersey")) if ath.get("jersey") is not None else None,
                        "position": pos,
                        "height_display": None,
                        "weight_display": None,
                        "age": None,
                        "country": None,
                        "headshot_url": headshot,
                        "status": "active",
                        "is_active": True,
                    }

                dnp = bool(ath_row.get("didNotPlay", False))
                dnp_reason = ath_row.get("reason") or None
                raw_stats = ath_row.get("stats") or []

                def _col(name: str, default: str = "0") -> str:
                    pos_i = idx.get(name)
                    if pos_i is None or pos_i >= len(raw_stats):
                        return default
                    return str(raw_stats[pos_i])

                if not raw_stats:
                    dnp = True

                fgm, fga = parse_split_pair(_col("FG", "0-0"))
                tpm, tpa = parse_split_pair(_col("3PT", "0-0"))
                ftm, fta = parse_split_pair(_col("FT", "0-0"))
                mins = safe_int(_col("MIN", "0"), 0)
                if mins == 0 and not dnp and safe_int(_col("PTS", "0")) == 0 and fga == 0 and safe_int(_col("REB", "0")) == 0:
                    dnp = True

                out_rows.append(
                    {
                        "game_external_id": eid,
                        "team_external_id": tid,
                        "player_external_id": pid,
                        "minutes": mins,
                        "pts": safe_int(_col("PTS", "0"), 0),
                        "reb": safe_int(_col("REB", "0"), 0),
                        "oreb": safe_int(_col("OREB", "0"), 0),
                        "dreb": safe_int(_col("DREB", "0"), 0),
                        "ast": safe_int(_col("AST", "0"), 0),
                        "stl": safe_int(_col("STL", "0"), 0),
                        "blk": safe_int(_col("BLK", "0"), 0),
                        "tov": safe_int(_col("TO", "0"), 0),
                        "pf": safe_int(_col("PF", "0"), 0),
                        "fgm": fgm,
                        "fga": fga,
                        "tpm": tpm,
                        "tpa": tpa,
                        "ftm": ftm,
                        "fta": fta,
                        "plus_minus": safe_int(_col("+/-", "0"), 0),
                        "starter": bool(ath_row.get("starter", False)),
                        "did_not_play": dnp,
                        "dnp_reason": dnp_reason,
                    }
                )
        return out_rows

    if game_meta_for_boxscore:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            for rows in ex.map(_fetch_box, game_meta_for_boxscore):
                stats_rows.extend(rows)

    return games, stats_rows, detected_year, detected_name


# ---------------------------------------------------------------------------
# SQL output helpers (--mode sql)
# ---------------------------------------------------------------------------
def sql_lit(v: Any) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (list, dict)):
        s = json.dumps(v, ensure_ascii=False).replace("'", "''")
        return f"'{s}'::jsonb"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def write_sql_seed_files(
    out_dir: Path,
    season_year: int,
    season_name: str,
    teams: list[dict[str, Any]],
    standings: list[dict[str, Any]],
    players: list[dict[str, Any]],
    games: list[dict[str, Any]],
    stats: list[dict[str, Any]],
) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    # File 1: League, Season, Teams, Standings
    lines: list[str] = [
        "-- 01 Core: League, Season, Teams & Standings",
        "insert into public.leagues (slug, name, short_name, country, source_type, external_source, external_id, logo_url, is_public)",
        "values ('nba', 'National Basketball Association', 'NBA', 'USA', 'api', 'espn', 'nba', 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png', true)",
        "on conflict (slug) do update set name = excluded.name, logo_url = excluded.logo_url;",
        "",
        f"insert into public.seasons (league_id, name, season_year, is_current)",
        f"values ((select id from public.leagues where slug = 'nba'), {sql_lit(season_name)}, {season_year}, true)",
        "on conflict (league_id, season_year) do update set name = excluded.name, is_current = excluded.is_current;",
        "",
        "with lg as (select id as league_id from public.leagues where slug = 'nba'),",
        "team_data (external_source, external_id, name, short_name, abbreviation, city, conference, primary_color, alternate_color, logo_url, is_active) as (",
        "  values",
    ]
    team_vals = [
        f"    ({sql_lit(t['external_source'])}, {sql_lit(t['external_id'])}, {sql_lit(t['name'])}, {sql_lit(t['short_name'])}, {sql_lit(t['abbreviation'])}, {sql_lit(t['city'])}, {sql_lit(t['conference'])}, {sql_lit(t['primary_color'])}, {sql_lit(t['alternate_color'])}, {sql_lit(t['logo_url'])}, {sql_lit(t['is_active'])})"
        for t in teams
    ]
    lines.append(",\n".join(team_vals))
    lines.extend(
        [
            ")",
            "insert into public.teams (league_id, external_source, external_id, name, short_name, abbreviation, city, conference, primary_color, alternate_color, logo_url, is_active)",
            "select lg.league_id, td.external_source, td.external_id, td.name, td.short_name, td.abbreviation, td.city, td.conference, td.primary_color, td.alternate_color, td.logo_url, td.is_active",
            "from team_data td cross join lg",
            "on conflict (league_id, external_source, external_id) where external_id is not null do update set",
            "  name = excluded.name, short_name = excluded.short_name, abbreviation = excluded.abbreviation,",
            "  city = excluded.city, conference = excluded.conference, primary_color = excluded.primary_color,",
            "  alternate_color = excluded.alternate_color, logo_url = excluded.logo_url, is_active = excluded.is_active;",
            "",
        ]
    )

    if standings:
        lines.extend(
            [
                "with lg as (select id as league_id from public.leagues where slug = 'nba'),",
                f"sn as (select id as season_id from public.seasons s join lg on lg.league_id = s.league_id where s.season_year = {season_year}),",
                "st_data (team_ext_id, conference, playoff_seed, wins, losses, win_pct, games_behind, home_record, away_record, last_ten, streak, ppg, oppg, diff) as (",
                "  values",
            ]
        )
        st_vals = [
            f"    ({sql_lit(s['team_external_id'])}, {sql_lit(s['conference'])}, {sql_lit(s['playoff_seed'])}::smallint, {s['wins']}::smallint, {s['losses']}::smallint, {s['win_pct']}::numeric(5,3), {sql_lit(s['games_behind'])}, {sql_lit(s['home_record'])}, {sql_lit(s['away_record'])}, {sql_lit(s['last_ten'])}, {sql_lit(s['streak'])}, {sql_lit(s['ppg'])}::numeric(5,1), {sql_lit(s['oppg'])}::numeric(5,1), {sql_lit(s['diff'])}::numeric(5,1))"
            for s in standings
        ]
        lines.append(",\n".join(st_vals))
        lines.extend(
            [
                ")",
                "insert into public.team_standings (league_id, season_id, team_id, conference, playoff_seed, wins, losses, win_pct, games_behind, home_record, away_record, last_ten, streak, ppg, oppg, diff, updated_at)",
                "select lg.league_id, sn.season_id, t.id, st.conference, st.playoff_seed, st.wins, st.losses, st.win_pct, st.games_behind, st.home_record, st.away_record, st.last_ten, st.streak, st.ppg, st.oppg, st.diff, now()",
                "from st_data st cross join lg cross join sn",
                "join public.teams t on t.league_id = lg.league_id and t.external_source = 'espn' and t.external_id = st.team_ext_id",
                "on conflict (season_id, team_id) do update set",
                "  conference = excluded.conference, playoff_seed = excluded.playoff_seed, wins = excluded.wins,",
                "  losses = excluded.losses, win_pct = excluded.win_pct, games_behind = excluded.games_behind,",
                "  home_record = excluded.home_record, away_record = excluded.away_record, last_ten = excluded.last_ten,",
                "  streak = excluded.streak, ppg = excluded.ppg, oppg = excluded.oppg, diff = excluded.diff, updated_at = now();",
            ]
        )

    p1 = out_dir / "01_core.sql"
    p1.write_text("\n".join(lines), encoding="utf-8")
    written.append(p1)

    # File 2: Players (chunked 250 per file)
    chunk_size = 250
    for idx in range(0, len(players), chunk_size):
        chunk = players[idx : idx + chunk_size]
        p_lines = [
            f"-- 02 Players chunk {idx // chunk_size + 1}",
            "with lg as (select id as league_id from public.leagues where slug = 'nba'),",
            "p_data (external_source, external_id, team_ext_id, first_name, last_name, full_name, jersey_number, position, height_display, weight_display, age, country, headshot_url, status, is_active) as (",
            "  values",
        ]
        p_vals = [
            f"    ({sql_lit(p['external_source'])}, {sql_lit(p['external_id'])}, {sql_lit(p['team_external_id'])}, {sql_lit(p['first_name'])}, {sql_lit(p['last_name'])}, {sql_lit(p['full_name'])}, {sql_lit(p['jersey_number'])}, {sql_lit(p['position'])}, {sql_lit(p['height_display'])}, {sql_lit(p['weight_display'])}, {sql_lit(p['age'])}::smallint, {sql_lit(p['country'])}, {sql_lit(p['headshot_url'])}, {sql_lit(p['status'])}, {sql_lit(p['is_active'])})"
            for p in chunk
        ]
        p_lines.append(",\n".join(p_vals))
        p_lines.extend(
            [
                ")",
                "insert into public.players (league_id, team_id, external_source, external_id, first_name, last_name, full_name, jersey_number, position, height_display, weight_display, age, country, headshot_url, status, is_active, updated_at)",
                "select lg.league_id, t.id, pd.external_source, pd.external_id, pd.first_name, pd.last_name, pd.full_name, pd.jersey_number, pd.position, pd.height_display, pd.weight_display, pd.age, pd.country, pd.headshot_url, pd.status, pd.is_active, now()",
                "from p_data pd cross join lg",
                "left join public.teams t on t.league_id = lg.league_id and t.external_source = 'espn' and t.external_id = pd.team_ext_id",
                "on conflict (league_id, external_source, external_id) where external_id is not null do update set",
                "  team_id = coalesce(excluded.team_id, public.players.team_id),",
                "  full_name = excluded.full_name, jersey_number = coalesce(excluded.jersey_number, public.players.jersey_number),",
                "  position = coalesce(excluded.position, public.players.position),",
                "  height_display = coalesce(excluded.height_display, public.players.height_display),",
                "  weight_display = coalesce(excluded.weight_display, public.players.weight_display),",
                "  age = coalesce(excluded.age, public.players.age),",
                "  country = coalesce(excluded.country, public.players.country),",
                "  headshot_url = coalesce(excluded.headshot_url, public.players.headshot_url),",
                "  status = excluded.status, updated_at = now();",
            ]
        )
        pf = out_dir / f"02_players_{idx // chunk_size + 1:02d}.sql"
        pf.write_text("\n".join(p_lines), encoding="utf-8")
        written.append(pf)

    # File 3: Games
    if games:
        g_lines = [
            "-- 03 Games",
            "with lg as (select id as league_id from public.leagues where slug = 'nba'),",
            f"sn as (select id as season_id from public.seasons s join lg on lg.league_id = s.league_id where s.season_year = {season_year}),",
            "g_data (external_source, external_id, game_date, tipoff_at, status, status_detail, period, clock, home_ext_id, away_ext_id, home_score, away_score, home_linescores, away_linescores, venue, odds) as (",
            "  values",
        ]
        g_vals = [
            f"    ({sql_lit(g['external_source'])}, {sql_lit(g['external_id'])}, {sql_lit(g['game_date'])}::date, {sql_lit(g['tipoff_at'])}::timestamptz, {sql_lit(g['status'])}, {sql_lit(g['status_detail'])}, {g['period']}::smallint, {sql_lit(g['clock'])}, {sql_lit(g['home_team_ext_id'])}, {sql_lit(g['away_team_ext_id'])}, {g['home_score']}::smallint, {g['away_score']}::smallint, {sql_lit(g['home_linescores'])}, {sql_lit(g['away_linescores'])}, {sql_lit(g['venue'])}, {sql_lit(g.get('odds'))})"
            for g in games
        ]
        g_lines.append(",\n".join(g_vals))
        g_lines.extend(
            [
                ")",
                "insert into public.games (league_id, season_id, external_source, external_id, game_date, tipoff_at, status, status_detail, period, clock, home_team_id, away_team_id, home_score, away_score, home_linescores, away_linescores, venue, odds, updated_at)",
                "select lg.league_id, sn.season_id, gd.external_source, gd.external_id, gd.game_date, gd.tipoff_at, gd.status, gd.status_detail, gd.period, gd.clock, ht.id, at.id, gd.home_score, gd.away_score, gd.home_linescores, gd.away_linescores, gd.venue, gd.odds, now()",
                "from g_data gd cross join lg cross join sn",
                "join public.teams ht on ht.league_id = lg.league_id and ht.external_source = 'espn' and ht.external_id = gd.home_ext_id",
                "join public.teams at on at.league_id = lg.league_id and at.external_source = 'espn' and at.external_id = gd.away_ext_id",
                "on conflict (league_id, external_source, external_id) where external_id is not null do update set",
                "  game_date = excluded.game_date, tipoff_at = excluded.tipoff_at, status = excluded.status,",
                "  status_detail = excluded.status_detail, period = excluded.period, clock = excluded.clock,",
                "  home_score = excluded.home_score, away_score = excluded.away_score,",
                "  home_linescores = excluded.home_linescores, away_linescores = excluded.away_linescores,",
                "  venue = coalesce(excluded.venue, public.games.venue), odds = coalesce(excluded.odds, public.games.odds), updated_at = now();",
            ]
        )
        gf = out_dir / "03_games.sql"
        gf.write_text("\n".join(g_lines), encoding="utf-8")
        written.append(gf)

    # File 4+: Player Game Stats (chunked 400 rows per file)
    stat_chunk = 400
    for idx in range(0, len(stats), stat_chunk):
        chunk = stats[idx : idx + stat_chunk]
        s_lines = [
            f"-- 04 Player Game Stats chunk {idx // stat_chunk + 1}",
            "with lg as (select id as league_id from public.leagues where slug = 'nba'),",
            "s_data (game_ext_id, team_ext_id, player_ext_id, minutes, pts, reb, oreb, dreb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta, plus_minus, starter, did_not_play, dnp_reason) as (",
            "  values",
        ]
        s_vals = [
            f"    ({sql_lit(r['game_external_id'])}, {sql_lit(r['team_external_id'])}, {sql_lit(r['player_external_id'])}, {r['minutes']}::smallint, {r['pts']}::smallint, {r['reb']}::smallint, {r['oreb']}::smallint, {r['dreb']}::smallint, {r['ast']}::smallint, {r['stl']}::smallint, {r['blk']}::smallint, {r['tov']}::smallint, {r['pf']}::smallint, {r['fgm']}::smallint, {r['fga']}::smallint, {r['tpm']}::smallint, {r['tpa']}::smallint, {r['ftm']}::smallint, {r['fta']}::smallint, {r['plus_minus']}::smallint, {sql_lit(r['starter'])}, {sql_lit(r['did_not_play'])}, {sql_lit(r['dnp_reason'])})"
            for r in chunk
        ]
        s_lines.append(",\n".join(s_vals))
        s_lines.extend(
            [
                ")",
                "insert into public.player_game_stats (league_id, game_id, team_id, player_id, minutes, pts, reb, oreb, dreb, ast, stl, blk, tov, pf, fgm, fga, tpm, tpa, ftm, fta, plus_minus, starter, did_not_play, dnp_reason, updated_at)",
                "select lg.league_id, g.id, t.id, p.id, sd.minutes, sd.pts, sd.reb, sd.oreb, sd.dreb, sd.ast, sd.stl, sd.blk, sd.tov, sd.pf, sd.fgm, sd.fga, sd.tpm, sd.tpa, sd.ftm, sd.fta, sd.plus_minus, sd.starter, sd.did_not_play, sd.dnp_reason, now()",
                "from s_data sd cross join lg",
                "join public.games g on g.league_id = lg.league_id and g.external_source = 'espn' and g.external_id = sd.game_ext_id",
                "join public.teams t on t.league_id = lg.league_id and t.external_source = 'espn' and t.external_id = sd.team_ext_id",
                "join public.players p on p.league_id = lg.league_id and p.external_source = 'espn' and p.external_id = sd.player_ext_id",
                "on conflict (game_id, player_id) do update set",
                "  team_id = excluded.team_id, minutes = excluded.minutes, pts = excluded.pts, reb = excluded.reb,",
                "  oreb = excluded.oreb, dreb = excluded.dreb, ast = excluded.ast, stl = excluded.stl,",
                "  blk = excluded.blk, tov = excluded.tov, pf = excluded.pf, fgm = excluded.fgm, fga = excluded.fga,",
                "  tpm = excluded.tpm, tpa = excluded.tpa, ftm = excluded.ftm, fta = excluded.fta,",
                "  plus_minus = excluded.plus_minus, starter = excluded.starter,",
                "  did_not_play = excluded.did_not_play, dnp_reason = excluded.dnp_reason, updated_at = now();",
            ]
        )
        sf = out_dir / f"04_stats_{idx // stat_chunk + 1:02d}.sql"
        sf.write_text("\n".join(s_lines), encoding="utf-8")
        written.append(sf)

    # Final sync_runs entry
    sync_sql = (
        "-- 05 Sync Run Audit\n"
        "insert into public.sync_runs (source, league_slug, status, games_synced, stats_synced, message)\n"
        f"values ('espn', 'nba', 'success', {len(games)}, {len(stats)}, 'Initial seed sync');\n"
    )
    sf_end = out_dir / "99_sync_run.sql"
    sf_end.write_text(sync_sql, encoding="utf-8")
    written.append(sf_end)
    return written


# ---------------------------------------------------------------------------
# Supabase REST API sync helpers (--mode supabase)
# ---------------------------------------------------------------------------
class SupabaseRest:
    def __init__(self, url: str, service_key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.key = service_key

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        if extra_headers:
            headers.update(extra_headers)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(f"{self.base}/{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase REST {method} {path} -> {err.code}: {detail}") from err

    def select_all(self, table: str, params: str = "") -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset = 0
        limit = 1000
        while True:
            sep = "&" if params else ""
            path = f"{table}?{params}{sep}limit={limit}&offset={offset}"
            chunk = self.request("GET", path, extra_headers={"Prefer": "count=none"}) or []
            rows.extend(chunk)
            if len(chunk) < limit:
                break
            offset += limit
        return rows

    def upsert_on_conflict(self, table: str, rows: list[dict[str, Any]], on_conflict: str, batch: int = 300) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for i in range(0, len(rows), batch):
            chunk = rows[i : i + batch]
            res = self.request(
                "POST",
                f"{table}?on_conflict={urllib.parse.quote(on_conflict)}",
                body=chunk,
                extra_headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            )
            if res:
                out.extend(res)
        return out


def sync_via_supabase_rest(
    season_year: int,
    season_name: str,
    teams: list[dict[str, Any]],
    standings: list[dict[str, Any]],
    players: list[dict[str, Any]],
    games: list[dict[str, Any]],
    stats: list[dict[str, Any]],
) -> None:
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise SystemExit("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.")

    sb = SupabaseRest(url, key)

    # 1. League
    league_rows = sb.upsert_on_conflict(
        "leagues",
        [
            {
                "slug": LEAGUE_SLUG,
                "name": "National Basketball Association",
                "short_name": "NBA",
                "country": "USA",
                "source_type": "api",
                "external_source": EXTERNAL_SOURCE,
                "external_id": "nba",
                "logo_url": "https://a.espncdn.com/i/teamlogos/leagues/500/nba.png",
                "is_public": True,
            }
        ],
        "slug",
    )
    league_id = league_rows[0]["id"]

    # 2. Season
    season_rows = sb.upsert_on_conflict(
        "seasons",
        [
            {
                "league_id": league_id,
                "name": season_name,
                "season_year": season_year,
                "is_current": True,
            }
        ],
        "league_id,season_year",
    )
    season_id = season_rows[0]["id"]

    # 3. Teams (lookup existing by external_id to handle partial unique index cleanly)
    existing_teams = sb.select_all("teams", f"league_id=eq.{league_id}&external_source=eq.{EXTERNAL_SOURCE}&select=id,external_id")
    team_id_map = {str(r["external_id"]): r["id"] for r in existing_teams if r.get("external_id")}
    new_teams = []
    for t in teams:
        payload = {**t, "league_id": league_id}
        eid = t["external_id"]
        if eid in team_id_map:
            sb.request("PATCH", f"teams?id=eq.{team_id_map[eid]}", body=payload, extra_headers={"Prefer": "return=minimal"})
        else:
            new_teams.append(payload)
    if new_teams:
        inserted = sb.request("POST", "teams", body=new_teams)
        for r in inserted or []:
            team_id_map[str(r["external_id"])] = r["id"]

    # 4. Standings
    standing_payloads = []
    for s in standings:
        tid = team_id_map.get(s["team_external_id"])
        if not tid:
            continue
        standing_payloads.append(
            {
                "league_id": league_id,
                "season_id": season_id,
                "team_id": tid,
                "conference": s["conference"],
                "playoff_seed": s["playoff_seed"],
                "wins": s["wins"],
                "losses": s["losses"],
                "win_pct": s["win_pct"],
                "games_behind": s["games_behind"],
                "home_record": s["home_record"],
                "away_record": s["away_record"],
                "last_ten": s["last_ten"],
                "streak": s["streak"],
                "ppg": s["ppg"],
                "oppg": s["oppg"],
                "diff": s["diff"],
                "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }
        )
    if standing_payloads:
        sb.upsert_on_conflict("team_standings", standing_payloads, "season_id,team_id")

    # 5. Players
    existing_players = sb.select_all("players", f"league_id=eq.{league_id}&external_source=eq.{EXTERNAL_SOURCE}&select=id,external_id")
    player_id_map = {str(r["external_id"]): r["id"] for r in existing_players if r.get("external_id")}
    new_players = []
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    for p in players:
        payload = {
            "league_id": league_id,
            "team_id": team_id_map.get(p["team_external_id"]),
            "external_source": p["external_source"],
            "external_id": p["external_id"],
            "first_name": p["first_name"],
            "last_name": p["last_name"],
            "full_name": p["full_name"],
            "jersey_number": p["jersey_number"],
            "position": p["position"],
            "height_display": p["height_display"],
            "weight_display": p["weight_display"],
            "age": p["age"],
            "country": p["country"],
            "headshot_url": p["headshot_url"],
            "status": p["status"],
            "is_active": p["is_active"],
            "updated_at": now_iso,
        }
        eid = p["external_id"]
        if eid in player_id_map:
            # Update core fields without overwriting rich bio fields with None
            patch_body = {k: v for k, v in payload.items() if v is not None}
            sb.request("PATCH", f"players?id=eq.{player_id_map[eid]}", body=patch_body, extra_headers={"Prefer": "return=minimal"})
        else:
            new_players.append(payload)
    for i in range(0, len(new_players), 200):
        inserted = sb.request("POST", "players", body=new_players[i : i + 200])
        for r in inserted or []:
            player_id_map[str(r["external_id"])] = r["id"]

    # 6. Games
    existing_games = sb.select_all("games", f"league_id=eq.{league_id}&external_source=eq.{EXTERNAL_SOURCE}&select=id,external_id")
    game_id_map = {str(r["external_id"]): r["id"] for r in existing_games if r.get("external_id")}
    new_games = []
    for g in games:
        ht = team_id_map.get(g["home_team_ext_id"])
        at = team_id_map.get(g["away_team_ext_id"])
        if not ht or not at:
            continue
        payload = {
            "league_id": league_id,
            "season_id": season_id,
            "external_source": g["external_source"],
            "external_id": g["external_id"],
            "game_date": g["game_date"],
            "tipoff_at": g["tipoff_at"],
            "status": g["status"],
            "status_detail": g["status_detail"],
            "period": g["period"],
            "clock": g["clock"],
            "home_team_id": ht,
            "away_team_id": at,
            "home_score": g["home_score"],
            "away_score": g["away_score"],
            "home_linescores": g["home_linescores"],
            "away_linescores": g["away_linescores"],
            "venue": g["venue"],
            "updated_at": now_iso,
        }
        if g.get("odds") is not None:
            payload["odds"] = g["odds"]
        eid = g["external_id"]
        if eid in game_id_map:
            sb.request("PATCH", f"games?id=eq.{game_id_map[eid]}", body=payload, extra_headers={"Prefer": "return=minimal"})
        else:
            new_games.append(payload)
    for i in range(0, len(new_games), 150):
        inserted = sb.request("POST", "games", body=new_games[i : i + 150])
        for r in inserted or []:
            game_id_map[str(r["external_id"])] = r["id"]

    # 7. Player Game Stats
    stat_payloads = []
    for r in stats:
        gid = game_id_map.get(r["game_external_id"])
        tid = team_id_map.get(r["team_external_id"])
        pid = player_id_map.get(r["player_external_id"])
        if not gid or not tid or not pid:
            continue
        stat_payloads.append(
            {
                "league_id": league_id,
                "game_id": gid,
                "team_id": tid,
                "player_id": pid,
                "minutes": r["minutes"],
                "pts": r["pts"],
                "reb": r["reb"],
                "oreb": r["oreb"],
                "dreb": r["dreb"],
                "ast": r["ast"],
                "stl": r["stl"],
                "blk": r["blk"],
                "tov": r["tov"],
                "pf": r["pf"],
                "fgm": r["fgm"],
                "fga": r["fga"],
                "tpm": r["tpm"],
                "tpa": r["tpa"],
                "ftm": r["ftm"],
                "fta": r["fta"],
                "plus_minus": r["plus_minus"],
                "starter": r["starter"],
                "did_not_play": r["did_not_play"],
                "dnp_reason": r["dnp_reason"],
                "updated_at": now_iso,
            }
        )
    if stat_payloads:
        sb.upsert_on_conflict("player_game_stats", stat_payloads, "game_id,player_id", batch=300)

    # 8. Log sync_runs
    sb.request(
        "POST",
        "sync_runs",
        body=[
            {
                "source": EXTERNAL_SOURCE,
                "league_slug": LEAGUE_SLUG,
                "status": "success",
                "games_synced": len(games),
                "stats_synced": len(stat_payloads),
                "message": f"Synced {len(teams)} teams, {len(players)} players, {len(games)} games, {len(stat_payloads)} stat lines",
            }
        ],
        extra_headers={"Prefer": "return=minimal"},
    )


DEFAULT_SUPABASE_URL = "https://dowxayyvtghtjkctasfn.supabase.co"


def sync_via_edge_function(
    url: str,
    days_back: int,
    days_ahead: int,
    start_date: str | None = None,
    end_date: str | None = None,
) -> None:
    fn_url = f"{url.rstrip('/')}/functions/v1/sync-nba"
    payload: dict[str, Any] = {"days_back": days_back, "days_ahead": days_ahead}
    if start_date:
        payload["start_date"] = start_date
    if end_date:
        payload["end_date"] = end_date
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        fn_url,
        data=data,
        headers={**HEADERS, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            res = json.loads(raw) if raw else {}
            if not res.get("ok"):
                raise RuntimeError(f"Edge Function sync-nba returned error: {raw}")
            print(
                f"[sync_nba] Edge Function sync-nba OK: {res.get('games_synced')} games, "
                f"{res.get('stats_synced')} stats ({res.get('dates')})"
            )
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Edge Function sync-nba HTTP {err.code}: {detail}") from err


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync NBA data from ESPN into Supabase")
    parser.add_argument("--mode", choices=["supabase", "sql"], default="supabase")
    parser.add_argument("--sql-dir", default="./seed_sql")
    parser.add_argument("--days-back", type=int, default=4, help="Days before today to sync")
    parser.add_argument("--days-ahead", type=int, default=3, help="Days ahead of today to sync")
    parser.add_argument("--start-date", help="Override start date YYYY-MM-DD")
    parser.add_argument("--end-date", help="Override end date YYYY-MM-DD")
    args = parser.parse_args()

    if args.mode == "supabase":
        url = (
            os.environ.get("SUPABASE_URL", "").strip()
            or os.environ.get("VITE_SUPABASE_URL", "").strip()
            or DEFAULT_SUPABASE_URL
        )
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not key:
            print(
                "[sync_nba] SUPABASE_SERVICE_ROLE_KEY not set in env; "
                "delegating sync to Supabase Edge Function (sync-nba)..."
            )
            sync_via_edge_function(url, args.days_back, args.days_ahead, args.start_date, args.end_date)
            return 0
        os.environ["SUPABASE_URL"] = url

    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date()
    start_d = dt.date.fromisoformat(args.start_date) if args.start_date else today - dt.timedelta(days=args.days_back)
    end_d = dt.date.fromisoformat(args.end_date) if args.end_date else today + dt.timedelta(days=args.days_ahead)
    dates = [start_d + dt.timedelta(days=i) for i in range((end_d - start_d).days + 1)]

    print(f"[sync_nba] Fetching teams & standings...")
    teams, standings, season_year, season_name = fetch_teams_and_standings()
    valid_team_ids = {t["external_id"] for t in teams}
    print(f"[sync_nba] Found {len(teams)} teams, {len(standings)} standings entries ({season_name}).")

    print(f"[sync_nba] Fetching rosters...")
    players_by_ext_id = fetch_all_rosters(sorted(valid_team_ids))
    print(f"[sync_nba] Found {len(players_by_ext_id)} roster players.")

    print(f"[sync_nba] Fetching scoreboard & box scores for {start_d}..{end_d} ({len(dates)} days)...")
    games, stats, g_year, g_name = fetch_games_and_boxscores(dates, valid_team_ids, players_by_ext_id)
    if g_year:
        season_year = g_year
    if g_name:
        season_name = g_name

    players = list(players_by_ext_id.values())
    print(f"[sync_nba] Ready: {len(games)} games, {len(stats)} player stat lines, {len(players)} total players.")

    if args.mode == "sql":
        written = write_sql_seed_files(
            Path(args.sql_dir), season_year, season_name, teams, standings, players, games, stats
        )
        print(f"[sync_nba] Wrote {len(written)} SQL files into {args.sql_dir}")
    else:
        sync_via_supabase_rest(season_year, season_name, teams, standings, players, games, stats)
        print("[sync_nba] Supabase REST sync complete!")

    return 0


if __name__ == "__main__":
    sys.exit(main())
