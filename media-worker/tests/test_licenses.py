"""NO AGPL, NO GPL (licenses_check.py): the installed packages pass, and the checker itself catches what it should."""
import licenses_check as lc


def test_what_is_installed_is_clean():
    r = lc.scan()
    assert r["denied"] == [], r["denied"]
    assert r["unknown"] == [], r["unknown"]
    names = {p["name"].lower() for p in r["packages"]}
    # The parts the brief names are there, and PyMuPDF and Marker are not.
    assert {"markitdown", "docling", "pillow", "fastapi"} <= names
    assert not names & lc.DENY_NAMES


def test_the_deny_list_catches_copyleft_and_commercial_restrictions():
    for text in ("AGPL-3.0-or-later", "GNU Affero General Public License v3", "GPL-3.0", "GPLv2", "GNU General Public License v2 (GPLv2)", "SSPL-1.0",
                 "Business Source License 1.1", "CC-BY-NC-4.0", "PolyForm Noncommercial 1.0.0", "OpenRAIL-M", "Elastic License 2.0", "Commons Clause"):
        assert lc.DENY.search(text), text
    for text in ("MIT", "Apache-2.0", "BSD-3-Clause", "MIT-CMU", "MPL-2.0", "PSF-2.0", "ISC License", "HPND"):
        assert not lc.DENY.search(text), text
    assert lc.LGPL.search("GNU Lesser General Public License v3 (LGPLv3)")


def test_pymupdf_and_marker_are_refused_by_name(monkeypatch):
    class Fake:
        version = "1.0"

        def __init__(self, name, **fields):
            self.metadata = type("M", (), {"get": lambda _s, k, d=None: {"Name": name, **fields}.get(k, d), "get_all": lambda _s, k: []})()

    monkeypatch.setattr(lc.metadata, "distributions", lambda: [Fake("PyMuPDF", **{"License-Expression": "MIT"}), Fake("marker-pdf", **{"License-Expression": "GPL-3.0-or-later"}), Fake("fine", **{"License-Expression": "MIT"})])
    r = lc.scan()
    assert sorted(d["name"] for d in r["denied"]) == ["PyMuPDF", "marker-pdf"]
    assert lc.main([]) == 1


def test_a_gpl_package_fails_the_run_and_an_lgpl_one_is_only_listed(monkeypatch):
    class Fake:
        version = "1.0"

        def __init__(self, name, lic):
            self.metadata = type("M", (), {"get": lambda _s, k, d=None: {"Name": name, "License-Expression": lic}.get(k, d), "get_all": lambda _s, k: []})()

    monkeypatch.setattr(lc.metadata, "distributions", lambda: [Fake("lib-a", "LGPL-3.0-or-later"), Fake("lib-b", "MIT OR GPL-2.0-only")])
    r = lc.scan()
    assert r["denied"] == [] and [x["name"] for x in r["review"]] == ["lib-a", "lib-b"]
    monkeypatch.setattr(lc.metadata, "distributions", lambda: [Fake("lib-c", "GPL-3.0-only")])
    assert lc.scan()["denied"][0]["name"] == "lib-c"


def test_a_package_with_no_licence_stated_must_be_looked_at(monkeypatch):
    class Fake:
        version = "1.0"
        metadata = type("M", (), {"get": lambda _s, k, d=None: {"Name": "mystery"}.get(k, d), "get_all": lambda _s, k: []})()

    monkeypatch.setattr(lc.metadata, "distributions", lambda: [Fake()])
    assert [x["name"] for x in lc.scan()["unknown"]] == ["mystery"]
    assert lc.main([]) == 1
