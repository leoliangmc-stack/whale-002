// 在无头浏览器中连续播放若干秒，统计帧率与错误（软件渲染，仅供相对比较）。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const [url = 'http://localhost:5173/', w = '1280', h = '800', secs = '8', mobile = ''] = process.argv.slice(2);
const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__done === true);
const res = await page.evaluate(async (secs) => {
  const app = window.__wf.app;
  const times = [];
  let last = performance.now();
  await new Promise((resolve) => {
    const end = last + secs * 1000;
    const tick = (t) => { times.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else resolve(); };
    requestAnimationFrame(tick);
  });
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return { frames: times.length, avgMs: avg.toFixed(1), p95: times[Math.floor(times.length * 0.95)].toFixed(1), tier: app.quality.name, p: app.progress.p.toFixed(4) };
}, Number(secs));
console.log(url, JSON.stringify(res));
if (errors.length) console.log('ERRORS', errors);
await browser.close();
