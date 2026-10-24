// 逐帧录制（确定性时钟）：node scripts/record.mjs <url> <输出目录> <秒数> [帧率] [宽] [高] [mobile]
// 页面的 requestAnimationFrame / performance.now 由 Playwright 的虚拟时钟驱动，每一帧之间恰好经过 1/帧率 秒，
// 所以录下的是按真实节奏播放的画面，与软件渲染的速度无关。之后可以用 ffmpeg 合成视频：
//   ffmpeg -framerate 30 -i out/%05d.png -pix_fmt yuv420p out.mp4
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const [url, out, secs = '10', fps = '30', w = '960', h = '600', mobile = ''] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.clock.install({ time: 0 });
await page.goto(url, { waitUntil: 'load' });
for (let i = 0; i < 400; i++) {
  if (await page.evaluate(() => window.__done === true)) break;
  await page.clock.runFor(50);
  await page.waitForTimeout(20);
}
// 虚拟时钟默认会随真实时间流动：加载完成后暂停，之后只由 runFor 推进
await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
// 带 &play 时从指定进度、以自动播放的正常速度开始（加载期间推进的进度不算）
await page.evaluate(() => {
  const q = new URLSearchParams(location.search);
  const pr = window.__wf.app.progress;
  if (!q.has('p') || !q.has('play')) return;
  const p = Number(q.get('p')) || 0;
  pr.jumpTo(p, false);
  pr.setPlaying(true);
  pr.autoRate = pr.constructor.rateAt(p);
});
const step = 1000 / +fps;
const n = Math.round(+secs * +fps);
for (let i = 0; i < n; i++) {
  await page.clock.runFor(step);
  await page.screenshot({ path: `${out}/${String(i).padStart(5, '0')}.png` });
}
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
