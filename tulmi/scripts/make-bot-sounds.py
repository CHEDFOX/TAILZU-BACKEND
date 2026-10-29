#!/usr/bin/env python3
"""
THE BOTS' SOUNDS: made here, from nothing but maths (no samples from anywhere).

Pull-a-bot throws a bot off the list with a sound (one of a pack, never the same twice running, a rare funny one now and
then), ticks when the pull crosses the line, chimes when there is something new, says a small "hmm" when there is not;
the bots' moments (sneeze, a tiny fart, celebrate, hiccup, a clap) have theirs. All short (<= 450 ms), warm, quiet.

    python3 scripts/make-bot-sounds.py            # make them all: masters, the phone's files, the catalog
    python3 scripts/make-bot-sounds.py --bump     # the same, and raise the catalog's v (the apps fetch the new pack)
    python3 scripts/make-bot-sounds.py --check    # only analyse what is there

Writes, from the repo root:
    shared/bots/sounds/masters/<id>.wav   44.1 kHz mono 16-bit masters
    shared/bots/sounds/<id>.m4a           AAC 96 kb/s, what the server serves (/bots/sounds/, server.ts)
    shared/bots/sounds.json               the catalog: v, and each sound's id, file, hash, kind, weight, rare, ms, label

Each sound is normalised to a loudness by kind (K-weighted, the loudest 100 ms: throw -20 LUFS, tick -27, new -21,
uptodate -23, moment -23), its true peak kept under -2 dBFS, with a short fade in and out and no DC. Then it is checked:
no clipping, silent ends, no offset, the length. Needs numpy and ffmpeg (with its aac encoder).
"""
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "shared", "bots", "sounds")
MASTERS = os.path.join(OUT, "masters")
CATALOG = os.path.join(ROOT, "shared", "bots", "sounds.json")
MAX_MS = 450
TARGET = {"throw": -20.0, "tick": -27.0, "new": -21.0, "uptodate": -23.0, "moment": -23.0}
PEAK_DB = -2.0

rng = np.random.default_rng(20261029)


# ----------------------------------------------------------------------------- building blocks

def secs(n):
    return np.arange(int(round(n * SR))) / SR


def phase(freq):
    """A frequency curve (Hz per sample) to a running phase, so sweeps and wobbles stay continuous."""
    return 2 * np.pi * np.cumsum(freq) / SR


def edecay(t, tau):
    return np.exp(-t / tau)


def attack(t, a):
    """A raised-cosine rise over `a` seconds."""
    x = np.clip(t / max(a, 1e-6), 0, 1)
    return 0.5 - 0.5 * np.cos(np.pi * x)


def place(out, sig, at):
    i = int(round(at * SR))
    n = min(len(sig), len(out) - i)
    if n > 0:
        out[i:i + n] += sig[:n]
    return out


def biquad(x, b, a):
    """Direct form II transposed, one sample at a time (no scipy)."""
    b0, b1, b2 = b
    _, a1, a2 = a
    y = np.zeros_like(x)
    z1 = z2 = 0.0
    for i, xi in enumerate(x):
        yi = b0 * xi + z1
        z1 = b1 * xi - a1 * yi + z2
        z2 = b2 * xi - a2 * yi
        y[i] = yi
    return y


