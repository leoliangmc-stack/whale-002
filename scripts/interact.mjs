// 交互测试：滚轮推进 / 回退、暂停、重新开始、跳章节、触摸滑动、探索模式点击。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '/tmp/claude-0/shots';
const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const results = [];
const check = (name, ok, info = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const P = (page) => page.evaluate(() => window.__wf.app.progress.shown);

// ---------- 桌面
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('desktop: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('desktop console: ' + m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.__done === true);
  await page.click('#intro .btn.primary');
  await page.waitForTimeout(2500);
  const p0 = await P(page);
  check('autoplay advances', p0 > 0.0005, `shown=${p0.toFixed(5)}`);
  // 暂停
  await page.keyboard.press('Space');
  const a = await P(page);
  await page.waitForTimeout(1500);
  const b = await P(page);
  check('pause stops progress', Math.abs(b - a) < 0.0006, `${a.toFixed(5)} → ${b.toFixed(5)}`);
  // 滚轮前进（暂停时仍可滚动）
  await page.mouse.move(640, 400);
  for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
  await page.waitForTimeout(1500);
  const c = await P(page);
  check('wheel advances story while paused', c > b + 0.01, `${b.toFixed(4)} → ${c.toFixed(4)}`);
  // 快速滚动受限速保护
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 400); }
  await page.waitForTimeout(300);
  const d = await P(page);
  const secs = (Date.now() - t0) / 1000;
  check('fast scroll is rate limited (no skipping)', (d - c) / secs < 0.035, `${((d - c) / secs).toFixed(4)} progress/s over ${secs.toFixed(1)}s`);
  // 回退
  await page.waitForTimeout(1500);
  const e1 = await P(page);
  for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
  await page.waitForTimeout(1500);
  const e2 = await P(page);
  check('wheel rewinds story', e2 < e1 - 0.01, `${e1.toFixed(4)} → ${e2.toFixed(4)}`);
  // 跳章节（第 6 章）
  await page.mouse.move(640, 760);
  await page.click('.tick:nth-of-type(6)');
  await page.waitForTimeout(1200);
  const f = await P(page);
  check('chapter tick jumps', Math.abs((f % 1) - 0.55) < 0.01, `p=${(f % 1).toFixed(4)}`);
  await page.screenshot({ path: `${out}/it_chapter6.png` });
  // 重新开始
  await page.keyboard.press('r');
  await page.waitForTimeout(600);
  const g = await P(page);
  check('restart returns to start', g < 0.01, `p=${g.toFixed(4)}`);
  // 自由探索未解锁时点击
  await page.mouse.move(640, 760);
  await page.click('#bar .row:nth-of-type(2) .btn:last-child', { force: true });
  await page.waitForTimeout(300);
  const toast = await page.textContent('#toast');
  check('explore locked message', /解锁/.test(toast ?? ''), toast?.slice(0, 30));
  await ctx.close();
}

