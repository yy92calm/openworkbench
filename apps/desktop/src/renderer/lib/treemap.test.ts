// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { squarify } from './treemap';

const area = (r: { w: number; h: number }) => r.w * r.h;

describe('squarify', () => {
  it('fills the canvas with a single item', () => {
    expect(squarify([5], 200, 100)).toEqual([{ x: 0, y: 0, w: 200, h: 100 }]);
  });

  it('keeps areas proportional to the values and covers the canvas', () => {
    const values = [50, 25, 15, 10];
    const total = values.reduce((a, b) => a + b, 0);
    const rects = squarify(values, 400, 200);
    expect(rects.reduce((sum, r) => sum + area(r), 0)).toBeCloseTo(400 * 200, 0);
    rects.forEach((r, i) => {
      expect(area(r)).toBeCloseTo((values[i] / total) * 400 * 200, 0);
    });
  });

  it('produces non-overlapping rectangles', () => {
    const rects = squarify([40, 30, 20, 10], 300, 200);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0.001);
      }
    }
  });

  it('leaves zero-area rects for non-positive values', () => {
    const rects = squarify([10, 0, -5], 100, 100);
    expect(area(rects[0])).toBeCloseTo(100 * 100, 0);
    expect(area(rects[1])).toBe(0);
    expect(area(rects[2])).toBe(0);
  });

  it('returns zeros for empty input or an empty canvas', () => {
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify([1, 2], 0, 100).every((r) => area(r) === 0)).toBe(true);
  });
});