def rbj(kind, f, q=0.707, gain_db=0.0):
    """RBJ cookbook coefficients, normalised (a0 = 1)."""
    w = 2 * np.pi * f / SR
    cw, sw = np.cos(w), np.sin(w)
    al = sw / (2 * q)
    A = 10 ** (gain_db / 40)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]; a = [1 + al, -2 * cw, 1 - al]
    elif kind == "hp":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]; a = [1 + al, -2 * cw, 1 - al]
    elif kind == "bp":
        b = [al, 0, -al]; a = [1 + al, -2 * cw, 1 - al]
    elif kind == "peak":
        b = [1 + al * A, -2 * cw, 1 - al * A]; a = [1 + al / A, -2 * cw, 1 - al / A]
    elif kind == "hshelf":
        sq = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sq)]
        a = [(A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sq]
    else:
        raise ValueError(kind)
    return [v / a[0] for v in b], [1.0, a[1] / a[0], a[2] / a[0]]


def filt(x, kind, f, q=0.707, gain_db=0.0):
    b, a = rbj(kind, f, q, gain_db)
    return biquad(x, b, a)


def sweep_bp(x, f_of_t, q):
    """A band-pass whose centre moves (64-sample blocks, its state carried over)."""
    y = np.zeros_like(x)
    z1 = z2 = 0.0
    for s in range(0, len(x), 64):
        f = float(np.clip(f_of_t(s / SR), 40, SR * 0.45))
        (b0, b1, b2), (_, a1, a2) = rbj("bp", f, q)
        for i in range(s, min(s + 64, len(x))):
            xi = x[i]
            yi = b0 * xi + z1
            z1 = b1 * xi - a1 * yi + z2
            z2 = b2 * xi - a2 * yi
            y[i] = yi
    return y


def formants(src, t, f_of_t):
    """A voice: the source through three moving band-passes (vowel formants), summed with their weights."""
    out = np.zeros_like(src)
    for k, (q, w) in enumerate([(6, 1.0), (8, 0.6), (10, 0.25)]):
        out += w * sweep_bp(src, lambda tt, k=k: f_of_t(tt)[k], q)
    return out


def harmonics(freq, n, tilt=1.0, odd=False):
    """A band-limited buzz (harmonics up to Nyquist) on a frequency curve."""
    ph = phase(freq)
    out = np.zeros_like(freq)
    for k in range(1, n + 1):
        if odd and k % 2 == 0:
            continue
        lim = (freq * k) < SR * 0.45
        out += lim * np.sin(k * ph) / (k ** tilt)
    return out


def modal(t, f0, modes, at=0.0):
    """Struck modes: (ratio, amplitude, decay seconds) each, from time `at`."""
    out = np.zeros_like(t)
    tt = np.clip(t - at, 0, None)
    on = t >= at
    for r, amp, tau in modes:
        if f0 * r < SR * 0.45:
            out += on * amp * np.sin(2 * np.pi * f0 * r * tt) * edecay(tt, tau)
    return out * attack(tt, 0.0015)


def noise(n):
    return rng.standard_normal(n)


def room(x, mix=0.12, length=0.07):
    """A tiny warm room: decaying low-passed noise as an impulse response, mixed in quietly."""
    t = secs(length)
    ir = noise(len(t)) * edecay(t, length / 4)
    ir = filt(ir, "lp", 3200)
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-12
    wet = np.convolve(x, ir)[: len(x)]
    return x + mix * wet


def soft(x, drive=1.4):
    return np.tanh(drive * x) / np.tanh(drive)


def finish(x, fade_in=0.003, fade_out=0.018):
    """No DC (a gentle high-pass and the mean), a raised-cosine fade at each end."""
    x = filt(x, "hp", 30)
    x = x - np.mean(x)
    n = len(x)
    i = max(1, int(fade_in * SR)); o = max(1, int(fade_out * SR))
    x[:i] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(i) / i)
    x[n - o:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(o) / o)
    x[0] = 0.0; x[-1] = 0.0
    return x


# ----------------------------------------------------------------------------- the sounds

def boing():
    t = secs(0.42)
    wob = 0.38 * edecay(t, 0.11) * np.sin(2 * np.pi * 13.5 * t)
    f = (175 + 70 * (1 - edecay(t, 0.18))) * (1 + wob)
    ph = phase(f)
    x = np.sin(ph) + 0.28 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    x *= attack(t, 0.004) * edecay(t, 0.15)
    return room(filt(soft(x, 1.2), "lp", 2600), 0.1)


def pop():
    t = secs(0.17)
    f = 260 + 820 * (1 - edecay(t, 0.018))
    x = np.sin(phase(f)) * attack(t, 0.0015) * edecay(t, 0.05)
    click = filt(noise(len(t)), "bp", 2400, 1.2) * edecay(t, 0.004) * 0.25
    return room(filt(x + click, "lp", 5000), 0.08)


