/**
 * Colour maths for searching palettes. Everything is compared in OKLCH
 * (lightness, chroma, hue), where equal steps look roughly equal, rather than
 * by distance between hex values.
 */

export type Oklch = {
  /** Lightness, 0 (black) to 1 (white). */
  l: number;
  /** Chroma: 0 is grey, about 0.3 is as vivid as a screen gets. */
  c: number;
  /** Hue angle in degrees, 0 to 360. */
  h: number;
};

export const TONES = ["black", "grey", "white"] as const;
export type Tone = (typeof TONES)[number];

/** What the colour picker can ask for: a hue, or one of the neutrals. */
export type ColorPick = { kind: "hue"; hue: number } | { kind: "tone"; tone: Tone };

/** How far a palette colour's hue may sit from the picked hue, in degrees. */
const HUE_TOLERANCE = 25;
/** Below this chroma a colour reads as a neutral, whatever its hue angle says. */
const MIN_CHROMA = 0.04;
/** Palettes are stored most common colour first; later colours count for less. */
const POSITION_WEIGHT = [1, 0.8, 0.65, 0.5, 0.4];

const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

function toLinear(channel: number) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number) {
  return value <= 0.0031308
    ? 12.92 * value
    : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** Null when the text is not a six-digit hex colour. */
export function hexToOklch(hex: string): Oklch | null {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) return null;
  const rgb = parseInt(match[1], 16);
  const r = toLinear((rgb >> 16) & 255);
  const g = toLinear((rgb >> 8) & 255);
  const b = toLinear(rgb & 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    l: lightness,
    c: Math.hypot(a, bAxis),
    h: ((Math.atan2(bAxis, a) * 180) / Math.PI + 360) % 360,
  };
}

function toLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = l - 0.0894841775 * a - 1.291485548 * b;
  const long = lRoot ** 3;
  const medium = mRoot ** 3;
  const short = sRoot ** 3;
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
}

/**
 * The nearest colour a screen can show: chroma is lowered until the colour
 * fits, which keeps its lightness and hue.
 */
export function oklchToHex(color: Oklch): string {
  const displayable = (rgb: number[]) =>
    rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005);

  let rgb = toLinearRgb(color);
  if (!displayable(rgb)) {
    let low = 0;
    let high = color.c;
    for (let step = 0; step < 20; step += 1) {
      const middle = (low + high) / 2;
      if (displayable(toLinearRgb({ ...color, c: middle }))) low = middle;
      else high = middle;
    }
    rgb = toLinearRgb({ ...color, c: low });
  }
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(channel))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** The colour the picker shows for a hue: vivid, mid-light. */
export function hueSwatch(hue: number): string {
  return oklchToHex({ l: 0.72, c: 0.17, h: hue });
}

export const TONE_SWATCH: Record<Tone, string> = {
  black: "#111111",
  grey: "#8a8a8a",
  white: "#ffffff",
};

function hueDistance(a: number, b: number) {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
}

/** 0 when the colour does not answer the pick, up to 1 for a perfect answer. */
function closeness(color: Oklch, pick: ColorPick): number {
  if (pick.kind === "tone") {
    if (pick.tone === "black") return color.l <= 0.32 && color.c <= 0.05 ? 1 : 0;
    if (pick.tone === "white") return color.l >= 0.88 && color.c <= 0.04 ? 1 : 0;
    return color.l > 0.32 && color.l < 0.88 && color.c <= 0.03 ? 1 : 0;
  }
  if (color.c < MIN_CHROMA) return 0;
  const gap = hueDistance(color.h, pick.hue);
  if (gap > HUE_TOLERANCE) return 0;
  // Photo colours are muted, so hue decides the match; a closer hue and a
  // more vivid colour only move it up the ranking.
  const hueScore = 1 - 0.6 * (gap / HUE_TOLERANCE);
  const vividness = 0.6 + 0.4 * Math.min(1, color.c / 0.12);
  return hueScore * vividness;
}

/**
 * How well a palette answers a pick: 0 for no match, higher when the matching
 * colour is closer to the pick and more dominant in the palette.
 */
export function paletteMatch(palette: string[], pick: ColorPick): number {
  let best = 0;
  palette.forEach((hex, index) => {
    const color = hexToOklch(hex);
    if (!color) return;
    const weight = POSITION_WEIGHT[Math.min(index, POSITION_WEIGHT.length - 1)];
    best = Math.max(best, weight * closeness(color, pick));
  });
  return best;
}

/** The pick as it is written in the URL: `h210`, `black`, `grey` or `white`. */
export function formatColorPick(pick: ColorPick): string {
  return pick.kind === "tone" ? pick.tone : `h${Math.round(pick.hue) % 360}`;
}

export function parseColorPick(value: string | null | undefined): ColorPick | null {
  if (!value) return null;
  if ((TONES as readonly string[]).includes(value)) {
    return { kind: "tone", tone: value as Tone };
  }
  const match = /^h(\d{1,3})$/.exec(value);
  return match ? { kind: "hue", hue: Number(match[1]) % 360 } : null;
}

export function describeColorPick(pick: ColorPick): string {
  return pick.kind === "tone" ? pick.tone : `hue ${Math.round(pick.hue)}°`;
}
