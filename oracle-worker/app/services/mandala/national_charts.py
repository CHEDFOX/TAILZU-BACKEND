"""
MUNDANE ASTROLOGY — NATIONAL FOUNDATION CHARTS DATABASE
Verified birth data for nations worldwide.

Sources:
- B.V. Raman: "Mundane Astrology" (1982)
- Nicholas Campion: "The Book of World Horoscopes" (1999)
- SAMVA (Systems Approach to Mundane Vedic Astrology)
- Deborah Houlding: skyscript.co.uk/mundane.html
- Historical records

Time notes:
- Times are LOCAL time at the capital unless noted UTC
- Where exact time is unknown, 00:00 midnight is used (ascendant unreliable)
- "rectified" = time rectified by mundane astrologers from events
"""

from datetime import datetime
from typing import Dict, List, Optional

# ── NATIONAL CHART DATA ──────────────────────────────────────────────────────
# Format: 'key': {
#   name, datetime (local), utc_offset, lat, lon, capital,
#   notes (source/reliability), ascendant_sign (if known)
# }

NATIONAL_CHARTS = {

    # ── SOUTH ASIA ────────────────────────────────────────────────────────────
    'india': {
        'name': 'India',
        'date': '1947-08-15',
        'time': '00:00',
        'utc_offset': 5.5,
        'lat': 28.6139,
        'lon': 77.2090,
        'capital': 'New Delhi',
        'ascendant_sign': 'Taurus',
        'notes': 'Time chosen by Pt. Surya Narayan Vyas for Taurus lagna at Abhijit muhurta. Most widely used by Vedic astrologers. B.V. Raman confirmed.',
        'region': 'South Asia',
        'current_vd_dasha': 'Mars (2025-2032)',
    },
    'pakistan': {
        'name': 'Pakistan',
        'date': '1947-08-14',
        'time': '09:30',
        'utc_offset': 5.0,
        'lat': 24.8607,
        'lon': 67.0011,
        'capital': 'Karachi (founding)',
        'ascendant_sign': 'Virgo',
        'notes': 'Independence declared at 9:30 AM Karachi. Campion. Generally accepted.',
        'region': 'South Asia',
    },
    'bangladesh': {
        'name': 'Bangladesh',
        'date': '1971-03-26',
        'time': '00:01',
        'utc_offset': 6.0,
        'lat': 23.8103,
        'lon': 90.4125,
        'capital': 'Dhaka',
        'ascendant_sign': 'Scorpio',
        'notes': 'Declaration of independence midnight 26 March 1971. Campion.',
        'region': 'South Asia',
    },
    'sri_lanka': {
        'name': 'Sri Lanka',
        'date': '1948-02-04',
        'time': '00:00',
        'utc_offset': 5.5,
        'lat': 6.9271,
        'lon': 79.8612,
        'capital': 'Colombo',
        'notes': 'Independence from Britain. Campion.',
        'region': 'South Asia',
    },
    'nepal': {
        'name': 'Nepal',
        'date': '2008-05-28',
        'time': '20:15',
        'utc_offset': 5.75,
        'lat': 27.7172,
        'lon': 85.3240,
        'capital': 'Kathmandu',
        'notes': 'Federal Democratic Republic declared. Older kingdom chart: 1768 but republic chart more relevant.',
        'region': 'South Asia',
    },
    'afghanistan': {
        'name': 'Afghanistan',
        'date': '1919-08-19',
        'time': '00:00',
        'utc_offset': 4.5,
        'lat': 34.5289,
        'lon': 69.1723,
        'capital': 'Kabul',
        'notes': 'Independence from Britain. Campion.',
        'region': 'South Asia',
    },

    # ── EAST ASIA ─────────────────────────────────────────────────────────────
    'china': {
        'name': "China (PRC)",
        'date': '1949-10-01',
        'time': '15:15',
        'utc_offset': 8.0,
        'lat': 39.9042,
        'lon': 116.4074,
        'capital': 'Beijing',
        'ascendant_sign': 'Capricorn',
        'notes': 'Mao proclaimed PRC from Tiananmen at 15:15. Widely used by Vedic mundane astrologers. Campion, SAMVA.',
        'region': 'East Asia',
    },
    'japan': {
        'name': 'Japan',
        'date': '1947-05-03',
        'time': '00:00',
        'utc_offset': 9.0,
        'lat': 35.6762,
        'lon': 139.6503,
        'capital': 'Tokyo',
        'notes': 'Post-war constitution enacted. Modern Japan chart. Campion.',
        'region': 'East Asia',
    },
    'south_korea': {
        'name': 'South Korea',
        'date': '1948-08-15',
        'time': '00:00',
        'utc_offset': 9.0,
        'lat': 37.5665,
        'lon': 126.9780,
        'capital': 'Seoul',
        'notes': 'Republic of Korea established. Campion.',
        'region': 'East Asia',
    },
    'north_korea': {
        'name': 'North Korea',
        'date': '1948-09-09',
        'time': '00:00',
        'utc_offset': 9.0,
        'lat': 39.0392,
        'lon': 125.7625,
        'capital': 'Pyongyang',
        'notes': 'DPRK established. Campion.',
        'region': 'East Asia',
    },
    'taiwan': {
        'name': 'Taiwan (ROC)',
        'date': '1912-01-01',
        'time': '00:00',
        'utc_offset': 8.0,
        'lat': 25.0330,
        'lon': 121.5654,
        'capital': 'Taipei',
        'notes': 'Republic of China founded. Taiwan uses this chart. Campion.',
        'region': 'East Asia',
    },
    'mongolia': {
        'name': 'Mongolia',
        'date': '1921-07-11',
        'time': '00:00',
        'utc_offset': 8.0,
        'lat': 47.8864,
        'lon': 106.9057,
        'capital': 'Ulaanbaatar',
        'notes': 'Independence from China. Campion.',
        'region': 'East Asia',
    },

    # ── SOUTHEAST ASIA ────────────────────────────────────────────────────────
    'indonesia': {
        'name': 'Indonesia',
        'date': '1945-08-17',
        'time': '10:00',
        'utc_offset': 7.0,
        'lat': -6.2088,
        'lon': 106.8456,
        'capital': 'Jakarta',
        'notes': 'Sukarno declared independence 10 AM Jakarta. Campion.',
        'region': 'Southeast Asia',
    },
    'vietnam': {
        'name': 'Vietnam',
        'date': '1945-09-02',
        'time': '14:00',
        'utc_offset': 7.0,
        'lat': 21.0285,
        'lon': 105.8542,
        'capital': 'Hanoi',
        'notes': 'Ho Chi Minh declared independence 2 PM Hanoi. Campion.',
        'region': 'Southeast Asia',
    },
    'thailand': {
        'name': 'Thailand',
        'date': '1932-06-24',
        'time': '06:00',
        'utc_offset': 7.0,
        'lat': 13.7563,
        'lon': 100.5018,
        'capital': 'Bangkok',
        'notes': 'Constitutional monarchy established. Campion.',
        'region': 'Southeast Asia',
    },
    'malaysia': {
        'name': 'Malaysia',
        'date': '1957-08-31',
        'time': '00:00',
        'utc_offset': 8.0,
        'lat': 3.1390,
        'lon': 101.6869,
        'capital': 'Kuala Lumpur',
        'notes': 'Independence from Britain (Malaya). Campion.',
        'region': 'Southeast Asia',
    },
    'singapore': {
        'name': 'Singapore',
        'date': '1965-08-09',
        'time': '00:00',
        'utc_offset': 8.0,
        'lat': 1.3521,
        'lon': 103.8198,
        'capital': 'Singapore',
        'notes': 'Independence from Malaysia. Campion.',
        'region': 'Southeast Asia',
    },
    'philippines': {
        'name': 'Philippines',
        'date': '1946-07-04',
        'time': '09:15',
        'utc_offset': 8.0,
        'lat': 14.5995,
        'lon': 120.9842,
        'capital': 'Manila',
        'notes': 'Independence from USA. Campion.',
        'region': 'Southeast Asia',
    },
    'myanmar': {
        'name': 'Myanmar (Burma)',
        'date': '1948-01-04',
        'time': '04:20',
        'utc_offset': 6.5,
        'lat': 16.8661,
        'lon': 96.1951,
        'capital': 'Yangon',
        'notes': 'Time 4:20 AM chosen by Burmese astrologers for auspicious lagna. Campion.',
        'region': 'Southeast Asia',
    },

    # ── WEST ASIA / MIDDLE EAST ───────────────────────────────────────────────
    'israel': {
        'name': 'Israel',
        'date': '1948-05-14',
        'time': '16:00',
        'utc_offset': 2.0,
        'lat': 32.0853,
        'lon': 34.7818,
        'capital': 'Tel Aviv (founding)',
        'ascendant_sign': 'Scorpio',
        'notes': 'Declaration at 4 PM before Shabbat. Campion. Widely used.',
        'region': 'Middle East',
    },
    'iran': {
        'name': 'Iran (Islamic Republic)',
        'date': '1979-04-01',
        'time': '15:00',
        'utc_offset': 3.5,
        'lat': 35.6892,
        'lon': 51.3890,
        'capital': 'Tehran',
        'ascendant_sign': 'Cancer',
        'notes': 'Islamic Republic proclaimed after referendum. 3 PM Tehran. Campion.',
        'region': 'Middle East',
    },
    'saudi_arabia': {
        'name': 'Saudi Arabia',
        'date': '1932-09-23',
        'time': '00:00',
        'utc_offset': 3.0,
        'lat': 24.6877,
        'lon': 46.7219,
        'capital': 'Riyadh',
        'notes': 'Kingdom unified by Ibn Saud. Campion.',
        'region': 'Middle East',
    },
    'uae': {
        'name': 'United Arab Emirates',
        'date': '1971-12-02',
        'time': '00:00',
        'utc_offset': 4.0,
        'lat': 24.4539,
        'lon': 54.3773,
        'capital': 'Abu Dhabi',
        'notes': 'Federation formed. Campion.',
        'region': 'Middle East',
    },
    'iraq': {
        'name': 'Iraq',
        'date': '1932-10-03',
        'time': '00:00',
        'utc_offset': 3.0,
        'lat': 33.3152,
        'lon': 44.3661,
        'capital': 'Baghdad',
        'notes': 'Independence from Britain. Campion.',
        'region': 'Middle East',
    },
    'syria': {
        'name': 'Syria',
        'date': '1946-04-17',
        'time': '00:00',
        'utc_offset': 2.0,
        'lat': 33.5138,
        'lon': 36.2765,
        'capital': 'Damascus',
        'notes': 'French mandate ended. Campion.',
        'region': 'Middle East',
    },
    'turkey': {
        'name': 'Turkey',
        'date': '1923-10-29',
        'time': '20:30',
        'utc_offset': 3.0,
        'lat': 39.9334,
        'lon': 32.8597,
        'capital': 'Ankara',
        'notes': 'Republic proclaimed 8:30 PM Ankara. Campion.',
        'region': 'Middle East',
    },
    'jordan': {
        'name': 'Jordan',
        'date': '1946-05-25',
        'time': '00:00',
        'utc_offset': 2.0,
        'lat': 31.9554,
        'lon': 35.9455,
        'capital': 'Amman',
        'notes': 'Independence from Britain. Campion.',
        'region': 'Middle East',
    },
    'qatar': {
        'name': 'Qatar',
        'date': '1971-09-03',
        'time': '00:00',
        'utc_offset': 3.0,
        'lat': 25.2854,
        'lon': 51.5310,
        'capital': 'Doha',
        'notes': 'Independence from Britain. Campion.',
        'region': 'Middle East',
    },
    'kuwait': {
        'name': 'Kuwait',
        'date': '1961-06-19',
        'time': '00:00',
        'utc_offset': 3.0,
        'lat': 29.3759,
        'lon': 47.9774,
        'capital': 'Kuwait City',
        'notes': 'Independence from Britain. Campion.',
        'region': 'Middle East',
    },

    # ── CENTRAL ASIA ──────────────────────────────────────────────────────────
    'kazakhstan': {
        'name': 'Kazakhstan',
        'date': '1991-12-16',
        'time': '00:00',
        'utc_offset': 6.0,
        'lat': 51.1801,
        'lon': 71.4460,
        'capital': 'Astana',
        'notes': 'Independence from USSR. Campion.',
        'region': 'Central Asia',
    },
    'uzbekistan': {
        'name': 'Uzbekistan',
        'date': '1991-09-01',
        'time': '00:00',
        'utc_offset': 5.0,
        'lat': 41.2995,
        'lon': 69.2401,
        'capital': 'Tashkent',
        'notes': 'Independence from USSR.',
        'region': 'Central Asia',
    },

    # ── EUROPE ────────────────────────────────────────────────────────────────
    'uk': {
        'name': 'United Kingdom',
        'date': '1801-01-01',
        'time': '00:00',
        'utc_offset': 0.0,
        'lat': 51.5074,
        'lon': -0.1278,
        'capital': 'London',
        'ascendant_sign': 'Libra',
        'notes': 'Act of Union (Great Britain + Ireland). Most used UK chart. Campion.',
        'region': 'Europe',
    },
    'germany': {
        'name': 'Germany (Reunified)',
        'date': '1990-10-03',
        'time': '00:00',
        'utc_offset': 2.0,
        'lat': 52.5200,
        'lon': 13.4050,
        'capital': 'Berlin',
        'ascendant_sign': 'Cancer',
        'notes': 'German Reunification midnight. Most relevant modern chart.',
        'region': 'Europe',
    },
    'france': {
        'name': 'France (Fifth Republic)',
        'date': '1958-10-05',
        'time': '00:00',
        'utc_offset': 2.0,
        'lat': 48.8566,
        'lon': 2.3522,
        'capital': 'Paris',
        'notes': 'Fifth Republic constitution. Campion. (Revolution chart 1789 also used for deeper analysis.)',
        'region': 'Europe',
    },
    'russia': {
        'name': 'Russia (Federation)',
        'date': '1991-12-25',
        'time': '19:38',
        'utc_offset': 3.0,
        'lat': 55.7558,
        'lon': 37.6173,
        'capital': 'Moscow',
        'notes': 'USSR dissolved, Russia declared sovereign. Gorbachev resigned 19:38 Moscow. Campion.',
        'region': 'Europe',
    },
    'ukraine': {
        'name': 'Ukraine',
        'date': '1991-08-24',
        'time': '18:00',
        'utc_offset': 3.0,
        'lat': 50.4501,
        'lon': 30.5234,
        'capital': 'Kyiv',
        'notes': 'Independence declared 6 PM Kyiv. Campion.',
        'region': 'Europe',
    },
    'italy': {
        'name': 'Italy (Republic)',
        'date': '1946-06-10',
        'time': '00:00',
        'utc_offset': 2.0,
        'lat': 41.9028,
        'lon': 12.4964,
        'capital': 'Rome',
        'notes': 'Republic proclaimed after referendum. Campion.',
        'region': 'Europe',
    },
    'spain': {
        'name': 'Spain (Democracy)',
        'date': '1978-12-29',
        'time': '00:00',
        'utc_offset': 1.0,
        'lat': 40.4168,
        'lon': -3.7038,
        'capital': 'Madrid',
        'notes': 'Constitution ratified. Modern democratic Spain. Campion.',
        'region': 'Europe',
    },
    'poland': {
        'name': 'Poland (Third Republic)',
        'date': '1989-12-31',
        'time': '00:00',
        'utc_offset': 1.0,
        'lat': 52.2297,
        'lon': 21.0122,
        'capital': 'Warsaw',
        'notes': 'Third Polish Republic. Campion.',
        'region': 'Europe',
    },
    'sweden': {
        'name': 'Sweden',
        'date': '1523-06-06',
        'time': '12:00',
        'utc_offset': 1.0,
        'lat': 59.3293,
        'lon': 18.0686,
        'capital': 'Stockholm',
        'notes': 'Gustav Vasa crowned King. National Day. Noon assumed.',
        'region': 'Europe',
    },
    'switzerland': {
        'name': 'Switzerland',
        'date': '1291-08-01',
        'time': '00:00',
        'utc_offset': 1.0,
        'lat': 46.9480,
        'lon': 7.4474,
        'capital': 'Bern',
        'notes': 'Federal Charter. Ancient but used. Campion.',
        'region': 'Europe',
    },
    'netherlands': {
        'name': 'Netherlands',
        'date': '1815-03-29',
        'time': '00:00',
        'utc_offset': 0.0,
        'lat': 52.3676,
        'lon': 4.9041,
        'capital': 'Amsterdam',
        'notes': 'Kingdom of Netherlands constituted. Campion.',
        'region': 'Europe',
    },
    'greece': {
        'name': 'Greece',
        'date': '1974-07-24',
        'time': '04:00',
        'utc_offset': 3.0,
        'lat': 37.9838,
        'lon': 23.7275,
        'capital': 'Athens',
        'notes': 'Democracy restored. 4 AM Athens. Campion.',
        'region': 'Europe',
    },
    'serbia': {
        'name': 'Serbia',
        'date': '2006-06-05',
        'time': '15:00',
        'utc_offset': 2.0,
        'lat': 44.8176,
        'lon': 20.4633,
        'capital': 'Belgrade',
        'notes': 'Independence from Serbia-Montenegro.',
        'region': 'Europe',
    },

    # ── NORTH AMERICA ─────────────────────────────────────────────────────────
    'usa': {
        'name': 'United States of America',
        'date': '1776-07-04',
        'time': '17:10',
        'utc_offset': -5.0,
        'lat': 39.9526,
        'lon': -75.1652,
        'capital': 'Philadelphia (signing)',
        'ascendant_sign': 'Sagittarius',
        'notes': 'Sibley chart. 5:10 PM Philadelphia. Most widely used by Vedic mundane astrologers. B.V. Raman.',
        'region': 'North America',
    },
    'canada': {
        'name': 'Canada',
        'date': '1867-07-01',
        'time': '00:00',
        'utc_offset': -5.0,
        'lat': 45.4215,
        'lon': -75.6972,
        'capital': 'Ottawa',
        'notes': 'Confederation. Campion.',
        'region': 'North America',
    },
    'mexico': {
        'name': 'Mexico',
        'date': '1821-09-28',
        'time': '00:00',
        'utc_offset': -6.0,
        'lat': 19.4326,
        'lon': -99.1332,
        'capital': 'Mexico City',
        'notes': 'Independence from Spain. Campion.',
        'region': 'North America',
    },
    'cuba': {
        'name': 'Cuba',
        'date': '1959-01-08',
        'time': '00:00',
        'utc_offset': -5.0,
        'lat': 23.1136,
        'lon': -82.3666,
        'capital': 'Havana',
        'notes': "Castro's revolution triumph. Campion.",
        'region': 'North America',
    },

    # ── SOUTH AMERICA ─────────────────────────────────────────────────────────
    'brazil': {
        'name': 'Brazil',
        'date': '1822-09-07',
        'time': '16:30',
        'utc_offset': -3.0,
        'lat': -23.5505,
        'lon': -46.6333,
        'capital': 'São Paulo (proclamation site)',
        'notes': 'Independence proclaimed by Pedro I. Campion. 4:30 PM.',
        'region': 'South America',
    },
    'argentina': {
        'name': 'Argentina',
        'date': '1816-07-09',
        'time': '00:00',
        'utc_offset': -4.0,
        'lat': -34.6037,
        'lon': -58.3816,
        'capital': 'Buenos Aires',
        'notes': 'Independence declared. Campion.',
        'region': 'South America',
    },
    'colombia': {
        'name': 'Colombia',
        'date': '1819-12-17',
        'time': '00:00',
        'utc_offset': -5.0,
        'lat': 4.7110,
        'lon': -74.0721,
        'capital': 'Bogotá',
        'notes': 'Gran Colombia founded by Bolívar. Campion.',
        'region': 'South America',
    },
    'venezuela': {
        'name': 'Venezuela',
        'date': '1811-07-05',
        'time': '00:00',
        'utc_offset': -4.0,
        'lat': 10.4806,
        'lon': -66.9036,
        'capital': 'Caracas',
        'notes': 'Independence declared. Campion.',
        'region': 'South America',
    },
    'chile': {
        'name': 'Chile',
        'date': '1818-02-12',
        'time': '00:00',
        'utc_offset': -4.0,
        'lat': -33.4489,
        'lon': -70.6693,
        'capital': 'Santiago',
        'notes': 'Independence from Spain. Campion.',
        'region': 'South America',
    },
    'peru': {
        'name': 'Peru',
        'date': '1821-07-28',
        'time': '00:00',
        'utc_offset': -5.0,
        'lat': -12.0464,
        'lon': -77.0428,
        'capital': 'Lima',
        'notes': 'Independence declared by San Martín. Campion.',
        'region': 'South America',
    },

    # ── AFRICA ────────────────────────────────────────────────────────────────
    'south_africa': {
        'name': 'South Africa',
        'date': '1994-04-27',
        'time': '00:00',
        'utc_offset': 2.0,
        'lat': -25.7479,
        'lon': 28.2293,
        'capital': 'Pretoria',
        'notes': 'First democratic election / end of apartheid. This chart used for modern SA. Campion.',
        'region': 'Africa',
    },
    'nigeria': {
        'name': 'Nigeria',
        'date': '1960-10-01',
        'time': '00:00',
        'utc_offset': 1.0,
        'lat': 9.0765,
        'lon': 7.3986,
        'capital': 'Abuja',
        'notes': 'Independence from Britain. Campion.',
        'region': 'Africa',
    },
    'egypt': {
        'name': 'Egypt',
        'date': '1953-06-18',
        'time': '23:30',
        'utc_offset': 2.0,
        'lat': 30.0444,
        'lon': 31.2357,
        'capital': 'Cairo',
        'notes': 'Republic proclaimed. Campion.',
        'region': 'Africa',
    },
    'ethiopia': {
        'name': 'Ethiopia',
        'date': '1941-05-05',
        'time': '00:00',
        'utc_offset': 3.0,
        'lat': 9.0250,
        'lon': 38.7469,
        'capital': 'Addis Ababa',
        'notes': 'Liberation from Italian occupation. Campion.',
        'region': 'Africa',
    },
    'kenya': {
        'name': 'Kenya',
        'date': '1963-12-12',
        'time': '00:00',
        'utc_offset': 3.0,
        'lat': -1.2921,
        'lon': 36.8219,
        'capital': 'Nairobi',
        'notes': 'Independence from Britain. Campion.',
        'region': 'Africa',
    },
    'ghana': {
        'name': 'Ghana',
        'date': '1957-03-06',
        'time': '00:00',
        'utc_offset': 0.0,
        'lat': 5.6037,
        'lon': -0.1870,
        'capital': 'Accra',
        'notes': 'Independence. First sub-Saharan African country. Campion.',
        'region': 'Africa',
    },
    'morocco': {
        'name': 'Morocco',
        'date': '1956-03-02',
        'time': '00:00',
        'utc_offset': 0.0,
        'lat': 33.9716,
        'lon': -6.8498,
        'capital': 'Rabat',
        'notes': 'Independence from France. Campion.',
        'region': 'Africa',
    },
    'algeria': {
        'name': 'Algeria',
        'date': '1962-07-05',
        'time': '00:00',
        'utc_offset': 1.0,
        'lat': 36.7372,
        'lon': 3.0865,
        'capital': 'Algiers',
        'notes': 'Independence from France. Campion.',
        'region': 'Africa',
    },
    'tanzania': {
        'name': 'Tanzania',
        'date': '1964-04-26',
        'time': '00:00',
        'utc_offset': 3.0,
        'lat': -6.7924,
        'lon': 39.2083,
        'capital': 'Dar es Salaam',
        'notes': 'Tanzania formed from Tanganyika and Zanzibar. Campion.',
        'region': 'Africa',
    },

    # ── OCEANIA ───────────────────────────────────────────────────────────────
    'australia': {
        'name': 'Australia',
        'date': '1901-01-01',
        'time': '13:35',
        'utc_offset': 10.0,
        'lat': -33.8688,
        'lon': 151.2093,
        'capital': 'Sydney (founding)',
        'notes': 'Federation proclaimed. 1:35 PM Sydney. Campion. Widely used.',
        'region': 'Oceania',
    },
    'new_zealand': {
        'name': 'New Zealand',
        'date': '1907-09-26',
        'time': '00:00',
        'utc_offset': 12.0,
        'lat': -41.2865,
        'lon': 174.7762,
        'capital': 'Wellington',
        'notes': 'Dominion status. Campion.',
        'region': 'Oceania',
    },

    # ── INTERNATIONAL ORGANISATIONS ───────────────────────────────────────────
    'un': {
        'name': 'United Nations',
        'date': '1945-10-24',
        'time': '16:45',
        'utc_offset': -5.0,
        'lat': 40.7128,
        'lon': -74.0060,
        'capital': 'New York',
        'notes': 'UN Charter entered into force. 4:45 PM New York. Campion.',
        'region': 'International',
    },
    'eu': {
        'name': 'European Union',
        'date': '1993-11-01',
        'time': '00:00',
        'utc_offset': 1.0,
        'lat': 50.8503,
        'lon': 4.3517,
        'capital': 'Brussels',
        'notes': 'Maastricht Treaty entered into force.',
        'region': 'International',
    },
}


# ── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

def get_country(key: str) -> Optional[Dict]:
    """Get a national chart entry by key."""
    return NATIONAL_CHARTS.get(key.lower().replace(' ', '_'))


def get_all_countries() -> List[str]:
    """Return all country keys."""
    return list(NATIONAL_CHARTS.keys())


def get_countries_by_region(region: str) -> List[Dict]:
    """Get all countries in a region."""
    return [v for v in NATIONAL_CHARTS.values() if v.get('region', '').lower() == region.lower()]


def detect_country_from_text(text: str) -> Optional[str]:
    """
    Detect which country a user is asking about from natural language.
    Returns the country key or None.
    """
    text_lower = text.lower()

    # Direct name matches — order matters (longer names first)
    name_map = {
        'united states': 'usa', 'america': 'usa', 'us ': 'usa', 'u.s.': 'usa',
        'united kingdom': 'uk', 'britain': 'uk', 'england': 'uk', 'great britain': 'uk',
        'people\'s republic of china': 'china', 'prc': 'china',
        'south korea': 'south_korea', 'north korea': 'north_korea',
        'saudi': 'saudi_arabia', 'ksa': 'saudi_arabia',
        'uae': 'uae', 'emirates': 'uae', 'dubai': 'uae', 'abu dhabi': 'uae',
        'new zealand': 'new_zealand',
        'south africa': 'south_africa',
        'sri lanka': 'sri_lanka',
        'european union': 'eu',
        'india': 'india', 'bharat': 'india', 'hindustan': 'india',
        'pakistan': 'pakistan', 'china': 'china', 'japan': 'japan',
        'russia': 'russia', 'ukraine': 'ukraine', 'israel': 'israel',
        'iran': 'iran', 'iraq': 'iraq', 'turkey': 'turkey',
        'germany': 'germany', 'france': 'france', 'italy': 'italy',
        'spain': 'spain', 'australia': 'australia', 'brazil': 'brazil',
        'canada': 'canada', 'mexico': 'mexico', 'indonesia': 'indonesia',
        'nigeria': 'nigeria', 'egypt': 'egypt', 'kenya': 'kenya',
        'singapore': 'singapore', 'malaysia': 'malaysia', 'thailand': 'thailand',
        'vietnam': 'vietnam', 'philippines': 'philippines',
        'bangladesh': 'bangladesh', 'nepal': 'nepal', 'myanmar': 'myanmar',
        'afghanistan': 'afghanistan', 'taiwan': 'taiwan',
        'argentina': 'argentina', 'colombia': 'colombia', 'chile': 'chile',
        'venezuela': 'venezuela', 'peru': 'peru',
        'ghana': 'ghana', 'ethiopia': 'ethiopia', 'tanzania': 'tanzania',
        'morocco': 'morocco', 'algeria': 'algeria',
        'jordan': 'jordan', 'qatar': 'qatar', 'kuwait': 'kuwait',
        'kazakhstan': 'kazakhstan', 'mongolia': 'mongolia',
        'cuba': 'cuba', 'greece': 'greece', 'poland': 'poland',
        'sweden': 'sweden', 'netherlands': 'netherlands', 'switzerland': 'switzerland',
        'united nations': 'un', 'un ': 'un',

        # Indian states
        'rajasthan': 'rajasthan', 'maharashtra': 'maharashtra', 'gujarat': 'gujarat',
        'karnataka': 'karnataka', 'tamil nadu': 'tamil_nadu', 'kerala': 'kerala',
        'uttar pradesh': 'uttar_pradesh', 'west bengal': 'west_bengal',
        'punjab state': 'punjab', 'haryana': 'haryana', 'madhya pradesh': 'madhya_pradesh',
        'andhra pradesh': 'andhra_pradesh', 'telangana': 'telangana',
        'bihar': 'bihar', 'odisha': 'odisha', 'assam': 'assam',
        'jharkhand': 'jharkhand', 'chhattisgarh': 'chhattisgarh',
        'uttarakhand': 'uttarakhand', 'goa state': 'goa',
        'himachal': 'himachal_pradesh', 'jammu': 'jammu_kashmir', 'kashmir': 'jammu_kashmir',


    # ══════════════════════════════════════════════════════════════════════════
    # INDIAN STATES — Formation dates (States Reorganisation Act 1956 + later)
    # ══════════════════════════════════════════════════════════════════════════

    'rajasthan': {
        'name': 'Rajasthan', 'date': '1949-03-30', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 26.91, 'lon': 75.79, 'capital': 'Jaipur', 'type': 'state',
        'notes': 'United Rajputana states merged. Capital Jaipur.',
        'region': 'Indian State',
    },
    'maharashtra': {
        'name': 'Maharashtra', 'date': '1960-05-01', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 19.07, 'lon': 72.88, 'capital': 'Mumbai', 'type': 'state',
        'notes': 'Formed from Bombay State. Maharashtra Day.',
        'region': 'Indian State',
    },
    'gujarat': {
        'name': 'Gujarat', 'date': '1960-05-01', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 23.02, 'lon': 72.57, 'capital': 'Ahmedabad (then)', 'type': 'state',
        'notes': 'Formed from Bombay State. Gujarat Day.',
        'region': 'Indian State',
    },
    'karnataka': {
        'name': 'Karnataka', 'date': '1956-11-01', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 12.97, 'lon': 77.59, 'capital': 'Bangalore', 'type': 'state',
        'notes': 'Formed as Mysore State under States Reorganisation. Renamed Karnataka 1973.',
        'region': 'Indian State',
    },
    'tamil_nadu': {
        'name': 'Tamil Nadu', 'date': '1969-01-14', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 13.08, 'lon': 80.27, 'capital': 'Chennai', 'type': 'state',
        'notes': 'Renamed from Madras State on Pongal day 1969.',
        'region': 'Indian State',
    },
    'kerala': {
        'name': 'Kerala', 'date': '1956-11-01', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 8.52, 'lon': 76.94, 'capital': 'Thiruvananthapuram', 'type': 'state',
        'notes': 'Formed under States Reorganisation Act. Kerala Piravi.',
        'region': 'Indian State',
    },
    'uttar_pradesh': {
        'name': 'Uttar Pradesh', 'date': '1950-01-26', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 26.85, 'lon': 80.95, 'capital': 'Lucknow', 'type': 'state',
        'notes': 'United Provinces renamed. Republic Day.',
        'region': 'Indian State',
    },
    'west_bengal': {
        'name': 'West Bengal', 'date': '1950-01-26', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 22.57, 'lon': 88.36, 'capital': 'Kolkata', 'type': 'state',
        'notes': 'Republic Day formation.',
        'region': 'Indian State',
    },
    'punjab': {
        'name': 'Punjab', 'date': '1966-11-01', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 30.73, 'lon': 76.78, 'capital': 'Chandigarh', 'type': 'state',
        'notes': 'Reorganised — Haryana separated. Punjabi Suba.',
        'region': 'Indian State',
    },
    'haryana': {
        'name': 'Haryana', 'date': '1966-11-01', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 28.67, 'lon': 77.42, 'capital': 'Chandigarh (shared)', 'type': 'state',
        'notes': 'Separated from Punjab. Haryana Day.',
        'region': 'Indian State',
    },
    'madhya_pradesh': {
        'name': 'Madhya Pradesh', 'date': '1956-11-01', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 23.26, 'lon': 77.41, 'capital': 'Bhopal', 'type': 'state',
        'notes': 'States Reorganisation. Madhya Pradesh Diwas.',
        'region': 'Indian State',
    },
    'andhra_pradesh': {
        'name': 'Andhra Pradesh', 'date': '2014-06-02', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 16.51, 'lon': 80.65, 'capital': 'Amaravati', 'type': 'state',
        'notes': 'Reorganised after Telangana separation. New AP.',
        'region': 'Indian State',
    },
    'telangana': {
        'name': 'Telangana', 'date': '2014-06-02', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 17.38, 'lon': 78.49, 'capital': 'Hyderabad', 'type': 'state',
        'notes': 'Separated from Andhra Pradesh. 29th state.',
        'region': 'Indian State',
    },
    'bihar': {
        'name': 'Bihar', 'date': '1950-01-26', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 25.61, 'lon': 85.14, 'capital': 'Patna', 'type': 'state',
        'notes': 'Republic Day formation. Bihar Diwas March 22.',
        'region': 'Indian State',
    },
    'odisha': {
        'name': 'Odisha', 'date': '1936-04-01', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 20.27, 'lon': 85.84, 'capital': 'Bhubaneswar', 'type': 'state',
        'notes': 'First state formed on linguistic basis. Utkal Diwas.',
        'region': 'Indian State',
    },
    'assam': {
        'name': 'Assam', 'date': '1950-01-26', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 26.14, 'lon': 91.74, 'capital': 'Dispur', 'type': 'state',
        'notes': 'Republic Day formation.',
        'region': 'Indian State',
    },
    'jharkhand': {
        'name': 'Jharkhand', 'date': '2000-11-15', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 23.34, 'lon': 85.31, 'capital': 'Ranchi', 'type': 'state',
        'notes': 'Carved from Bihar. Jharkhand Foundation Day.',
        'region': 'Indian State',
    },
    'chhattisgarh': {
        'name': 'Chhattisgarh', 'date': '2000-11-01', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 21.25, 'lon': 81.63, 'capital': 'Raipur', 'type': 'state',
        'notes': 'Carved from Madhya Pradesh.',
        'region': 'Indian State',
    },
    'uttarakhand': {
        'name': 'Uttarakhand', 'date': '2000-11-09', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 30.32, 'lon': 78.03, 'capital': 'Dehradun', 'type': 'state',
        'notes': 'Carved from UP. Originally Uttaranchal.',
        'region': 'Indian State',
    },
    'goa': {
        'name': 'Goa', 'date': '1961-12-19', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 15.50, 'lon': 73.83, 'capital': 'Panaji', 'type': 'state',
        'notes': 'Liberation from Portugal. Goa Liberation Day.',
        'region': 'Indian State',
    },
    'himachal_pradesh': {
        'name': 'Himachal Pradesh', 'date': '1971-01-25', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 31.10, 'lon': 77.17, 'capital': 'Shimla', 'type': 'state',
        'notes': 'Full statehood. HP Statehood Day.',
        'region': 'Indian State',
    },
    'jammu_kashmir': {
        'name': 'Jammu & Kashmir', 'date': '2019-10-31', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 34.09, 'lon': 74.80, 'capital': 'Srinagar/Jammu', 'type': 'state',
        'notes': 'Union Territory status. Article 370 abrogated.',
        'region': 'Indian State',
    },

    # ══════════════════════════════════════════════════════════════════════════
    # MAJOR CITY FOUNDATION CHARTS
    # ══════════════════════════════════════════════════════════════════════════

    'london_city': {
        'name': 'London', 'date': '1066-12-25', 'time': '12:00', 'utc_offset': 0.0,
        'lat': 51.51, 'lon': -0.13, 'capital': 'London', 'type': 'city',
        'notes': 'William the Conqueror coronation. Traditional London chart. Noon assumed.',
        'region': 'City',
    },
    'new_york_city': {
        'name': 'New York City', 'date': '1653-02-02', 'time': '12:00', 'utc_offset': -5.0,
        'lat': 40.71, 'lon': -74.01, 'capital': 'New York', 'type': 'city',
        'notes': 'New Amsterdam granted city charter. Noon assumed.',
        'region': 'City',
    },
    'washington_dc': {
        'name': 'Washington DC', 'date': '1790-07-16', 'time': '12:00', 'utc_offset': -5.0,
        'lat': 38.91, 'lon': -77.04, 'capital': 'Washington', 'type': 'city',
        'notes': 'Residence Act signed by Washington.',
        'region': 'City',
    },
    'paris_city': {
        'name': 'Paris', 'date': '1789-07-14', 'time': '10:00', 'utc_offset': 1.0,
        'lat': 48.86, 'lon': 2.35, 'capital': 'Paris', 'type': 'city',
        'notes': 'Fall of the Bastille. Revolutionary Paris. 10 AM estimated.',
        'region': 'City',
    },
    'delhi_city': {
        'name': 'New Delhi', 'date': '1931-02-13', 'time': '10:30', 'utc_offset': 5.5,
        'lat': 28.61, 'lon': 77.21, 'capital': 'Delhi', 'type': 'city',
        'notes': 'New Delhi inaugurated by Viceroy Irwin. 10:30 AM ceremony.',
        'region': 'City',
    },
    'mumbai_city': {
        'name': 'Mumbai', 'date': '1661-08-27', 'time': '12:00', 'utc_offset': 5.5,
        'lat': 19.07, 'lon': 72.88, 'capital': 'Mumbai', 'type': 'city',
        'notes': 'Ceded to Britain by Portugal as part of Catherine of Braganza dowry.',
        'region': 'City',
    },
    'tokyo_city': {
        'name': 'Tokyo', 'date': '1889-05-01', 'time': '00:00', 'utc_offset': 9.0,
        'lat': 35.68, 'lon': 139.69, 'capital': 'Tokyo', 'type': 'city',
        'notes': 'Tokyo City formally established under city code.',
        'region': 'City',
    },
    'dubai_city': {
        'name': 'Dubai', 'date': '1833-06-09', 'time': '00:00', 'utc_offset': 4.0,
        'lat': 25.20, 'lon': 55.27, 'capital': 'Dubai', 'type': 'city',
        'notes': 'Al Maktoum dynasty established Dubai as independent. Approximate date.',
        'region': 'City',
    },
    'singapore_city': {
        'name': 'Singapore City', 'date': '1819-02-06', 'time': '00:00', 'utc_offset': 8.0,
        'lat': 1.35, 'lon': 103.82, 'capital': 'Singapore', 'type': 'city',
        'notes': 'Stamford Raffles established trading post.',
        'region': 'City',
    },
    'rome_city': {
        'name': 'Rome', 'date': '0753-04-21', 'time': '12:00', 'utc_offset': 1.0,
        'lat': 41.90, 'lon': 12.50, 'capital': 'Rome', 'type': 'city',
        'notes': 'Traditional founding by Romulus. 753 BCE. Natale di Roma.',
        'region': 'City',
    },
    'jaipur_city': {
        'name': 'Jaipur', 'date': '1727-11-18', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 26.91, 'lon': 75.79, 'capital': 'Jaipur', 'type': 'city',
        'notes': 'Founded by Maharaja Sawai Jai Singh II. Planned city.',
        'region': 'City',
    },
    'varanasi_city': {
        'name': 'Varanasi (Kashi)', 'date': '1194-01-01', 'time': '00:00', 'utc_offset': 5.5,
        'lat': 25.32, 'lon': 83.01, 'capital': 'Varanasi', 'type': 'city',
        'notes': 'One of oldest continuously inhabited cities. Date symbolic — ancient origin.',
        'region': 'City',
    },
    'istanbul_city': {
        'name': 'Istanbul', 'date': '0330-05-11', 'time': '12:00', 'utc_offset': 3.0,
        'lat': 41.01, 'lon': 28.98, 'capital': 'Constantinople', 'type': 'city',
        'notes': 'Constantine founded Constantinople. 330 CE. Noon assumed.',
        'region': 'City',
    },
    'jerusalem_city': {
        'name': 'Jerusalem', 'date': '1000-01-01', 'time': '12:00', 'utc_offset': 2.0,
        'lat': 31.77, 'lon': 35.23, 'capital': 'Jerusalem', 'type': 'city',
        'notes': 'King David conquered. ~1000 BCE. Symbolic date.',
        'region': 'City',
    },

    }

    for phrase, key in name_map.items():
        if phrase in text_lower:
            return key

    return None


def list_countries(region: str = None) -> List[str]:
    """List country names, optionally filtered by region."""
    if region:
        return [v['name'] for v in NATIONAL_CHARTS.values() if v.get('region', '').lower() == region.lower()]
    return [v['name'] for v in NATIONAL_CHARTS.values()]


def get_chart_datetime(key: str):
    """Return the datetime object for a national chart (in UTC)."""
    chart = get_country(key)
    if not chart:
        return None
    from datetime import timedelta
    date_str = chart['date']
    time_str = chart.get('time', '00:00')
    utc_offset = chart.get('utc_offset', 0)
    local_dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    utc_dt = local_dt - timedelta(hours=utc_offset)
    return utc_dt


REGIONS = ['South Asia', 'East Asia', 'Southeast Asia', 'Middle East',
           'Central Asia', 'Europe', 'North America', 'South America',
           'Africa', 'Oceania', 'International']

# Merge extended charts
try:
    from .charts_extended import EXTENDED_CHARTS
    NATIONAL_CHARTS.update(EXTENDED_CHARTS)
except ImportError:
    pass
