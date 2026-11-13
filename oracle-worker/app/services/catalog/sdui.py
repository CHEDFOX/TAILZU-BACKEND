"""
SDUI — helpers to build Server-Driven UI trees the app renders generically.

The app ships a primitive renderer (src/render/sdui.js). The backend sends a
`tree` of nodes and the app draws it — so brand-new screens / tabs / flows /
forms need NO app release. Use these helpers to build trees cleanly, or write
the dicts by hand.

Surfaces:
  • home block:        {"id": "...", "type": "sdui", "options": {"tree": [...]}}
  • fullscreen screen: a section with template="sdui", present="fullscreen",
                       and either config={"tree": [...]} (static) or an endpoint
                       that returns {"tree": [...]} (dynamic).
  • whole tab:         a catalog.tabs item {"key","icon","screen":"sdui",
                       "section":"<id>"} or {"...","tree":[...]}.

Node:
  {type, style, props, text|bind, src|srcBind, children, for+item, if,
   name, value, action}
Types:  box row stack scroll grid card text heading paragraph overline label
        image media video icon button input spacer divider blocks switch
Actions (action.kind): open | url | nav | close | back | set | submit
"""
from typing import Any, Dict, List, Optional


def node(type: str, children: Optional[List] = None, **kw) -> Dict[str, Any]:
    n: Dict[str, Any] = {"type": type}
    if children is not None:
        n["children"] = children
    n.update({k: v for k, v in kw.items() if v is not None})
    return n


def screen(tree: List[Dict], no_scroll: bool = False) -> Dict[str, Any]:
    """The envelope an SDUI endpoint returns."""
    out: Dict[str, Any] = {"tree": tree}
    if no_scroll:
        out["noScroll"] = True
    return out


# Shorthands
def heading(text=None, bind=None, **kw): return node("heading", text=text, bind=bind, **kw)
def paragraph(text=None, bind=None, **kw): return node("paragraph", text=text, bind=bind, **kw)
def overline(text=None, bind=None, **kw): return node("overline", text=text, bind=bind, **kw)
def image(src=None, src_bind=None, **kw): return node("image", src=src, srcBind=src_bind, **kw)
def divider(**kw): return node("divider", **kw)
def spacer(height=16): return node("spacer", props={"height": height})
def button(text, action, **kw): return node("button", text=text, action=action, **kw)
def box(children, **kw): return node("box", children=children, **kw)
def row(children, **kw): return node("row", children=children, **kw)
def grid(children, cols=2, **kw): return node("grid", children=children, props={"cols": cols}, **kw)


# A small demo screen used by the hidden `sdui_demo` section so the renderer can
# be verified after the final build ships (set visible=True or open by id).
DEMO_TREE: List[Dict] = [
    overline(text="SERVER-DRIVEN"),
    heading(text="This screen came from the backend"),
    paragraph(text="Every element here — the heading, this text, the image, the "
                   "button — was sent as JSON from the server. No app build."),
    divider(),
    image(src="time/vedic/today", props={"height": 200, "rounded": 18}),
    spacer(18),
    button("Open the Oracle", {"kind": "nav", "nav": "tab", "arg": "oracle"},
           style={"backgroundColor": "$gold"}),
]
