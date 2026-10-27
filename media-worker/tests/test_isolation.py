"""What a job cannot do (app/isolate.py, app/netguard.py, app/zipguard.py, app/pdfdoc.py): reach the network, outlive its clock, eat the machine."""
import io
import zipfile

import pytest

from app import isolate, zipguard
from app.config import Settings
from app.errors import WorkerError
from app.pdfdoc import convert_pdf

from conftest import make_pdf


def run(task_args: dict, **kw):
    kw.setdefault("timeout", 20)
    kw.setdefault("memory_mb", 512)
    return isolate.run("selftest", b"x", task_args, **kw)


def test_a_job_cannot_open_a_connection_or_look_a_name_up():
    assert run({"what": "network"}) == {"connected": False, "error": "NetworkBlocked"}
    assert run({"what": "dns"}) == {"resolved": False, "error": "NetworkBlocked"}


def test_a_job_that_wants_more_memory_than_it_may_is_killed_and_the_server_is_not():
    assert run({"what": "memory", "mb": 20}, memory_mb=512) == {"allocated": 20 * 1024 * 1024}
    with pytest.raises(WorkerError) as e:
        run({"what": "memory", "mb": 900}, memory_mb=400)
    assert e.value.code == "failed" and "too large or too complex" in e.value.message


def test_a_job_that_runs_too_long_is_killed_with_everything_it_started():
    import subprocess
    import time

    t0 = time.time()
    with pytest.raises(WorkerError) as e:
        run({"what": "spawn_sleeper"}, timeout=2)
    assert e.value.code == "timeout" and time.time() - t0 < 10
    assert e.value.status == 504
    left = subprocess.run(["pgrep", "-f", "^sleep 30$"], capture_output=True).stdout.split()
    assert left == []


