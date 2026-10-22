// The page half of make-blip-loops.ts: runs inside Chromium, with the retuned
// blip.js loaded as `TailzuBlip`. A single arrow function, so the script can
// hand its text to page.evaluate; it returns every loop's frames, cropped.
({ loops, frames, frameMs, dpr, look }) => {
  const out = [];
  for (const l of loops) {
    const blip = l.calm ? globalThis.TailzuBlipCalm : globalThis.TailzuBlip;
    // Room for the raised arm, the antenna, the glow and a hop, on every side.
    const W = Math.ceil(l.H * 3), Hc = Math.ceil(l.H * 2.2), feet = Math.ceil(l.H * 1.7);
    const canvas = document.createElement("canvas");
    const w = blip.createWalker(canvas, {
      dpr, reduced: false, now: () => 0, raf: null, caf: null,
      dot: look.dot, sticker: look.sticker, glow: look.glow, paper: look.paper,
    });
    w.size(W, Hc, dpr);
    w.snap(W / 2, feet, l.H, l.pose);
    // The pose's spring settles over a loop's length (40 x 50 ms), so that the
    // clock is back at the start of a loop when the first frame is drawn.
    for (let i = 0; i < 40; i++) w.draw(0.05);
    const raw = [];
    for (let k = 0; k < frames; k++) {
      w.draw(k ? frameMs / 1000 : 0);
      const copy = document.createElement("canvas");
      copy.width = canvas.width; copy.height = canvas.height;
      copy.getContext("2d").drawImage(canvas, 0, 0);
      raw.push(copy);
    }
    out.push({ name: l.name, size: l.size, raw });
  }
  // One box per size class: the union of everything drawn in it, to the pixel.
  const box = {};
  for (const o of out) {
    for (const c of o.raw) {
      const { data, width, height } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
      let [x0, y0, x1, y1] = box[o.size] || [width, height, 0, 0];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      box[o.size] = [x0, y0, x1, y1];
    }
  }
  // Even pixel counts, so the picture is a whole number of points at 2x.
  const crop = {};
  for (const [k, [x0, y0, x1, y1]] of Object.entries(box)) {
    const m = dpr * 2; // a margin
    const X0 = Math.max(0, x0 - m), Y0 = Math.max(0, y0 - m);
    let w = x1 + m - X0 + 1, h = y1 + m - Y0 + 1;
    w += w % 2; h += h % 2;
    crop[k] = [X0, Y0, w, h];
  }
  return out.map((o) => {
    const [X0, Y0, w, h] = crop[o.size];
    return {
      name: o.name, size: o.size,
      frames: o.raw.map((c) => {
        const t = document.createElement("canvas");
        t.width = w; t.height = h;
        t.getContext("2d").drawImage(c, X0, Y0, w, h, 0, 0, w, h);
        return t.toDataURL("image/png").split(",")[1];
      }),
    };
  });
}
