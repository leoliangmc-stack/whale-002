/**
 * PerformanceMonitor：持续测量帧时间。持续掉帧时自动降低画质（粒子数量、分辨率、特效），
 * 长时间运行流畅时尝试恢复一级。
 */
export class PerformanceMonitor {
  private avg = 16.7;
  private slow = 0;
  private fast = 0;
  private cooldown = 3;
  tier: 0 | 1 | 2;
  readonly maxTier: 0 | 1 | 2;
  /** 用户手动选择画质时关闭自动调整 */
  auto = true;
  fps = 60;

  constructor(initial: 0 | 1 | 2, private readonly onChange: (tier: 0 | 1 | 2) => void) {
    this.tier = initial;
    this.maxTier = initial;
  }

  sample(dtMs: number): void {
    if (dtMs <= 0 || dtMs > 250) return; // 切到后台等异常帧不计入
    this.avg += (dtMs - this.avg) * 0.05;
    this.fps = 1000 / this.avg;
    this.cooldown -= dtMs / 1000;
    if (!this.auto || this.cooldown > 0) return;
    if (this.avg > 24) {
      this.slow += dtMs / 1000;
      this.fast = 0;
    } else if (this.avg < 14) {
      this.fast += dtMs / 1000;
      this.slow = 0;
    } else {
      this.slow = Math.max(0, this.slow - dtMs / 2000);
      this.fast = 0;
    }
    if (this.slow > 2.2 && this.tier > 0) {
      this.set((this.tier - 1) as 0 | 1);
    } else if (this.fast > 12 && this.tier < this.maxTier) {
      this.set((this.tier + 1) as 1 | 2);
    }
  }

  set(t: 0 | 1 | 2): void {
    if (t === this.tier) return;
    this.tier = t;
    this.slow = this.fast = 0;
    this.cooldown = 4;
    this.onChange(t);
  }
}
