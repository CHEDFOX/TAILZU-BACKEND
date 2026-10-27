"""Office files and web pages to Markdown (app/convert.py), through the real endpoint and a real child process. Files are made on the fly."""
import json

import pytest

from conftest import make_bomb_docx, make_docx, make_epub, make_odf, make_pptx, make_xlsx, make_zip


def convert(client, fmt: str, data: bytes):
    return client.post(f"/v1/convert?format={fmt}", data)


def test_docx_becomes_markdown_with_its_headings_and_tables(client):
    r = convert(client, "docx", make_docx(["The notice period is sixty days."]))
    assert r.status_code == 200, r.text
    md = r.json()["markdown"]
    assert "# Employee handbook" in md
    assert "The notice period is sixty days." in md
    assert "| Item | Days |" in md and "| Notice | 60 |" in md
    assert r.json()["tables"] == []


def test_xlsx_gives_the_text_and_the_rows_of_each_visible_sheet(client):
    sheets = {"Sales": [["Month", "Revenue"], ["Jan", 100], ["Feb", 150.5], [None, None], ["Mar", 120]], "Costs": [["Item", "Cost"], ["Rent", 900]]}
    r = convert(client, "xlsx", make_xlsx(sheets))
    assert r.status_code == 200, r.text
    body = r.json()
    assert "## Sales" in body["markdown"] and "Feb" in body["markdown"]
    assert [t["name"] for t in body["tables"]] == ["Sales", "Costs"]
    sales = body["tables"][0]
    assert sales["columns"] == ["Month", "Revenue"]
    assert sales["rows"] == [["Jan", 100], ["Feb", 150.5], ["Mar", 120]]
    assert sales["total_rows"] == 3


def test_xlsx_keeps_500_rows_a_sheet_and_counts_all_of_them(client):
    rows = [["n", "v"]] + [[i, i * 2] for i in range(900)]
    body = convert(client, "xlsx", make_xlsx({"Big": rows})).json()
    t = body["tables"][0]
    assert len(t["rows"]) == 500 and t["total_rows"] == 900


def test_xlsx_formulas_are_values_not_code(client):
    import io
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["a", "b"])
    ws.append([1, "=1+1"])
    ws.append([2, '=HYPERLINK("http://evil.example/","x")'])
    out = io.BytesIO()
    wb.save(out)
    body = convert(client, "xlsx", out.getvalue()).json()
    # Never evaluated: a formula nobody has calculated has no cached value, so it is empty here.
    assert body["tables"][0]["rows"] == [[1, None], [2, None]]
    assert "evil.example" not in json.dumps(body["tables"])


def test_pptx_is_a_section_a_slide(client):
    r = convert(client, "pptx", make_pptx())
    assert r.status_code == 200, r.text
    md = r.json()["markdown"]
    assert "<!-- Slide number: 1 -->" in md and "<!-- Slide number: 2 -->" in md
    assert "Launch plan" in md and "Four lakh rupees." in md
    assert r.json()["pages"] == 2


