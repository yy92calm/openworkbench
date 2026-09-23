// Squarified treemap layout (Bruls et al.): values → pixel rects that fill the
// canvas without overlaps and keep blocks as square-ish as possible. Pure so
// the layout is unit-testable; the component measures the container and paints.

export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EMPTY: TreemapRect = { x: 0, y: 0, w: 0, h: 0 };

/** Worst aspect ratio of a row (areas) laid along `length`. */
function worstRatio(areas: number[], length: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  if (sum <= 0 || length <= 0) return Number.POSITIVE_INFINITY;
  return Math.max((length * length * max) / (sum * sum), (sum * sum) / (length * length * min));
}

/**
 * Lay `values` out into a `width × height` canvas, preserving each value's
 * share of the total area. Non-positive values get a zero rect (invisible).
 */
export function squarify(values: readonly number[], width: number, height: number): TreemapRect[] {
  const rects: TreemapRect[] = values.map(() => ({ ...EMPTY }));
  if (width <= 0 || height <= 0) return rects;
  const items = values
    .map((value, index) => ({ area: value, index }))
    .filter((e) => e.area > 0)
    .sort((a, b) => b.area - a.area);
  const total = items.reduce((sum, e) => sum + e.area, 0);
  if (total <= 0) return rects;
  const scale = (width * height) / total;
  for (const item of items) item.area *= scale;

  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let start = 0;
  while (start < items.length) {
    const length = Math.min(w, h);
    if (length <= 0) break;
    // Grow the row while the worst aspect ratio keeps improving.
    let end = start + 1;
    let best = worstRatio([items[start].area], length);
    while (end < items.length) {
      const candidate = worstRatio(
        items.slice(start, end + 1).map((e) => e.area),
        length,
      );
      if (candidate > best) break;
      best = candidate;
      end += 1;
    }
    const row = items.slice(start, end);
    const rowArea = row.reduce((sum, e) => sum + e.area, 0);
    if (w >= h) {
      // Vertical strip on the left; items stack top → bottom.
      const stripW = rowArea / h;
      let oy = y;
      for (const item of row) {
        const ih = item.area / stripW;
        rects[item.index] = { x, y: oy, w: stripW, h: ih };
        oy += ih;
      }
      x += stripW;
      w -= stripW;
    } else {
      // Horizontal band on top; items go left → right.
      const stripH = rowArea / w;
      let ox = x;
      for (const item of row) {
        const iw = item.area / stripH;
        rects[item.index] = { x: ox, y, w: iw, h: stripH };
        ox += iw;
      }
      y += stripH;
      h -= stripH;
    }
    start = end;
  }
  return rects;
}
