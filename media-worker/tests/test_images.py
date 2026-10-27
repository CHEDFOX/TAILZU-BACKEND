"""Pictures made fit for their use (app/images.py): resized, converted, upright, and with nothing else in them."""
import io

import pytest
from PIL import Image

from app.errors import WorkerError
from app.images import optimise

from conftest import jpeg_with_exif, png_bytes

LIMIT = 50_000_000


def open_(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


def test_a_big_picture_is_made_to_fit_and_a_small_one_is_not_made_bigger():
    data, w, h, fmt = optimise(png_bytes((2000, 1000)), 512, "png", 82, LIMIT)
    assert (w, h, fmt) == (512, 256, "png") and open_(data).size == (512, 256)
    data, w, h, _ = optimise(png_bytes((100, 50)), 512, "png", 82, LIMIT)
    assert (w, h) == (100, 50)


def test_the_format_asked_for_is_the_format_made():
    for fmt, pil in (("webp", "WEBP"), ("png", "PNG"), ("jpeg", "JPEG")):
        data, _, _, chosen = optimise(png_bytes((64, 64)), 64, fmt, 80, LIMIT)
        assert chosen == fmt and open_(data).format == pil


def test_auto_keeps_flat_pictures_png_and_makes_photographs_webp():
    flat = optimise(png_bytes((64, 64)), 64, "auto", 80, LIMIT)
    assert flat[3] == "png"
    photo = optimise(png_bytes((128, 128), noise=True), 128, "auto", 80, LIMIT)
    assert photo[3] == "webp"


def test_exif_gps_and_the_rest_are_gone_and_the_picture_is_turned_upright():
    src = jpeg_with_exif((64, 48), orientation=6)
    assert b"GPS 12.9716N" in src
    out, w, h, _ = optimise(src, 1000, "webp", 80, LIMIT)
    assert b"GPS" not in out and b"Asha" not in out and b"Exif" not in out
    # Orientation 6 means "rotate 90 degrees": a 64 x 48 sensor image is a 48 x 64 picture once upright.
    assert (w, h) == (48, 64)
    assert not open_(out).getexif()


def test_png_text_chunks_do_not_survive():
    from PIL import PngImagePlugin

    info = PngImagePlugin.PngInfo()
    info.add_text("Author", "Asha Rao")
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (1, 2, 3)).save(buf, "PNG", pnginfo=info)
    assert b"Asha Rao" in buf.getvalue()
    out, *_ = optimise(buf.getvalue(), 100, "png", 80, LIMIT)
    assert b"Asha Rao" not in out and b"tEXt" not in out


def test_transparency_is_kept_in_png_and_webp_and_flattened_onto_white_for_jpeg():
    rgba = png_bytes((16, 16), mode="RGBA", colour=(255, 0, 0, 0))
    for fmt in ("png", "webp"):
        out = open_(optimise(rgba, 64, fmt, 80, LIMIT)[0])
        assert out.mode == "RGBA" and out.getpixel((0, 0))[3] == 0
    jpg = open_(optimise(rgba, 64, "jpeg", 80, LIMIT)[0])
    assert jpg.mode == "RGB" and min(jpg.getpixel((0, 0))) > 240


def test_a_palette_gif_with_transparency_and_an_animation_become_one_still_frame():
    frames = [Image.new("P", (10, 10), i) for i in (0, 1, 2)]
    buf = io.BytesIO()
    frames[0].save(buf, "GIF", save_all=True, append_images=frames[1:], duration=50, loop=0)
    out, w, h, fmt = optimise(buf.getvalue(), 64, "png", 80, LIMIT)
    assert open_(out).format == "PNG" and getattr(open_(out), "is_animated", False) is False and (w, h) == (10, 10)


def test_a_small_file_that_unpacks_to_a_huge_picture_is_a_bomb():
    big = io.BytesIO()
    Image.new("1", (9000, 9000), 0).save(big, "PNG")
    assert len(big.getvalue()) < 100_000
    with pytest.raises(WorkerError) as e:
        optimise(big.getvalue(), 512, "png", 80, 50_000_000)
    assert e.value.code == "bomb" and "far bigger than its file size suggests" in e.value.message


def test_damaged_and_unsupported_pictures_say_so():
    with pytest.raises(WorkerError) as e:
        optimise(b"not a picture at all", 64, "png", 80, LIMIT)
    assert e.value.code == "corrupt"
    with pytest.raises(WorkerError) as e:
        optimise(png_bytes()[:30], 64, "png", 80, LIMIT)
    assert e.value.code == "corrupt"
    buf = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buf, "BMP")
    with pytest.raises(WorkerError) as e:
        optimise(buf.getvalue(), 64, "png", 80, LIMIT)
    assert e.value.code == "unsupported"
    with pytest.raises(WorkerError):
        optimise(png_bytes(), 64, "tiff", 80, LIMIT)


def test_the_endpoint_returns_the_picture_with_its_size_in_headers(client):
    r = client.post("/v1/image?max=100&format=webp&quality=70", png_bytes((400, 200), noise=True))
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"
    assert (r.headers["x-image-width"], r.headers["x-image-height"], r.headers["x-image-format"]) == ("100", "50", "webp")
    assert open_(r.content).size == (100, 50)


def test_the_endpoint_refuses_a_bomb_in_words(client):
    big = io.BytesIO()
    Image.new("1", (9000, 9000), 0).save(big, "PNG")
    r = client.post("/v1/image?max=100&format=png", big.getvalue())
    assert r.status_code == 422 and r.json()["code"] == "bomb"
