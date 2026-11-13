"""
PROVENANCE — Levels 7 + 8 of the platform architecture.

  Level 7 (Research Database) — every computational method declared beside the work it
                                comes from, what it needs, what it emits, what it assumes
                                and where it fails.
  Level 8 (Explainability)    — the machinery to answer "where does this come from?" and
                                "what produced this reading?" from that record rather than
                                from an LLM's memory.

    from app.services.provenance import answer_source, citations_for, trace_reading

    answer_source("vimshottari")        -> prompt-ready provenance for the Oracle
    citations_for(["vimshottari_dasha"]) -> compact source block for a reading prompt
    trace_reading([...])                -> structured record for the API / debugger

Adding a method = one declaration in `methods/<tradition>.py`. Adding a tradition = one
module plus one import line. The registry is the single source of truth; nothing else
needs to know a method exists.
"""
from app.services.provenance.registry import (  # noqa: F401
    Method, method, get, all_methods, by_system, by_level, systems, resolve,
    dependency_chain, render_citation, catalog, coverage, to_dict,
    LEVELS, DETERMINISTIC, PARAMETRIC, INTERPRETIVE, STATISTICAL,
)
from app.services.provenance.sources import (  # noqa: F401
    Source, cite, by_tradition, by_kind,
    get as get_source, all_sources, catalog as source_catalog,
)
from app.services.provenance.context import (  # noqa: F401
    answer_source, citations_for, citations_for_system, trace_reading,
    is_provenance_question, GUARD,
)
import app.services.provenance.methods  # noqa: F401  (registers on import)

__all__ = [
    "Method", "Source", "method", "get", "get_source", "all_methods", "all_sources",
    "by_system", "by_level", "by_tradition", "by_kind", "systems", "resolve",
    "dependency_chain", "render_citation", "cite", "catalog", "source_catalog",
    "coverage", "to_dict", "answer_source", "citations_for", "citations_for_system",
    "trace_reading", "is_provenance_question", "GUARD",
    "LEVELS", "DETERMINISTIC", "PARAMETRIC", "INTERPRETIVE", "STATISTICAL",
]
