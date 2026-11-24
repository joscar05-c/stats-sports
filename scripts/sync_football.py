#!/usr/bin/env python3
"""
Synchronize Football (Soccer) leagues (starting with English Premier League `eng.1`)
teams, standings, rosters, matches, and player/team match stats from ESPN's public
JSON endpoints into Supabase (PostgreSQL).

Zero external pip dependencies — uses Python 3 standard library only.

Usage:
  SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
    python scripts/sync_football.py --league eng.1 --days-back 5 --days-ahead 10

  # Backfill entire current season so far:
  SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
    python scripts/sync_football.py --league eng.1 --backfill-season
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

ESPN_BASE = "https://site.api.espn.com/apis"
EXTERNAL_SOURCE = "espn"
HEADERS = {
    "User-Agent": "CourtVisionStats/1.0 (+https://github.com)",
    "Accept": "application/json",
}

LEAGUE_CATALOG: dict[str, dict[str, str]] = {
    "eng.1": {
        "slug": "premier-league",
        "name": "English Premier League",
        "short_name": "Premier League",
        "country": "Inglaterra",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
    },
    "esp.1": {
        "slug": "laliga",
        "name": "Spanish LALIGA",
        "short_name": "LaLiga",
        "country": "España",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png",
    },
    "ita.1": {
        "slug": "serie-a",
        "name": "Italian Serie A",
        "short_name": "Serie A",
        "country": "Italia",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/12.png",
    },
    "ger.1": {
        "slug": "bundesliga",
        "name": "German Bundesliga",
        "short_name": "Bundesliga",
        "country": "Alemania",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png",
    },
    "fra.1": {
        "slug": "ligue-1",
        "name": "French Ligue 1",
        "short_name": "Ligue 1",
        "country": "Francia",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/9.png",
    },
    "uefa.champions": {
        "slug": "champions-league",
        "name": "UEFA Champions League",
        "short_name": "Champions League",
        "country": "Europa",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png",
    },
    "conmebol.libertadores": {
        "slug": "libertadores",
        "name": "CONMEBOL Libertadores",
        "short_name": "Libertadores",
        "country": "Sudamérica",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/58.png",
    },
    "conmebol.sudamericana": {
        "slug": "sudamericana",
        "name": "CONMEBOL Sudamericana",
        "short_name": "Sudamericana",
        "country": "Sudamérica",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/1208.png",
    },
    "arg.1": {
        "slug": "argentina",
        "name": "Liga Profesional Argentina",
        "short_name": "Argentina",
        "country": "Argentina",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/1.png",
    },
    "bra.1": {
        "slug": "brasileirao",
        "name": "Brasileirão Série A",
        "short_name": "Brasil",
        "country": "Brasil",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/85.png",
    },
    "col.1": {
        "slug": "colombia",
        "name": "Liga BetPlay Dimayor",
        "short_name": "Colombia",
        "country": "Colombia",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/1543.png",
    },
    "chi.1": {
        "slug": "chile",
        "name": "Primera División de Chile",
        "short_name": "Chile",
        "country": "Chile",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/86.png",
    },
    "uru.1": {
        "slug": "uruguay",
        "name": "Liga AUF Uruguaya",
        "short_name": "Uruguay",
        "country": "Uruguay",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/1592.png",
    },
    "par.1": {
        "slug": "paraguay",
        "name": "Primera División de Paraguay",
        "short_name": "Paraguay",
        "country": "Paraguay",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/1892.png",
    },
    "per.1": {
        "slug": "peru",
        "name": "Liga 1 Perú",
        "short_name": "Perú",
        "country": "Perú",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/1813.png",
    },
    "ecu.1": {
        "slug": "ecuador",
        "name": "LigaPro Ecuador",
        "short_name": "Ecuador",
        "country": "Ecuador",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/1944.png",
    },
    "bol.1": {
        "slug": "bolivia",
        "name": "División Profesional de Bolivia",
        "short_name": "Bolivia",
        "country": "Bolivia",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/1949.png",
    },
    "ven.1": {
        "slug": "venezuela",
        "name": "Liga FUTVE Venezuela",
        "short_name": "Venezuela",
        "country": "Venezuela",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/1947.png",
    },
}


def fetch_json(url: str, retries: int = 3, timeout: int = 18) -> dict[str, Any]:
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
        s = str(val).strip().lstrip("+")
        return int(round(float(s)))
    except (ValueError, TypeError):
        return default


def safe_float(val: Any) -> float | None:
    if val is None or val == "" or val == "--" or val == "-":
        return None
    try:
        return float(str(val).strip().lstrip("+"))
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


def normalize_color(hex_val: str | None) -> str | None:
    if not hex_val:
        return None
    c = hex_val.strip().lstrip("#")
    if len(c) in (3, 6):
        return f"#{c.lower()}"
    return None


def map_match_status(status_obj: dict[str, Any]) -> tuple[str, str]:
    st_type = status_obj.get("type") or {}
    state = st_type.get("state") or "pre"
    name = str(st_type.get("name") or "")
    detail = str(st_type.get("shortDetail") or st_type.get("detail") or "")
    if "POSTPONED" in name or "CANCELED" in name:
        return "postponed", detail
    if state == "in":
        return "live", detail
    if state == "post" or st_type.get("completed"):
        return "final", detail
    return "scheduled", detail


def extract_soccer_odds(odds_list: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    entry = odds_list[0] if odds_list else None
    if not isinstance(entry, dict):
        return None
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
    draw_ml = ml.get("draw") or {}
    draw_odds_obj = entry.get("drawOdds") or {}

    payload = {
        "provider": prov.get("displayName") or prov.get("name") or "Sportsbook",
        "details": entry.get("details"),
        "home_spread": parse_line_num((home_ps.get("close") or {}).get("line")),
        "away_spread": parse_line_num((away_ps.get("close") or {}).get("line")),
        "open_home_spread": parse_line_num((home_ps.get("open") or {}).get("line")),
        "home_spread_odds": parse_american_odds((home_ps.get("close") or {}).get("odds")),
        "away_spread_odds": parse_american_odds((away_ps.get("close") or {}).get("odds")),
        "over_under": parse_line_num((over_tot.get("close") or {}).get("line"))
        or safe_float(entry.get("overUnder")),
        "open_over_under": parse_line_num((over_tot.get("open") or {}).get("line")),
        "over_odds": parse_american_odds((over_tot.get("close") or {}).get("odds")),
        "under_odds": parse_american_odds((under_tot.get("close") or {}).get("odds")),
        "home_moneyline": parse_american_odds((home_ml.get("close") or {}).get("odds")),
        "away_moneyline": parse_american_odds((away_ml.get("close") or {}).get("odds")),
        "draw_moneyline": parse_american_odds((draw_ml.get("close") or {}).get("odds"))
        or parse_american_odds(draw_odds_obj.get("moneyLine")),
        "open_home_moneyline": parse_american_odds((home_ml.get("open") or {}).get("odds")),
        "open_away_moneyline": parse_american_odds((away_ml.get("open") or {}).get("odds")),
    }
    cleaned = {k: v for k, v in payload.items() if v is not None}
    return cleaned or None


def extract_team_match_stats(stat_list: list[dict[str, Any]]) -> dict[str, Any]:
    smap = {s.get("name"): s.get("displayValue") for s in stat_list if s.get("name")}
    raw_pass_pct = safe_float(smap.get("passPct"))
    pass_pct = (
        round(raw_pass_pct * 100, 1)
        if raw_pass_pct is not None and raw_pass_pct <= 1.0
        else raw_pass_pct
    )
    return {
        "possession_pct": safe_float(smap.get("possessionPct")),
        "shots": safe_int(smap.get("totalShots"), 0),
        "shots_on_target": safe_int(smap.get("shotsOnTarget"), 0),
        "corners": safe_int(smap.get("wonCorners"), 0),
        "fouls": safe_int(smap.get("foulsCommitted"), 0),
        "yellow_cards": safe_int(smap.get("yellowCards"), 0),
        "red_cards": safe_int(smap.get("redCards"), 0),
        "offsides": safe_int(smap.get("offsides"), 0),
        "saves": safe_int(smap.get("saves"), 0),
        "shot_pct": safe_float(smap.get("shotPct")),
        "total_passes": safe_int(smap.get("totalPasses"), 0),
        "accurate_passes": safe_int(smap.get("accuratePasses"), 0),
        "pass_pct": pass_pct,
        "crosses": safe_int(smap.get("totalCrosses"), 0),
        "accurate_crosses": safe_int(smap.get("accurateCrosses"), 0),
        "blocked_shots": safe_int(smap.get("blockedShots"), 0),
        "tackles": safe_int(smap.get("totalTackles"), 0),
        "effective_tackles": safe_int(smap.get("effectiveTackles"), 0),
        "interceptions": safe_int(smap.get("interceptions"), 0),
        "clearances": safe_int(smap.get("totalClearance"), 0),
        "penalty_goals": safe_int(smap.get("penaltyKickGoals"), 0),
        "penalty_shots": safe_int(smap.get("penaltyKickShots"), 0),
    }


def extract_key_events(
    raw_events: list[dict[str, Any]], team_abbr_by_ext: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ev in raw_events or []:
        etype = str((ev.get("type") or {}).get("text") or "").strip()
        if not etype:
            continue
        low = etype.lower()
        kind: str | None = None
        if "own goal" in low:
            kind = "own_goal"
        elif "penalty" in low and "scored" in low or low == "penalty - scored":
            kind = "penalty"
        elif "goal" in low and "missed" not in low:
            kind = "goal"
        elif "red card" in low:
            kind = "red"
        elif "yellow card" in low:
            kind = "yellow"
        if not kind:
            continue

        participants = ev.get("participants") or []
        scorer = (
            ((participants[0].get("athlete") or {}).get("displayName"))
            if len(participants) > 0
            else None
        )
        assist = (
            ((participants[1].get("athlete") or {}).get("displayName"))
            if len(participants) > 1
            else None
        )
        ev_team = ev.get("team") or {}
        team_abbr = ev_team.get("abbreviation") or (
            team_abbr_by_ext.get(str(ev_team.get("id") or "")) if team_abbr_by_ext else None
        )
        out.append(
            {
                "kind": kind,
                "label": etype,
                "minute": str((ev.get("clock") or {}).get("displayValue") or ""),
                "team_abbr": team_abbr,
                "player": scorer,
                "assist": assist,
            }
        )
    return out


FPL_TO_ESPN_ABBR: dict[str, str] = {"MCI": "MNC", "MUN": "MAN"}


def normalize_person_name(val: str | None) -> str:
    if not val:
        return ""
    s = unicodedata.normalize("NFD", val)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in s.lower())
    return " ".join(s.split())


def build_fpl_photo_resolver(league_code: str) -> Callable[[str, str | None], str | None]:
    if league_code not in ("eng.1", "uefa.champions"):
        return lambda _name, _abbr=None: None
    try:
        fpl = fetch_json("https://fantasy.premierleague.com/api/bootstrap-static/")
        team_abbr_by_id: dict[int, str] = {}
        for t in fpl.get("teams") or []:
            abbr = str(t.get("short_name") or "").upper()
            if t.get("id") and abbr:
                team_abbr_by_id[int(t["id"])] = FPL_TO_ESPN_ABBR.get(abbr, abbr)

        by_team_full: dict[str, str] = {}
        by_team_web: dict[str, str] = {}
        by_team_last: dict[str, list[str]] = {}
        by_global_full: dict[str, str] = {}

        for el in fpl.get("elements") or []:
            code = el.get("code")
            if not code:
                continue
            url = f"https://resources.premierleague.com/premierleague25/photos/players/110x140/{code}.png"
            abbr = team_abbr_by_id.get(int(el.get("team") or 0), "")
            full = normalize_person_name(f"{el.get('first_name') or ''} {el.get('second_name') or ''}")
            web = normalize_person_name(el.get("web_name"))
            sec = normalize_person_name(el.get("second_name"))
            if abbr and full:
                by_team_full[f"{abbr}|{full}"] = url
            if abbr and web:
                by_team_web[f"{abbr}|{web}"] = url
            if full and full not in by_global_full:
                by_global_full[full] = url
            if abbr and sec:
                last_tok = sec.split()[-1]
                by_team_last.setdefault(f"{abbr}|{last_tok}", []).append(url)

        def resolver(full_name: str, team_abbr: str | None = None) -> str | None:
            n_full = normalize_person_name(full_name)
            if not n_full:
                return None
            abbr = (team_abbr or "").upper()
            if abbr:
                exact = by_team_full.get(f"{abbr}|{n_full}") or by_team_web.get(f"{abbr}|{n_full}")
                if exact:
                    return exact
                toks = n_full.split()
                last_tok = toks[-1]
                first_last = f"{toks[0]} {last_tok}" if len(toks) >= 2 else n_full
                if f"{abbr}|{first_last}" in by_team_full:
                    return by_team_full[f"{abbr}|{first_last}"]
                last_cands = by_team_last.get(f"{abbr}|{last_tok}", [])
                if len(last_cands) == 1:
                    return last_cands[0]
                prefix = f"{abbr}|"
                for k, u in by_team_full.items():
                    if k.startswith(prefix):
                        k_name = k[len(prefix) :]
                        if k_name in n_full or n_full in k_name:
                            return u
            return by_global_full.get(n_full)

        return resolver
    except Exception:
        return lambda _name, _abbr=None: None


WIKI_UA = "CourtVisionStats/1.0 (https://github.com/joscar05-c/stats-sports)"
FOOTBALL_DESC_RE = re.compile(
    r"football|soccer|goalkeeper|defender|midfielder|forward|winger|striker|"
    r"futbolista|portero|defensa|centrocampista|delantero|"
    r"futebolista|futebol|goleiro|zagueiro|volante|atacante|"
    r"calciatore|portiere|difensore|attaccante|"
    r"fußballspieler|torwart|abwehrspieler|mittelfeldspieler|stürmer|"
    r"footballeur|gardien de but",
    re.I,
)
DEATH_DESC_RE = re.compile(r"\b(?:18|19|20)\d{2}\s*[–\-]\s*(?:18|19|20)\d{2}\b")
BORN_YEAR_DESC_RE = re.compile(r"(?:born|n\.|nacido en|nascido em|nasc\.|geboren)\s+(\d{4})\b", re.I)
LEAGUE_SECONDARY_WIKIS: dict[str, list[str]] = {
    "esp.1": ["es"],
    "ita.1": ["it"],
    "ger.1": ["de"],
    "fra.1": ["fr"],
    "uefa.champions": ["es", "it", "de", "fr"],
    "conmebol.libertadores": ["es", "pt"],
    "conmebol.sudamericana": ["es", "pt"],
    "arg.1": ["es"],
    "bra.1": ["pt", "es"],
    "col.1": ["es"],
    "chi.1": ["es"],
    "uru.1": ["es"],
    "par.1": ["es"],
    "per.1": ["es"],
    "ecu.1": ["es"],
    "bol.1": ["es"],
    "ven.1": ["es"],
}


def _fetch_wiki_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": WIKI_UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _is_birth_year_compatible(birth_year: int | None, age: int | None, cur_year: int) -> bool:
    if birth_year is None or birth_year < 1983:
        return False
    if age is not None and abs(birth_year - (cur_year - age)) > 2:
        return False
    return True


def _fetch_wikidata_birth_years(qids: list[str]) -> dict[str, int]:
    unique = sorted({q for q in qids if q})
    if not unique:
        return {}
    out: dict[str, int] = {}
    chunks = [unique[i : i + 50] for i in range(0, len(unique), 50)]

    def worker(chunk: list[str]) -> dict[str, int]:
        local: dict[str, int] = {}
        try:
            qs = urllib.parse.urlencode(
                {"action": "wbgetentities", "ids": "|".join(chunk), "props": "claims", "format": "json"}
            )
            data = _fetch_wiki_json(f"https://www.wikidata.org/w/api.php?{qs}")
            for qid, ent in (data.get("entities") or {}).items():
                p569 = (ent.get("claims") or {}).get("P569") or []
                t = str(
                    ((p569[0].get("mainsnak") or {}).get("datavalue") or {}).get("value", {}).get("time", "")
                    if p569
                    else ""
                )
                m = re.match(r"^\+?(\d{4})-", t)
                if m:
                    local[qid] = int(m.group(1))
        except Exception:
            pass
        return local

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for res in ex.map(worker, chunks):
            out.update(res)
    return out


def resolve_football_headshots_from_wiki(
    league_code: str,
    players: list[dict[str, Any]],
) -> dict[str, str]:
    if not players:
        return {}
    cur_year = dt.datetime.now(dt.timezone.utc).year
    resolved: dict[str, str] = {}

    def run_pass(lang: str, title_builder: Callable[[dict[str, Any]], list[str]]) -> None:
        remaining = [p for p in players if p["key"] not in resolved]
        if not remaining:
            return
        query_items: list[tuple[str, int | None, str]] = []
        for p in remaining:
            name = str(p.get("full_name") or "").strip()
            if not name:
                continue
            for title in title_builder({**p, "full_name": name}):
                query_items.append((p["key"], p.get("age"), title))
        if not query_items:
            return

        chunks = [query_items[i : i + 50] for i in range(0, len(query_items), 50)]

        def fetch_chunk(chunk: list[tuple[str, int | None, str]]) -> list[dict[str, Any]]:
            cands: list[dict[str, Any]] = []
            try:
                qs = urllib.parse.urlencode(
                    {
                        "action": "query",
                        "titles": "|".join(c[2] for c in chunk),
                        "prop": "pageimages|description|pageprops",
                        "ppprop": "wikibase_item",
                        "pithumbsize": "240",
                        "redirects": "1",
                        "format": "json",
                    }
                )
                data = _fetch_wiki_json(f"https://{lang}.wikipedia.org/w/api.php?{qs}")
                q = data.get("query") or {}
                norm_map = {n["from"]: n["to"] for n in (q.get("normalized") or [])}
                redir_map = {r["from"]: r["to"] for r in (q.get("redirects") or [])}
                pages_by_title = {
                    p["title"]: p for p in (q.get("pages") or {}).values() if "missing" not in p
                }
                for key, age, title in chunk:
                    cur = redir_map.get(norm_map.get(title, title), norm_map.get(title, title))
                    page = pages_by_title.get(cur)
                    if not page:
                        continue
                    desc = str(page.get("description") or "")
                    thumb = str((page.get("thumbnail") or {}).get("source") or "")
                    if not thumb or not FOOTBALL_DESC_RE.search(desc) or DEATH_DESC_RE.search(desc):
                        continue
                    ym = BORN_YEAR_DESC_RE.search(desc)
                    desc_year = int(ym.group(1)) if ym else None
                    if desc_year is not None and not _is_birth_year_compatible(desc_year, age, cur_year):
                        continue
                    qid = (page.get("pageprops") or {}).get("wikibase_item")
                    cands.append({"key": key, "age": age, "thumb": thumb, "qid": qid, "desc_year": desc_year})
            except Exception:
                pass
            return cands

        candidates: list[dict[str, Any]] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            for cands in ex.map(fetch_chunk, chunks):
                candidates.extend(cands)
        if not candidates:
            return
        birth_years = _fetch_wikidata_birth_years([str(c["qid"]) for c in candidates if c.get("qid")])
        for c in candidates:
            key = c["key"]
            if key in resolved:
                continue
            qid = c.get("qid")
            by = birth_years.get(str(qid)) if qid and str(qid) in birth_years else c.get("desc_year")
            if _is_birth_year_compatible(by, c.get("age"), cur_year):
                resolved[key] = c["thumb"]
            elif by is None and lang == "en" and c.get("age") is None:
                resolved[key] = c["thumb"]

    run_pass("en", lambda p: [p["full_name"]])
    run_pass("en", lambda p: [f"{p['full_name']} (footballer)"])
    run_pass(
        "en",
        lambda p: [
            f"{p['full_name']} (footballer, born {cur_year - p['age']})",
            f"{p['full_name']} (footballer, born {cur_year - p['age'] - 1})",
        ]
        if p.get("age") is not None
        else [],
    )
    for sec_lang in LEAGUE_SECONDARY_WIKIS.get(league_code, []):
        run_pass(sec_lang, lambda p: [p["full_name"]])
    return resolved


class SupabaseRest:
    def __init__(self, url: str, service_key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.key = service_key

    def _request(
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
            err_body = err.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase {method} {path} -> HTTP {err.code}: {err_body}") from err

    def select_all(self, table: str, params: str = "") -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset = 0
        limit = 1000
        while True:
            sep = "&" if params else ""
            path = f"{table}?{params}{sep}limit={limit}&offset={offset}"
            chunk = self._request("GET", path, extra_headers={"Prefer": "count=none"}) or []
            rows.extend(chunk)
            if len(chunk) < limit:
                break
            offset += limit
        return rows

    def upsert_on_conflict(
        self, table: str, rows: list[dict[str, Any]], on_conflict: str, batch: int = 300
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for i in range(0, len(rows), batch):
            chunk = rows[i : i + batch]
            res = self._request(
                "POST",
                f"{table}?on_conflict={urllib.parse.quote(on_conflict)}",
                body=chunk,
                extra_headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            )
            if isinstance(res, list):
                out.extend(res)
        return out


def sync_league(
    league_code: str,
    days_back: int,
    days_ahead: int,
    backfill_season: bool,
    sb_url: str,
    sb_key: str,
) -> None:
    meta = LEAGUE_CATALOG[league_code]
    sb = SupabaseRest(sb_url, sb_key)
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()

    # 1. Fetch teams, standings, and default scoreboard (calendar + current season)
    teams_json = fetch_json(f"{ESPN_BASE}/site/v2/sports/soccer/{league_code}/teams")
    standings_json = fetch_json(f"{ESPN_BASE}/v2/sports/soccer/{league_code}/standings")
    default_sb = fetch_json(f"{ESPN_BASE}/site/v2/sports/soccer/{league_code}/scoreboard")

    season_year = 2026
    season_name = "2026-27"
    seasons_list = standings_json.get("seasons") or []
    if seasons_list:
        s0 = seasons_list[0]
        season_year = safe_int(s0.get("year"), season_year)
        season_name = s0.get("seasonYears") or s0.get("displayName") or season_name

    # Upsert League & Season
    league_rows = sb.upsert_on_conflict(
        "leagues",
        [
            {
                "slug": meta["slug"],
                "name": meta["name"],
                "short_name": meta["short_name"],
                "country": meta["country"],
                "sport": "football",
                "source_type": "api",
                "external_source": EXTERNAL_SOURCE,
                "external_id": league_code,
                "logo_url": meta["logo_url"],
                "is_public": True,
            }
        ],
        "slug",
    )
    league_id = league_rows[0]["id"]

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

    # 2. Upsert Teams (20 clubs)
    existing_teams = sb.select_all(
        "teams", f"league_id=eq.{league_id}&external_source=eq.{EXTERNAL_SOURCE}&select=id,external_id"
    )
    team_id_map: dict[str, int] = {
        str(r["external_id"]): r["id"] for r in existing_teams if r.get("external_id")
    }

    raw_teams = teams_json.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", [])
    valid_team_ids: set[str] = set()
    team_abbr_by_ext: dict[str, str] = {}
    new_teams: list[dict[str, Any]] = []
    for item in raw_teams:
        t = item.get("team") or {}
        tid = str(t.get("id") or "")
        if not tid:
            continue
        valid_team_ids.add(tid)
        abbr = t.get("abbreviation") or tid[:3].upper()
        team_abbr_by_ext[tid] = abbr
        logos = t.get("logos") or []
        logo_url = logos[0].get("href") if logos else None
        payload = {
            "league_id": league_id,
            "external_source": EXTERNAL_SOURCE,
            "external_id": tid,
            "name": t.get("displayName") or t.get("name") or tid,
            "short_name": t.get("shortDisplayName") or t.get("nickname") or t.get("name") or tid,
            "abbreviation": abbr,
            "city": t.get("location"),
            "primary_color": normalize_color(t.get("color")),
            "alternate_color": normalize_color(t.get("alternateColor")),
            "logo_url": logo_url,
            "is_active": True,
        }
        existing_tid = team_id_map.get(tid)
        if existing_tid:
            sb._request("PATCH", f"teams?id=eq.{existing_tid}", payload, {"Prefer": "return=minimal"})
        else:
            new_teams.append(payload)

    if new_teams:
        inserted = sb._request("POST", "teams", new_teams) or []
        for r in inserted:
            team_id_map[str(r["external_id"])] = r["id"]

    # 3. Upsert Standings
    children = standings_json.get("children", [])
    has_multi_groups = len(children) > 1
    standing_payloads: list[dict[str, Any]] = []
    for child in children:
        group_name = (
            str(child.get("name") or child.get("shortName") or "").strip() or None
            if has_multi_groups
            else None
        )
        for entry in (child.get("standings") or {}).get("entries", []):
            tid_ext = str((entry.get("team") or {}).get("id") or "")
            tid = team_id_map.get(tid_ext)
            if not tid:
                continue
            smap = {
                s.get("name"): s.get("displayValue") if s.get("displayValue") is not None else s.get("value")
                for s in entry.get("stats", [])
                if s.get("name")
            }
            played = safe_int(smap.get("gamesPlayed"), 0)
            wins = safe_int(smap.get("wins"), 0)
            draws = safe_int(smap.get("ties"), 0)
            losses = safe_int(smap.get("losses"), 0)
            points = safe_int(smap.get("points"), 0)
            gf = safe_int(smap.get("pointsFor"), 0)
            ga = safe_int(smap.get("pointsAgainst"), 0)
            gd = safe_int(smap.get("pointDifferential"), gf - ga)
            rank = safe_int(smap.get("rank"), 0) or None
            win_pct = round((wins + 0.5 * draws) / played, 3) if played > 0 else 0.0
            standing_payloads.append(
                {
                    "league_id": league_id,
                    "season_id": season_id,
                    "team_id": tid,
                    "conference": group_name,
                    "playoff_seed": rank,
                    "played": played,
                    "wins": wins,
                    "draws": draws,
                    "losses": losses,
                    "points": points,
                    "goals_for": gf,
                    "goals_against": ga,
                    "goal_diff": gd,
                    "win_pct": win_pct,
                    "ppg": round(gf / played, 2) if played > 0 else 0.0,
                    "oppg": round(ga / played, 2) if played > 0 else 0.0,
                    "diff": gd,
                    "updated_at": now_iso,
                }
            )
    if standing_payloads:
        sb.upsert_on_conflict("team_standings", standing_payloads, "season_id,team_id")

    # 4. Sync Team Rosters into `players`
    existing_players = sb.select_all(
        "players",
        f"league_id=eq.{league_id}&external_source=eq.{EXTERNAL_SOURCE}&select=id,external_id,full_name,team_id,age,headshot_url",
    )
    player_id_map: dict[str, int] = {
        str(r["external_id"]): r["id"] for r in existing_players if r.get("external_id")
    }
    team_abbr_by_db_id: dict[int, str] = {
        db_id: team_abbr_by_ext[ext_id]
        for ext_id, db_id in team_id_map.items()
        if ext_id in team_abbr_by_ext
    }
    resolve_fpl_photo = build_fpl_photo_resolver(league_code)

    def fetch_team_roster(ext_tid: str) -> tuple[str, list[dict[str, Any]]]:
        try:
            rj = fetch_json(f"{ESPN_BASE}/site/v2/sports/soccer/{league_code}/teams/{ext_tid}/roster")
            return ext_tid, rj.get("athletes") or []
        except Exception:
            return ext_tid, []

    discovered_players: dict[str, dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for ext_tid, athletes in ex.map(fetch_team_roster, sorted(valid_team_ids)):
            for ath in athletes:
                pid = str(ath.get("id") or "")
                if not pid:
                    continue
                pos = (ath.get("position") or {}).get("abbreviation") or (ath.get("position") or {}).get("name")
                discovered_players[pid] = {
                    "external_source": EXTERNAL_SOURCE,
                    "external_id": pid,
                    "team_external_id": ext_tid,
                    "first_name": ath.get("firstName"),
                    "last_name": ath.get("lastName"),
                    "full_name": ath.get("displayName") or ath.get("fullName") or f"Player {pid}",
                    "jersey_number": str(ath["jersey"]) if ath.get("jersey") is not None else None,
                    "position": pos,
                    "height_display": ath.get("displayHeight"),
                    "weight_display": ath.get("displayWeight"),
                    "age": safe_int(ath.get("age"), 0) or None,
                    "country": (ath.get("citizenshipCountry") or {}).get("abbreviation")
                    or ath.get("citizenship"),
                    "headshot_url": (ath.get("headshot") or {}).get("href"),
                    "status": "active",
                    "is_active": True,
                }

    # 5. Determine calendar matchdays to fetch
    now_pet = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=5)
    today_date = now_pet.date()
    is_south_america = league_code.startswith("conmebol.") or league_code in (
        "arg.1",
        "bra.1",
        "col.1",
        "chi.1",
        "uru.1",
        "par.1",
        "per.1",
        "ecu.1",
        "bol.1",
        "ven.1",
    )
    min_date = (
        dt.date(season_year, 1 if is_south_america else 7, 1)
        if backfill_season
        else (today_date - dt.timedelta(days=days_back))
    )
    max_date = today_date + dt.timedelta(days=days_ahead)

    cal_raw = (default_sb.get("leagues") or [{}])[0].get("calendar") or []
    target_dates: list[str] = []
    seen_cal: set[str] = set()
    for c in cal_raw:
        if not isinstance(c, str):
            continue
        d_str = c[:10]
        if len(d_str) != 10 or d_str in seen_cal:
            continue
        try:
            d_obj = dt.date.fromisoformat(d_str)
        except ValueError:
            continue
        if min_date <= d_obj <= max_date:
            seen_cal.add(d_str)
            target_dates.append(d_str)

    if not target_dates:
        is_cup_midweek = league_code in (
            "uefa.champions",
            "conmebol.libertadores",
            "conmebol.sudamericana",
        )
        start_d = (
            dt.date(season_year, 2 if league_code.startswith("conmebol.") else 9, 1)
            if backfill_season
            else min_date
        )
        cur = start_d
        while cur <= max_date:
            if not backfill_season or not is_cup_midweek or cur.weekday() in (1, 2, 3):
                target_dates.append(cur.isoformat())
            cur += dt.timedelta(days=1)
        if not target_dates:
            target_dates = [today_date.isoformat()]

    def fetch_day_sb(d_str: str) -> tuple[str, dict[str, Any]]:
        ymd = d_str.replace("-", "")
        return d_str, fetch_json(f"{ESPN_BASE}/site/v2/sports/soccer/{league_code}/scoreboard?dates={ymd}")

    games_by_ext: dict[str, dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for d_str, sb_json in ex.map(fetch_day_sb, target_dates):
            for ev in sb_json.get("events") or []:
                ev_id = str(ev.get("id") or "")
                if not ev_id:
                    continue
                comp = (ev.get("competitions") or [None])[0]
                if not comp:
                    continue
                competitors = comp.get("competitors") or []
                home = next((c for c in competitors if c.get("homeAway") == "home"), None)
                away = next((c for c in competitors if c.get("homeAway") == "away"), None)
                if not home or not away:
                    continue
                ht_ext = str((home.get("team") or {}).get("id") or "")
                at_ext = str((away.get("team") or {}).get("id") or "")
                if ht_ext not in valid_team_ids or at_ext not in valid_team_ids:
                    continue
                st_obj = comp.get("status") or ev.get("status") or {}
                status, status_detail = map_match_status(st_obj)
                tipoff_at = ev.get("date") or f"{d_str}T00:00:00Z"
                # Derive local Peru (UTC-5) match date
                try:
                    dt_utc = dt.datetime.fromisoformat(tipoff_at.replace("Z", "+00:00"))
                    local_date = (dt_utc - dt.timedelta(hours=5)).date().isoformat()
                except Exception:
                    local_date = d_str

                games_by_ext[ev_id] = {
                    "external_source": EXTERNAL_SOURCE,
                    "external_id": ev_id,
                    "game_date": local_date,
                    "tipoff_at": tipoff_at,
                    "status": status,
                    "status_detail": status_detail,
                    "period": safe_int(st_obj.get("period"), 0),
                    "clock": st_obj.get("displayClock"),
                    "home_team_ext_id": ht_ext,
                    "away_team_ext_id": at_ext,
                    "home_score": safe_int(home.get("score"), 0),
                    "away_score": safe_int(away.get("score"), 0),
                    "home_linescores": None,
                    "away_linescores": None,
                    "venue": (comp.get("venue") or {}).get("fullName"),
                    "odds": extract_soccer_odds(comp.get("odds")),
                    "sport_stats": None,
                }

    # 6. Fetch match summaries for final/live matches
    games_to_summarize = [g for g in games_by_ext.values() if g["status"] in ("final", "live")]
    stats_rows: list[dict[str, Any]] = []

    def fetch_summary(g: dict[str, Any]) -> list[dict[str, Any]]:
        eid = g["external_id"]
        summ = fetch_json(f"{ESPN_BASE}/site/v2/sports/soccer/{league_code}/summary?event={eid}")
        pick_odds = extract_soccer_odds(summ.get("odds") or summ.get("pickcenter"))
        if pick_odds:
            g["odds"] = {**(g["odds"] or {}), **pick_odds}

        header_comps = ((summ.get("header") or {}).get("competitions") or [None])[0]
        if isinstance(header_comps, dict):
            for hc in header_comps.get("competitors") or []:
                ls = [safe_int(x.get("displayValue") if x.get("displayValue") is not None else x.get("value"), 0) for x in (hc.get("linescores") or []) if isinstance(x, dict)]
                if ls:
                    if hc.get("homeAway") == "home":
                        g["home_linescores"] = ls
                    elif hc.get("homeAway") == "away":
                        g["away_linescores"] = ls

        home_stats: dict[str, Any] = {}
        away_stats: dict[str, Any] = {}
        for bt in (summ.get("boxscore") or {}).get("teams") or []:
            tid = str((bt.get("team") or {}).get("id") or "")
            parsed = extract_team_match_stats(bt.get("statistics") or [])
            if tid == g["home_team_ext_id"]:
                home_stats = parsed
            elif tid == g["away_team_ext_id"]:
                away_stats = parsed

        key_events = extract_key_events(summ.get("keyEvents") or [], team_abbr_by_ext)
        if home_stats or away_stats or key_events:
            g["sport_stats"] = {
                "home": home_stats,
                "away": away_stats,
                "events": key_events,
            }

        out: list[dict[str, Any]] = []
        valid_match_teams = {g["home_team_ext_id"], g["away_team_ext_id"]}
        for ros in summ.get("rosters") or []:
            tid = str((ros.get("team") or {}).get("id") or "")
            if tid not in valid_team_ids or tid not in valid_match_teams:
                continue
            for prow in ros.get("roster") or []:
                ath = prow.get("athlete") or {}
                pid = str(ath.get("id") or "")
                if not pid:
                    continue
                if pid not in discovered_players:
                    discovered_players[pid] = {
                        "external_source": EXTERNAL_SOURCE,
                        "external_id": pid,
                        "team_external_id": tid,
                        "first_name": ath.get("firstName"),
                        "last_name": ath.get("lastName"),
                        "full_name": ath.get("displayName") or ath.get("shortName") or f"Player {pid}",
                        "jersey_number": str(prow["jersey"]) if prow.get("jersey") is not None else None,
                        "position": (prow.get("position") or {}).get("abbreviation"),
                        "headshot_url": (ath.get("headshot") or {}).get("href"),
                        "status": "active",
                        "is_active": True,
                    }

                smap = {
                    s.get("name"): safe_int(s.get("value"), 0)
                    for s in prow.get("stats") or []
                    if s.get("name")
                }
                appearances = smap.get("appearances", 0)
                sub_ins = smap.get("subIns", 0)
                is_starter = bool(prow.get("starter"))
                dnp = appearances == 0 and sub_ins == 0 and not is_starter
                mins = 0 if dnp else (90 if is_starter else 25)
                out.append(
                    {
                        "game_external_id": eid,
                        "team_external_id": tid,
                        "player_external_id": pid,
                        "minutes": mins,
                        "starter": is_starter,
                        "did_not_play": dnp,
                        "dnp_reason": "Suplente sin minutos" if dnp else None,
                        "sport_stats": {
                            "appearances": appearances,
                            "sub_ins": sub_ins,
                            "goals": smap.get("totalGoals", 0),
                            "assists": smap.get("goalAssists", 0),
                            "shots": smap.get("totalShots", 0),
                            "shots_on_target": smap.get("shotsOnTarget", 0),
                            "yellow_cards": smap.get("yellowCards", 0),
                            "red_cards": smap.get("redCards", 0),
                            "fouls_committed": smap.get("foulsCommitted", 0),
                            "fouls_suffered": smap.get("foulsSuffered", 0),
                            "saves": smap.get("saves", 0),
                            "shots_faced": smap.get("shotsFaced", 0),
                            "goals_conceded": smap.get("goalsConceded", 0),
                            "own_goals": smap.get("ownGoals", 0),
                            "offsides": smap.get("offsides", 0),
                        },
                    }
                )
        return out

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for rows in ex.map(fetch_summary, games_to_summarize):
            stats_rows.extend(rows)

    # 7. Insert newly discovered players & fill missing headshots (FPL + Wikipedia fallback)
    wiki_targets: list[dict[str, Any]] = []
    prelim_new: dict[str, str] = {}
    for p in discovered_players.values():
        if p["external_id"] not in player_id_map:
            photo = p.get("headshot_url") or resolve_fpl_photo(
                p["full_name"], team_abbr_by_ext.get(p["team_external_id"])
            )
            if photo:
                prelim_new[p["external_id"]] = photo
            else:
                wiki_targets.append(
                    {"key": f"new:{p['external_id']}", "full_name": p["full_name"], "age": p.get("age")}
                )

    prelim_existing: dict[int, str] = {}
    for ep in existing_players:
        if ep.get("headshot_url"):
            continue
        abbr = team_abbr_by_db_id.get(ep.get("team_id") or -1)
        photo = resolve_fpl_photo(ep.get("full_name") or "", abbr)
        if photo:
            prelim_existing[ep["id"]] = photo
        else:
            wiki_targets.append(
                {
                    "key": f"db:{ep['id']}",
                    "full_name": ep.get("full_name") or "",
                    "age": ep.get("age") if isinstance(ep.get("age"), int) else None,
                }
            )

    wiki_photo_map = resolve_football_headshots_from_wiki(league_code, wiki_targets)

    new_players: list[dict[str, Any]] = []
    for p in discovered_players.values():
        if p["external_id"] not in player_id_map:
            new_players.append(
                {
                    "league_id": league_id,
                    "team_id": team_id_map.get(p["team_external_id"]),
                    "external_source": EXTERNAL_SOURCE,
                    "external_id": p["external_id"],
                    "first_name": p.get("first_name"),
                    "last_name": p.get("last_name"),
                    "full_name": p["full_name"],
                    "jersey_number": p.get("jersey_number"),
                    "position": p.get("position"),
                    "height_display": p.get("height_display"),
                    "weight_display": p.get("weight_display"),
                    "age": p.get("age"),
                    "country": p.get("country"),
                    "headshot_url": prelim_new.get(p["external_id"])
                    or wiki_photo_map.get(f"new:{p['external_id']}"),
                    "status": "active",
                    "is_active": True,
                    "updated_at": now_iso,
                }
            )
    if new_players:
        for i in range(0, len(new_players), 300):
            inserted = sb._request("POST", "players", new_players[i : i + 300]) or []
            for r in inserted:
                player_id_map[str(r["external_id"])] = r["id"]

    headshot_patches: list[tuple[int, str]] = []
    for ep in existing_players:
        if ep.get("headshot_url"):
            continue
        photo = prelim_existing.get(ep["id"]) or wiki_photo_map.get(f"db:{ep['id']}")
        if photo:
            headshot_patches.append((ep["id"], photo))
    if headshot_patches:
        def patch_photo(item: tuple[int, str]) -> None:
            pid, url = item
            sb._request("PATCH", f"players?id=eq.{pid}", {"headshot_url": url, "updated_at": now_iso}, {"Prefer": "return=minimal"})
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
            list(ex.map(patch_photo, headshot_patches))

    # 8. Sync games (PATCH existing, POST new)
    existing_games = sb.select_all(
        "games", f"league_id=eq.{league_id}&external_source=eq.{EXTERNAL_SOURCE}&select=id,external_id"
    )
    game_id_map: dict[str, int] = {
        str(r["external_id"]): r["id"] for r in existing_games if r.get("external_id")
    }

    new_games: list[dict[str, Any]] = []
    game_updates: list[tuple[int, dict[str, Any]]] = []
    for g in games_by_ext.values():
        ht = team_id_map.get(g["home_team_ext_id"])
        at = team_id_map.get(g["away_team_ext_id"])
        if not ht or not at:
            continue
        payload: dict[str, Any] = {
            "league_id": league_id,
            "season_id": season_id,
            "external_source": EXTERNAL_SOURCE,
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
            "venue": g["venue"],
            "updated_at": now_iso,
        }
        gid = game_id_map.get(g["external_id"])
        if gid:
            if g["odds"] is not None:
                payload["odds"] = g["odds"]
            if g["sport_stats"] is not None:
                payload["sport_stats"] = g["sport_stats"]
            if g["home_linescores"] is not None:
                payload["home_linescores"] = g["home_linescores"]
            if g["away_linescores"] is not None:
                payload["away_linescores"] = g["away_linescores"]
            game_updates.append((gid, payload))
        else:
            # PostgREST bulk INSERT requires identical keys across all rows
            payload["odds"] = g["odds"]
            payload["sport_stats"] = g["sport_stats"]
            payload["home_linescores"] = g["home_linescores"]
            payload["away_linescores"] = g["away_linescores"]
            new_games.append(payload)

    def patch_game(item: tuple[int, dict[str, Any]]) -> None:
        gid, pl = item
        sb._request("PATCH", f"games?id=eq.{gid}", pl, {"Prefer": "return=minimal"})

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        list(ex.map(patch_game, game_updates))

    if new_games:
        for i in range(0, len(new_games), 200):
            inserted = sb._request("POST", "games", new_games[i : i + 200]) or []
            for r in inserted:
                game_id_map[str(r["external_id"])] = r["id"]

    # 9. Upsert player match stats
    stat_payloads: list[dict[str, Any]] = []
    for r in stats_rows:
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
                "pts": r["sport_stats"]["goals"],
                "ast": r["sport_stats"]["assists"],
                "starter": r["starter"],
                "did_not_play": r["did_not_play"],
                "dnp_reason": r["dnp_reason"],
                "sport_stats": r["sport_stats"],
                "updated_at": now_iso,
            }
        )

    if stat_payloads:
        sb.upsert_on_conflict("player_game_stats", stat_payloads, "game_id,player_id", batch=300)

    # 10. Log sync_runs
    msg = (
        f"Synced {len(games_by_ext)} matches ({target_dates[0]}..{target_dates[-1]}), "
        f"{len(stat_payloads)} player stats"
    )
    sb._request(
        "POST",
        "sync_runs",
        [
            {
                "source": EXTERNAL_SOURCE,
                "league_slug": meta["slug"],
                "status": "success",
                "games_synced": len(games_by_ext),
                "stats_synced": len(stat_payloads),
                "message": msg,
            }
        ],
        {"Prefer": "return=minimal"},
    )
    print(f"[OK] {meta['short_name']} ({season_name}): {msg}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync football league stats from ESPN to Supabase")
    parser.add_argument("--league", default="eng.1", choices=list(LEAGUE_CATALOG.keys()))
    parser.add_argument("--all-leagues", action="store_true", help="Sync all configured football leagues")
    parser.add_argument("--days-back", type=int, default=6)
    parser.add_argument("--days-ahead", type=int, default=12)
    parser.add_argument("--backfill-season", action="store_true")
    args = parser.parse_args()

    sb_url = os.environ.get("SUPABASE_URL", "").strip()
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not sb_url or not sb_key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.", file=sys.stderr)
        return 1

    targets = list(LEAGUE_CATALOG.keys()) if args.all_leagues else [args.league]
    for code in targets:
        sync_league(
            league_code=code,
            days_back=args.days_back,
            days_ahead=args.days_ahead,
            backfill_season=args.backfill_season,
            sb_url=sb_url,
            sb_key=sb_key,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