def test_odt_ods_odp_are_read_by_our_own_reader(client):
    odt = make_odf("text", '<text:h text:outline-level="1">Handbook</text:h><text:p>Notice is <text:span>sixty</text:span> days.</text:p>'
                   '<text:list><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p>two</text:p></text:list-item></text:list>'
                   '<table:table><table:table-row><table:table-cell><text:p>Item</text:p></table:table-cell><table:table-cell><text:p>Days</text:p></table:table-cell></table:table-row>'
                   '<table:table-row><table:table-cell><text:p>Notice</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="60"><text:p>60</text:p></table:table-cell></table:table-row></table:table>')
    md = convert(client, "odt", odt).json()["markdown"]
    assert "# Handbook" in md and "Notice is sixty days." in md and "- one" in md and "- two" in md
    assert "| Item | Days |" in md and "| Notice | 60 |" in md

    ods = make_odf("spreadsheet", '<table:table table:name="Sales"><table:table-row><table:table-cell><text:p>Month</text:p></table:table-cell><table:table-cell><text:p>Revenue</text:p></table:table-cell></table:table-row>'
                   '<table:table-row><table:table-cell><text:p>Jan</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="100"><text:p>100</text:p></table:table-cell></table:table-row></table:table>')
    body = convert(client, "ods", ods).json()
    assert body["tables"] == [{"name": "Sales", "columns": ["Month", "Revenue"], "rows": [["Jan", 100]], "total_rows": 1}]
    assert "## Sales" in body["markdown"]

    odp = make_odf("presentation", '<draw:page><draw:frame><draw:text-box><text:p>Roadmap</text:p></draw:text-box></draw:frame></draw:page><draw:page><draw:frame><draw:text-box><text:p>Budget</text:p></draw:text-box></draw:frame></draw:page>')
    body = convert(client, "odp", odp).json()
    assert "<!-- Slide number: 2 -->\nBudget" in body["markdown"] and body["pages"] == 2


def test_epub_and_html(client):
    md = convert(client, "epub", make_epub()).json()["markdown"]
    assert "Chapter One" in md and "bright cold day in April" in md
    # Font obfuscation is not DRM.
    assert convert(client, "epub", make_epub(font_obfuscation=True)).status_code == 200
    html = b"<html><head><title>T</title><style>p{color:red}</style><script>alert(1)</script></head><body><h1>Title</h1><p>Hello <b>there</b>, welcome.</p><a href='http://evil.example/x'>link</a></body></html>"
    md = convert(client, "html", html).json()["markdown"]
    assert "# Title" in md and "Hello **there**, welcome." in md
    assert "alert(1)" not in md and "color:red" not in md


def test_embedded_images_do_not_bring_their_bytes(client):
    md = convert(client, "docx", make_docx(["see below"])).json()["markdown"]
    assert "base64" not in md


@pytest.mark.parametrize(
    "name, data, fmt, code, words",
    [
        ("password OOXML", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 600, "xlsx", "password", "password-protected"),
        ("zip bomb", make_bomb_docx(), "docx", "bomb", "grow"),
        ("not a zip", b"plain words, no zip at all", "docx", "corrupt", "damaged"),
        ("a zip that is not a docx", make_zip({"a.txt": b"x"}), "docx", "unsupported", "not a docx"),
        ("a zip that is not an xlsx", make_zip({"a.txt": b"x"}), "xlsx", "unsupported", "not a xlsx"),
        ("encrypted ODF", make_odf("text", "<text:p>x</text:p>", encrypted=True), "odt", "password", "password-protected"),
        ("an epub with DRM", make_epub(drm=True), "epub", "password", "copy-protected"),
        ("odt that is really a spreadsheet", make_odf("spreadsheet", "<table:table/>"), "odt", "unsupported", "not an odt"),
    ],
)
def test_refusals_say_what_is_wrong_in_words(client, name, data, fmt, code, words):
    r = convert(client, fmt, data)
    assert r.status_code == 422, name
    assert r.json()["code"] == code, name
    assert words in r.json()["message"], name


def test_a_bomb_of_many_entries_is_refused_before_it_is_opened(client):
    many = make_zip({f"f{i}.xml": b"x" for i in range(3100)} | {"[Content_Types].xml": b"<Types/>", "word/document.xml": b"<w/>"})
    r = convert(client, "docx", many)
    assert r.json()["code"] == "bomb" and "far more than a document has" in r.json()["message"]


def test_an_odf_with_an_entity_attack_does_not_expand_it(client):
    # The billion-laughs shape: defusedxml refuses entity declarations.
    evil = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:body>&lol2;</office:body></office:document-content>'
    import io, zipfile

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("mimetype", "application/vnd.oasis.opendocument.text", compress_type=zipfile.ZIP_STORED)
        z.writestr("content.xml", evil)
    r = convert(client, "odt", out.getvalue())
    assert r.status_code == 422 and r.json()["code"] == "corrupt"