// ---------- 探索模式（桌面）
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('explore: ' + e));
  await page.goto(base + '?explore');
  await page.waitForFunction(() => window.__done === true);
  await page.waitForTimeout(1500);
  const fh0 = await page.evaluate(() => window.__wf.app.camera.exploreFrameH);
  await page.mouse.move(640, 500);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(50); }
  await page.waitForTimeout(1200);
  const fh1 = await page.evaluate(() => window.__wf.app.camera.exploreFrameH);
  check('explore wheel zooms in', fh1 < fh0 * 0.8, `${fh0.toFixed(1)} → ${fh1.toFixed(1)}`);
  const x0 = await page.evaluate(() => window.__wf.app.camera.ex.x);
  await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(400, 400, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(800);
  const x1 = await page.evaluate(() => window.__wf.app.camera.ex.x);
  check('explore drag pans', x1 > x0 + 0.5, `${x0.toFixed(2)} → ${x1.toFixed(2)}`);
  // 点击头骨
  await page.evaluate(() => { const a = window.__wf.app; a.camera.flyTo(33.5, 1797.5, 9); });
  await page.waitForTimeout(2500);
  const hit = await page.evaluate(() => {
    const a = window.__wf.app; const w = a.world.whale1; const P = { x: 0, y: 0 }; const S = { x: 0, y: 0, s: 0 };
    w.skeleton.skullToWorld(1.0, -0.2, w.body, w.state, P); a.camera.cam.project(P.x, P.y, 0, S); return S;
  });
  await page.mouse.click(hit.x, hit.y);
  await page.waitForTimeout(600);
  const info = await page.textContent('#info');
  check('tap on skull opens info', /头骨/.test(info ?? ''), (info ?? '').slice(0, 20));
  await page.screenshot({ path: `${out}/it_explore_info.png` });
  // 时间控制
  await page.click('.seg .btn:nth-child(1)');
  await page.waitForTimeout(1500);
  const rate = await page.evaluate(() => window.__wf.app.world.ecology.rate);
  check('eco pause', rate === 0, `rate=${rate}`);
  await page.click('.seg .btn:nth-child(3)');
  await page.waitForTimeout(1500);
  const rate2 = await page.evaluate(() => window.__wf.app.world.ecology.rate);
  check('eco accelerate', rate2 > 3, `rate=${rate2.toFixed(2)}`);
  // 返回故事
  await page.click('#explore-top .btn');
  await page.waitForTimeout(1200);
  const mode = await page.evaluate(() => window.__wf.app.mode);
  check('return to story', mode === 'story', mode);
  await ctx.close();
}

// ---------- 下沉：同一进度无论经由自动播放、滚轮回退还是直接跳转到达，鲸鱼的身体几何与镜头都完全一致
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('descent: ' + e));
  await page.goto(base + '?p=0.3&muted');
  await page.waitForFunction(() => window.__done === true);
  const snap = () => page.evaluate(() => {
    const a = window.__wf.app; const w = a.world.whale1; const b = w.body; const s = a.narrative.currentShot;
    const v = [w.state.x, w.state.y, w.state.pitch, w.finAngle, w.finFarAngle, b.flukeAngle, s.tx, s.ty, s.frameH, s.elev];
    for (let i = 0; i < b.n; i += 3) v.push(b.ux[i], b.uy[i], b.bx[i], b.by[i]);
    return { p: a.progress.shown, v };
  });
  const same = async (label) => {
    const s1 = await snap();
    await page.evaluate((p) => window.__wf.setP(p), s1.p);
    await page.waitForTimeout(300);
    const s2 = await snap();
    const diff = Math.max(...s1.v.map((x, i) => Math.abs(x - s2.v[i])));
    check(`descent pose is history-independent (${label})`, Math.abs(s1.p - s2.p) < 1e-9 && diff < 1e-6, `p=${s1.p.toFixed(4)} maxΔ=${diff.toExponential(1)}`);
  };
  // 向前：自动播放经过停止游动与失去平衡
  await page.evaluate(() => window.__wf.app.progress.setPlaying(true));
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.__wf.app.progress.setPlaying(false));
  await page.waitForTimeout(800);
  await same('autoplay forward');
  // 向后：从深海用滚轮回看
  await page.evaluate(() => window.__wf.setP(0.43));
  await page.waitForTimeout(400);
  await page.mouse.move(640, 400);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
  await page.waitForTimeout(2000);
  await same('wheel backward');
  await ctx.close();
}

// ---------- 手机触摸
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('mobile: ' + e));
  await page.goto(base);
  await page.waitForFunction(() => window.__done === true);
  await page.tap('#intro .btn.primary');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__wf.app.progress.setPlaying(false));
  const a = await P(page);
  // 合成触摸滑动（手指上滑）
  const cdp = await ctx.newCDPSession(page);
  for (let k = 0; k < 4; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 650 }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 650 - i * 40 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1500);
  const b = await P(page);
  check('touch swipe up advances story', b > a + 0.005, `${a.toFixed(4)} → ${b.toFixed(4)}`);
  const scrollY = await page.evaluate(() => window.scrollY);
  check('page does not scroll', scrollY === 0, `scrollY=${scrollY}`);
  await ctx.close();
}

await browser.close();
console.log(results.join('\n'));
if (errors.length) console.log('\nERRORS:\n' + errors.join('\n'));
