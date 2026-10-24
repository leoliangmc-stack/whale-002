import { smoothstep } from '../core/math';
import type { DeviceClass, Layout, SafeArea } from '../core/types';

/**
 * ResponsiveLayoutManager：识别 PC / iPad / 手机与横竖屏，计算安全区域与构图参数。
 * 尺寸变化（旋转、浏览器工具栏伸缩、窗口缩放）时通知订阅者重新计算镜头构图。
 */
export class ResponsiveLayoutManager {
  layout: Layout;
  private readonly listeners: Array<(l: Layout) => void> = [];
  private probe: HTMLDivElement;
  private pending = 0;

  constructor() {
    this.probe = document.createElement('div');
    this.probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);' +
      'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);';
    document.body.appendChild(this.probe);
    this.layout = this.measure();
    const schedule = () => {
      cancelAnimationFrame(this.pending);
      this.pending = requestAnimationFrame(() => this.refresh());
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', () => setTimeout(schedule, 120));
    window.visualViewport?.addEventListener('resize', schedule);
  }

  onChange(fn: (l: Layout) => void): void {
    this.listeners.push(fn);
  }

  refresh(): void {
    const next = this.measure();
    const prev = this.layout;
    this.layout = next;
    if (prev.w !== next.w || prev.h !== next.h || prev.device !== next.device) this.listeners.forEach((f) => f(next));
  }

  private safe(): SafeArea {
    const cs = getComputedStyle(this.probe);
    return {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
  }

  private measure(): Layout {
    const w = Math.max(1, Math.round(window.innerWidth));
    const h = Math.max(1, Math.round(window.innerHeight));
    const coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const minSide = Math.min(w, h);
    let device: DeviceClass;
    if (coarse && minSide < 600) device = 'phone';
    else if (coarse) device = 'tablet';
    else device = minSide < 500 ? 'phone' : 'desktop';
    const aspect = w / h;
    const portrait = h > w * 1.05;
    // 竖屏时开阔海域的构图沿对角线向上，让鲸鱼与前方的磷虾群在窄画面中都能放得下
    const compAngle = -0.05 - 0.6 * (1 - smoothstep(0.7, 1.25, aspect));
    return { device, portrait, w, h, aspect, coarse, safe: this.safe(), compAngle };
  }
}
