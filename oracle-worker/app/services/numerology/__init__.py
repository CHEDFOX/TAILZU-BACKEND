"""
NUMEROLOGY — organized by system.

  core     — shared engine + raw tables: NumerologyEngine, CHALDEAN, PYTHAGOREAN,
             Lo Shu grid, compound-number meanings, reduce helpers, number compatibility.
  vedic    — Ank Jyotish: number->planet, Naisargika Maitri friendships, beej
             mantras + remedies, Chaldean name/compound numbers.  (was ank_jyotish)
  western  — Pythagorean: life path, expression, soul urge, personality, personal
             year, karmic debt, master numbers, pinnacles/challenges.  (was pythagorean)
  chinese  — Nine Star Ki: principal/monthly/annual stars + forecast.  (was nine_star_ki)

The system modules hold the tradition-specific READINGS; `core` holds the shared
computation primitives the engine composes from.
"""
from . import core, vedic, western, chinese

# Back-compat: keep the old tradition-named imports working.
ank_jyotish = vedic
pythagorean = western
nine_star_ki = chinese
