import { describe, expect, it } from 'vitest';
import { CreatureManager } from '../src/systems/CreatureManager';
import { CREATURE_INFO } from '../src/config/creatures';
import { QUALITY } from '../src/config/performance';

const zero = { scav: 0, amph: 0, crabs: 0, enrich: 0, sulfo: 0, dwellers: 0 };

function run(m: CreatureManager, eco: typeof zero, mode: 'story' | 'explore', secs: number, camY = 1795) {
  for (let i = 0; i < secs * 30; i++) m.update({ mode, p: 0.6, eco, camY, dt: 1 / 30, time: i / 30 });
}

describe('CreatureManager', () => {
  it('scavenger count follows ecological presence and is reversible', () => {
    const m = new CreatureManager();
    m.setQuality(QUALITY[2]);
    run(m, zero, 'story', 3);
    const base = m.activeCount;
    run(m, { ...zero, scav: 1, amph: 1, crabs: 1 }, 'story', 10);
    const peak = m.activeCount;
    expect(peak).toBeGreaterThan(base + 10);
    run(m, zero, 'story', 30);
    expect(m.activeCount).toBe(base);
  });

  it('partial presence activates only part of a population', () => {
    const m = new CreatureManager();
    m.setQuality(QUALITY[2]);
    run(m, { ...zero, scav: 0.3 }, 'story', 8);
    const some = m.activeCount;
    run(m, { ...zero, scav: 1 }, 'story', 8);
    expect(m.activeCount).toBeGreaterThan(some);
  });

  it('hidden specials exist only in explore mode', () => {
    const m = new CreatureManager();
    run(m, zero, 'story', 1);
    expect(m.specials()).toHaveLength(0);
    run(m, { scav: 0.15, amph: 0.1, crabs: 0.8, enrich: 1, sulfo: 1, dwellers: 1 }, 'explore', 2);
    const sp = m.specials();
    expect(sp.map((s) => s.id).sort()).toEqual(['hidden-anglerfish', 'hidden-glow']);
  });

  it('paused ecological time freezes motion', () => {
    const m = new CreatureManager();
    const eco = { scav: 0.15, amph: 0.1, crabs: 0.8, enrich: 1, sulfo: 1, dwellers: 1 };
    run(m, eco, 'explore', 5);
    const snap = JSON.stringify(m.specials());
    for (let i = 0; i < 60; i++) m.update({ mode: 'explore', p: 0, eco, camY: 1795, dt: 0, time: i });
    expect(JSON.stringify(m.specials())).toBe(snap);
  });

  it('every creature info key used by the roster has a card', () => {
    const m = new CreatureManager() as unknown as { all: Array<{ info: string }> };
    for (const c of m.all) expect(CREATURE_INFO[c.info], c.info).toBeTruthy();
    for (const k of ['blueWhale', 'krill', 'skull', 'mandible', 'vertebra', 'rib', 'flipper', 'pelvis', 'osedax', 'mat', 'rock', 'marineSnow']) {
      expect(CREATURE_INFO[k], k).toBeTruthy();
    }
  });
});