def plink():
    t = secs(0.44)
    x = modal(t, 784.0, [(1, 1.0, 0.24), (3.92, 0.22, 0.05), (9.1, 0.07, 0.016), (2.0, 0.08, 0.12)])
    thunk = filt(noise(len(t)), "lp", 900) * edecay(t, 0.006) * 0.18
    return room(x + thunk, 0.14)


def whee():
    t = secs(0.42)
    swell = attack(t, 0.16) * edecay(np.clip(t - 0.16, 0, None), 0.08)
    air = sweep_bp(noise(len(t)), lambda s: 500 + 2600 * (s / 0.42) ** 1.3, 2.2) * swell * 0.55
    f = 620 * (1 + 0.95 * (t / 0.42) ** 1.6) * (1 + 0.012 * np.sin(2 * np.pi * 9 * t))
    tone = (np.sin(phase(f)) + 0.15 * np.sin(2 * phase(f))) * attack(np.clip(t - 0.06, 0, None), 0.08) * edecay(np.clip(t - 0.18, 0, None), 0.11) * 0.32
    return room(filt(air + tone, "lp", 6500), 0.1)


def squeak():
    t = secs(0.21)
    u = t / 0.21
    f = 980 + 820 * np.sin(np.pi * np.clip(u * 1.05, 0, 1)) ** 0.8 + 120 * u
    buzz = harmonics(f, 10, 1.1)
    nasal = filt(filt(buzz, "peak", 2600, 2.0, 9), "lp", 4200)
    flutter = 1 + 0.12 * np.sin(2 * np.pi * 47 * t)
    env = attack(t, 0.01) * (1 - attack(np.clip(t - 0.15, 0, None), 0.06)) * flutter
    breath = filt(noise(len(t)), "bp", 2800, 1.5) * env * 0.05
    return room(soft(nasal * env * 0.4, 1.6) + breath, 0.1)


def tok():
    t = secs(0.24)
    exc = noise(len(t)) * edecay(t, 0.0015)
    one = modal(t, 540.0, [(1, 1.0, 0.045), (2.43, 0.45, 0.018), (3.9, 0.2, 0.009)])
    two = modal(t, 760.0, [(1, 0.5, 0.035), (2.43, 0.22, 0.014)], at=0.085)
    body = filt(exc, "bp", 700, 1.4) * 0.35
    return room(one + two + body, 0.16)


def ping():
    t = secs(0.45)
    x = modal(t, 1318.5, [(1, 1.0, 0.22), (1.0023, 0.5, 0.2), (2.76, 0.25, 0.07), (5.4, 0.08, 0.025)])
    return room(filt(x, "lp", 9000), 0.18)


def chirp():
    t = secs(0.27)
    out = np.zeros_like(t)
    for i, (f0, at) in enumerate([(1047, 0.0), (1319, 0.075), (1760, 0.15)]):
        d = 0.06 if i < 2 else 0.1
        tt = secs(d)
        f = f0 * (1 + 0.06 * (tt / d)) * (1 + (0.04 * np.sin(2 * np.pi * 38 * tt) if i == 2 else 0))
        b = harmonics(f, 7, 1.0, odd=True) * attack(tt, 0.003) * (1 - attack(np.clip(tt - d + 0.015, 0, None), 0.015))
        place(out, b * 0.35, at)
    return room(filt(out, "lp", 4200), 0.12)


def twang():
    t = secs(0.4)
    f = 150 * (1 + 0.22 * edecay(t, 0.035)) * (1 + 0.012 * np.sin(2 * np.pi * 6 * t))
    ph = phase(f)
    x = np.zeros_like(t)
    for k in range(1, 14):
        if 150 * k > SR * 0.4:
            break
        x += np.sin(k * ph) / (k ** 1.15) * edecay(t, 0.26 / (k ** 0.7))
    x *= attack(t, 0.002)
    return room(filt(soft(x * 0.6, 1.3), "lp", 3000), 0.12)


