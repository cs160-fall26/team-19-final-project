#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

/*
 * look.js: instruments for studying a reference image.
 *
 * Looking at an image gives an impression. These commands give facts: what a
 * region looks like up close, which colours it holds, where things sit, what
 * a shape's outline is, and what a part you built looks like next to the
 * place it came from. USAGE lists them; `look.js` without arguments prints it.
 */

const USAGE = `look.js: instruments for studying a reference image.

Every box is x,y,w,h and every point is x,y, in fractions of the whole image,
with 0,0 at the top left. A box may be named: --box title=0.2,0,0.6,0.15

  look.js info    <image>
  look.js grid    <image> <out.png> [--box x,y,w,h] [--step 0.05]
  look.js crop    <image> <out.png> --box x,y,w,h [--width px]
  look.js sample  <image> --box [name=]x,y,w,h [--box ...]
  look.js palette <image> [--box x,y,w,h] [--k 6]
  look.js ramp    <image> --from x,y --to x,y [--steps 6]
  look.js trace   <image> <out.svg> --box x,y,w,h [--light | --near #hex] [--threshold 0-255] [--tol 0.08] [--simplify 1.2] [--drop-edge]
  look.js shot    <page.html> <out.png> [--size 1400x900] [--full]
  look.js pair    <left.png> <right.png> <out.png> [--labels reference,rebuilt]
  look.js page    <study.json>

page checks a study, draws every part from its file, and writes the part
pictures, one comparison per part, parts/index.json, study.html and study.png.

shot and page need a browser, and a browser cannot start inside a sandboxed
shell (a Codex session, for example). For that case, whoever launches the
agent runs this outside the sandbox first:

  look.js serve   <folder> [<folder of its own>]

It renders pages inside <folder>, offline, for as long as it runs. shot and
page find it by themselves.`;

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

function fail(message) {
  console.error(`look.js: ${message}`);
  process.exit(1);
}

/** Removes `file` if it is a link, so that writing to it cannot land somewhere else. */
function dropLink(file) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
  } catch {
    // Nothing is there yet.
  }
}

/** Writes a file that `page` owns. */
function writeOwn(file, data) {
  dropLink(file);
  fs.writeFileSync(file, data);
}

let sharp;
try {
  sharp = require("sharp");
} catch {
  fail("the `sharp` package is missing. Run this from the project's folder, or set NODE_PATH to a node_modules folder that has sharp.");
}

/* ---------- arguments ---------- */

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : argv[(i += 1)];
    (options[arg.slice(2)] ??= []).push(value);
  }
  return { positional, options };
}

const last = (options, key, fallback) => (options[key] ? options[key].at(-1) : fallback);

function parseBox(text) {
  if (typeof text !== "string") fail("a box is written x,y,w,h in fractions of the image, for example --box 0.2,0.1,0.5,0.3");
  const named = text.includes("=");
  const name = named ? text.slice(0, text.indexOf("=")) : null;
  const numbers = (named ? text.slice(text.indexOf("=") + 1) : text).split(",").map(Number);
  if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) {
    fail(`"${text}" is not a box. Write x,y,w,h in fractions of the image.`);
  }
  const [x, y, w, h] = numbers;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0005 || y + h > 1.0005) {
    fail(`box ${text} leaves the image. Fractions run from 0 to 1, and x+w and y+h must stay within 1.`);
  }
  return { name, x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

function parsePoint(text, flag) {
  const numbers = typeof text === "string" ? text.split(",").map(Number) : [];
  if (numbers.length !== 2 || numbers.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
    fail(`--${flag} takes a point x,y in fractions of the image.`);
  }
  return { x: numbers[0], y: numbers[1] };
}

const WHOLE = { name: null, x: 0, y: 0, w: 1, h: 1 };

/* ---------- pixels ---------- */

async function openImage(file) {
  if (!file || !fs.existsSync(file)) fail(`no such image: ${file}`);
  // Applies the EXIF rotation once, so every later step sees the image upright.
  const buffer = await sharp(file).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width, height: meta.height };
}

function toPixels(box, image) {
  const left = Math.min(image.width - 1, Math.round(box.x * image.width));
  const top = Math.min(image.height - 1, Math.round(box.y * image.height));
  return {
    left,
    top,
    width: Math.max(1, Math.min(image.width - left, Math.round(box.w * image.width))),
    height: Math.max(1, Math.min(image.height - top, Math.round(box.h * image.height))),
  };
}

async function readPixels(image, box, maxEdge, kernel = "lanczos3") {
  let pipeline = sharp(image.buffer).extract(toPixels(box, image));
  if (maxEdge) {
    pipeline = pipeline.resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true, kernel });
  }
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/* ---------- colour ---------- */

const hex = (r, g, b) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

function parseHex(text) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(text).trim());
  if (!match) fail(`"${text}" is not a six-digit hex colour.`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toLinear = (channel) => {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

// OKLab: distances in it match how different two colours look.
function toOklab(r, g, b) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, fromLinear(v))) * 255);
}

