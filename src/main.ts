import './styles/main.css';
import { App } from './app/App';

function boot(): void {
  const root = document.getElementById('app');
  if (!root) return;
  try {
    const app = new App(root);
    app.run();
  } catch (err) {
    console.error(err);
    root.innerHTML =
      '<div style="padding:32px;max-width:520px;margin:20vh auto;text-align:center;line-height:1.8;color:#eef6f8">' +
      '<h2 style="font-weight:600">无法启动《鲸落：深海之境》</h2>' +
      '<p>当前浏览器似乎不支持 Canvas 2D 绘图。请使用最新版的 Chrome、Safari 或 Edge 打开。</p></div>';
  }
}

boot();