def bloop():
    t = secs(0.2)
    f = 240 * np.exp(np.log(760 / 240) * np.clip(t / 0.06, 0, 1)) + 40 * t
    x = (np.sin(phase(f)) + 0.12 * np.sin(2 * phase(f))) * attack(t, 0.004) * edecay(t, 0.055)
    two = np.zeros_like(t)
    tt = secs(0.1)
    f2 = 420 * np.exp(np.log(980 / 420) * np.clip(tt / 0.04, 0, 1))
    place(two, np.sin(phase(f2)) * attack(tt, 0.003) * edecay(tt, 0.03) * 0.35, 0.085)
    return room(filt(x + two, "lp", 3800), 0.1)


def hop():
    t = secs(0.24)
    f = np.where(t < 0.085, 523.25 * (1 + 0.04 * t / 0.085), 784 + 80 * np.clip((t - 0.085) / 0.05, 0, 1))
    ph = phase(f)
    tri = (8 / np.pi ** 2) * (np.sin(ph) - np.sin(3 * ph) / 9 + np.sin(5 * ph) / 25)
    env = attack(t, 0.004) * np.where(t < 0.08, 1.0, 0.85) * edecay(np.clip(t - 0.09, 0, None), 0.06)
    dip = 1 - 0.7 * np.exp(-((t - 0.083) / 0.006) ** 2)
    return room(filt(tri * env * dip, "lp", 4500), 0.1)


def zip_():
    t = secs(0.17)
    f = 380 * np.exp(np.log(2500 / 380) * (t / 0.13) ** 0.9)
    f = np.minimum(f, 2800)
    ph = phase(f)
    x = (np.sin(ph) + 0.25 * np.sin(2 * ph)) * attack(t, 0.006) * edecay(np.clip(t - 0.09, 0, None), 0.025)
    air = filt(noise(len(t)), "hp", 3000) * attack(t, 0.04) * edecay(np.clip(t - 0.08, 0, None), 0.03) * 0.08
    return room(filt(x * 0.8 + air, "lp", 7000), 0.08)


def slide():
    """The rare one: a slide whistle, up and down, breathy."""
    t = secs(0.45)
    up = np.clip(t / 0.2, 0, 1)
    down = np.clip((t - 0.2) / 0.22, 0, 1)
    f = 560 + 1000 * (0.5 - 0.5 * np.cos(np.pi * up)) - 1120 * (0.5 - 0.5 * np.cos(np.pi * down))
    f = np.maximum(f, 380) * (1 + 0.018 * np.sin(2 * np.pi * 7 * t))
    tone = (np.sin(phase(f)) + 0.06 * np.sin(2 * phase(f))) * attack(t, 0.02) * (1 - attack(np.clip(t - 0.4, 0, None), 0.045))
    breath = sweep_bp(noise(len(t)), lambda s: float(np.interp(s, t, f)), 4) * 0.12
    env = attack(t, 0.02) * (1 - attack(np.clip(t - 0.4, 0, None), 0.045))
    return room(filt(tone * 0.7 + breath * env, "lp", 5000), 0.12)


def tick():
    t = secs(0.05)
    x = modal(t, 2200.0, [(1, 1.0, 0.006), (1.62, 0.5, 0.004)])
    exc = filt(noise(len(t)), "bp", 3200, 1.0) * edecay(t, 0.0012) * 0.4
    return x + exc


def chime():
    t = secs(0.45)
    bell = [(1, 1.0, 0.26), (2.0, 0.22, 0.12), (3.0, 0.07, 0.05), (4.2, 0.03, 0.02)]
    x = modal(t, 783.99, bell) * 0.85 + modal(t, 1046.5, bell, at=0.11)
    return room(filt(x, "lp", 7000), 0.2)


