/**
 * 部署时保留上一版的资源文件：node scripts/keep-previous-assets.mjs <上一版的 gh-pages 目录> <dist>
 *
 * GitHub Pages 会把页面与文件缓存约 10 分钟（浏览器与 CDN）。刚部署完的这段时间里刷新，可能拿到旧的页面或旧的
 * manifest，去请求上一版的 JS 与声音文件；如果新的部署把它们删了，页面就会缺声音（例如改名后的鲸鸣）甚至白屏。
 * 这里把上一版 assets/ 里、这一版没有的文件复制进 dist（不覆盖这一版的任何文件），并记在 dist/.previous-assets 里；
 * 上一版自己保留下来的旧文件（列在它的 .previous-assets 里）不再继续保留，所以最多多出一版的文件。
 */
import fs from 'node:fs';
import path from 'node:path';

const [prev, dist] = process.argv.slice(2);
if (!prev || !dist) {
  console.error('用法：node scripts/keep-previous-assets.mjs <上一版目录> <dist>');
  process.exit(2);
}
const LIST = '.previous-assets';
const older = new Set();
try {
  for (const line of fs.readFileSync(path.join(prev, LIST), 'utf8').split('\n')) if (line) older.add(line);
} catch {
  /* 上一版没有记录 */
}

const kept = [];
function walk(rel) {
  const src = path.join(prev, rel);
  if (!fs.existsSync(src)) return;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) walk(r);
    else if (e.isFile() && !older.has(r) && !fs.existsSync(path.join(dist, r))) {
      fs.mkdirSync(path.dirname(path.join(dist, r)), { recursive: true });
      fs.copyFileSync(path.join(prev, r), path.join(dist, r));
      kept.push(r);
    }
  }
}
walk('assets');
fs.writeFileSync(path.join(dist, LIST), kept.join('\n') + (kept.length ? '\n' : ''));
console.log(`保留上一版的 ${kept.length} 个文件`);
for (const r of kept) console.log('  ' + r);
