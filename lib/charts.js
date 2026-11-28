'use strict';
/**
 * Small server-side SVG charts for the dashboard. No chart library and no
 * script: the SVG is drawn here, sized by viewBox, coloured by CSS classes
 * (public/css/features.css) so it follows the Appearance accent colour.
 *
 * Specs (from the house data-viz rules): bars at most 24px wide with a 4px
 * rounded end and square base, 2px gap between touching bars, 2px lines,
 * end dots r=4 with a surface ring, hairline solid gridlines, one y-axis,
 * text in text colours (never the series colour), a <title> on every mark
 * for hover, and a table view next to each chart.
 */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Clean axis maximum and step: 0, 2,000, 4,000 … */
function niceScale(max, ticks = 4) {
  if (!(max > 0)) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  return { max: step * ticks, step };
}

function compact(n, digits) {
  const a = Math.abs(n);
  const out = a >= 1e7 ? (n / 1e7).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'Cr'
    : a >= 1e5 ? (n / 1e5).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, '') + 'L'
      : a >= 1e3 ? (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K'
        : String(Math.round(n));
  return digits ? digits(out) : out;
}

/** Bar with a rounded top and a square base. */
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * Grouped columns.
 * opts: { categories: [label], series: [{ name, cls, values: [n] }], fmt: n => text, digits }
 */
function columns(opts) {
  const W = 640, H = 230, L = 46, R = 8, T = 14, B = 28;
  const cats = opts.categories;
  const series = opts.series;
  const fmt = opts.fmt || ((n) => String(n));
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const sc = niceScale(max);
  const plotW = W - L - R, plotH = H - T - B;
  const band = plotW / Math.max(1, cats.length);
  const gap = 2;
  const barW = Math.min(24, (band * 0.72 - gap * (series.length - 1)) / series.length);
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v) => T + plotH - (v / sc.max) * plotH;

  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || '')}">`;
  for (let v = 0; v <= sc.max + 1e-9; v += sc.step) {
    const yy = y(v).toFixed(1);
    s += `<line class="grid${v === 0 ? ' base' : ''}" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
    s += `<text class="tick" x="${L - 6}" y="${yy}" dy="0.32em" text-anchor="end">${esc(compact(v, opts.digits))}</text>`;
  }
  cats.forEach((c, i) => {
    const gx = L + band * i + (band - groupW) / 2;
    series.forEach((ser, j) => {
      const v = ser.values[i] || 0;
      const x = gx + j * (barW + gap);
      const top = y(v);
      s += `<g class="mark"><rect class="hit" x="${(L + band * i).toFixed(1)}" y="${T}" width="${band.toFixed(1)}" height="${plotH}" fill="transparent"/>` +
        `<path class="bar ${ser.cls}" d="${barPath(x, top, barW, T + plotH - top)}"/>` +
        `<title>${esc(c)} · ${esc(ser.name)}: ${esc(fmt(v))}</title></g>`;
    });
    if (cats.length <= 12 || i % 2 === 0) {
      s += `<text class="tick" x="${(L + band * i + band / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(c)}</text>`;
    }
  });
  return s + '</svg>';
}

/**
 * One line, 0–100 (percent). opts: { labels: [text], values: [n|null], name, fmt, digits }
 * Gaps (null) break the line instead of dropping to zero.
 */
function line(opts) {
  const W = 640, H = 230, L = 40, R = 40, T = 14, B = 28;
  const vals = opts.values;
  const n = vals.length;
  const plotW = W - L - R, plotH = H - T - B;
  const x = (i) => L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => T + plotH - (v / 100) * plotH;
  const fmt = opts.fmt || ((v) => `${v}%`);

  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || '')}">`;
  for (let v = 0; v <= 100; v += 25) {
    const yy = y(v).toFixed(1);
    s += `<line class="grid${v === 0 ? ' base' : ''}" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
    s += `<text class="tick" x="${L - 6}" y="${yy}" dy="0.32em" text-anchor="end">${esc(opts.digits ? opts.digits(v) : v)}%</text>`;
  }
  // path segments + soft area wash
  let d = '', area = '', open = false, segStart = 0;
  vals.forEach((v, i) => {
    if (v == null) {
      if (open) { area += `L${x(i - 1).toFixed(1)},${y(0)}L${x(segStart).toFixed(1)},${y(0)}Z`; open = false; }
      return;
    }
    const p = `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    if (!open) { d += `M${p}`; area += `M${p}`; segStart = i; open = true; } else { d += `L${p}`; area += `L${p}`; }
  });
  if (open) area += `L${x(n - 1).toFixed(1)},${y(0)}L${x(segStart).toFixed(1)},${y(0)}Z`;
  s += `<path class="area" d="${area}"/><path class="line" d="${d}"/>`;

  // hover columns: one per point, with a dot that shows on hover
  const step = n > 1 ? plotW / (n - 1) : plotW;
  vals.forEach((v, i) => {
    if (v == null) return;
    s += `<g class="mark pt"><rect class="hit" x="${(x(i) - step / 2).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${plotH}" fill="transparent"/>` +
      `<line class="cross" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${T}" y2="${T + plotH}"/>` +
      `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4"/>` +
      `<title>${esc(opts.labels[i])}: ${esc(fmt(v))}</title></g>`;
  });
  // label the last point (selective direct label)
  let last = n - 1; while (last >= 0 && vals[last] == null) last--;
  if (last >= 0) {
    s += `<circle class="dot end" cx="${x(last).toFixed(1)}" cy="${y(vals[last]).toFixed(1)}" r="4"/>`;
    s += `<text class="val" x="${(x(last) + 8).toFixed(1)}" y="${y(vals[last]).toFixed(1)}" dy="0.32em">${esc(fmt(vals[last]))}</text>`;
  }
  const every = Math.ceil(n / 8);
  opts.labels.forEach((lab, i) => {
    if (i !== n - 1 && (i % every !== 0 || n - 1 - i < every)) return; // keep the last label clear of its neighbour
    s += `<text class="tick" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(lab)}</text>`;
  });
  return s + '</svg>';
}

module.exports = { columns, line, niceScale };
