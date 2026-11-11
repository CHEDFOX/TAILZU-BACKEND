"""
ORACLE — ENGINE CACHE
Calculate birth chart ONCE per user, reuse for all questions.
"""

from datetime import datetime, timedelta
from typing import Dict
import hashlib


class EngineCache:
    def __init__(self, max_size: int = 200, ttl_minutes: int = 120):
        self._cache: Dict[str, dict] = {}
        self.max_size = max_size
        self.ttl = timedelta(minutes=ttl_minutes)

    def _make_key(self, birth_dt: datetime, lat: float, lng: float) -> str:
        raw = f"{birth_dt.isoformat()}:{lat:.4f}:{lng:.4f}"
        return hashlib.md5(raw.encode()).hexdigest()

    def get(self, birth_dt: datetime, lat: float, lng: float):
        key = self._make_key(birth_dt, lat, lng)
        entry = self._cache.get(key)
        if entry and datetime.now() - entry['created'] < self.ttl:
            entry['last_access'] = datetime.now()
            entry['hits'] += 1
            return entry['engine']
        elif entry:
            del self._cache[key]
        return None

    def put(self, birth_dt: datetime, lat: float, lng: float, engine):
        key = self._make_key(birth_dt, lat, lng)
        if len(self._cache) >= self.max_size:
            oldest = min(self._cache, key=lambda k: self._cache[k]['last_access'])
            del self._cache[oldest]
        self._cache[key] = {
            'engine': engine,
            'created': datetime.now(),
            'last_access': datetime.now(),
            'hits': 0,
        }

    def clear(self):
        self._cache.clear()

    def stats(self) -> Dict:
        total_hits = sum(v['hits'] for v in self._cache.values())
        return {
            'cached': len(self._cache),
            'max': self.max_size,
            'total_hits': total_hits,
        }


# Global singleton
_engine_cache = EngineCache()


def get_cached_engine(birth_dt: datetime, lat: float, lng: float):
    """Get engine from cache or create new."""
    engine = _engine_cache.get(birth_dt, lat, lng)
    if engine:
        return engine, True  # (engine, was_cached)

    from ..jyotish_engine import JyotishEngine
    engine = JyotishEngine(birth_dt, lat, lng)
    _engine_cache.put(birth_dt, lat, lng, engine)
    return engine, False


def get_cache_stats():
    return _engine_cache.stats()
