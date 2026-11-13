"""
HORA-AWARE NOTIFICATIONS
Generates context-aware push notification content based on:
  1. Current planetary hora (which planet rules this hour)
  2. What that planet means for THIS specific user's chart
  3. What the user has been asking about (from memory)

Called by the notification cron job, not by the API directly.
"""

from datetime import datetime, timedelta
from typing import Dict

HORA_SEQUENCE = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"]

# Day lord (0=Monday)
DAY_LORDS = {
    0: "Moon", 1: "Mars", 2: "Mercury", 3: "Jupiter",
    4: "Venus", 5: "Saturn", 6: "Sun",
}

HORA_DURATIONS_MINUTES = 60  # Each hora is approximately 1 hour

PLANET_ACTIVITIES = {
    "Sun": {
        "best_for": "leadership decisions, meeting authority figures, government work, father-related matters",
        "avoid": "starting partnerships, being submissive, night activities",
        "energy": "confident, authoritative, visible",
        "notification_templates": [
            "This hour favors bold decisions. Step into your authority.",
            "The next 60 minutes carry Sun energy. Ideal for career moves.",
            "Right now favors leadership. Make that call you have been avoiding.",
            "Sun hora active. Government, authority, and visibility are amplified.",
        ],
    },
    "Moon": {
        "best_for": "emotional conversations, nurturing, travel, public dealings, mother",
        "avoid": "confrontation, aggressive decisions, legal matters",
        "energy": "receptive, intuitive, flowing",
        "notification_templates": [
            "Moon hora active. Trust your intuition right now.",
            "The next hour favors emotional conversations and connecting.",
            "Your intuitive sense is strongest right now. Listen to it.",
            "Moon energy is flowing. Good for travel and public matters.",
        ],
    },
    "Mars": {
        "best_for": "exercise, competition, surgery, property deals, courage",
        "avoid": "peace negotiations, delicate conversations, lending money",
        "energy": "aggressive, driven, physical",
        "notification_templates": [
            "Mars hora. Channel this energy into action, not arguments.",
            "High-energy hour ahead. Great for exercise and bold moves.",
            "Mars is ruling this hour. Property and competition favored.",
            "The next 60 minutes reward courage. Take the first step.",
        ],
    },
    "Mercury": {
        "best_for": "communication, writing, business deals, learning, trading",
        "avoid": "long-term commitments, emotional decisions, rest",
        "energy": "quick, analytical, communicative",
        "notification_templates": [
            "Mercury hora. Perfect for writing, calls, and business.",
            "Your communication is sharpest right now. Send that message.",
            "The next hour favors intellect. Study, trade, negotiate.",
            "Mercury energy active. Quick decisions work in your favor.",
        ],
    },
    "Jupiter": {
        "best_for": "spiritual practice, teaching, legal matters, children, finance",
        "avoid": "shortcuts, deception, trivial matters",
        "energy": "expansive, wise, fortunate",
        "notification_templates": [
            "Jupiter hora. The most auspicious hour of the day.",
            "Luck peaks in this hour. Start something meaningful.",
            "Jupiter energy active. Teaching, learning, and wisdom flow.",
            "The next 60 minutes carry grace. Use them wisely.",
        ],
    },
    "Venus": {
        "best_for": "love conversations, art, shopping, beauty, reconciliation",
        "avoid": "austerity, harsh words, arguments with partner",
        "energy": "harmonious, beautiful, pleasurable",
        "notification_templates": [
            "Venus hora. Love, beauty, and harmony are amplified.",
            "The next hour favors romance and reconciliation.",
            "Venus is active. Art, music, and beauty flow naturally.",
            "Perfect moment for that conversation about the heart.",
        ],
    },
    "Saturn": {
        "best_for": "discipline, long-term planning, organization, serving others",
        "avoid": "new beginnings, celebrations, taking risks",
        "energy": "structured, patient, grounding",
        "notification_templates": [
            "Saturn hora. Focus on structure and discipline.",
            "The next hour rewards patience and planning.",
            "Saturn energy active. Organize, plan, and build slowly.",
            "Use this hour for the hard work others avoid.",
        ],
    },
}


