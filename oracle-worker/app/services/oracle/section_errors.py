"""
SECTION FAILURES — make them visible instead of silent.

Every `build_sections` dispatcher wraps its builders in `except Exception: continue`.
The resilience is right: one broken section must not take down a turn. The SILENCE is
not, and it produces the worst failure this pipeline has.

When a builder raises, its section vanishes from the briefing. The classifier still
reported picking it, the pipeline still says `deep=True`, and the responder — told it has
data on a subject and handed nothing — writes from its own general knowledge instead. The
output is fluent, on-topic and completely ungrounded, and nothing anywhere says so.

That is how "read my zi wei dou shu chart" came back with no palaces, no stars, no bureau
and no transformations while the run log showed `sections: zi_wei`. The section was picked,
the builder raised, and the model filled the hole.

So: still continue, but say what broke. Once per (system, section, error-type) per process,
so a section failing on every request logs once rather than flooding the journal.
"""
import re
import sys
import traceback
from typing import Set, Tuple

_SEEN: Set[Tuple[str, str, str]] = set()


def note_section_failure(system: str, section: str, exc: BaseException,
                         verbose: bool = False) -> None:
    """Record that a section builder raised. Never raises itself."""
    try:
        key = (str(system), str(section), type(exc).__name__)
        if key in _SEEN:
            return
        _SEEN.add(key)
        # WHERE it broke, not just what. "'list' object has no attribute 'get'"
        # names neither the file nor the line, and there are dozens of .get()
        # calls in any one builder's call chain — so the message sent us
        # guessing at the wrong one twice. The deepest frame is the one that
        # actually raised; that single line is usually the whole diagnosis.
        where = ""
        try:
            tb = traceback.extract_tb(exc.__traceback__)
            if tb:
                f = tb[-1]
                where = f" at {f.filename.split('/')[-1]}:{f.lineno} in {f.name}()"
        except Exception:
            pass
        msg = (f"[sections] {system}/{section} FAILED to build "
               f"({type(exc).__name__}: {str(exc)[:200]}){where} — the section was dropped "
               f"from the briefing and the responder will have written without it.")
        print(msg, file=sys.stderr, flush=True)
        if verbose:
            traceback.print_exc(file=sys.stderr)
    except Exception:
        pass


# A label followed by nothing ("Severity: "), a house with no number ("in  H"),
# empty brackets, a bare None. These are what a renderer prints when it reads keys
# its engine does not return — the most common failure in this codebase, and one
# that raises nothing.
_BLANK_VALUE = re.compile(r"(:\s*$|:\s*\||\bin\s+H\b|\(\s*\)|:\s*None\b|\bNone\s*$)")


def _blank_lines(text: str) -> int:
    lines = [l for l in (text or "").splitlines() if l.strip()]
    n = 0
    for i, l in enumerate(lines):
        if not _BLANK_VALUE.search(l):
            continue
        # A heading that introduces an indented list is not blank ("Upcoming:").
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if l.rstrip().endswith(":") and nxt and (len(nxt) - len(nxt.lstrip())) > (len(l) - len(l.lstrip())):
            continue
        n += 1
    return n


def vet_section(system: str, section: str, text: str) -> str:
    """The section text if it carries data; '' (and a report, once) if it does not.

    Exceptions are already reported by note_section_failure. This covers the other
    way a section fails: it builds without raising and says nothing — empty, or a
    column of labels with no values. That failure sent a third of the Vedic
    sections to the model as husks, and nothing anywhere said so."""
    body = (text or "").strip()
    if not body:
        _report(system, section, "EMPTY", "built without error and returned nothing")
        return ""
    lines = [l for l in body.splitlines() if l.strip()]
    blank = _blank_lines(body)
    if lines and blank * 2 >= len(lines) and blank >= 1 and len(lines) <= 12 or (blank >= 4 and blank * 3 >= len(lines)):
        _report(system, section, "BLANK", f"{blank} of {len(lines)} lines carry no value: {lines[0][:80]!r}")
        return ""
    return text


def _report(system: str, section: str, kind: str, why: str) -> None:
    try:
        key = (str(system), str(section), kind)
        if key in _SEEN:
            return
        _SEEN.add(key)
        print(f"[sections] {system}/{section} {kind}: {why} — dropped from the briefing; its renderer "
              f"probably reads keys the engine does not return.", file=sys.stderr, flush=True)
    except Exception:
        pass


def failures() -> list:
    """Everything that has failed this process — for the test series to report."""
    return sorted(f"{s}/{n}: {e}" for s, n, e in _SEEN)


def reset() -> None:
    _SEEN.clear()
