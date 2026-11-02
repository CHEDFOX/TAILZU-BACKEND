/**
 * The mic mark and its animation, on the keyboard and on the site.
 */

// Brand amber, here only as the brand mark's own colour for its hatched link
// (BRAND_MARK below — shown only where the mark is drawn untinted; on the key
// it wears the key's ink). Not a key, band or fill colour: amber is for what
// is live, and the keyboard's live signal is the dictation dots.
const BRAND_ACCENT = "#E8A23C";

/**
 * THE MARK, AS GEOMETRY. The same seven shapes the site's header, the favicon
 * and the app icon draw: three squares, the hatched link, the line up to the
 * dot. Sent to the keyboards as shapes rather than as a picture, so the mark
 * on the mic key is redrawn from here — resized, recoloured, set moving —
 * without a store build; and so that nothing but geometry can ever stand
 * where the mark stands. A pushed GIF cannot replace it, because the key no
 * longer takes a picture at idle at all.
 *
 * Coordinates are the mark's own artboard; `viewBox` is the part of it the
 * key shows. A shape with an `id` can be given motion below.
 */
const BRAND_MARK = {
  viewBox: [170, 228, 680, 512],
  // The key is round. Fit by the artboard's diagonal, so its corners touch
  // the circle and no square is cut off at the rim; "box" fits the sides.
  fit: "circle",
  // On the key every shape wears the key's own ink (`fg`), as the bundled
  // mark always did. `tint: false` shows the brand colours instead.
  tint: true,
  // Every shape named, in the order a signal travels through the mark: the
  // low square, up the line to the first square, across the link to the
  // second, up the long line to the dot.
  shapes: [
    { id: "line1", kind: "line", x1: 346, y1: 402, x2: 270, y2: 598, width: 9, cap: "round", color: "#E9CBA2" },
    {
      // THE WAVE OF THE ICON, measured from the splash: seven thin bars of
      // uneven height across the line. The bars move like water, in the
      // mark's own ink — nothing lights: a crest passes and each bar rises
      // under it, `swell.height` times taller and `swell.thick` thicker, and
      // collapses behind it.
      id: "link", kind: "bars", x1: 444, y1: 394, x2: 554, y2: 486, thick: 6,
      heights: [28, 36, 41, 46, 43, 34, 28], swell: { thick: 1.3, height: 1.9 }, color: BRAND_ACCENT,
    },
    { id: "line2", kind: "line", x1: 668, y1: 478, x2: 828, y2: 243, width: 9, cap: "round", color: "#C77A3A" },
    { id: "dot", kind: "circle", cx: 828, cy: 243, r: 11, color: "#B06240" },
    { id: "a", kind: "rect", x: 308, y: 269, w: 132, h: 132, rx: 28, color: "#F4F1EA" },
    { id: "b", kind: "rect", x: 558, y: 478, w: 132, h: 132, rx: 28, color: "#F4F1EA" },
    { id: "c", kind: "rect", x: 178, y: 598, w: 132, h: 132, rx: 28, color: "#F4F1EA" },
  ],
};

/**
 * THE MARK ON THE MIC KEY: the three blocks and the wave between them.
 *
 * The owner: "we will be using 3 blocks and the wave between, not the last
 * line on the 3rd block". The long line up from the third block, and the dot
 * it ends in, stay on the brand mark (the icon, the site's header) and come
 * off the key. The view is cut to what is left, the blocks' own extent and
 * the same margin, so the blocks fill the key rather than leave a corner of
 * it empty where the line used to reach. The motion below names `line2` and
 * `dot` still; motion on a shape the mark lacks is ignored.
 */
export const MIC_MARK = {
  ...BRAND_MARK,
  viewBox: [170, 261, 528, 477],
  shapes: BRAND_MARK.shapes.filter((s) => s.id !== "line2" && s.id !== "dot"),
};

