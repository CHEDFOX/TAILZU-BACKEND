"""
TIMING FOCUS — grounds the Oracle in REAL dates when a question is about time.

Two modes:
  • A SPECIFIC date is asked about (classifier resolved target_date) → compute the
    life-chapter (daśā) ruling THAT day + the sky over the chart that day.
  • A timing question with NO date ("when will I marry?", "is this a good year?")
    → compute the UPCOMING life-chapter windows over the next ~2 years, with real
    dates — the horizon a human actually reasons in — so the Oracle answers with
    concrete windows instead of vague "soon".

The daśā engine (get_dasha_for_date) and the ephemeris both work for any date, so
this is exact, not guessed.
"""
from datetime import datetime

_BENEFIC = {"Jupiter", "Venus", "Mercury", "Moon"}
_MALEFIC = {"Saturn", "Mars", "Rahu", "Ketu"}
_TIMING_QTYPES = {"timing", "yes_no", "should_i"}
_TIMING_TOPICS = {"timing", "marriage", "career", "wealth", "travel", "health", "family"}


def _parse_date(s):
    if not s or not isinstance(s, str):
        return None
    s = s.strip()[:10]
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    return None


def _add_months(base, n):
    m = base.month - 1 + n
    y = base.year + m // 12
    m = m % 12 + 1
    return datetime(y, m, min(base.day, 28), 12, 0)


def _dasha_str(engine, dt):
    try:
        return (engine.get_dasha_for_date(dt) or {}).get("dasha_string", "") or ""
    except Exception:
        return ""


def _level2(s):
    """Keep only the top two daśā levels (mahā / antar) — the human-scale chapter."""
    for sep in (">", "/", "›", "-", "–"):
        if sep in s:
            parts = [x.strip() for x in s.split(sep) if x.strip()]
            return " / ".join(parts[:2])
    return s.strip()


def _sky_summary(engine, dt):
    """A plain read of the sky that day, relative to the person's own chart."""
    try:
        from app.services.core.ephemeris import get_ephemeris
        asc = getattr(engine, "ascendant_rashi", None)
        if asc is None:
            return ""
        eph = get_ephemeris()
        pl = eph.get_all_planets(eph.get_julian_day(dt)) or {}
        good, hard = [], []
        for p, d in pl.items():
            r = d.get("rashi")
            if r is None:
                continue
            h = ((r - asc) % 12) + 1
            if p in _BENEFIC and h in (1, 4, 5, 7, 9, 10, 11):
                good.append(f"{p} (H{h})")
            elif p in _MALEFIC and h in (1, 4, 7, 8, 10, 12):
                hard.append(f"{p} (H{h})")
        bits = []
        if good:
            bits.append("supportive: " + ", ".join(good))
        if hard:
            bits.append("testing: " + ", ".join(hard))
        return "; ".join(bits) or "quiet / mixed"
    except Exception:
        return ""


def _boundary(engine, a, b, cur):
    """The day the chapter changes, between sample dates a (still `cur`) and b."""
    lo, hi = a, b
    while (hi - lo).total_seconds() > 86400:
        mid = lo + (hi - lo) / 2
        if _level2(_dasha_str(engine, mid)) == cur:
            lo = mid
        else:
            hi = mid
    return hi


def _upcoming_windows(engine, today, months=24):
    """Sample the daśā monthly, then find each change to the DAY, and collapse into
    constant (mahā/antar) windows.

    The monthly sample alone put every boundary on the first sample after it — up to
    a month late — and the briefing calls these "real, computed dates". A bisection
    between the two samples that straddle a change costs five lookups and is exact."""
    windows, cur, start, prev = [], None, today, today
    for i in range(months + 1):
        d = _add_months(today, i)
        lvl = _level2(_dasha_str(engine, d))
        if lvl != cur:
            edge = _boundary(engine, prev, d, cur) if cur else d
            if cur:
                windows.append((start, edge, cur))
            cur, start = lvl, (edge if i else today)
        prev = d
    if cur:
        windows.append((start, _add_months(today, months), cur))
    return [w for w in windows if w[2]]


def timing_focus(engine, intent, today=None):
    """Return a grounded TIMING block for the Oracle briefing, or '' when not needed."""
    if engine is None or not isinstance(intent, dict):
        return ""
    today = today or datetime.now()
    td = _parse_date(intent.get("target_date"))
    qtype = (intent.get("question_type") or "").lower()
    topic = (intent.get("topic") or "").lower()
    is_timing = qtype in _TIMING_QTYPES or topic in _TIMING_TOPICS

    lines = []
    if td:
        # A specific date was asked about — read THAT day exactly.
        ds = _level2(_dasha_str(engine, td))
        sky = _sky_summary(engine, td)
        lines.append(f"THEY ASKED ABOUT A SPECIFIC DATE — {td:%d %b %Y}:")
        if ds:
            lines.append(f"  life-chapter running then: {ds}")
        if sky:
            lines.append(f"  the sky over their chart that day: {sky}")
        now_ds = _level2(_dasha_str(engine, today))
        if now_ds:
            lines.append(f"  (for contrast, today {today:%d %b %Y} they are in: {now_ds})")
        lines.append("  → Answer for THAT date specifically, grounded in the above.")
    elif is_timing:
        # No date given — surface the upcoming windows a person reasons in.
        wins = _upcoming_windows(engine, today, 24)
        if wins:
            lines.append(f"NO EXACT DATE GIVEN — the upcoming life-chapters (today = {today:%d %b %Y}); "
                         "answer with these REAL windows, not vague 'soon':")
            for a, b, ds in wins:
                lines.append(f"  {a:%d %b %Y} → {b:%d %b %Y}:  {ds}")
            lines.append("  → Point to the window(s) that best fit what they're asking, with the month/year.")

    if not lines:
        return ""
    return "=== TIMING FOCUS (real, computed dates) ===\n" + "\n".join(lines)
