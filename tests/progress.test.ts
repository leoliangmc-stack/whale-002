import { describe, expect, it } from 'vitest';
import { StoryProgressController } from '../src/controllers/StoryProgressController';
import { CYCLE_SECONDS } from '../src/config/stages';

function run(c: StoryProgressController, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) c.update(dt);
}

describe('StoryProgressController', () => {
  it('autoplays one full cycle in roughly the authored duration and fires onLoop', () => {
    let loops = 0;
    const c = new StoryProgressController({ onLoop: () => loops++ });
    run(c, CYCLE_SECONDS + 3, 1 / 30);
    expect(loops).toBe(1);
    expect(c.p).toBeLessThan(0.05);
  });

  it('never goes below zero when rewinding at the start', () => {
    const c = new StoryProgressController();
    c.setPlaying(false);
    c.scrollBy(-0.5);
    run(c, 2);
    expect(c.shown).toBe(0);
  });

  it('pausing stops progress (scrolling still works)', () => {
    const c = new StoryProgressController();
    run(c, 5);
    c.setPlaying(false);
    run(c, 0.5);
    const a = c.shown;
    run(c, 3);
    expect(c.shown - a).toBeLessThan(1e-4);
    c.scrollBy(0.02);
    run(c, 3);
    expect(c.shown - a).toBeGreaterThan(0.015);
  });

  it('limits speed through key shots so a burst of scrolling cannot skip them', () => {
    const c = new StoryProgressController();
    c.setPlaying(false);
    c.jumpTo(0.075); // 滤食镜头
    const before = c.shown;
    for (let i = 0; i < 60; i++) {
      c.scrollBy(0.05);
      c.update(1 / 60);
    }
    const travelled = c.shown - before;
    expect(travelled).toBeLessThan(StoryProgressController.maxSpeedAt(0.08) * 1.05 + 1e-4);
  });

  it('wraps seamlessly: cycle-relative progress restarts at 0 after 1', () => {
    const c = new StoryProgressController();
    c.setPlaying(false);
    c.jumpTo(0.999);
    c.scrollBy(0.02);
    run(c, 4);
    expect(c.cycles).toBe(1);
    expect(c.p).toBeGreaterThan(0);
    expect(c.p).toBeLessThan(0.05);
  });
});