/**
 * HOW THE MARK MOVES, AT THE SIZE OF A KEY — the splash, on a loop.
 *
 * The app's splash lights the mark in a sequence: the low square turns
 * amber and goes pale again, then the top square, then a bright cluster of
 * dashes travels down the link between the blocks — the dashes themselves
 * stay put — and the right square lights last. That is the `signal`: a
 * timeline of steps, each naming a shape, when it lights (seconds into the
 * period) and for how long — `hold` for a shape that fills, `run` for a
 * dashed line the cluster travels along, `width` how much of the line the
 * cluster spans, fully lit at its core and soft at its edges. On a 36pt key
 * the squares and the link are the shapes big enough to read, which is why
 * the signal lives on them. `color` is what the shape wears while lit: pale
 * on the key's dark ink.
 *
 * The whole mark (`on: "mark"`) takes a slow `breathe`.
 *
 * `recording` is what the key does while the microphone is open: the
 * dispersal. Everything but the wave leaves. The whole gathers inward a
 * touch (`gather`), then each part — the squares, the plain lines, the dot —
 * leaves in turn, `stagger` seconds after the last, nearest the wave first:
 * out from the middle along an arc bent `arc` key-radii sideways, `out`
 * key-radii away past the rim, turning `spin` degrees, shrinking by
 * `shrink` and fading as it crosses the rim. Once they are away the kept
 * shape (`keep`, the dashed link between the blocks) glides to the middle
 * (`centre`, after `wait` seconds) and grows by `lift`: the wave, and the
 * wave is a sea. The bars are the front of a surface `tide.rows` deep, each
 * row `tide.depth` units behind the last and a little smaller and fainter,
 * the way distance is; between the rows the water is facets of ink, faint,
 * deeper where the crest stands. Two crests travel it, a long slow one
 * (`tide.length` of the line, one pass every `tide.period` seconds) and a
 * shorter quicker one riding it, each row meeting them `tide.skew` of a
 * cycle later so they run diagonally across the water; under a crest the
 * surface rises, up to `tide.rise` of the bars' full swell, its top leaning
 * forward by `tide.lean` of its height — the curl of a breaking wave — and
 * collapses behind it; `tide.mess` adds a third crest running against the
 * others, a chop of short ripples and a slow noise, so no two tides are
 * alike. The rows grow out of the bars as the wave opens and sink back
 * into them as it closes. All in the mark's own ink. Stop is a throw
 * (`back`): the wave settles back into the link, and the parts are hurled
 * in from outside in cascade (`back.stagger` apart), tumbling `back.tumble`
 * extra turns, buffeted by a turbulence of `back.turbulence` key-radii that
 * dies as they close in, on a fast spring (`back.speed`) underdamped by
 * `back.bounce` so each overshoots the core a touch and snaps onto it,
 * within `settle` seconds; then the idle signal resumes. Every part follows
 * one number, its progress from home to away, so a stop mid-flight simply
 * turns it around: nothing ever jumps. A build that predates the dispersal
 * reads `recording` as a name and shows its particles.
 *
 * Motion on a shape the mark lacks is ignored, a kind a build does not know
 * is ignored, and a build older than this ignores all of it and draws its
 * bundled mark: the same picture, still.
 */
/**
 * THE PROGRAM. What the mic key does — the idle signal and breath, the
 * dispersal when the microphone opens, the sea with its tides, the throw
 * home — written in the motion language the keyboards run (see
 * docs/keyboard-spec.md, "The program"). Numbers, functions, springs, and
 * for every shape an expression for where it is, how it is turned, scaled,
 * faded and coloured this frame, plus what to draw around it. A change here
 * is a deploy, not a build; `motion` below stays for builds that predate
 * the program. Checked by tests/catalog.test.ts with the same evaluator.
 */
/*
 * NOTHING COMPUTED THAT IS NOT SEEN. At rest the 42 lines of the sea are
 * invisible (their opacity is q, and q is 0), yet every frame worked out
 * every one of them — ~1,500 function calls and ~29,000 steps a frame, the
 * same at rest as while recording, under every keystroke. Now the sea is
 * counted only while it shows (q > 0.0005), the link's bars skip the sea's
 * crest when there is no sea, and the parts' turbulence is skipped when a
 * part is home. The picture is the same to well under a thousandth of the
 * mark (tests/catalog.test.ts compares the two frame by frame).
 */
