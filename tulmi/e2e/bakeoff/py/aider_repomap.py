"""Aider's repo map as a locator, in Aider's own venv: the files of a git work tree in the order its map ranks them for a request.

    python -I aider_repomap.py <git work tree> <request text file>   ->  {"ranked": [rel paths, best first], "files": n, "ms": ...}

This is what Aider does before each turn (aider/coders/base_coder.py get_repo_map): the identifiers in the message and the files it names (get_ident_mentions,
get_file_mentions, get_ident_filename_matches, copied as they are) personalize the PageRank over the definition/reference graph (aider/repomap.py
get_ranked_tags); a file's place is where its best-ranked definition first comes. No chat files are in play, as in a first message. Nothing is sent to a model.
The CLI's own `--show-repo-map` prints the same map without the personalization, sorted by file name (see locate.ts).
"""
import json, os, re, subprocess, sys, time
from collections import defaultdict
from pathlib import Path

from aider.io import InputOutput
from aider.models import Model
from aider.repomap import RepoMap

root, request_file = sys.argv[1], sys.argv[2]
request = open(request_file, encoding="utf-8").read()
t0 = time.perf_counter()

raw = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode("utf-8", "replace").split("\0")
rels = [f for f in raw if f and os.path.isfile(os.path.join(root, f))]

# get_ident_mentions
idents = set(re.split(r"\W+", request))

# get_file_mentions (addable files = all of them)
words = set(w.rstrip(",.!;:?") for w in request.split())
words = set(w.strip("\"'`*_") for w in words)
mentioned = set()
by_base = defaultdict(list)
for rel in rels:
    if rel.replace("\\", "/") in set(w.replace("\\", "/") for w in words):
        mentioned.add(rel)
    base = os.path.basename(rel)
    if "/" in base or "\\" in base or "." in base or "_" in base or "-" in base:
        by_base[base].append(rel)
for base, rs in by_base.items():
    if len(rs) == 1 and base in words:
        mentioned.add(rs[0])

# get_ident_filename_matches
stems = defaultdict(set)
for rel in rels:
    stem = Path(rel).stem.lower()
    if len(stem) >= 5:
        stems[stem].add(rel)
for ident in idents:
    if len(ident) >= 5:
        mentioned.update(stems[ident.lower()])

io = InputOutput(yes=True, pretty=False, fancy_input=False)
model = Model("openai/e2e-model")
rm = RepoMap(map_tokens=1024, root=root, main_model=model, io=io, verbose=False, refresh="always")
tags = rm.get_ranked_tags([], [os.path.join(root, r) for r in rels], mentioned, idents)

ranked, seen = [], set()
for t in tags:
    rel = t[0]
    if rel not in seen:
        seen.add(rel)
        ranked.append(rel)
print(json.dumps({"ranked": ranked, "files": len(rels), "mentionedFiles": sorted(mentioned), "ms": (time.perf_counter() - t0) * 1000}))