def test_the_folder_of_a_job_is_removed_and_its_environment_is_not_the_servers(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_WORKER_SECRET", "must-not-reach-the-child-" + "x" * 20)
    seen = {}

    real = isolate.subprocess.Popen

    def spy(*a, **k):
        seen["env"] = k["env"]
        seen["cwd"] = k["cwd"]
        return real(*a, **k)

    monkeypatch.setattr(isolate.subprocess, "Popen", spy)
    run({"what": "sleep", "seconds": 0})
    assert "MEDIA_WORKER_SECRET" not in seen["env"]
    assert seen["env"]["HF_HUB_OFFLINE"] == "1" and seen["env"]["TRANSFORMERS_OFFLINE"] == "1"
    import glob

    assert glob.glob("/tmp/mw-*") == [] or all(not __import__("os").path.exists(p + "/in.bin") for p in glob.glob("/tmp/mw-*"))


def test_a_child_that_crashes_says_nothing_of_why():
    with pytest.raises(WorkerError) as e:
        isolate.run("not-a-task", b"x", {}, timeout=20, memory_mb=512)
    assert e.value.code == "unsupported"


# ------------------------------------------------------------------ the zip guard


def _zip(entries: dict[str, bytes], **kw) -> str:
    import tempfile

    f = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    with zipfile.ZipFile(f, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for k, v in entries.items():
            z.writestr(k, v)
    f.close()
    return f.name


def test_the_zip_guard_counts_entries_sizes_and_ratios():
    s = Settings(secret=b"x" * 40, zip_entries_max=5, zip_declared_max=10 * 1024 * 1024, zip_ratio_max=100)
    zipguard.check(_zip({"a": b"x", "b": b"y"}), s).close()
    with pytest.raises(WorkerError) as e:
        zipguard.check(_zip({f"f{i}": b"x" for i in range(6)}), s)
    assert e.value.code == "bomb"
    with pytest.raises(WorkerError) as e:
        zipguard.check(_zip({"z": b"\0" * (2 * 1024 * 1024)}), s)
    assert e.value.code == "bomb" and "hundreds of times" in e.value.message
    with pytest.raises(WorkerError) as e:
        zipguard.check(_zip({f"z{i}": b"\0" * 1_000_000 for i in range(11)}), Settings(secret=b"x" * 40, zip_declared_max=10 * 1024 * 1024, zip_ratio_max=100_000))
    assert e.value.code == "bomb"
    with pytest.raises(WorkerError) as e:
        zipguard.check(__import__("tempfile").NamedTemporaryFile(delete=False).name, s)
    assert e.value.code == "corrupt"


def test_an_entry_that_says_it_is_small_and_is_not_is_cut_off():
    path = _zip({"x.xml": b"a" * 100_000})
    with zipfile.ZipFile(path) as zf:
        with pytest.raises(WorkerError) as e:
            zipguard.bounded_read(zf, "x.xml", 1000)
    assert e.value.code == "bomb"


# ------------------------------------------------------------------ PDFs


class FakeDoc:
    def export_to_markdown(self, **kw):
        assert kw == {"page_break_placeholder": "\f"}
        return "# Invoice\n\nTotal 4,500\f# Page two\n\nPay by the fifth."


class FakeConverter:
    def __init__(self):
        self.calls = []

    def convert(self, source, **kw):
        self.calls.append(kw)
        return type("R", (), {"document": FakeDoc()})()


def test_a_pdf_is_read_by_the_layout_reader_with_its_pages_separated(tmp_path):
    p = tmp_path / "a.pdf"
    p.write_bytes(make_pdf(["one", "two"]))
    conv = FakeConverter()
    out = convert_pdf(p, Settings(secret=b"x" * 40), lambda: conv)
    assert out["pages"] == 2 and out["markdown"].split("\f") == ["# Invoice\n\nTotal 4,500", "# Page two\n\nPay by the fifth."]
    assert conv.calls == [{"max_num_pages": 300, "max_file_size": 30 * 1024 * 1024}]


def test_a_password_protected_pdf_is_refused_before_any_model_is_loaded(tmp_path):
    p = tmp_path / "locked.pdf"
    p.write_bytes(make_pdf(["secret"], encrypt="hunter2"))
    called = []
    with pytest.raises(WorkerError) as e:
        convert_pdf(p, Settings(secret=b"x" * 40), lambda: called.append(1))
    assert e.value.code == "password" and "password-protected" in e.value.message
    assert called == []


def test_a_long_pdf_and_a_damaged_one_are_refused(tmp_path):
    p = tmp_path / "a.pdf"
    p.write_bytes(make_pdf(["one", "two", "three"]))
    with pytest.raises(WorkerError) as e:
        convert_pdf(p, Settings(secret=b"x" * 40, pdf_pages_max=2), lambda: FakeConverter())
    assert e.value.code == "too_long"
    p.write_bytes(b"%PDF-1.4 this is not really a pdf")
    with pytest.raises(WorkerError) as e:
        convert_pdf(p, Settings(secret=b"x" * 40), lambda: FakeConverter())
    assert e.value.code == "corrupt"


def test_a_failure_in_the_layout_reader_never_repeats_what_it_said(tmp_path):
    p = tmp_path / "a.pdf"
    p.write_bytes(make_pdf(["one"]))

    class Boom:
        def convert(self, *a, **k):
            raise RuntimeError("tensor error while reading: the secret words of the file")

    with pytest.raises(WorkerError) as e:
        convert_pdf(p, Settings(secret=b"x" * 40), lambda: Boom())
    assert e.value.code == "failed" and "secret words" not in e.value.message


def test_the_pdf_endpoint_refuses_a_password_pdf_end_to_end(client):
    r = client.post("/v1/pdf", make_pdf(["secret"], encrypt="hunter2"))
    assert r.status_code == 422 and r.json()["code"] == "password"


def test_docling_is_set_up_with_nothing_remote():
    import inspect

    from app import pdfdoc

    src = inspect.getsource(pdfdoc._docling_converter)
    assert "enable_remote_services = False" in src and "allow_external_plugins = False" in src