export const MIC_PROGRAM = {
  "version": 1,
  // 60 at rest, the same as recording. Builds before K43 run the throw home
  // — the mark coming back together after the microphone closes — at the
  // idle rate, so the idle rate IS that animation's smoothness (at 12 it
  // stuttered). A frame at rest now costs about 3% of what it did (see
  // NOTHING COMPUTED THAT IS NOT SEEN, above), so 60 frames a second is
  // still around a thirteenth of the work 24 used to be. K43 / A4 stop the
  // program at rest altogether (kb.mic.idleStill).
  "fps": {
    "idle": 60,
    "rec": 60
  },
  "colors": {
    "signal": "#F4F1EA"
  },
  "vars": {
    "period": 3.6,
    "n": 6,
    "breathe": 4.2,
    "bscale": 1.06,
    "out": 1.9,
    "spin": 40,
    "arc": 0.22,
    "shrink": 0.45,
    "gather": 0.05,
    "stagger": 0.07,
    "bspeed": 12,
    "bbounce": 0.6,
    "bturb": 0.14,
    "btumble": 1,
    "bstagger": 0.05,
    "lift": 2.8,
    "wait": 0.25,
    "krad": 1.636,
    "ring": 0.72,
    "nt": 42,
    "tick": 0.05,
    "swell": 0.15,
    "sweep": 1.1,
    "turn": 0.12,
    "voice": 0.75,
    "bloom": 0.35,
    "breath": 0.035
  },
  "funcs": {
    "turbs": {
      "args": [],
      "expr": "rec ? 0 : (abs(p) < 0.002 ? 0 : bturb*R*abs(p)*(0.6*sin(t*11 + k*2.1) + 0.4*sin(t*17 + k*0.7)))"
    },
    "turbr": {
      "args": [],
      "expr": "rec ? 0 : (abs(p) < 0.002 ? 0 : bturb*R*0.5*abs(p)*sin(t*13 + k*1.3))"
    },
    "side": {
      "args": [],
      "expr": "arc*R*sin(pi*clamp(p, 0, 1))*sign + turbs()"
    },
    "along": {
      "args": [],
      "expr": "out*R*p + turbr()"
    },
    "ang": {
      "args": [
        "k"
      ],
      "expr": "tau*k/nt + turn*t"
    },
    "rr": {
      "args": [],
      "expr": "krad*R*ring*(bloom + (1 - bloom)*q)*(1 + breath*lv)/lift"
    },
    "cr": {
      "args": [
        "k"
      ],
      "expr": "0.6*crest(ang(k)*2 - sweep*t) + 0.4*crest(ang(k)*3 + sweep*0.7*t + 1)"
    },
    "th": {
      "args": [
        "k"
      ],
      "expr": "(tick*krad*R*(0.5 + 0.5*height(k % cols)/46) + swell*krad*R*cr(k)*(1 - voice + voice*lv))/lift*q"
    },
    "tx": {
      "args": [
        "k",
        "s"
      ],
      "expr": "(x1 + x2)/2 + (lx*cos(ang(k)) + nx*sin(ang(k)))*(rr() + th(k)*s)"
    },
    "ty": {
      "args": [
        "k",
        "s"
      ],
      "expr": "(y1 + y2)/2 + (ly*cos(ang(k)) + ny*sin(ang(k)))*(rr() + th(k)*s)"
    }
  },
  "springs": {
    "p": {
      "scope": "shape",
      "rest": 0,
      "target": "rec ? (since < k*stagger ? 0 : (since < k*stagger + 0.1 ? -gather : 1)) : (since >= (n - 1 - k)*bstagger + 0.12 ? 0 : prev)",
      "rate": "rec ? 6.5 : bspeed",
      "damp": "rec ? 1 : bbounce"
    },
    "q": {
      "scope": "global",
      "rest": 0,
      "target": "rec ? (since >= wait ? 1 : 0) : 0",
      "rate": "7",
      "damp": "1"
    },
    "lv": {
      "scope": "global",
      "rest": 0,
      "target": "rec ? level : 0",
      "rate": "16",
      "damp": "1"
    }
  },
  "mark": {
    "scale": "1 + (bscale - 1)*(0.5 - 0.5*cos(tau*t/breathe))"
  },
  "shapes": {
    "a": {
      "vars": {
        "k": 0,
        "sign": 1
      },
      "dx": "dir.x*along() - dir.y*side()",
      "dy": "dir.y*along() + dir.x*side()",
      "rot": "(spin + (rec ? 0 : btumble*360))*p*sign",
      "scale": "1 - shrink*clamp(p, 0, 1)",
      "opacity": "1 - smooth(0.55, 1, clamp(p, 0, 1))",
      "mix": "rec ? 0 : ramp(t % period, 0.92, 0.42)"
    },
    "b": {
      "vars": {
        "k": 1,
        "sign": -1
      },
      "dx": "dir.x*along() - dir.y*side()",
      "dy": "dir.y*along() + dir.x*side()",
      "rot": "(spin + (rec ? 0 : btumble*360))*p*sign",
      "scale": "1 - shrink*clamp(p, 0, 1)",
      "opacity": "1 - smooth(0.55, 1, clamp(p, 0, 1))",
      "mix": "rec ? 0 : ramp(t % period, 2.33, 0.42)"
    },
    "line1": {
      "vars": {
        "k": 2,
        "sign": 1
      },
      "dx": "dir.x*along() - dir.y*side()",
      "dy": "dir.y*along() + dir.x*side()",
      "rot": "(spin + (rec ? 0 : btumble*360))*p*sign",
      "scale": "1 - shrink*clamp(p, 0, 1)",
      "opacity": "1 - smooth(0.55, 1, clamp(p, 0, 1))"
    },
    "c": {
      "vars": {
        "k": 3,
        "sign": 1
      },
      "dx": "dir.x*along() - dir.y*side()",
      "dy": "dir.y*along() + dir.x*side()",
      "rot": "(spin + (rec ? 0 : btumble*360))*p*sign",
      "scale": "1 - shrink*clamp(p, 0, 1)",
      "opacity": "1 - smooth(0.55, 1, clamp(p, 0, 1))",
      "mix": "rec ? 0 : ramp(t % period, 0.33, 0.42)"
    },
    "link": {
      "dx": "(cx - home.x)*q",
      "dy": "(cy - home.y)*q",
      "rot": "(180 - atan2(y2 - y1, x2 - x1)*180/pi)*q",
      "scale": "1 + (lift - 1)*q",
      "rise": "q > 0.0005 ? max(q*clamp(0.2*cr(i*6) + 1.1*lv*(0.6 + 0.4*sin(t*9 + i*1.7)), 0, 1), run(f, t % period, 1.33, 0.95, 0.3)*(1 - q)) : run(f, t % period, 1.33, 0.95, 0.3)",
      "lean": "0"
    }
  },
  "emit": [
    {
      "attach": "link",
      "kind": "line",
      "repeat": [
        "q > 0.0005 ? nt : 0"
      ],
      "as": [
        "k"
      ],
      "x1": "tx(k, -0.3)",
      "y1": "ty(k, -0.3)",
      "x2": "tx(k, 0.7)",
      "y2": "ty(k, 0.7)",
      "opacity": "q*(0.42 + 0.5*cr(k)*(0.5 + 0.5*lv))",
      "width": "thick*1.5",
      "color": "ink"
    }
  ],
  "settle": {
    "eps": 0.002,
    "timeout": 1.4
  }
};

export const MIC_MOTION = {
  idle: [
    {
      on: "mark", kind: "signal", period: 3.6, color: "#F4F1EA",
      steps: [
        { on: "c", at: 0.33, hold: 0.42 },
        { on: "a", at: 0.92, hold: 0.42 },
        { on: "link", at: 1.33, run: 0.95, width: 0.3 },
        { on: "b", at: 2.33, hold: 0.42 },
      ],
    },
    { on: "mark", kind: "breathe", period: 4.2, scale: 1.06, opacity: 1 },
  ],
  recording: {
    kind: "disperse", keep: "link", out: 1.9, spin: 40, arc: 0.22, shrink: 0.45, gather: 0.05, stagger: 0.07, settle: 1.4,
    back: { speed: 12, bounce: 0.6, turbulence: 0.14, tumble: 1, stagger: 0.05 },
    wave: { lift: 2, centre: true, wait: 0.25, tide: { period: 1.2, length: 0.6, rise: 1, rows: 5, depth: 14, lean: 0.55, skew: 0.09, mess: 0.7 } },
  },
};
