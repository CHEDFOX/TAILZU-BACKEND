"""
LIBRARY — world philosophy and cosmology, structured for comparison.

    from app.services import library

    library.compare("time")           -> every tradition's position, grouped, lineage-weighted
    library.search("what is fate")    -> plain-language question → the traditions answering it
    library.positions_of("daoist")    -> one school across all questions
    library.to_prompt(result)         -> Oracle-ready text

Three registries, each a plug-in bus like `patterns/signals`:
    lineage.py    traditions and how they transmitted to each other
    concepts.py   the questions, and what each tradition holds
    works.py      the texts (registered into the shared provenance bibliography)

Growing it = adding declarations. Nothing else changes.
"""
from app.services.library import works  # noqa: F401  (registers the bibliography first)
from app.services.library import positions  # noqa: F401  (registers positions)

from app.services.library.engine import (  # noqa: F401
    compare, positions_of, search, to_prompt,
)
from app.services.library.concepts import (  # noqa: F401
    Concept, Position, concept, position, get_concept, all_concepts,
    positions_for, positions_by_tradition, all_positions, resolve_concept,
    catalog as concept_catalog, to_dict as position_to_dict,
    concept_to_dict,
)
from app.services.library.lineage import (  # noqa: F401
    Tradition, tradition, edge, get as get_tradition, all_traditions,
    ancestry, shares_lineage, independent_groups, convergence_report,
    catalog as tradition_catalog,
)

__all__ = [
    "compare", "positions_of", "search", "to_prompt",
    "Concept", "Position", "concept", "position", "get_concept", "all_concepts",
    "positions_for", "positions_by_tradition", "all_positions", "resolve_concept",
    "concept_catalog", "position_to_dict", "concept_to_dict",
    "Tradition", "tradition", "edge", "get_tradition", "all_traditions",
    "ancestry", "shares_lineage", "independent_groups", "convergence_report",
    "tradition_catalog",
]