def hmm():
    t = secs(0.4)
    f = np.where(t < 0.17, 392 - 10 * t / 0.17, 311 - 25 * np.clip((t - 0.17) / 0.2, 0, 1))
    f = f * (1 + 0.008 * np.sin(2 * np.pi * 5.5 * t))
    ph = phase(f)
    x = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    env = attack(t, 0.03) * (1 - 0.75 * np.exp(-((t - 0.17) / 0.018) ** 2)) * (1 - attack(np.clip(t - 0.3, 0, None), 0.09))
    return room(filt(filt(x * env, "lp", 1400), "peak", 260, 1.2, 3), 0.1)


def voice_src(f, n=24):
    """A soft glottal buzz on a pitch curve."""
    return harmonics(f, n, 1.3)


def sneeze():
    t = secs(0.45)
    # "ah": a rising, breathy vowel
    a_len = 0.2
    ta = secs(a_len)
    fa = 230 + 110 * (ta / a_len) ** 1.5
    src = voice_src(fa) * 0.5 + noise(len(ta)) * 0.25
    ah = formants(src, ta, lambda s: (720, 1220, 2600)) * attack(ta, 0.08) * (1 - attack(np.clip(ta - 0.17, 0, None), 0.03))
    # "choo": a burst, then a falling "oo"
    c_len = 0.21
    tc = secs(c_len)
    ch = filt(filt(noise(len(tc)), "hp", 1800), "peak", 3800, 1.2, 6) * attack(tc, 0.004) * edecay(tc, 0.035) * 0.9
    fo = 300 - 70 * (tc / c_len)
    oo = formants(voice_src(fo) * 0.6 + noise(len(tc)) * 0.15, tc, lambda s: (330, 880, 2300)) * attack(np.clip(tc - 0.02, 0, None), 0.015) * edecay(np.clip(tc - 0.05, 0, None), 0.07)
    out = np.zeros_like(t)
    place(out, ah * 1.6, 0.0)
    place(out, ch * 0.8 + oo, 0.22)
    return room(filt(out, "lp", 7000), 0.1)


def fart_small():
    """Tasteful: a tiny "prrt", soft and low, rising at its end."""
    t = secs(0.24)
    jitter = 1 + 0.06 * np.cumsum(noise(len(t))) / np.sqrt(len(t))
    f = (92 + 40 * np.clip((t - 0.15) / 0.06, 0, 1)) * jitter
    buzz = harmonics(f, 18, 0.9)
    flutter = 0.6 + 0.4 * np.sin(2 * np.pi * 24 * t) ** 2
    env = attack(t, 0.012) * (1 - attack(np.clip(t - 0.2, 0, None), 0.035))
    breath = filt(noise(len(t)), "lp", 500) * 0.25
    return room(filt(filt((buzz * 0.5 * flutter + breath) * env, "lp", 650), "peak", 180, 1.0, 4), 0.08)


def party():
    t = secs(0.45)
    out = np.zeros_like(t)
    for i, f0 in enumerate([1046.5, 1318.5, 1568.0, 2093.0]):
        tt = secs(0.3)
        place(out, modal(tt, f0, [(1, 1.0, 0.09), (3.92, 0.16, 0.02), (2.0, 0.06, 0.05)]) * (0.7 + 0.1 * i), 0.045 * i)
    for _ in range(9):
        at = 0.16 + rng.random() * 0.22
        tt = secs(0.06)
        place(out, np.sin(2 * np.pi * (3500 + rng.random() * 2500) * tt) * edecay(tt, 0.012) * attack(tt, 0.001) * 0.18, at)
    return room(filt(out, "lp", 9000), 0.16)


def hic():
    t = secs(0.17)
    d = 0.1
    tt = secs(d)
    f = 300 + 260 * (1 - edecay(tt, 0.012))
    v = formants(voice_src(f) * 0.6, tt, lambda s: (330, 2300, 3000)) * attack(tt, 0.003) * edecay(np.clip(tt - 0.02, 0, None), 0.03)
    gulp = filt(noise(len(tt)), "bp", 900, 1.5) * edecay(tt, 0.006) * 0.4
    out = np.zeros_like(t)
    place(out, v + gulp, 0.0)
    return room(filt(out, "lp", 6000), 0.12)


