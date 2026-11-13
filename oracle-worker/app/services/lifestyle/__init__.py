"""
LIFESTYLE — time-period (today / now) practical guidance, per system.

Each module computes the *daily, now-dependent* prescriptions a tradition makes
— what to wear, the direction to face, the lucky number, the favourable hours,
the auspicious/inauspicious windows — grounded in the chart and the current
date/time. These feed the chat pipeline as data sections (see each system's
sections.py) and can back future "Today's edit" features.

  vedic      — weekday lord (colour/metal/direction/deity), gem to wear, Tara
               Bala (is today auspicious for you), Disha Shool, today's windows.
  western    — day ruler + planetary hour (Chaldean), Moon phase guidance,
               retrograde flags, colour/metal/herb/gem of the day.
  chinese    — favourable element → lucky colour/direction/number, today's
               element vs Day Master, the day's clash animal, Tai Sui direction.
  kp         — the ruling planets of NOW and what they favour.
  numerology — personal year/month/day, today's lucky number/colour/activity.

Every function is defensive: it returns a best-effort dict and never raises, so a
missing engine method degrades a field rather than breaking the chat turn.
"""