/** "#rrggbb  L 0.62 C 0.11 h 187": lightness 0-1, chroma (0 is grey), hue in degrees. */
function describe(r, g, b) {
  const [L, a, bb] = toOklab(r, g, b);
  const chroma = Math.hypot(a, bb);
  const hue = chroma < 0.02 ? "  -" : String(Math.round(((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360)).padStart(3);
  return `${hex(r, g, b)}  L ${L.toFixed(2)} C ${chroma.toFixed(2)} h ${hue}`;
}

const percent = (share) => (share >= 0.1 ? `${Math.round(share * 100)}%` : `${(share * 100).toFixed(1)}%`);

/* ---------- info, crop, grid ---------- */

async function info(image) {
  console.log(`${image.width} x ${image.height} px, aspect ${(image.width / image.height).toFixed(3)} (width / height)`);
}

async function crop(image, out, box, options) {
  const region = toPixels(box, image);
  const natural = Math.min(6, Math.max(1, 1200 / Math.max(region.width, region.height)));
  const width = Number(last(options, "width", 0)) || Math.round(region.width * natural);
  await sharp(image.buffer).extract(region).resize({ width, kernel: "lanczos3" }).png().toFile(out);
  console.log(`${out}: ${region.width} x ${region.height} px of the image, enlarged to ${width} px wide`);
}

async function grid(image, out, box, options) {
  const region = toPixels(box, image);
  const scale = Math.min(6, Math.max(1, 1400 / Math.max(region.width, region.height)));
  const width = Math.round(region.width * scale);
  const height = Math.round(region.height * scale);
  // Fine enough that the short side gets four lines, coarse enough that the
  // labels on the long side do not run into each other.
  const steps = [0.1, 0.05, 0.02, 0.01, 0.005, 0.002];
  let step = Number(last(options, "step", NaN));
  if (!(step > 0)) {
    let pick = steps.findIndex((s) => Math.min(box.w, box.h) / s >= 4);
    if (pick < 0) pick = steps.length - 1;
    while (pick > 0 && Math.max(box.w, box.h) / steps[pick] > 28) pick -= 1;
    step = steps[pick];
  }
  const label = (value) => String(Number(value.toFixed(3)));
  const marks = [];
  for (let k = Math.ceil(box.x / step - 1e-9); k * step <= box.x + box.w + 1e-9; k += 1) {
    const at = ((k * step - box.x) / box.w) * width;
    marks.push(`<line x1="${at}" y1="0" x2="${at}" y2="${height}"/>`);
    marks.push(`<rect x="${at + 2}" y="2" width="${label(k * step).length * 8 + 8}" height="18" class="plate"/><text x="${at + 6}" y="15">${label(k * step)}</text>`);
  }
  for (let k = Math.ceil(box.y / step - 1e-9); k * step <= box.y + box.h + 1e-9; k += 1) {
    const at = ((k * step - box.y) / box.h) * height;
    marks.push(`<line x1="0" y1="${at}" x2="${width}" y2="${at}"/>`);
    marks.push(`<rect x="2" y="${at + 2}" width="${label(k * step).length * 8 + 8}" height="18" class="plate"/><text x="6" y="${at + 15}">${label(k * step)}</text>`);
  }
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <style>line{stroke:#ff00aa;stroke-opacity:.8;stroke-width:1}.plate{fill:#000;fill-opacity:.78}text{font:13px Menlo,monospace;fill:#fff}</style>
    ${marks.join("\n")}</svg>`;
  await sharp(image.buffer)
    .extract(region)
    .resize({ width, height, kernel: "lanczos3" })
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .png()
    .toFile(out);
  console.log(`${out}: lines every ${step} of the whole image. Labels on the top edge are x, labels on the left edge are y.`);
}

/* ---------- sample, palette, ramp ---------- */

async function sample(image, boxes) {
  for (const box of boxes) {
    const { data, channels } = await readPixels(image, box);
    const bins = new Map();
    const total = data.length / channels;
    for (let i = 0; i < data.length; i += channels) {
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bin.n += 1;
      bin.r += data[i];
      bin.g += data[i + 1];
      bin.b += data[i + 2];
      bins.set(key, bin);
    }
    const ranked = [...bins.values()]
      .map((bin) => {
        const rgb = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n];
        const [L, a, b] = toOklab(...rgb);
        return { rgb, share: bin.n / total, L, chroma: Math.hypot(a, b) };
      })
      .sort((a, b) => b.share - a.share);
    const solid = ranked.filter((bin) => bin.share >= 0.01);
    const darkest = [...solid].sort((a, b) => a.L - b.L)[0];
    const lightest = [...solid].sort((a, b) => b.L - a.L)[0];
    const vivid = [...solid].sort((a, b) => b.chroma - a.chroma)[0];
    console.log(`${box.name ?? `${box.x},${box.y},${box.w},${box.h}`}`);
    for (const bin of ranked.slice(0, 4)) console.log(`  ${percent(bin.share).padStart(5)}  ${describe(...bin.rgb)}`);
    console.log(`  darkest ${hex(...darkest.rgb)}   lightest ${hex(...lightest.rgb)}   most vivid ${hex(...vivid.rgb)}`);
  }
  console.log("\nThin lines and small text are blended with what is behind them. Their true colour is nearer the darkest (or most vivid) value than the most common one.");
}

/** Dominant colours by k-means in OKLab, plus small vivid colours that area alone would hide. */
async function palette(image, box, k) {
  // "nearest" keeps real pixels: averaging would invent in-between colours.
  const { data, channels } = await readPixels(image, box, 320, "nearest");
  const count = data.length / channels;
  const lab = new Float32Array(count * 3);
  const bins = new Map();
  for (let i = 0; i < count; i += 1) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    lab.set(toOklab(r, g, b), i * 3);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  const ranked = [...bins.values()]
    .map((bin) => ({ share: bin.n / count, rgb: [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n] }))
    .map((bin) => ({ ...bin, lab: toOklab(...bin.rgb) }))
    .sort((a, b) => b.share - a.share);
  const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

  // Start from the most common colours that are visibly different from each other.
  let centres = [];
  for (const bin of ranked) {
    if (centres.every((centre) => distance(centre, bin.lab) >= 0.07)) centres.push([...bin.lab]);
    if (centres.length === k) break;
  }
  let sizes = [];
  for (let round = 0; round < 12; round += 1) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < count; i += 1) {
      const point = [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]];
      let best = 0;
      let bestDistance = Infinity;
      centres.forEach((centre, index) => {
        const d = distance(centre, point);
        if (d < bestDistance) {
          bestDistance = d;
          best = index;
        }
      });
      sums[best][0] += point[0];
      sums[best][1] += point[1];
      sums[best][2] += point[2];
      sums[best][3] += 1;
    }
    centres = centres.map((centre, index) =>
      sums[index][3] ? [sums[index][0] / sums[index][3], sums[index][1] / sums[index][3], sums[index][2] / sums[index][3]] : centre,
    );
    sizes = sums.map((sum) => sum[3]);
  }
  const clusters = centres
    .map((centre, index) => ({ centre, share: sizes[index] / count }))
    .filter((cluster) => cluster.share > 0)
    .sort((a, b) => b.share - a.share);

  console.log("Dominant colours, by share of the area:");
  for (const cluster of clusters) {
    console.log(`  ${percent(cluster.share).padStart(5)}  ${describe(...fromOklab(...cluster.centre))}`);
  }
  const lightness = clusters.map((cluster) => cluster.centre[0]);
  console.log(`Lightness runs from ${Math.min(...lightness).toFixed(2)} to ${Math.max(...lightness).toFixed(2)} across these.`);

  const accents = ranked
    .map((bin) => ({ ...bin, chroma: Math.hypot(bin.lab[1], bin.lab[2]) }))
    .filter((bin) => bin.share >= 0.0015 && bin.chroma >= 0.08)
    .filter((bin) => clusters.every((cluster) => distance(cluster.centre, bin.lab) >= 0.09))
    .sort((a, b) => b.chroma * Math.sqrt(b.share) - a.chroma * Math.sqrt(a.share));
  const kept = [];
  for (const accent of accents) {
    if (kept.every((other) => distance(other.lab, accent.lab) >= 0.08)) kept.push(accent);
    if (kept.length === 4) break;
  }
  if (kept.length > 0) {
    console.log("Small but vivid, easy to miss by area:");
    for (const accent of kept) console.log(`  ${percent(accent.share).padStart(5)}  ${describe(...accent.rgb)}`);
  }
}

async function ramp(image, from, to, steps) {
  const { data, width, height, channels } = await readPixels(image, WHOLE, 900);
  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.012));
  const stops = [];
  for (let step = 0; step < steps; step += 1) {
    const t = steps === 1 ? 0 : step / (steps - 1);
    const cx = Math.round((from.x + (to.x - from.x) * t) * (width - 1));
    const cy = Math.round((from.y + (to.y - from.y) * t) * (height - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y += 1) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
        const i = (y * width + x) * channels;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n += 1;
      }
    }
    stops.push({ t, rgb: [r / n, g / n, b / n] });
  }
  for (const stop of stops) console.log(`  ${String(Math.round(stop.t * 100)).padStart(3)}%  ${describe(...stop.rgb)}`);
  const angle = Math.round(((Math.atan2((to.x - from.x) * image.width, -(to.y - from.y) * image.height) * 180) / Math.PI + 360) % 360);
  const list = stops.map((stop) => `${hex(...stop.rgb)} ${Math.round(stop.t * 100)}%`).join(", ");
  console.log(`\nAlong that line: linear-gradient(${angle}deg, ${list})`);
  console.log("The percentages are positions along the sampled line, not across the whole image. For light that spreads from a point, sample outward from that point and write a radial-gradient with these stops.");
}

/* ---------- trace ---------- */

/** Simplifies a closed outline, keeping points that move it by more than `epsilon`. */
function simplifyLoop(points, epsilon) {
  if (points.length < 8) return points;
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < points.length; i += 1) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }
  const reduce = (segment) => {
    if (segment.length < 3) return segment;
    const [ax, ay] = segment[0];
    const [bx, by] = segment[segment.length - 1];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let index = 0;
    let worst = -1;
    for (let i = 1; i < segment.length - 1; i += 1) {
      const d = Math.abs((bx - ax) * (ay - segment[i][1]) - (ax - segment[i][0]) * (by - ay)) / length;
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst <= epsilon) return [segment[0], segment[segment.length - 1]];
    return [...reduce(segment.slice(0, index + 1)).slice(0, -1), ...reduce(segment.slice(index))];
  };
  const first = reduce(points.slice(0, far + 1));
  const second = reduce([...points.slice(far), points[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** Outlines of the filled pixels of a mask, as closed loops along pixel edges. */
function outlines(mask, width, height) {
  const filled = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  const stride = width + 1;
  const edges = new Map();
  const add = (x0, y0, x1, y1) => {
    const from = y0 * stride + x0;
    const list = edges.get(from);
    if (list) list.push(y1 * stride + x1);
    else edges.set(from, [y1 * stride + x1]);
  };
  // Each filled pixel contributes the sides that face an empty one, walked clockwise.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) add(x, y, x + 1, y);
      if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const [start, list] of edges) {
    while (list.length > 0) {
      const loop = [];
      let from = start;
      let to = list.pop();
      let guard = 0;
      while (guard < 4_000_000) {
        guard += 1;
        loop.push([from % stride, Math.floor(from / stride)]);
        if (to === start) break;
        const options = edges.get(to);
        if (!options || options.length === 0) break;
        let pick = options.length - 1;
        if (options.length > 1) {
          // Two outlines meet at this corner: keep turning right, so shapes that
          // only touch diagonally stay separate.
          const dx = (to % stride) - (from % stride);
          const dy = Math.floor(to / stride) - Math.floor(from / stride);
          const right = (Math.floor(to / stride) + dx) * stride + ((to % stride) - dy);
          const found = options.indexOf(right);
          if (found >= 0) pick = found;
        }
        from = to;
        to = options.splice(pick, 1)[0];
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

const loopArea = (points) => {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
};

async function trace(image, out, box, options) {
  const region = toPixels(box, image);
  // Enlarging before the cut turns stair-stepped pixel edges into smooth ones.
  const scale = Math.min(8, Math.max(1, 900 / Math.max(region.width, region.height)));
  const width = Math.round(region.width * scale);
  const height = Math.round(region.height * scale);
  const enlarged = await sharp(image.buffer).extract(region).resize({ width, height, kernel: "cubic" }).png().toBuffer();
  const { data, info } = await sharp(enlarged).raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const total = width * height;
  const mask = new Uint8Array(total);

  let how;
  if (options.near) {
    const target = toOklab(...parseHex(last(options, "near")));
    const tolerance = Number(last(options, "tol", 0.08));
    for (let i = 0; i < total; i += 1) {
      const lab = toOklab(data[i * channels], data[i * channels + 1], data[i * channels + 2]);
      mask[i] = Math.hypot(lab[0] - target[0], lab[1] - target[1], lab[2] - target[2]) <= tolerance ? 1 : 0;
    }
    how = `pixels within ${tolerance} of ${last(options, "near")}`;
  } else {
    const luma = new Uint8Array(total);
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < total; i += 1) {
      luma[i] = Math.round(0.2126 * data[i * channels] + 0.7152 * data[i * channels + 1] + 0.0722 * data[i * channels + 2]);
      histogram[luma[i]] += 1;
    }
    let threshold = Number(last(options, "threshold", NaN));
    if (!Number.isFinite(threshold)) {
      // Otsu: the cut that best separates the dark pixels from the light ones.
      let sumAll = 0;
      for (let v = 0; v < 256; v += 1) sumAll += v * histogram[v];
      let below = 0;
      let sumBelow = 0;
      let best = -1;
      threshold = 128;
      for (let v = 0; v < 256; v += 1) {
        below += histogram[v];
        if (below === 0 || below === total) continue;
        sumBelow += v * histogram[v];
        const between = below * (total - below) * (sumBelow / below - (sumAll - sumBelow) / (total - below)) ** 2;
        if (between > best) {
          best = between;
          threshold = v;
        }
      }
    }
    const light = Boolean(options.light);
    for (let i = 0; i < total; i += 1) mask[i] = (light ? luma[i] > threshold : luma[i] <= threshold) ? 1 : 0;
    how = `pixels ${light ? "lighter" : "darker"} than ${threshold} of 255`;
  }

  const epsilon = Number(last(options, "simplify", 1.2));
  const minArea = total * 0.0002;
  const onEdge = (points) => points.some(([x, y]) => x <= 0 || y <= 0 || x >= width || y >= height);
  const shapes = outlines(mask, width, height)
    .map((loop) => ({ touches: onEdge(loop), points: simplifyLoop(loop, epsilon) }))
    .map((shape) => ({ ...shape, area: loopArea(shape.points) }))
    .filter((shape) => !(options["drop-edge"] && shape.touches))
    .filter((shape) => Math.abs(shape.area) >= minArea && shape.points.length >= 3)
    .sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
    .slice(0, 60);
  if (shapes.length === 0) fail(`nothing to trace: no region of ${how} is large enough. Try --light, --threshold, or --near with a colour from \`sample\`.`);

  const d = shapes
    .map((shape) => `M${shape.points.map(([x, y]) => `${Number(x.toFixed(1))} ${Number(y.toFixed(1))}`).join("L")}Z`)
    .join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path fill="currentColor" fill-rule="evenodd" d="${d}"/></svg>\n`;
  fs.writeFileSync(out, svg);

  const preview = out.replace(/\.svg$/i, "") + ".preview.png";
  const drawn = await sharp(Buffer.from(svg.replace("<svg ", `<svg width="${width}" height="${height}" `)))
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  await sharp({ create: { width: width * 2 + 24, height, channels: 3, background: "#ff00aa" } })
    .composite([{ input: enlarged, left: 0, top: 0 }, { input: drawn, left: width + 24, top: 0 }])
    .png()
    .toFile(preview);

  const covered = shapes.reduce((sum, shape) => sum + shape.area, 0) / total;
  const solids = shapes.filter((shape) => shape.area > 0);
  console.log(`${out}: ${solids.length} shape(s) and ${shapes.length - solids.length} hole(s) from ${how}, covering ${percent(Math.max(0, covered))} of the box, ${shapes.reduce((sum, shape) => sum + shape.points.length, 0)} points.`);
  for (const shape of solids.slice(0, 8)) {
    const xs = shape.points.map((point) => point[0]);
    const ys = shape.points.map((point) => point[1]);
    const at = (value, size, origin, span) => (origin + (value / size) * span).toFixed(3);
    console.log(
      `  shape at ${at(Math.min(...xs), width, box.x, box.w)},${at(Math.min(...ys), height, box.y, box.h)} to ${at(Math.max(...xs), width, box.x, box.w)},${at(Math.max(...ys), height, box.y, box.h)}  ${percent(shape.area / total)} of the box, ${shape.points.length} points${shape.touches ? "  (touches the edge of the box)" : ""}`,
    );
  }
  if (solids.some((shape) => shape.touches)) {
    console.log("A shape that touches the edge of the box is usually background or something cut off. Move the box, change the threshold, or add --drop-edge. Keep it when the shape is meant to run off the edge, as the lines of a pattern do.");
  }
  console.log(`${preview}: the box on the left, the traced shape on the right. Open it before you trust the trace.`);
  console.log("The path uses currentColor, so the colour of the surrounding text recolours it. Its viewBox is the box in enlarged pixels.");
}

/* ---------- shot, pair ---------- */

function findBrowser() {
  if (process.env.CHROME_BIN) return { bin: process.env.CHROME_BIN, flags: [] };
  for (const root of [path.join(os.homedir(), "Library/Caches/ms-playwright"), path.join(os.homedir(), ".cache/ms-playwright")]) {
    if (!fs.existsSync(root)) continue;
    const shells = fs.readdirSync(root).filter((name) => name.startsWith("chromium_headless_shell")).sort().reverse();
    for (const shell of shells) {
      for (const build of fs.readdirSync(path.join(root, shell))) {
        const bin = path.join(root, shell, build, "chrome-headless-shell");
        if (fs.existsSync(bin)) return { bin, flags: [] };
      }
    }
  }
  const installed = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((bin) => fs.existsSync(bin));
  if (installed) return { bin: installed, flags: ["--headless=new"] };
  throw new Error("no Chrome found to render with. Set CHROME_BIN to a Chrome or Chromium binary.");
}

/**
 * Renders a page with a browser on this machine and returns the size of the
 * image it wrote. Throws when it cannot. `offline` keeps the page off the network.
 */
async function render({ page, out, width, height, full }, offline = false) {
  const browser = findBrowser();
  let profile = null;
  let problem = null;
  try {
    // A profile of its own, so a Chrome the user has open is left alone.
    profile = fs.mkdtempSync(path.join(path.dirname(out), ".look-chrome-"));
    execFileSync(
      browser.bin,
      [
        ...browser.flags,
        ...(offline ? ["--proxy-server=http://127.0.0.1:9", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] : []),
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--disable-gpu",
        "--allow-file-access-from-files",
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        "--virtual-time-budget=6000",
        `--screenshot=${out}`,
        pathToFileURL(page).href,
      ],
      { stdio: "ignore", timeout: 90_000 },
    );
  } catch (error) {
    problem = error;
  } finally {
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  }
  if (problem) {
    throw new Error(
      `the browser could not render ${page}. A browser cannot start inside a sandboxed shell: if yours is sandboxed, whoever launched you has to run \`look.js serve <folder>\` outside the sandbox, and this command will then use it.`,
    );
  }
  if (!fs.existsSync(out)) throw new Error(`the browser wrote no screenshot for ${page}.`);
  if (!full) return { width, height };
  // Cut the page off below its last row that is not empty background.
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const row = (y) => data.subarray(y * info.width * info.channels, (y + 1) * info.width * info.channels);
  const blank = row(info.height - 1);
  let bottom = info.height - 1;
  while (bottom > 0 && row(bottom).equals(blank)) bottom -= 1;
  const kept = Math.min(info.height, bottom + 32);
  const trimmed = await sharp(out).extract({ left: 0, top: 0, width: info.width, height: kept }).png().toBuffer();
  fs.writeFileSync(out, trimmed);
  return { width: info.width, height: kept };
}