def clap():
    t = secs(0.2)
    out = np.zeros_like(t)
    for k, at in enumerate([0.0, 0.009, 0.017, 0.026]):
        n = secs(0.12)
        b = filt(filt(noise(len(n)), "bp", 1500, 0.9), "peak", 2400, 1.0, 3) * attack(n, 0.0008) * edecay(n, 0.006 if k < 3 else 0.03)
        place(out, b * (0.7 if k < 3 else 1.0), at)
    return room(out, 0.25, 0.09)


# id, maker, kind, weight, rare, label
SOUNDS = [
    ("boing", boing, "throw", 3, False, "Springy boing"),
    ("pop", pop, "throw", 3, False, "Bubbly pop"),
    ("plink", plink, "throw", 3, False, "Soft plink"),
    ("whee", whee, "throw", 3, False, "Whoosh, whee"),
    ("squeak", squeak, "throw", 2, False, "Toy squeak"),
    ("tok", tok, "throw", 2, False, "Wooden tok"),
    ("ping", ping, "throw", 2, False, "Glassy ping"),
    ("chirp", chirp, "throw", 3, False, "Robot chirp"),
    ("twang", twang, "throw", 2, False, "Rubber-band twang"),
    ("bloop", bloop, "throw", 3, False, "Soft bloop"),
    ("hop", hop, "throw", 2, False, "Bip-boop hop"),
    ("zip", zip_, "throw", 2, False, "Quick zip"),
    ("slide", slide, "throw", 1, True, "Slide whistle (rare)"),
    ("tick", tick, "tick", 1, False, "The line"),
    ("chime", chime, "new", 1, False, "Something new"),
    ("hmm", hmm, "uptodate", 1, False, "Up to date"),
    ("sneeze", sneeze, "moment", 1, False, "Sneeze"),
    ("fart.small", fart_small, "moment", 1, False, "A tiny one"),
    ("party", party, "moment", 1, False, "Celebrate"),
    ("hic", hic, "moment", 1, False, "Hiccup"),
    ("clap", clap, "moment", 1, False, "Clap"),
]


# ----------------------------------------------------------------------------- loudness, checks, files

_K = None


