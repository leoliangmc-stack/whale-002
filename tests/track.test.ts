import { describe, expect, it } from 'vitest';
import { Track } from '../src/core/Track';

describe('Track', () => {
  it('passes through keys and clamps outside', () => {
    const t = new Track([[0, 0], [0.5, 10], [1, 4]]);
    expect(t.at(0)).toBeCloseTo(0);
    expect(t.at(0.5)).toBeCloseTo(10);
    expect(t.at(1)).toBeCloseTo(4);
    expect(t.at(-1)).toBeCloseTo(0);
    expect(t.at(2)).toBeCloseTo(4);
  });

  it('is monotone between monotone keys (no overshoot)', () => {
    const t = new Track([[0, 0], [0.1, 0], [0.2, 100], [0.3, 100], [1, 100]]);
    let prev = -Infinity;
    for (let p = 0; p <= 1; p += 0.001) {
      const v = t.at(p);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(v).toBeLessThanOrEqual(100 + 1e-9);
      prev = v;
    }
  });

  it('cyclic tracks are continuous and smooth across the seam', () => {
    const t = new Track([[0, 1], [0.3, 5], [0.7, -2], [0.9, 3]], { cyclic: true });
    expect(t.at(1 - 1e-7)).toBeCloseTo(t.at(0), 4);
    expect(t.slope(1 - 2e-6, 1e-6)).toBeCloseTo(t.slope(2e-6, 1e-6), 1);
  });
});