def get_current_hora(latitude: float = 28.6139, longitude: float = 77.209,
                     now: datetime = None, sunrise: float = None, sunset: float = None) -> Dict:
    """
    Which planetary hora is active at `now` — LOCAL time at the place whose
    sunrise and sunset are given (JyotishEngine.get_current_hora_info passes the
    chart's place, its local clock and its real sun times).

    Delegates to time_systems.hora_at, the one implementation. This used to count
    clock hours from a 06:00 sunrise on the server's own clock, and to step
    through the WEEKDAY order (Sun, Moon, Mars…) instead of the hora order (Sun,
    Venus, Mercury…), so after a Sun hora it named the Moon. With no arguments it
    keeps the old fallback: the server clock and a 06:00–18:00 day.
    """
    from .time_systems import hora_at
    now = now or datetime.now()
    h = hora_at(now, 6.0 if sunrise is None else sunrise, 18.0 if sunset is None else sunset)
    return {
        "hora_lord": h["lord"],
        "day_lord": h["day_lord"],
        "minutes_remaining": h["minutes_remaining"],
        "hora_info": PLANET_ACTIVITIES.get(h["lord"], {}),
        "is_day": h["is_day"],
        "start": h["start"],
        "end": h["end"],
        "timestamp": now.isoformat(),
    }


def generate_notification(engine=None, user_topics: list = None) -> Dict:
    """
    Generate a personalized push notification based on current hora
    and optionally the user's chart + topics of interest.
    """
    import random

    # The chart's own place and clock when we have the chart; the server's otherwise.
    hora = engine.get_current_hora_info() if engine is not None else get_current_hora()
    hora_lord = hora["hora_lord"]
    info = hora["hora_info"]

    # Base notification from templates
    templates = info.get("notification_templates", ["Check your cosmic alignment."])
    base_message = random.choice(templates)

    # Personalize if we have chart data
    personal_note = ""
    if engine:
        try:
            planets = engine.planets
            hora_planet_data = planets.get(hora_lord, {})
            hora_house = hora_planet_data.get("house", 0)

            if hora_house:
                house_notes = {
                    1: "This energy directly touches your sense of self.",
                    2: "This connects to your finances and family.",
                    3: "Your communication and courage are activated.",
                    4: "Home and emotional peace are in focus.",
                    5: "Creativity and romance are highlighted.",
                    6: "Health and daily routine need attention.",
                    7: "Partnerships and relationships are activated.",
                    8: "Deep transformation is at play.",
                    9: "Fortune and higher learning are favored.",
                    10: "Your career and public image are in focus.",
                    11: "Gains and social connections are amplified.",
                    12: "Spiritual growth and release are highlighted.",
                }
                personal_note = house_notes.get(hora_house, "")
        except Exception:
            pass

    # Connect to user's topics if available
    topic_hook = ""
    if user_topics:
        if hora_lord == "Venus" and "marriage" in user_topics:
            topic_hook = "This is especially relevant for what you have been asking about love."
        elif hora_lord == "Jupiter" and "career" in user_topics:
            topic_hook = "This connects to the career shifts we discussed."
        elif hora_lord == "Saturn" and "career" in user_topics:
            topic_hook = "Use this structured energy for the career planning ahead."
        elif hora_lord == "Moon" and "marriage" in user_topics:
            topic_hook = "Your emotional clarity right now affects your relationship path."

    # Build final notification
    title = hora_lord + " Hora Active"
    body = base_message
    if personal_note:
        body += " " + personal_note
    if topic_hook:
        body += " " + topic_hook

    return {
        "title": title,
        "body": body,
        "hora_lord": hora_lord,
        "best_for": info.get("best_for", ""),
        "avoid": info.get("avoid", ""),
        "minutes_remaining": hora["minutes_remaining"],
        "energy": info.get("energy", ""),
    }


def get_next_favorable_hora(target_planet: str, now: datetime = None,
                            sunrise: float = None, sunset: float = None) -> Dict:
    """When the next hora of `target_planet` begins, walking the real hora
    boundaries from `now` (LOCAL time at the place whose sun times are given).
    It stepped whole clock hours from a 06:00 sunrise, in the weekday order."""
    from .time_systems import hora_at
    now = now or datetime.now()
    sr = 6.0 if sunrise is None else sunrise
    ss = 18.0 if sunset is None else sunset
    t = now
    for _ in range(30):
        h = hora_at(t, sr, ss)
        t = t + timedelta(minutes=h["minutes_remaining"] + 1)
        if hora_at(t, sr, ss)["lord"] == target_planet:
            start = (t - timedelta(minutes=1)).replace(second=0, microsecond=0)
            return {
                "planet": target_planet,
                "starts_at": start.isoformat(),
                "hours_away": round((start - now).total_seconds() / 3600, 1),
            }
    return {"planet": target_planet, "starts_at": "unknown", "hours_away": -1}