def k_weight(x):
    """ITU-R BS.1770 K-weighting at 44.1 kHz (its shelf, then its high-pass)."""
    global _K
    if _K is None:
        # The standard's two stages, re-derived for 44.1 kHz.
        f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
        K = math.tan(math.pi * f0 / SR); Vh = 10 ** (G / 20); Vb = Vh ** 0.4996667741545416
        a0 = 1 + K / Q + K * K
        s1 = ([(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0])
        f0, Q = 38.13547087602444, 0.5003270373238773
        K = math.tan(math.pi * f0 / SR)
        a0 = 1 + K / Q + K * K
        s2 = ([1, -2, 1], [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0])
        _K = (s1, s2)
    (b1, a1), (b2, a2) = _K
    return biquad(biquad(x, b1, a1), b2, a2)


def loudness(x, win=0.1):
    """The loudest `win` seconds, K-weighted, in LUFS (a short sound's loudness: integrated gating needs 400 ms blocks)."""
    y = k_weight(np.concatenate([x, np.zeros(int(win * SR))]))
    n = int(win * SR)
    c = np.concatenate([[0.0], np.cumsum(y * y)])
    ms = (c[n:] - c[:-n]) / n
    return -0.691 + 10 * math.log10(max(float(np.max(ms)), 1e-12))


def true_peak_db(x):
    """Peak after 4x oversampling (by FFT), in dBFS."""
    n = len(x)
    X = np.fft.rfft(x)
    Y = np.zeros(2 * n + 1, dtype=complex)
    Y[: len(X)] = X
    up = np.fft.irfft(Y, 4 * n) * 4
    return 20 * math.log10(max(float(np.max(np.abs(up))), 1e-12))


def normalise(x, kind):
    g = 10 ** ((TARGET[kind] - loudness(x)) / 20)
    x = x * g
    over = true_peak_db(x) - PEAK_DB
    if over > 0:
        x = x * 10 ** (-over / 20)
    return x


def checks(name, x):
    errs = []
    ms = 1000 * len(x) / SR
    if ms > MAX_MS:
        errs.append(f"{ms:.0f} ms is over {MAX_MS}")
    if not np.all(np.isfinite(x)):
        errs.append("not finite")
    pk = 20 * math.log10(max(float(np.max(np.abs(x))), 1e-12))
    if pk > -1.0:
        errs.append(f"peak {pk:.1f} dBFS")
    if abs(float(np.mean(x))) > 1e-4:
        errs.append(f"DC {float(np.mean(x)):.2e}")
    # Silent ends: the first and last samples at zero, and the last 2 ms all but silent (the fade did its work).
    if abs(float(x[0])) > 1e-4 or abs(float(x[-1])) > 1e-4:
        errs.append("ends not at zero")
    tail = x[-int(0.002 * SR):]
    if 20 * math.log10(max(float(np.sqrt(np.mean(tail ** 2))), 1e-12)) > -50:
        errs.append("tail not silent")
    # A click: a jump between samples far above what the sound's own highs make.
    d = np.abs(np.diff(x))
    if float(np.max(d)) > 0.5:
        errs.append(f"jump {float(np.max(d)):.2f}")
    return errs


def write_wav(path, x):
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def read_wav(path):
    with wave.open(path, "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0


def encode(wav, m4a):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", wav, "-c:a", "aac", "-b:a", "96k", "-ar", str(SR), "-ac", "1",
                    "-movflags", "+faststart", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", m4a], check=True)


def decoded(m4a):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "x.wav")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", m4a, "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", p], check=True)
        return read_wav(p)


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def main():
    check_only = "--check" in sys.argv
    os.makedirs(MASTERS, exist_ok=True)
    old = {}
    if os.path.exists(CATALOG):
        with open(CATALOG) as f:
            old = json.load(f)
    v = int(old.get("v", 0)) or 1
    if "--bump" in sys.argv:
        v += 1
    entries, bad = [], 0
    print(f"{'id':<12} {'kind':<9} {'ms':>4} {'LUFS':>6} {'peak':>6} {'m4a peak':>8}  checks")
    for sid, make, kind, weight, rare, label in SOUNDS:
        wav = os.path.join(MASTERS, f"{sid}.wav")
        m4a = os.path.join(OUT, f"{sid}.m4a")
        if check_only:
            x = read_wav(wav)
        else:
            x = finish(normalise(finish(make()), kind))
            write_wav(wav, x)
            x = read_wav(wav)
            encode(wav, m4a)
        dec = decoded(m4a)
        errs = checks(sid, x)
        dpk = 20 * math.log10(max(float(np.max(np.abs(dec))), 1e-12))
        if dpk > -0.5:
            errs.append(f"m4a peak {dpk:.1f}")
        bad += len(errs)
        ms = round(1000 * len(x) / SR)
        print(f"{sid:<12} {kind:<9} {ms:>4} {loudness(x):>6.1f} {20 * math.log10(float(np.max(np.abs(x)))):>6.1f} {dpk:>8.1f}  {'ok' if not errs else '; '.join(errs)}")
        e = {"id": sid, "file": f"{sid}.m4a", "hash": sha(m4a), "kind": kind, "weight": weight, "ms": ms, "label": label}
        if rare:
            e["rare"] = True
        entries.append(e)
    if not check_only:
        cat = {
            "v": v,
            "note": "The bots' sounds (tulmi/scripts/make-bot-sounds.py makes them; docs/bots-app.md \"Sounds\"). Raise v with every change: the apps fetch a new pack when it moves.",
            "sounds": entries,
        }
        with open(CATALOG, "w") as f:
            json.dump(cat, f, indent=2)
            f.write("\n")
        print(f"wrote {len(entries)} sounds, v {v} -> {os.path.relpath(CATALOG, ROOT)}")
    if bad:
        print(f"{bad} problem(s)")
        sys.exit(1)


if __name__ == "__main__":
    main()
