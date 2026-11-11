"""
DEPRECATED — Replaced by classical_rules.py

This module used invented weights (score += 15, score -= 20).
All life event evaluation now uses ClassicalRules which traces
every rule to a specific BPHS/Phaladeepika sloka.
"""

from ..predictions.classical_rules import ClassicalRules
from typing import Dict


class ChartPromise:
    """Redirects to ClassicalRules — the textually grounded system."""

    def __init__(self, engine):
        self.engine = engine
        self.cr = ClassicalRules(engine)

    def evaluate(self, event: str) -> Dict:
        """Evaluate using classical text rules."""
        event_map = {
            'childbirth': 'children',
            'travel_foreign': 'foreign',
            'health_issue': 'health',
        }
        mapped = event_map.get(event, event)
        return self.cr.evaluate(mapped)

    def evaluate_all(self) -> Dict:
        """Full life reading using classical rules."""
        events = ['marriage', 'children', 'wealth', 'career', 'spiritual', 'health',
                  'foreign', 'property', 'education', 'longevity', 'father', 'mother',
                  'siblings', 'business', 'love', 'fame']
        results = {}
        for ev in events:
            results[ev] = self.cr.evaluate(ev)
        return {'events': results}
