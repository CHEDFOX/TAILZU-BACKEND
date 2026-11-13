"""
Importing this package registers every declared method.

Adding a tradition = adding a module here and one line below. Nothing else changes —
same plug-in contract as `patterns/signals/`.
"""
from app.services.provenance.methods import (  # noqa: F401  (imported for side effects)
    astronomy,
    vedic,
    western,
    chinese,
    research,
    divination,
    extended,
    schools,
)

__all__ = ["astronomy", "vedic", "western", "chinese", "research", "divination", "extended", "schools"]
