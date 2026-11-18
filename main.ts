// gta6-twitch-ccu-forecast-01 entry (Node 22, standard library only).
//
// Method: launch-day shape from the case's comparables, in log space.
//   - For each comparable launch, take its release-day hourly viewers and divide by its
//     own hour-1 print, giving a log-ratio curve log(v_h / v_1) for h = 2..24.
//   - The centre for hour h is the scale-weighted median of those log-ratios, where a
//     comparable's weight is exp(-|log(p1_comp) - log(p1_case)| / 0.6): launches whose
//     first hour was about as big as this case's count most. The centre is blended
//     60% toward the same weighted median over console-only comparables (no "PC" in
//     their platforms): this game is console-only, and so is every practice launch.
//   - The spread for hour h is the scale-weighted interquartile range of the same
//     log-ratios / 1.349, times 0.85, floored at 0.10 and capped at 1.2 log units.
//   - Both the centre and the spread curves are smoothed with a 3-hour moving
//     average: a launch day's viewership curve is smooth, the per-hour medians are not.
//   - Forecast: q_tau(h) = p1 * exp(centre_h + z_tau * spread_h), rounded to 2
//     decimals, where p1 is this case's hour-1 print. The Grand Theft Auto VI
//     category's own pre-release history (a comparable that is not a launch) is
//     excluded, as is any comparable with no hour-1 print.
//   - If a case has no usable comparables at all, the centre is 0 and the spread is
//     the house baseline's 0.15 * sqrt(h - 1): plain persistence, never a crash.
//
// Practice score, scored locally against SullyGnome's hourly averages (the same
// source the kit froze, re-read once for the four practice launches; hour-1 prints
// match the cases exactly): loss 0.2061 (p00 0.3626, p01 0.1668, p02 0.1054,
// p03 0.1895), versus the house baseline's 0.3871 on the same cases. Practice pays
// nothing and is no guide to the final; it only shows the shape model beats flat
// persistence on every past launch in the kit.
//
// Input: every <id>.in in the input directory: JSON
//   {"schema":"makefun/twitch-ccu-case/v1","id","game","day_start","checkpoint",
//    "levels","known","forecast","history","history_hourly","streams",
//    "categories_hourly","comparables","notes"}.
// Output: <id>.out {"hours":[{"hour":2,"q":[q05,q25,q50,q75,q95]}, ...]}, exactly
// 23 rows, hours 2..24, each q five finite numbers above 0 and at most 1e9,
// non-decreasing. Runs offline, deterministic, well inside the 8-second cap.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Scale-weight bandwidth, in natural-log units of hour-1 viewers. */
const BANDWIDTH = 0.6;
/** Weight of the console-only median in the centre blend. */
const CONSOLE_BLEND = 0.6;
/** Spread multiplier on the weighted IQR spread. */
const SPREAD_SCALE = 0.85;
/** Spread floor and cap, in natural-log units. */
const SPREAD_FLOOR = 0.1;
const SPREAD_CAP = 1.2;
/** Fallback spread per square-root hour when a case has no comparables. */
const FALLBACK_SIGMA = 0.15;

interface KnownRow {
  hour: number;
  viewers: number;
}

interface HourlyPoint {
  from: string;
  viewers: number;
  channels?: number;
}

interface Comparable {
  name: string;
  day_start: string;
  unlock?: string;
  platforms?: string;
  hourly: HourlyPoint[];
}

