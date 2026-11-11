"""
MODERN — twentieth and twenty-first century systems, dated honestly.

    from app.services.modern import human_design, gene_keys, enneagram, evolutionary

Each carries its actual origin in its provenance entry. Human Design is 1987, the
enneagram typology is c. 1970, Gene Keys is 2009, evolutionary astrology is the 1980s.
None of them is ancient, several are routinely presented as though they were, and the
registry records what is documented rather than what is claimed.
"""
from app.services.modern import human_design, enneagram, evolutionary  # noqa: F401

gene_keys = human_design  # Gene Keys derives directly from HD and shares its machinery

__all__ = ["human_design", "gene_keys", "enneagram", "evolutionary"]
