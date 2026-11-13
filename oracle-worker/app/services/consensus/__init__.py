"""
CONSENSUS — Level 6 of the platform architecture.

    from app.services.consensus import Finding, consensus, to_prompt

    findings = [
        Finding("vimshottari_dasha", "career", SUPPORTIVE, 0.8, "Jupiter mahadasha ..."),
        Finding("luck_pillars",      "career", SUPPORTIVE, 0.7, "Resource pillar ..."),
    ]
    result = consensus(findings, topic="career", scope="personal")

Confidence counts INDEPENDENT lines of reasoning, computed from the provenance dependency
graph — not the number of techniques that happen to agree.
"""
from app.services.consensus.engine import (  # noqa: F401
    Finding, consensus, to_prompt,
    SUPPORTIVE, ADVERSE, NEUTRAL, MIXED,
    STRONG, MODERATE, SINGLE_SOURCE, CONTESTED, INSUFFICIENT, BALANCED,
)
from app.services.consensus.weighting import (  # noqa: F401
    weight, to_guidance, to_detail, depth_requested,
)
from app.services.consensus.independence import (  # noqa: F401
    clusters, independence_report, shares_reasoning, shared_conventions,
)

__all__ = [
    "Finding", "consensus", "to_prompt",
    "SUPPORTIVE", "ADVERSE", "NEUTRAL", "MIXED",
    "STRONG", "MODERATE", "SINGLE_SOURCE", "CONTESTED", "INSUFFICIENT", "BALANCED",
    "clusters", "independence_report", "shares_reasoning", "shared_conventions",
    "weight", "to_guidance", "to_detail", "depth_requested",
]