interface Case {
  levels: number[];
  known: KnownRow[];
  forecast: Array<{ hour: number }>;
  history: Array<{ at: string; viewers: number }>;
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Weighted q-quantile of (value, weight) pairs; pairs must be non-empty. */
function weightedQuantile(pairs: Array<[number, number]>, q: number): number {
  const sorted = pairs.slice().sort((a, b) => a[0] - b[0]);
  let total = 0;
  for (const [, w] of sorted) total += w;
  if (total <= 0) return sorted[Math.floor(sorted.length / 2)][0];
  let acc = 0;
  for (const [x, w] of sorted) {
    acc += w;
    if (acc >= q * total) return x;
  }
  return sorted[sorted.length - 1][0];
}

/** 3-hour moving average of a per-hour curve (hours 2..24). */
function smooth(curve: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    let sum = 0;
    let n = 0;
    for (let hh = Math.max(2, h - 1); hh <= Math.min(24, h + 1); hh++) {
      const v = curve.get(hh);
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    out.set(h, n > 0 ? sum / n : 0);
  }
  return out;
}

/** True when this comparable is the target game's own pre-release history, not a launch. */
function isTargetHistory(c: Comparable): boolean {
  const name = (c.name ?? '').toLowerCase();
  const unlock = (c.unlock ?? '').toLowerCase();
  return name.includes('grand theft auto vi') || unlock.includes('not a launch') || unlock.includes('target-history');
}

/** The forecast quantiles for one hour. */
function hourQuantiles(p1: number, centre: number, spread: number): number[] {
  return Z.map((z) => Math.max(1, round2(p1 * Math.exp(centre + z * spread))));
}

function forecastCase(c: Case): Array<{ hour: number; q: number[] }> {
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`case asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const first = c.known.find((k) => k.hour === 1);
  const lastHistory = c.history.length > 0 ? c.history[c.history.length - 1] : undefined;
  const p1 = Math.max(1, first !== undefined ? first.viewers : lastHistory !== undefined ? lastHistory.viewers : 1);

  // Per-hour log-ratio samples from the comparables, with scale weights.
  const samples = new Map<number, Array<[number, number]>>();
  const samplesConsole = new Map<number, Array<[number, number]>>();
  for (let h = 2; h <= 24; h++) {
    samples.set(h, []);
    samplesConsole.set(h, []);
  }
  for (const comp of c.comparables ?? []) {
    if (isTargetHistory(comp)) continue;
    const dayStart = Date.parse(comp.day_start);
    if (Number.isNaN(dayStart)) continue;
    const byTime = new Map<number, number>();
    for (const p of comp.hourly ?? []) {
      const t = Date.parse(p.from);
      if (!Number.isNaN(t)) byTime.set(t, p.viewers);
    }
    const compP1 = byTime.get(dayStart);
    if (compP1 === undefined || compP1 < 1) continue;
    const w = Math.exp(-Math.abs(Math.log(compP1) - Math.log(p1)) / BANDWIDTH);
    const consoleOnly = !/pc/i.test(comp.platforms ?? '');
    for (let h = 2; h <= 24; h++) {
      const v = byTime.get(dayStart + (h - 1) * 3600_000);
      if (v === undefined || v < 1) continue;
      const r = Math.log(v / compP1);
      samples.get(h)!.push([r, w]);
      if (consoleOnly) samplesConsole.get(h)!.push([r, w]);
    }
  }

  const centre = new Map<number, number>();
  const spread = new Map<number, number>();
  for (let h = 2; h <= 24; h++) {
    const pairs = samples.get(h)!;
    if (pairs.length === 0) {
      centre.set(h, 0);
      spread.set(h, FALLBACK_SIGMA * Math.sqrt(h - 1));
      continue;
    }
    let m = weightedQuantile(pairs, 0.5);
    const consolePairs = samplesConsole.get(h)!;
    if (CONSOLE_BLEND > 0 && consolePairs.length >= 3) {
      m = (1 - CONSOLE_BLEND) * m + CONSOLE_BLEND * weightedQuantile(consolePairs, 0.5);
    }
    let s: number;
    if (pairs.length >= 4) {
      s = (weightedQuantile(pairs, 0.75) - weightedQuantile(pairs, 0.25)) / 1.349;
    } else if (pairs.length >= 2) {
      const xs = pairs.map(([x]) => x);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      s = Math.sqrt(xs.reduce((a, x) => a + (x - mean) * (x - mean), 0) / xs.length);
    } else {
      s = FALLBACK_SIGMA * Math.sqrt(h - 1);
    }
    centre.set(h, m);
    spread.set(h, Math.max(SPREAD_FLOOR, Math.min(SPREAD_CAP, s * SPREAD_SCALE)));
  }

  const smoothCentre = smooth(centre);
  const smoothSpread = smooth(spread);
  return c.forecast.map(({ hour }) => ({
    hour,
    q: hourQuantiles(p1, smoothCentre.get(hour) ?? 0, smoothSpread.get(hour) ?? FALLBACK_SIGMA * Math.sqrt(hour - 1)),
  }));
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
