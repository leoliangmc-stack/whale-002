/**
 * InputController：统一处理滚轮、触摸、鼠标拖动、双指缩放与键盘。
 *
 * 两种模式的手势有明确区分：
 *  - story（叙事）：上下滑动 / 滚轮 = 推进或回看故事（带惯性），点击 = 唤出控制栏；
 *  - explore（探索）：单指 / 鼠标拖动 = 移动视角，双指 / 滚轮 = 缩放，点击 = 观察生物。
 * 页面本身从不滚动（画布设置 touch-action:none），因此不会与浏览器滚动冲突。
 */

export type InputMode = 'story' | 'explore' | 'none';

export interface InputHandlers {
  mode(): InputMode;
  /** 叙事滚动，像素（正值 = 向前） */
  scroll(px: number): void;
  pan(dx: number, dy: number): void;
  panEnd(vx: number, vy: number): void;
  zoom(factor: number, cx: number, cy: number): void;
  tap(x: number, y: number, double: boolean): void;
  key(e: KeyboardEvent): boolean;
  activity(): void;
}

interface Ptr {
  id: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
}

export class InputController {
  private readonly ptrs = new Map<number, Ptr>();
  private inertia = 0;
  private lastMoveT = 0;
  private velY = 0;
  private velX = 0;
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };
  private lastTap = { t: 0, x: 0, y: 0 };
  private dragging = false;
  private tapTimer = 0;

  constructor(private readonly el: HTMLElement, private readonly h: InputHandlers) {
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('lostpointercapture', this.onCancel);
    window.addEventListener('keydown', this.onKey);
    // iOS Safari 的页面级缩放手势
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop, { passive: false });
    document.addEventListener('gesturechange', stop, { passive: false });
    // 阻止画布区域的默认触摸滚动 / 双击缩放
    el.addEventListener('touchmove', stop, { passive: false });
  }

  /** 每帧调用：释放手指后的惯性滚动。 */
  update(dt: number): void {
    if (Math.abs(this.inertia) > 2 && this.h.mode() === 'story') {
      this.h.scroll(this.inertia * dt);
      this.inertia *= Math.exp(-dt / 0.38);
    } else {
      this.inertia = 0;
    }
  }

  cancelInertia(): void {
    this.inertia = 0;
  }

  private onWheel = (e: WheelEvent): void => {
    const mode = this.h.mode();
    if (mode === 'none') return;
    if (e.ctrlKey && mode === 'story') return; // 允许浏览器缩放页面
    e.preventDefault();
    this.h.activity();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 18;
    else if (e.deltaMode === 2) dy *= window.innerHeight;
    if (mode === 'story') {
      this.inertia = 0;
      // 限制单次滚轮事件的幅度，避免一次滚动跳过太多
      this.h.scroll(Math.max(-220, Math.min(220, dy)));
    } else {
      const k = e.ctrlKey ? 0.012 : 0.0018;
      this.h.zoom(Math.exp(-dy * k), e.clientX, e.clientY);
    }
  };

  private onDown = (e: PointerEvent): void => {
    if (this.h.mode() === 'none') return;
    this.h.activity();
    this.inertia = 0;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* 某些浏览器在合成事件上会抛错，可忽略 */
    }
    const p: Ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
    this.ptrs.set(e.pointerId, p);
    this.dragging = false;
    this.velX = this.velY = 0;
    this.lastMoveT = performance.now();
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const mode = this.h.mode();
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 8) this.dragging = true;
    const now = performance.now();
    const dtm = Math.max(1, now - this.lastMoveT) / 1000;
    this.lastMoveT = now;
    this.h.activity();

    if (this.ptrs.size >= 2 && mode === 'explore') {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.pinchDist > 0) this.h.zoom(d / this.pinchDist, mid.x, mid.y);
      this.h.pan(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
      this.pinchDist = d;
      this.pinchMid = mid;
      this.dragging = true;
      return;
    }
    if (!this.dragging) return;
    if (mode === 'story') {
      // 手指上滑 = 故事向前
      this.h.scroll(-dy);
      this.velY = this.velY * 0.6 + (-dy / dtm) * 0.4;
    } else if (mode === 'explore') {
      this.h.pan(dx, dy);
      this.velX = this.velX * 0.6 + (dx / dtm) * 0.4;
      this.velY = this.velY * 0.6 + (dy / dtm) * 0.4;
    }
  };

  private onUp = (e: PointerEvent): void => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    const mode = this.h.mode();
    const stale = performance.now() - this.lastMoveT > 120;
    if (!this.dragging && this.ptrs.size === 0) {
      const now = performance.now();
      const dbl = now - this.lastTap.t < 320 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 30;
      this.lastTap = { t: dbl ? 0 : now, x: e.clientX, y: e.clientY };
      clearTimeout(this.tapTimer);
      this.h.tap(e.clientX, e.clientY, dbl);
      return;
    }
    if (this.ptrs.size > 0) {
      // 双指变单指：重置起点，避免跳动
      for (const q of this.ptrs.values()) {
        q.sx = q.x;
        q.sy = q.y;
      }
      this.pinchDist = 0;
      return;
    }
    if (mode === 'story' && !stale) this.inertia = Math.max(-4000, Math.min(4000, this.velY));
    if (mode === 'explore') this.h.panEnd(stale ? 0 : this.velX, stale ? 0 : this.velY);
  };

  private onCancel = (e: PointerEvent): void => {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinchDist = 0;
  };

  private onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (this.h.key(e)) {
      e.preventDefault();
      return;
    }
    const mode = this.h.mode();
    const step = window.innerHeight * 0.18;
    if (mode === 'story') {
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'ArrowRight') {
        this.h.scroll(e.key === 'PageDown' ? step * 3 : step);
        e.preventDefault();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'ArrowLeft') {
        this.h.scroll(e.key === 'PageUp' ? -step * 3 : -step);
        e.preventDefault();
      }
    } else if (mode === 'explore') {
      const k = 60;
      if (e.key === 'ArrowLeft') this.h.pan(k, 0);
      else if (e.key === 'ArrowRight') this.h.pan(-k, 0);
      else if (e.key === 'ArrowUp') this.h.pan(0, k);
      else if (e.key === 'ArrowDown') this.h.pan(0, -k);
      else if (e.key === '+' || e.key === '=') this.h.zoom(1.25, window.innerWidth / 2, window.innerHeight / 2);
      else if (e.key === '-' || e.key === '_') this.h.zoom(0.8, window.innerWidth / 2, window.innerHeight / 2);
      else return;
      e.preventDefault();
    }
  };
}