/*
 * The rendering helper. A sandboxed agent cannot start a browser, so a helper
 * outside the sandbox renders for it:
 *
 *   - the agent drops a request into <folder>/.look-queue/
 *   - the helper renders the page into a folder of its own, which the agent can
 *     read but not write
 *   - the agent copies the image from there to where it wants it
 *
 * The helper only ever reads from the agent's folder. It writes there once, at
 * start-up, before the agent runs, and removes its queue folder when it stops.
 * A helper that wrote to paths the agent names could be steered, through a
 * link, into writing outside the sandbox.
 */

/** The helper that covers one of `folders`, if one is running. */
function findHelper(folders) {
  for (const folder of folders) {
    let dir = path.resolve(folder);
    for (;;) {
      const queue = path.join(dir, ".look-queue");
      try {
        const state = fs.readFileSync(path.join(queue, "helper"), "utf8").trim();
        if (Date.now() - fs.statSync(path.join(state, "alive")).mtimeMs < 15_000) return { queue, state };
      } catch {
        // No helper here; look one folder up.
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

async function renderThroughHelper(helper, request) {
  const id = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  // Written under another name first, so the helper never reads half a request.
  fs.writeFileSync(path.join(helper.queue, `${id}.tmp`), JSON.stringify(request));
  fs.renameSync(path.join(helper.queue, `${id}.tmp`), path.join(helper.queue, `${id}.request.json`));
  const answer = path.join(helper.state, `${id}.done.json`);
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(answer)) {
      const result = JSON.parse(fs.readFileSync(answer, "utf8"));
      fs.rmSync(path.join(helper.queue, `${id}.request.json`), { force: true });
      if (!result.ok) throw new Error(result.error);
      fs.copyFileSync(result.image, request.out);
      return { width: result.width, height: result.height };
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("the rendering helper did not answer within 150 seconds.");
}

/** Renders a page to a PNG, through the helper when this shell cannot start a browser. Throws when neither works. */
async function renderTo(request) {
  const helper = findHelper([path.dirname(request.out), path.dirname(request.page), process.cwd()]);
  return helper ? renderThroughHelper(helper, request) : render(request);
}

async function shot(page, out, options) {
  if (!page || !fs.existsSync(page)) fail(`no such page: ${page}`);
  const match = /^(\d+)x(\d+)$/.exec(String(last(options, "size", "1400x900")));
  if (!match) fail("--size is written WIDTHxHEIGHT, for example --size 1400x900");
  const full = Boolean(options.full);
  try {
    const size = await renderTo({ page: path.resolve(page), out: path.resolve(out), width: Number(match[1]), height: full ? 9000 : Number(match[2]), full });
    console.log(`${out}: ${size.width} x ${size.height} px`);
  } catch (error) {
    fail(error.message);
  }
}

async function serve(root, stateFolder) {
  const base = fs.realpathSync(path.resolve(root ?? "."));
  const within = (file) => file === base || file.startsWith(base + path.sep);
  // The helper's own folder. It must be somewhere the sandboxed agent cannot
  // write: not inside the served folder, and not /tmp or $TMPDIR, which a
  // Codex sandbox leaves writable unless told otherwise.
  const state = path.resolve(stateFolder ?? path.join(os.homedir(), ".cache", "look-helper", String(process.pid)));
  if (within(state)) fail("the helper's own folder must be outside the folder it serves.");
  fs.mkdirSync(state, { recursive: true });
  const queue = path.join(base, ".look-queue");
  fs.rmSync(queue, { recursive: true, force: true });
  fs.mkdirSync(queue);
  fs.writeFileSync(path.join(queue, "helper"), `${state}\n`);

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (stopping = true));
  console.log(`look.js: rendering pages inside ${base} until stopped. Images go to ${state}.`);
  const seen = new Set();
  while (!stopping) {
    fs.writeFileSync(path.join(state, "alive"), String(Date.now()));
    let names = [];
    try {
      names = fs.readdirSync(queue);
    } catch {
      // The agent removed the queue folder; nothing to do until it is back.
    }
    for (const name of names.filter((entry) => /^[A-Za-z0-9-]+\.request\.json$/.test(entry)).sort()) {
      const id = name.slice(0, -".request.json".length);
      if (seen.has(id)) continue;
      seen.add(id);
      let result;
      try {
        const request = JSON.parse(fs.readFileSync(path.join(queue, name), "utf8"));
        const page = fs.realpathSync(path.resolve(String(request.page)));
        if (!within(page)) throw new Error(`the rendering helper only renders pages inside ${base}.`);
        const width = Math.min(4000, Math.max(100, Number(request.width) || 1400));
        const height = Math.min(9000, Math.max(100, Number(request.height) || 900));
        const image = path.join(state, `${id}.png`);
        const size = await render({ page, out: image, width, height, full: Boolean(request.full) }, true);
        result = { ok: true, image, ...size };
      } catch (error) {
        result = { ok: false, error: error.message };
      }
      fs.writeFileSync(path.join(state, `${id}.done.json`), JSON.stringify(result));
      console.log(`${new Date().toISOString()}  ${result.ok ? `${result.width} x ${result.height} px` : `refused or failed: ${result.error}`}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fs.rmSync(state, { recursive: true, force: true });
  try {
    // Only if it is still the real folder made at start-up, never a link put in its place.
    if (fs.lstatSync(queue).isDirectory()) fs.rmSync(queue, { recursive: true, force: true });
  } catch {
    // The agent already removed it.
  }
}

async function pair(left, right, out, options) {
  for (const file of [left, right]) if (!file || !fs.existsSync(file)) fail(`no such image: ${file}`);
  const labels = String(last(options, "labels", "reference,rebuilt")).split(",");
  const height = 760;
  const sides = [];
  for (const file of [left, right]) {
    const buffer = await sharp(file).flatten({ background: "#ffffff" }).resize({ height, width: 1300, fit: "inside" }).png().toBuffer();
    const meta = await sharp(buffer).metadata();
    sides.push({ buffer, width: meta.width, height: meta.height });
  }
  const gap = 24;
  const top = 34;
  const width = sides[0].width + sides[1].width + gap * 3;
  const caption = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${top}"><style>text{font:15px Menlo,monospace;fill:#111}</style>
    <text x="${gap}" y="22">${labels[0] ?? ""}</text><text x="${gap * 2 + sides[0].width}" y="22">${labels[1] ?? ""}</text></svg>`;
  await sharp({ create: { width, height: height + top + gap, channels: 3, background: "#e9e9e9" } })
    .composite([
      { input: Buffer.from(caption), left: 0, top: 0 },
      { input: sides[0].buffer, left: gap, top },
      { input: sides[1].buffer, left: gap * 2 + sides[0].width, top },
    ])
    .png()
    .toFile(out);
  console.log(`${out}: ${labels[0]} on the left, ${labels[1]} on the right`);
}

/* ---------- page: study.json to pictures and a page the owner can check ---------- */

const escapeHtml = (text) =>
  String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const SOURCES = ["measured", "estimated", "guessed"];
// The three ways a design agent uses a part.
const USES = {
  place: "a graphic dropped into a design",
  fill: "a container that takes content",
  follow: "an arrangement to copy",
};
const ROLES = ["look", "free"];
// Words that sound like an observation and give a designer nothing to act on.
const EMPTY_WORDS = /\b(clean|modern|elegant|beautiful|stunning|sleek|stylish|sophisticated|visually appealing|eye-catching|aesthetic|aesthetically|timeless|professional-looking|polished|striking|harmonious|pleasing)\b/gi;
// One CSS value: nothing in it can close the declaration it is written into.
const ONE_CSS_VALUE = /^[^;{}<>\\]+$/;

const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const given = (value) => value !== undefined && value !== null;

function checkStudy(study) {
  const problems = [];
  const notes = [];
  const isBox = (value) =>
    Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number" && n >= 0 && n <= 1) && value[2] > 0 && value[3] > 0 && value[0] + value[2] <= 1.0005 && value[1] + value[3] <= 1.0005;
  const phrases = (value, min, max) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(hasText);
  const cssValue = (value) => typeof value === "string" && ONE_CSS_VALUE.test(value);

  if (!hasText(study.kind)) problems.push('"kind" is missing: say what kind of image this is.');
  if (!hasText(study.ordinary_version)) problems.push('"ordinary_version" is missing: describe the ordinary version of this kind of image that you compared against.');
  if (!Array.isArray(study.candidates) || study.candidates.length < 3) problems.push('"candidates" should list every candidate you considered, taken or not (at least three).');
  const parts = Array.isArray(study.parts) ? study.parts : [];
  if (parts.length === 0) problems.push('"parts" is empty: a study needs at least one part.');

  const ids = new Set();
  for (const [index, part] of parts.entries()) {
    const at = `parts[${index}]${part?.id ? ` (${part.id})` : ""}`;
    if (!part || typeof part !== "object") {
      problems.push(`${at}: is not an object.`);
      continue;
    }
    const slug = hasText(part.id) && /^[a-z0-9][a-z0-9-]*$/.test(part.id);
    if (!slug) problems.push(`${at}: "id" must be a short slug such as "section-box".`);
    else if (ids.has(part.id)) problems.push(`${at}: the id is used twice.`);
    ids.add(part.id);
    for (const field of ["name", "aspect", "unusual", "use"]) if (!hasText(part[field])) problems.push(`${at}: "${field}" is missing.`);
    if (hasText(part.name) && part.name.trim().split(/\s+/).length > 7) {
      notes.push(`${at}: the name has ${part.name.trim().split(/\s+/).length} words. It sits under a small picture: two to five words.`);
    }
    if (!Object.hasOwn(USES, String(part.use_as))) {
      problems.push(`${at}: "use_as" must be ${Object.entries(USES).map(([key, meaning]) => `"${key}" (${meaning})`).join(", ")}.`);
    }
    if (!isBox(part.where)) problems.push(`${at}: "where" must be [x, y, w, h] in fractions of the image, inside it.`);
    if (!phrases(part.keywords, 3, 6)) problems.push(`${at}: "keywords" needs three to six short phrases for the look and the job of the part.`);
    if (!phrases(part.answers, 2, 4)) problems.push(`${at}: "answers" needs two to four requests a designer might type that this part answers.`);
    for (const key of ["background", "color"]) {
      if (given(part.stage?.[key]) && !cssValue(part.stage[key])) problems.push(`${at}: stage.${key} must be one CSS value.`);
    }

    const hasFile = given(part.file);
    const imageOnly = given(part.image_only);
    if (hasFile && imageOnly) problems.push(`${at}: has both "file" and "image_only". A part with an editable file is not image-only.`);
    else if (!hasFile && !imageOnly) problems.push(`${at}: needs "file" (its editable file) or, when it cannot be drawn as one, "image_only" with the reason.`);
    if (imageOnly && !hasText(part.image_only)) problems.push(`${at}: "image_only" must say why the part cannot be drawn as a file.`);
    if (imageOnly && (given(part.made_by) || (Array.isArray(part.variants) && part.variants.length > 0))) {
      problems.push(`${at}: an image-only part has no "made_by" and no "variants".`);
    }
    if (hasFile && slug) {
      const allowed = [`parts/${part.id}.svg`, `parts/${part.id}.html`];
      if (!allowed.includes(part.file)) problems.push(`${at}: "file" must be "${allowed[0]}" or "${allowed[1]}".`);
      if (given(part.made_by)) {
        if (part.made_by !== `parts/${part.id}.js`) problems.push(`${at}: "made_by" must be "parts/${part.id}.js".`);
        if (part.file !== allowed[0]) problems.push(`${at}: a part with "made_by" has "file": "${allowed[0]}", which \`page\` writes from the function.`);
      }
      if (!Array.isArray(part.variants) || part.variants.length < 1 || part.variants.length > 3) {
        problems.push(`${at}: "variants" needs one to three entries, each showing the part changed (other colours, or other parameters).`);
      } else {
        for (const [v, variant] of part.variants.entries()) {
          const here = `${at} variants[${v}]`;
          if (!variant || typeof variant !== "object") {
            problems.push(`${here}: is not an object.`);
            continue;
          }
          if (!hasText(variant.label)) problems.push(`${here}: "label" is missing: say what changed, in a few words.`);
          const vars = variant.vars ?? {};
          const params = variant.params ?? {};
          let changes = ["background", "color"].filter((key) => given(variant[key])).length;
          if (typeof vars !== "object" || Array.isArray(vars)) {
            problems.push(`${here}: "vars" must be an object of CSS variables and their values.`);
          } else {
            changes += Object.keys(vars).length;
            for (const [name, value] of Object.entries(vars)) {
              if (!/^--[A-Za-z0-9_-]+$/.test(name)) problems.push(`${here}: "${name}" is not a CSS variable name. They start with two dashes.`);
              if (!cssValue(value)) problems.push(`${here}: the value of ${name} must be one CSS value.`);
            }
          }
          for (const key of ["background", "color"]) {
            if (given(variant[key]) && !cssValue(variant[key])) problems.push(`${here}: "${key}" must be one CSS value.`);
          }
          if (typeof params !== "object" || Array.isArray(params)) {
            problems.push(`${here}: "params" must be an object of parameter names and values.`);
          } else {
            changes += Object.keys(params).length;
            if (Object.keys(params).length > 0 && !given(part.made_by)) problems.push(`${here}: "params" only applies to a part with "made_by".`);
          }
          if (changes === 0) problems.push(`${here}: changes nothing. Set "vars", "color", "background" or "params".`);
        }
      }
    }
    for (const [key, entry] of Object.entries(part.values ?? {})) {
      if (!entry || !SOURCES.includes(entry.source)) problems.push(`${at}: value "${key}" needs "source": measured, estimated or guessed.`);
    }
  }
  for (const [index, colour] of (study.colours ?? []).entries()) {
    if (!/^#[0-9a-f]{6}$/i.test(colour.hex ?? "")) problems.push(`colours[${index}]: "hex" must be a six-digit hex colour.`);
    if (!SOURCES.includes(colour.source)) problems.push(`colours[${index}]: needs "source": measured, estimated or guessed.`);
  }
  const prose = [
    study.ordinary_version,
    ...parts.flatMap((part) => [part?.name, part?.unusual, part?.use, ...(Array.isArray(part?.keywords) ? part.keywords : [])]),
    ...(study.rules ?? []).flatMap((rule) => [rule.rule, rule.evidence]),
    ...(study.notes ?? []),
  ]
    .filter(hasText)
    .join(" ");
  const empty = [...new Set((prose.match(EMPTY_WORDS) ?? []).map((word) => word.toLowerCase()))];
  return { problems, notes, empty };
}

/** Share of the image's pixels that sit close to each colour claimed as measured. */
async function findColours(image, colours) {
  const { data, channels } = await readPixels(image, WHOLE, 1600);
  const count = data.length / channels;
  const targets = colours.map((colour) => toOklab(...parseHex(colour.hex)));
  const hits = targets.map(() => 0);
  const nearest = targets.map(() => Infinity);
  for (let i = 0; i < count; i += 1) {
    const lab = toOklab(data[i * channels], data[i * channels + 1], data[i * channels + 2]);
    for (let t = 0; t < targets.length; t += 1) {
      const d = Math.hypot(lab[0] - targets[t][0], lab[1] - targets[t][1], lab[2] - targets[t][2]);
      if (d < nearest[t]) nearest[t] = d;
      if (d <= 0.035) hits[t] += 1;
    }
  }
  return colours.map((colour, index) => ({ ...colour, found: hits[index] / count, nearest: nearest[index] }));
}

/**
 * Loads the function behind a part. It runs with no `require`, no `process`
 * and no files, which keeps honest code honest. That is not a wall against
 * hostile code: only run `page` on a study where you would run its author.
 */
function loadMaker(file, at) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) throw new Error(`${at}: "made_by" is parts/${name}, which does not exist.`);
  const sandbox = { module: { exports: {} } };
  const context = vm.createContext(sandbox);
  const run = (code) => vm.runInContext(code, context, { filename: name, timeout: 5000 });
  try {
    run(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${at}: ${name} did not load: ${error.message}. A part's function is arithmetic and string building; it cannot use require, files or the network.`);
  }
  let params;
  try {
    if (run("typeof module.exports.render") !== "function") throw new Error("no render function");
    params = JSON.parse(run("JSON.stringify(module.exports.params ?? null)"));
  } catch {
    throw new Error(`${at}: ${name} must set module.exports = { params, render }, where render(p) returns the SVG as text.`);
  }
  if (!params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).length === 0) {
    throw new Error(`${at}: ${name} needs "params": one entry for each thing a designer can change.`);
  }
  const wrong = [];
  for (const [key, spec] of Object.entries(params)) {
    if (!spec || typeof spec !== "object" || !("value" in spec)) {
      wrong.push(`"${key}" needs a "value", the one you measured`);
      continue;
    }
    if (!ROLES.includes(spec.role)) wrong.push(`"${key}" needs "role": "look" (it carries the look) or "free" (change it to fit)`);
    if (!hasText(spec.note)) wrong.push(`"${key}" needs a "note" saying what it changes`);
    if (typeof spec.value === "number" && !(typeof spec.min === "number" && typeof spec.max === "number" && spec.min <= spec.value && spec.value <= spec.max)) {
      wrong.push(`"${key}" needs "min" and "max", with its value between them`);
    }
  }
  if (wrong.length > 0) throw new Error(`${at}: ${name} params: ${wrong.join("; ")}.`);

  const defaults = Object.fromEntries(Object.entries(params).map(([key, spec]) => [key, spec.value]));
  const render = (changes = {}) => {
    sandbox.__given = JSON.stringify({ ...defaults, ...changes });
    let svg;
    try {
      svg = run("module.exports.render(JSON.parse(__given))");
    } catch (error) {
      throw new Error(`${at}: render(${JSON.stringify(changes)}) in ${name} failed: ${error.message}`);
    }
    if (typeof svg !== "string" || !/^\s*<svg[\s>]/.test(svg)) throw new Error(`${at}: render in ${name} must return the SVG as text, starting with <svg.`);
    return svg.trim();
  };
  if (render() !== render()) {
    throw new Error(`${at}: render in ${name} gives different output for the same parameters. If it needs chance, take a "seed" parameter and derive every number from it.`);
  }
  return { params, render };
}

/** What a part's file would do when pasted somewhere else: problems stop `page`, notes are advice. */
function inspectFile(source, format, at) {
  const problems = [];
  const notes = [];
  if (/<script[\s>]/i.test(source) || /\son[a-z]+\s*=\s*["']/i.test(source)) problems.push(`${at}: the file runs script. A part is markup and styles only.`);
  if (/(?:href|src)\s*=\s*["']\s*(?:https?:)?\/\//i.test(source) || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(source) || /@import/i.test(source)) {
    problems.push(`${at}: the file loads something from outside itself. A part must stand alone.`);
  }
  if (format === "svg") {
    const root = /<svg[\s>][^>]*>/i.exec(source);
    if (!/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(source) || !root) problems.push(`${at}: an .svg part starts with <svg.`);
    else if (!/\sviewBox\s*=/i.test(root[0])) problems.push(`${at}: the <svg> needs a viewBox, so that it scales to any size.`);
    if (/<foreignObject[\s>]/i.test(source)) notes.push(`${at}: uses <foreignObject>, which only a browser draws. Use SVG elements so that design tools can open the file, or save the part as .html.`);
  } else {
    if (/<(?:html|head|body)[\s>]/i.test(source)) problems.push(`${at}: an .html part is a fragment: no <html>, <head> or <body>.`);
    if (/<(?:style|link)[\s>]/i.test(source)) notes.push(`${at}: has a <style> or <link> element. Inline styles keep a part from restyling the page it is pasted into.`);
  }
  if (/data:image\/|<image[\s>]|<img[\s>]/i.test(source)) {
    notes.push(`${at}: holds a bitmap, which nobody can edit. If the bitmap is the part, remove the file and mark the part "image_only".`);
  }
  const fixedColour = /(?:fill|stroke|color|background|border)[a-z-]*\s*[:=]\s*["']?[^;"'>]*#[0-9a-f]{3,8}\b/i.test(source);
  if (fixedColour && !/var\(\s*--/.test(source) && !/currentColor/i.test(source)) {
    notes.push(`${at}: every colour is written in directly. Write each as var(--name, #hex), so that it can be changed without editing the file.`);
  }
  const bare = [...source.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)].map((match) => match[1]);
  if (bare.length > 0) notes.push(`${at}: ${[...new Set(bare)].join(", ")} ${bare.length === 1 ? "has" : "have"} no fallback. Write var(--name, #hex), so that the file draws correctly alone.`);
  return { problems, notes };
}

/** The CSS variables a file reads, each with the value it falls back to. */
function variablesIn(source) {
  const found = new Map();
  for (const match of source.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g)) {
    if (!found.has(match[1])) found.set(match[1], match[2]?.trim() || null);
  }
  return [...found].map(([name, fallback]) => ({ name, fallback }));
}

/** The box to draw an SVG in: its own proportions, at the pixel scale of the region the part came from. */
function boxFor(svg, region) {
  const match = /<svg[^>]*\sviewBox\s*=\s*["']\s*[-\d.eE]+[\s,]+[-\d.eE]+[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)/i.exec(svg);
  const long = Math.max(region.width, region.height);
  if (!match || !(Number(match[1]) > 0) || !(Number(match[2]) > 0)) return { width: region.width, height: region.height };
  const aspect = Number(match[1]) / Number(match[2]);
  return aspect >= 1 ? { width: long, height: Math.max(1, Math.round(long / aspect)) } : { width: Math.max(1, Math.round(long * aspect)), height: long };
}

// Pictures of parts are about this many pixels on their long side.
const pictureScale = (width, height) => Math.min(4, 1200 / Math.max(width, height));

/** A document that draws one part alone, in a box of `width` by `height` CSS pixels, enlarged by `scale`. */
function framePage(frame) {
  const custom = Object.entries(frame.vars ?? {})
    .map(([name, value]) => `${name}:${value};`)
    .join("");
  // The page itself must not clip: #part is laid out at its own size and only drawn larger.
  return `<!doctype html><meta charset="utf-8"><style>html{overflow:hidden;background:${frame.background}}body{margin:0}#part{position:relative;width:${frame.width}px;height:${frame.height}px;overflow:hidden;transform:scale(${frame.scale});transform-origin:0 0;background:${frame.background};color:${frame.color};font:16px/1.4 -apple-system,"Helvetica Neue",Arial,sans-serif;${custom}}#part>svg{display:block!important;width:100%!important;height:100%!important}</style><div id="part">${frame.markup}</div>`;
}

/**
 * Draws every frame and leaves its picture in `frame.image`. Frames share a
 * page, each in a document of its own, so that one start of the browser draws
 * many and no part's styles or ids reach another.
 */
async function drawFrames(frames, partsFolder) {
  const sheets = [];
  for (const frame of frames) {
    frame.pxWidth = Math.max(1, Math.round(frame.width * frame.scale));
    frame.pxHeight = Math.max(1, Math.round(frame.height * frame.scale));
    let sheet = sheets.at(-1);
    if (!sheet || sheet.height + frame.pxHeight > 8000) {
      sheet = { frames: [], width: 500, height: 0 };
      sheets.push(sheet);
    }
    frame.top = sheet.height;
    sheet.frames.push(frame);
    sheet.width = Math.max(sheet.width, frame.pxWidth);
    sheet.height += frame.pxHeight;
  }
  for (const [index, sheet] of sheets.entries()) {
    const pageFile = path.join(partsFolder, `.sheet-${index}.html`);
    const shotFile = path.join(partsFolder, `.sheet-${index}.png`);
    const frameTags = sheet.frames
      .map((frame) => `<iframe style="top:${frame.top}px;width:${frame.pxWidth}px;height:${frame.pxHeight}px" srcdoc="${escapeHtml(framePage(frame))}"></iframe>`)
      .join("");
    writeOwn(pageFile, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}iframe{position:absolute;left:0;border:0;display:block}</style>${frameTags}`);
    try {
      dropLink(shotFile);
      await renderTo({ page: pageFile, out: shotFile, width: sheet.width, height: Math.max(300, sheet.height), full: false });
      const drawn = fs.readFileSync(shotFile);
      const size = await sharp(drawn).metadata();
      if (size.width < sheet.width || size.height < sheet.height) {
        throw new Error(`the browser drew ${size.width} x ${size.height} px where ${sheet.width} x ${sheet.height} was asked for.`);
      }
      for (const frame of sheet.frames) {
        frame.image = await sharp(drawn).extract({ left: 0, top: frame.top, width: frame.pxWidth, height: frame.pxHeight }).png().toBuffer();
      }
    } finally {
      fs.rmSync(pageFile, { force: true });
      fs.rmSync(shotFile, { force: true });
    }
  }
}

async function fitInside(buffer, maxWidth, maxHeight) {
  const out = await sharp(buffer).flatten({ background: "#ffffff" }).resize({ width: maxWidth, height: maxHeight, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const size = await sharp(out).metadata();
  return { buffer: out, width: size.width, height: size.height };
}

/** The part laid half-transparent over the region it came from. Edges that do not line up show double. */
async function overlaid(reference, part) {
  const size = await sharp(reference).metadata();
  const ghost = await sharp(part)
    .resize({ width: size.width, height: size.height, fit: "fill" })
    .ensureAlpha()
    .composite([{ input: Buffer.from([255, 255, 255, 128]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" }])
    .png()
    .toBuffer();
  return sharp(reference).composite([{ input: ghost, left: 0, top: 0 }]).png().toBuffer();
}

/** Lays captioned pictures out in rows on a grey ground and returns the PNG. */
async function contactSheet(rows) {
  const gap = 20;
  const caption = 26;
  const sizes = rows.map((row) => ({
    width: row.reduce((sum, cell) => sum + cell.width, 0) + gap * (row.length + 1),
    height: Math.max(...row.map((cell) => cell.height)) + caption + gap,
  }));
  const width = Math.max(...sizes.map((size) => size.width));
  const height = sizes.reduce((sum, size) => sum + size.height, 0) + gap;
  const layers = [];
  const labels = [];
  let top = gap;
  rows.forEach((row, index) => {
    let left = gap;
    for (const cell of row) {
      const room = Math.max(8, Math.floor((row.length === 1 ? width - gap * 2 : cell.width) / 8.5));
      const label = cell.label.length > room ? `${cell.label.slice(0, room - 1)}…` : cell.label;
      labels.push(`<text x="${left}" y="${top + 17}">${escapeHtml(label)}</text>`);
      layers.push({ input: cell.buffer, left, top: top + caption });
      left += cell.width + gap;
    }
    top += sizes[index].height;
  });
  const captions = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>text{font:14px Menlo,monospace;fill:#111}</style>${labels.join("")}</svg>`);
  return sharp({ create: { width, height, channels: 3, background: "#e9e9e9" } })
    .composite([{ input: captions, left: 0, top: 0 }, ...layers])
    .png()
    .toBuffer();
}

const PAGE_STYLE = `
  *{box-sizing:border-box}
  body{margin:0;background:#f4f4f4;color:#111;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
  .page{max-width:1500px;margin:0 auto;padding:40px 24px 80px}
  h2,.tag,th,.chip,.meta{font-family:ui-monospace,"SF Mono",Menlo,monospace}
  .eyebrow{margin:0 0 8px;font:11px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:rgba(0,0,0,.55)}
  h1{margin:0 0 8px;font-size:30px;font-weight:500;letter-spacing:-.02em;line-height:1.15}
  h2{margin:44px 0 14px;padding-top:12px;border-top:1px solid #000;font-size:12px;font-weight:500;letter-spacing:.1em;text-transform:uppercase}
  .lede{margin:0;max-width:80ch;color:rgba(0,0,0,.75)}
  .warn{margin:14px 0 0;padding:10px 12px;background:#fff6d6;font-size:13px}
  .card{background:#fff;padding:18px 20px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
  .tile{display:block;background:#fff;color:inherit;text-decoration:none}
  .tile .pic{display:grid;place-items:center;height:200px;padding:14px;background:#e6e6e6}
  .tile .pic img{display:block;max-width:100%;max-height:172px;box-shadow:0 0 0 1px rgba(0,0,0,.08)}
  .tile .txt{padding:12px 14px 14px}
  .tile b{display:block;font-size:15px;font-weight:600;line-height:1.3}
  .chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
  .chip{padding:1px 7px;font-size:11px;background:#f0f0f0;color:#333}
  .meta{margin:8px 0 0;font-size:11px;color:rgba(0,0,0,.55)}
  .top{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:16px;align-items:start}
  .ref{position:relative}.ref img{display:block;width:100%}
  .mark{position:absolute;border:2px solid #ff00aa;box-shadow:0 0 0 1px rgba(255,255,255,.7)}
  .mark b{position:absolute;left:-2px;top:-2px;min-width:20px;padding:1px 5px;background:#ff00aa;color:#fff;font:600 12px/1.4 ui-monospace,Menlo,monospace;text-align:center}
  .swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:12px 10px}
  .sw i{display:block;height:40px;border:1px solid rgba(0,0,0,.1)}
  .sw b{display:block;margin-top:6px;font-size:13px}.sw span{display:block;font:11px/1.4 ui-monospace,Menlo,monospace;color:rgba(0,0,0,.58)}
  .bad{color:#b00020!important}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th{text-align:left;font-size:11px;font-weight:500;letter-spacing:.06em;color:rgba(0,0,0,.55);padding:0 12px 8px 0}
  td{vertical-align:top;padding:8px 12px 8px 0;border-top:1px solid rgba(0,0,0,.08)}
  .tag{display:inline-block;padding:1px 7px;font-size:11px;background:#111;color:#fff}.tag.no{background:#e4e4e4;color:#555}
  .part{margin-top:16px}.part h3{margin:0 0 2px;font-size:19px;font-weight:600}
  .part .meta{margin:0 0 12px}
  .part .check{display:block;max-width:100%;max-height:820px;margin-bottom:14px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:14px;font-size:14px}
  .two b.h{display:block;font:11px/1.4 ui-monospace,Menlo,monospace;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:rgba(0,0,0,.55);margin-bottom:3px}
  .values{margin:12px 0 0;font:12px/1.7 ui-monospace,Menlo,monospace}
  .values span{display:inline-block;margin-right:18px}.values i{font-style:normal;color:rgba(0,0,0,.5)}
  .differs{margin:10px 0 0;font-size:13px;color:rgba(0,0,0,.7)}
  ul.plain{margin:0;padding-left:18px;display:grid;gap:4px}
  @media (max-width:900px){.top,.two{grid-template-columns:1fr}}
`;

const formatOf = (entry) => (entry.format === "image" ? "image only" : entry.maker ? "svg from a function" : entry.format);

function studyPage(study, loaded, colours, imageName) {
  const list = (items, render) => (items?.length ? `<ul class="plain">${items.map((item) => `<li>${render(item)}</li>`).join("")}</ul>` : "");
  const chips = (items) => `<div class="chips">${(items ?? []).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>`;
  const shown = (value) => escapeHtml(typeof value === "object" && value !== null ? JSON.stringify(value) : value);

  const tiles = loaded
    .map(
      ({ part, ...entry }) => `<a class="tile" href="#${part.id}"><div class="pic"><img src="parts/${part.id}.png" alt=""></div><div class="txt"><b>${escapeHtml(part.name)}</b>${chips(part.keywords)}<p class="meta">${escapeHtml(part.use_as)} · ${escapeHtml(part.aspect)} · ${formatOf(entry)}</p></div></a>`,
    )
    .join("");

  const sections = loaded
    .map(({ part, ...entry }, index) => {
      const variables = entry.source ? variablesIn(entry.source) : [];
      const params = entry.maker
        ? `<table><tr><th>Parameter</th><th>Measured</th><th>Range</th><th></th><th>What it changes</th></tr>${Object.entries(entry.maker.params)
            .map(
              ([name, spec]) => `<tr><td><b>${escapeHtml(name)}</b></td><td>${shown(spec.value)}</td><td>${typeof spec.value === "number" ? `${shown(spec.min)} to ${shown(spec.max)}` : ""}</td><td><span class="tag ${spec.role === "look" ? "" : "no"}">${spec.role === "look" ? "carries the look" : "free"}</span></td><td>${escapeHtml(spec.note)}</td></tr>`,
            )
            .join("")}</table>`
        : "";
      const change =
        entry.format === "image"
          ? `Nothing: this part is a picture. ${escapeHtml(part.image_only)}`
          : `${variables.length ? `Colours and other values through ${variables.map((variable) => `<code>${escapeHtml(variable.name)}</code>`).join(", ")}${/currentColor/i.test(entry.source) ? " and the text colour around it" : ""}.` : /currentColor/i.test(entry.source) ? "Its colour follows the text colour around it." : "No value can be changed from outside the file."}${params}`;
      const values = Object.entries(part.values ?? {})
        .map(([key, value]) => `<span>${escapeHtml(key)} <b>${shown(value.value)}</b> <i>${escapeHtml(value.source)}</i></span>`)
        .join("");
      const differs = (part.check?.still_differs ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      return `
      <section class="card part" id="${part.id}">
        <h3>${index + 1}. ${escapeHtml(part.name)}</h3>
        <p class="meta">${escapeHtml(part.use_as)} · ${escapeHtml(part.aspect)} · ${formatOf(entry)}${part.file ? ` · ${escapeHtml(part.file)}` : ""}${part.made_by ? ` · ${escapeHtml(part.made_by)}` : ""}</p>
        <img class="check" src="parts/${part.id}.${entry.format === "image" ? "crop" : "check"}.png" alt="">
        <div class="two">
          <div><b class="h">What is unusual</b>${escapeHtml(part.unusual)}</div>
          <div><b class="h">When to use it</b>${escapeHtml(part.use)}</div>
        </div>
        <div class="two">
          <div><b class="h">Found by</b>${chips(part.keywords)}<div style="margin-top:8px">${list(part.answers, escapeHtml)}</div></div>
          <div><b class="h">What can change</b>${change}</div>
        </div>
        ${values ? `<p class="values">${values}</p>` : ""}
        ${differs ? `<div class="differs">Still differs from the reference:<ul class="plain">${differs}</ul></div>` : ""}
      </section>`;
    })
    .join("\n");

  const marks = loaded
    .map(({ part }, index) => `<div class="mark" style="left:${part.where[0] * 100}%;top:${part.where[1] * 100}%;width:${part.where[2] * 100}%;height:${part.where[3] * 100}%"><b>${index + 1}</b></div>`)
    .join("");
  const swatches = colours
    .map(
      (colour) => `<div class="sw"><i style="background:${colour.hex}"></i><b>${escapeHtml(colour.role ?? "")}</b><span>${colour.hex}${typeof colour.share === "number" ? ` · ${percent(colour.share)}` : ""}</span>
        <span class="${colour.source === "measured" && colour.found < 0.0002 ? "bad" : ""}">${escapeHtml(colour.source)}${colour.source === "measured" && colour.found < 0.0002 ? ", not found in image" : ""}</span></div>`,
    )
    .join("");
  const candidates = (study.candidates ?? [])
    .map(
      (candidate) => `<tr><td><span class="tag ${candidate.taken ? "" : "no"}">${candidate.taken ? "taken" : "left"}</span></td><td><b>${escapeHtml(candidate.name)}</b></td>
        <td>${escapeHtml(candidate.instead_of ?? "")}</td><td>${escapeHtml(candidate.taken ? (candidate.form ?? "") : (candidate.why_not ?? ""))}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Study: ${escapeHtml(study.title ?? study.reference ?? "reference")}</title><style>${PAGE_STYLE}</style></head>
<body><div class="page">
  <p class="eyebrow">World Material Library · study${study.reference ? ` · ${escapeHtml(study.reference)}` : ""}</p>
  <h1>${escapeHtml(study.title ?? "Study of a reference")}</h1>
  <p class="lede">${escapeHtml(study.kind)}. Gives: ${escapeHtml((study.gives ?? []).join(", ") || "not stated")}.${study.does_not_give?.length ? ` Does not give: ${escapeHtml(study.does_not_give.join(", "))}.` : ""}</p>
  ${study.confirmed ? "" : `<p class="warn">Not confirmed by the owner yet. The choice of parts is the agent's${study.agent ? ` (${escapeHtml(study.agent)})` : ""}.</p>`}

  <h2>Parts</h2>
  <div class="tiles">${tiles}</div>

  <h2>Where the parts came from</h2>
  <div class="top">
    <div class="card"><div class="ref"><img src="${escapeHtml(imageName)}" alt="">${marks}</div></div>
    <div style="display:grid;gap:16px">
      <div class="card"><p class="eyebrow">The ordinary version</p>${escapeHtml(study.ordinary_version)}</div>
      ${swatches ? `<div class="card"><p class="eyebrow">Colours</p><div class="swatches">${swatches}</div></div>` : ""}
    </div>
  </div>

  <h2>Each part against the reference</h2>
  ${sections}

  <h2>Candidates</h2>
  <div class="card"><table><tr><th></th><th>Candidate</th><th>An ordinary version would have</th><th>Saved as, or why it was left</th></tr>${candidates}</table></div>

  ${study.rules?.length ? `<h2>Rules</h2><div class="card">${list(study.rules, (rule) => `<b>${escapeHtml(rule.rule)}</b> ${escapeHtml(rule.evidence ?? "")}`)}</div>` : ""}
  ${study.notes?.length ? `<h2>Seen but not built</h2><div class="card">${list(study.notes, escapeHtml)}</div>` : ""}
  ${study.questions?.length ? `<h2>Questions for the owner</h2><div class="card">${list(study.questions, escapeHtml)}</div>` : ""}
</div></body></html>
`;
}

async function page(file) {
  if (!file || !fs.existsSync(file)) fail(`no such study: ${file}`);
  let study;
  try {
    study = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
  }
  const folder = path.dirname(path.resolve(file));
  const { problems, notes, empty } = checkStudy(study);
  const stopIfWrong = () => {
    if (problems.length === 0) return;
    console.error(`${file} has ${problems.length === 1 ? "a problem" : "problems"}. Nothing was drawn.`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  };
  stopIfWrong();

  const imageName = given(study.image) ? String(study.image) : ["image.jpg", "image.jpeg", "image.png", "image.webp"].find((name) => fs.existsSync(path.join(folder, name)));
  if (!imageName || !/^[\w.-]+$/.test(imageName) || !fs.existsSync(path.join(folder, imageName))) {
    fail(`no reference image next to ${file}. It is image.jpg, image.png or image.webp, or the file named in "image".`);
  }
  const image = await openImage(path.join(folder, imageName));
  const partsFolder = path.join(folder, "parts");
  if (fs.existsSync(partsFolder) && fs.lstatSync(partsFolder).isSymbolicLink()) fail("parts/ is a link. It must be a real folder next to study.json.");
  fs.mkdirSync(partsFolder, { recursive: true });

  // Read every part's file before drawing anything, so that all problems come out in one run.
  const loaded = [];
  const frames = [];
  for (const part of study.parts) {
    const at = `part ${part.id}`;
    const region = toPixels({ x: part.where[0], y: part.where[1], w: part.where[2], h: part.where[3] }, image);
    const entry = { part, region, scale: pictureScale(region.width, region.height), maker: null, source: null, format: "image", frame: null, variants: [] };
    loaded.push(entry);
    if (!given(part.file)) continue;
    try {
      if (given(part.made_by)) {
        entry.maker = loadMaker(path.join(folder, part.made_by), at);
        writeOwn(path.join(folder, part.file), `${entry.maker.render()}\n`);
      }
      const partFile = path.join(folder, part.file);
      if (!fs.existsSync(partFile)) throw new Error(`${at}: "file" is ${part.file}, which does not exist.`);
      entry.source = fs.readFileSync(partFile, "utf8");
      entry.format = part.file.endsWith(".svg") ? "svg" : "html";
      const found = inspectFile(entry.source, entry.format, at);
      problems.push(...found.problems);
      notes.push(...found.notes);
      const markup = (source) => source.replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/i, "");
      const ground = { background: part.stage?.background ?? "#ffffff", color: part.stage?.color ?? "#111111" };
      entry.frame = { markup: markup(entry.source), width: region.width, height: region.height, scale: entry.scale, ...ground, vars: {} };
      frames.push(entry.frame);
      if (entry.format === "svg") {
        const own = boxFor(entry.source, region);
        const drawnAs = own.width / own.height;
        const cameFrom = region.width / region.height;
        if (Math.abs(drawnAs / cameFrom - 1) > 0.03) {
          notes.push(`${at}: its viewBox is ${drawnAs.toFixed(2)} wide for 1 high, and the region in "where" is ${cameFrom.toFixed(2)}. The picture shows empty bands until the two agree.`);
        }
      }
      for (const variant of part.variants ?? []) {
        let source = entry.source;
        let box = { width: region.width, height: region.height };
        const changes = variant.params ?? {};
        if (entry.maker && Object.keys(changes).length > 0) {
          for (const [name, value] of Object.entries(changes)) {
            const spec = entry.maker.params[name];
            if (!spec) throw new Error(`${at}: variant "${variant.label}" sets ${name}, which is not one of the params in ${part.made_by}.`);
            if (typeof spec.value === "number" && (typeof value !== "number" || value < spec.min || value > spec.max)) {
              throw new Error(`${at}: variant "${variant.label}" sets ${name} to ${JSON.stringify(value)}, outside its range of ${spec.min} to ${spec.max}.`);
            }
          }
          source = entry.maker.render(changes);
          box = boxFor(source, region);
        }
        const frame = { markup: markup(source), ...box, scale: pictureScale(box.width, box.height), background: variant.background ?? ground.background, color: variant.color ?? ground.color, vars: variant.vars ?? {} };
        frames.push(frame);
        entry.variants.push({ label: variant.label, frame });
      }
    } catch (error) {
      problems.push(error.message);
    }
  }
  stopIfWrong();

  try {
    await drawFrames(frames, partsFolder);
  } catch (error) {
    fail(error.message);
  }

  const index = [];
  for (const entry of loaded) {
    const { part, region, scale } = entry;
    const named = (suffix) => path.join(partsFolder, `${part.id}${suffix}`);
    const cut = sharp(image.buffer).extract(region);
    const crop = await cut
      .clone()
      .resize({ width: Math.max(1, Math.round(region.width * scale)), height: Math.max(1, Math.round(region.height * scale)), fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
    writeOwn(named(".crop.png"), crop);
    for (const old of [".v1.png", ".v2.png", ".v3.png"]) fs.rmSync(named(old), { force: true });
    const listed = {
      id: part.id,
      image: `parts/${part.id}.png`,
      from: `parts/${part.id}.crop.png`,
      format: entry.format,
      file: part.file ?? null,
      made_by: part.made_by ?? null,
      box: [region.width, region.height],
      variables: entry.source ? variablesIn(entry.source) : [],
      follows_text_colour: entry.source ? /currentColor/i.test(entry.source) : false,
      params: entry.maker?.params ?? null,
      variants: [],
    };
    index.push(listed);
    if (!entry.frame) {
      // The picture is the part, so it keeps the image's own pixels.
      writeOwn(named(".png"), await cut.clone().png().toBuffer());
      fs.rmSync(named(".check.png"), { force: true });
      continue;
    }
    writeOwn(named(".png"), entry.frame.image);
    for (const [v, variant] of entry.variants.entries()) {
      writeOwn(named(`.v${v + 1}.png`), variant.frame.image);
      listed.variants.push({ label: variant.label, image: `parts/${part.id}.v${v + 1}.png` });
    }

    const wide = region.width / region.height >= 1.8;
    const [mainWidth, mainHeight] = wide ? [1400, 320] : [500, 560];
    const [smallWidth, smallHeight] = wide ? [1400, 200] : [500, 300];
    const first = [
      { ...(await fitInside(crop, mainWidth, mainHeight)), label: "the region in the reference" },
      { ...(await fitInside(entry.frame.image, mainWidth, mainHeight)), label: `drawn from ${part.file}` },
      { ...(await fitInside(await overlaid(crop, entry.frame.image), mainWidth, mainHeight)), label: "overlaid: doubled edges are misplaced" },
    ];
    const others = [];
    for (const [v, variant] of entry.variants.entries()) {
      others.push({ ...(await fitInside(variant.frame.image, smallWidth, smallHeight)), label: `variant ${v + 1}: ${variant.label}` });
    }
    const rows = wide ? [...first, ...others].map((cell) => [cell]) : [first, ...(others.length > 0 ? [others] : [])];
    if (fs.existsSync(named(".check.png"))) fs.renameSync(named(".check.png"), named(".check.prev.png"));
    writeOwn(named(".check.png"), await contactSheet(rows));
  }
  writeOwn(path.join(partsFolder, "index.json"), `${JSON.stringify({ note: "Written by look.js page from study.json and the files in parts/. Do not edit: run page again.", parts: index }, null, 2)}\n`);

  const colours = await findColours(image, study.colours ?? []);
  const missing = colours.filter((colour) => colour.source === "measured" && colour.found < 0.0002);
  writeOwn(path.join(folder, "study.html"), studyPage(study, loaded, colours, imageName));
  try {
    dropLink(path.join(folder, "study.png"));
    // The top of the page: the tiles the owner sees first. The rest is the check pictures, which are files of their own.
    await renderTo({ page: path.join(folder, "study.html"), out: path.join(folder, "study.png"), width: 1500, height: 1300, full: false });
  } catch (error) {
    fail(error.message);
  }

  console.log(`Wrote in ${folder}:`);
  for (const entry of loaded) {
    const { part } = entry;
    const box = `${entry.region.width} x ${entry.region.height} px`;
    if (entry.frame) {
      console.log(`  parts/${part.id}.png        the part, drawn from ${part.file}${part.made_by ? ` (which ${part.made_by} made)` : ""} in a box of ${box}`);
      console.log(`  parts/${part.id}.check.png  the region in the reference, the part, both overlaid, then ${entry.variants.length} variant(s)`);
    } else {
      console.log(`  parts/${part.id}.png        image only: the region itself, ${box}`);
    }
  }
  console.log("  parts/index.json   what each part is made of, for search");
  console.log("  study.html         the page for the owner; study.png shows its top, the tiles they see first");
  console.log("\nOpen every check picture. The part and the region are drawn at the same size, so any difference you see is in your file.");
  for (const colour of colours.filter((entry) => entry.source === "measured")) {
    console.log(`  colour ${colour.hex} (${colour.role ?? "no role"}): ${colour.found >= 0.0002 ? `in the image, ${percent(colour.found)} of pixels` : `NOT in the image (closest pixel is ${colour.nearest.toFixed(3)} away; 0.035 counts as a match)`}`);
  }
  if (missing.length > 0) notes.push(`${missing.length} colour(s) marked "measured" do not occur in the image. Measure them again or mark them estimated.`);
  if (empty.length > 0) notes.push(`these words say nothing a designer can act on; replace each with what you measured or saw: ${empty.join(", ")}`);
  if (notes.length > 0) {
    console.log("\nWorth fixing:");
    for (const note of notes) console.log(`  - ${note}`);
  }
  if (!study.confirmed) console.log('\nThe study is marked "confirmed": false. Only the owner changes that.');
}

/* ---------- main ---------- */

(async () => {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, options } = parseArgs(rest);
  const box = options.box ? parseBox(last(options, "box")) : WHOLE;
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return console.log(USAGE);
    case "info":
      return info(await openImage(positional[0]));
    case "crop":
      if (!positional[1] || !options.box) fail("usage: look.js crop <image> <out.png> --box x,y,w,h");
      return crop(await openImage(positional[0]), positional[1], box, options);
    case "grid":
      if (!positional[1]) fail("usage: look.js grid <image> <out.png> [--box x,y,w,h] [--step 0.05]");
      return grid(await openImage(positional[0]), positional[1], box, options);
    case "sample":
      if (!options.box) fail("usage: look.js sample <image> --box [name=]x,y,w,h [--box ...]");
      return sample(await openImage(positional[0]), options.box.map(parseBox));
    case "palette":
      return palette(await openImage(positional[0]), box, Math.min(12, Math.max(2, Number(last(options, "k", 6)) || 6)));
    case "ramp":
      return ramp(await openImage(positional[0]), parsePoint(last(options, "from"), "from"), parsePoint(last(options, "to"), "to"), Math.min(16, Math.max(2, Number(last(options, "steps", 6)) || 6)));
    case "trace":
      if (!positional[1] || !options.box) fail("usage: look.js trace <image> <out.svg> --box x,y,w,h [--light | --near #hex]");
      return trace(await openImage(positional[0]), positional[1], box, options);
    case "shot":
      if (!positional[1]) fail("usage: look.js shot <page.html> <out.png> [--size 1400x900] [--full]");
      return shot(positional[0], positional[1], options);
    case "pair":
      if (!positional[2]) fail("usage: look.js pair <left.png> <right.png> <out.png> [--labels reference,rebuilt]");
      return pair(positional[0], positional[1], positional[2], options);
    case "page":
      return page(positional[0]);
    case "serve":
      return serve(positional[0], positional[1]);
    default:
      fail(`unknown command "${command}". Run look.js without arguments for the list.`);
  }
})().catch((error) => fail(error.stack ?? String(error)));
