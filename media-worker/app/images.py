"""A PICTURE MADE FIT FOR ITS USE, WITH NOTHING ELSE IN IT: Pillow (MIT-CMU).

  - decoded under a pixel limit (50 megapixels): a small file that unpacks to a huge picture is a bomb and is refused, not opened
  - turned upright by its EXIF orientation, then re-encoded from the pixels alone, so EXIF, GPS, XMP, IPTC, comments and thumbnails do not come along
  - made to fit `max` pixels on its longest side, never made bigger
  - saved as webp or png (or jpeg); `auto` keeps flat-colour and transparent pictures PNG (crisp, lossless) and makes photographs WebP
  - an animated picture is its first frame

Used for a logo or an image the Code bot adds to a project, and to shrink a picture too big for the vision tier.
"""
from __future__ import annotations

import io
import warnings
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from .config import Settings
from .errors import WorkerError

FORMATS = {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp", "GIF": "gif"}


def _has_alpha(im: Image.Image) -> bool:
    return im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info) or "A" in im.getbands()


def _flat(im: Image.Image) -> bool:
    """A logo, a diagram, a screenshot of text: at most 256 colours once it is small."""
    probe = im.convert("RGB")
    probe.thumbnail((160, 160), Image.Resampling.NEAREST)
    return probe.getcolors(maxcolors=256) is not None


def optimise(data: bytes, max_side: int, fmt: str, quality: int, max_pixels: int) -> tuple[bytes, int, int, str]:
    if fmt not in ("auto", "webp", "png", "jpeg"):
        raise WorkerError("unsupported", "format is auto, webp, png or jpeg.")
    max_side = max(16, min(int(max_side), 8000))
    quality = max(30, min(int(quality), 95))
    Image.MAX_IMAGE_PIXELS = max_pixels
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            im = Image.open(io.BytesIO(data))
            if im.format not in FORMATS:
                raise WorkerError("unsupported", "I can make PNG, JPEG, WebP and GIF pictures fit for use.")
            if im.size[0] * im.size[1] > max_pixels:
                raise Image.DecompressionBombError("too many pixels")
            if getattr(im, "is_animated", False):
                im.seek(0)
            im.load()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise WorkerError("bomb", "That picture is far bigger than its file size suggests (over 50 megapixels), so I did not open it.") from None
    except WorkerError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError):
        raise WorkerError("corrupt", "That picture is damaged, so I could not read it.") from None

    im = ImageOps.exif_transpose(im)
    alpha = _has_alpha(im)
    if im.mode == "P":
        im = im.convert("RGBA" if alpha else "RGB")
    elif im.mode in ("LA", "PA"):
        im = im.convert("RGBA")
    elif im.mode not in ("RGB", "RGBA", "L"):
        im = im.convert("RGBA" if alpha else "RGB")
    im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

    chosen = fmt
    if fmt == "auto":
        chosen = "png" if _flat(im) else "webp"
    buf = io.BytesIO()
    if chosen == "png":
        im.save(buf, "PNG", optimize=True)
    elif chosen == "webp":
        im.save(buf, "WEBP", quality=quality, method=4)
    else:
        if im.mode == "RGBA":
            flat = Image.new("RGB", im.size, (255, 255, 255))
            flat.paste(im, mask=im.getchannel("A"))
            im = flat
        elif im.mode != "RGB" and im.mode != "L":
            im = im.convert("RGB")
        im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue(), im.size[0], im.size[1], chosen


def optimise_file(path: Path, folder: Path, args: dict[str, Any], s: Settings) -> dict[str, Any]:
    out, w, h, fmt = optimise(path.read_bytes(), int(args.get("max", 1568)), str(args.get("format", "auto")), int(args.get("quality", 82)), s.image_pixels_max)
    (folder / "out.img").write_bytes(out)
    return {"width": w, "height": h, "format": fmt, "bytes": len(out)}
