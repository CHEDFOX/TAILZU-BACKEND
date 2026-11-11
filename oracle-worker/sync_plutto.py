"""
Refresh the oracle's engine from a Plutto checkout: python3 sync_plutto.py <path to Plutto-Backend>

The engine under app/ is Plutto's own code, copied byte for byte (same package name, so not one import is rewritten): every module the
oracle's pipeline and its reply can reach, found by following the imports from the entry points below, function-level ones included, plus
the ephemeris. Nothing else of Plutto comes along. Run it, read the summary, run the tests, commit app/.
"""
import ast
import os
import shutil
import sys

ENTRIES = ["app/services/oracle/pipeline.py", "app/core/llm.py", "app/core/config.py", "app/services/oracle/subsystems.py",
           "app/services/oracle/direct.py", "app/services/oracle/cast.py"]
DATA_DIRS = ["app/services/core/ephe"]
HERE = os.path.dirname(os.path.abspath(__file__))


def _file_of(root: str, mod: str):
    base = os.path.join(root, *mod.split("."))
    for p in (base + ".py", os.path.join(base, "__init__.py")):
        if os.path.isfile(p):
            return os.path.relpath(p, root)
    return None


def _imports(root: str, rel: str) -> set:
    pkg = os.path.dirname(rel).replace("/", ".")
    try:
        tree = ast.parse(open(os.path.join(root, rel), encoding="utf-8").read())
    except (OSError, SyntaxError):
        return set()
    out = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            out |= {a.name for a in n.names if a.name.startswith("app.")}
        elif isinstance(n, ast.ImportFrom):
            if n.level:
                parts = pkg.split(".")
                base = ".".join(parts[: len(parts) - (n.level - 1)])
                mod = f"{base}.{n.module}" if n.module else base
            else:
                mod = n.module or ""
            if mod == "app" or mod.startswith("app."):
                out.add(mod)
                out |= {f"{mod}.{a.name}" for a in n.names}
    # The decks are imported by name (cast.py): every module of the divination package comes along.
    if rel.endswith("oracle/cast.py"):
        out |= {f"app.services.divination.{f[:-3]}" for f in os.listdir(os.path.join(root, "app/services/divination")) if f.endswith(".py")}
    return out


def closure(root: str) -> list:
    seen, todo = set(), list(ENTRIES)
    while todo:
        rel = todo.pop()
        if rel in seen:
            continue
        seen.add(rel)
        for mod in _imports(root, rel):
            while mod:
                f = _file_of(root, mod)
                if f and f not in seen:
                    todo.append(f)
                mod = mod.rsplit(".", 1)[0] if "." in mod else ""
    return sorted(seen)


def main(root: str) -> None:
    files = closure(root)
    dest = os.path.join(HERE, "app")
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    for rel in files:
        os.makedirs(os.path.join(HERE, os.path.dirname(rel)), exist_ok=True)
        shutil.copy2(os.path.join(root, rel), os.path.join(HERE, rel))
    for d in DATA_DIRS:
        shutil.copytree(os.path.join(root, d), os.path.join(HERE, d), dirs_exist_ok=True)
    size = sum(os.path.getsize(os.path.join(HERE, f)) for f in files)
    print(f"{len(files)} modules ({size // 1024} KB) and {len(DATA_DIRS)} data folder(s) copied from {root}")


if __name__ == "__main__":
    if len(sys.argv) != 2 or not os.path.isdir(os.path.join(sys.argv[1], "app")):
        sys.exit("usage: python3 sync_plutto.py <path to Plutto-Backend>")
    main(os.path.abspath(sys.argv[1]))
