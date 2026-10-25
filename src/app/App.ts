import { QUALITY, guessInitialTier, type QualitySettings } from '../config/performance';
import { CREATURE_INFO } from '../config/creatures';
import { STAGES, WORLD } from '../config/stages';
import { CameraController } from '../controllers/CameraController';
import { InputController, type InputMode } from '../controllers/InputController';
import { ResponsiveLayoutManager } from '../controllers/ResponsiveLayoutManager';
import { StoryProgressController } from '../controllers/StoryProgressController';
import { clamp, window4 } from '../core/math';
import { storage, type Prefs, type QualityPref } from '../core/storage';
import type { RenderCtx } from '../core/types';
import { loadWhaleArt, whaleArt } from '../entities/WhaleArt';
import { ExploreScene } from '../scenes/ExploreScene';
import { NarrativeScene } from '../scenes/NarrativeScene';
import { World } from '../scenes/World';
import { AssetRegistry } from '../systems/AssetRegistry';
import { AudioManager } from '../systems/AudioManager';
import { DiscoveryManager } from '../systems/DiscoveryManager';
import { WHALE_SWITCH } from '../systems/StoryTimeline';
import type { EcoSpeed } from '../systems/EcologyManager';
import { ParallaxManager, profile } from '../systems/ParallaxManager';
import { PerformanceMonitor } from '../systems/PerformanceMonitor';
import { UI } from '../ui/UI';

type Mode = 'intro' | 'story' | 'explore';

/**
 * App：创建画布与各个模块，驱动主循环，在“沉浸式叙事”与“自由探索”两种模式之间切换。
 */
export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layoutMgr = new ResponsiveLayoutManager();
  private readonly world = new World();
  private readonly camera = new CameraController();
  private readonly progress: StoryProgressController;
  private readonly narrative: NarrativeScene;
  private readonly explore: ExploreScene;
  private readonly parallax = new ParallaxManager();
  private readonly audio = new AudioManager();
  private readonly assets = new AssetRegistry();
  private readonly discoveries: DiscoveryManager;
  private readonly perf: PerformanceMonitor;
  private readonly input: InputController;
  private readonly ui: UI;
  private readonly rc: RenderCtx;
  private prefs: Prefs;
  private mode: Mode = 'intro';
  private quality: QualitySettings;
  private dpr = 1;
  private time = 0;
  private lastT = 0;
  private frameCount = 0;
  private artFrames = 0;
  private snapshot: HTMLCanvasElement | null = null;
  private dissolveT = 0;
  private hasScrolled = false;
  private infoTarget: { x: number; y: number; z: number } | null = null;
  private following = false;
  private storyReturnP = 0;
  private audioLoading = false;
  /** 本帧是跳转（溶解过渡）：声音不触发 cue，0.9 s 交叉渐变到新状态 */
  private audioJump = false;
  private readonly params = new URLSearchParams(location.search);
  private systemReduced = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(root: HTMLElement) {
    this.canvas = root.querySelector('#scene') as HTMLCanvasElement;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D');
    this.ctx = ctx;
    this.prefs = storage.prefs();
    const layout = this.layoutMgr.layout;

    // 画质：自动（性能监测可降级）或用户固定
    const qp = (this.params.get('quality') as QualityPref | null) ?? this.prefs.quality;
    const tier = this.tierFor(qp, layout.device);
    this.quality = QUALITY[tier];
    this.perf = new PerformanceMonitor(tier, (t) => this.applyQuality(t));
    this.perf.auto = qp === 'auto';

    this.progress = new StoryProgressController({
      onLoop: () => {
        if (!this.discoveries.record.unlocked) {
          this.discoveries.unlockExplore();
          this.ui.setUnlocked(true);
          this.ui.showToast('自由探索已解锁', '你可以随时进入深海，自由观察鲸骨和周围的生命。', 6500);
        }
      },
    });
    this.narrative = new NarrativeScene(this.world, this.camera, this.progress);
    this.explore = new ExploreScene(this.world, this.camera);
    this.discoveries = new DiscoveryManager((d) => {
      this.ui.discoveryToast(d);
      this.audio.chime();
    });

    this.rc = {
      ctx: this.ctx,
      cam: this.camera.cam,
      light: this.world.lighting,
      dpr: 1,
      w: layout.w,
      h: layout.h,
      time: 0,
      eco: 0,
      dt: 0,
      quality: this.quality,
      layout,
      reducedMotion: this.reduced,
    };

    this.ui = new UI(root.querySelector('#ui') as HTMLElement, this.uiHandlers(), layout.device, this.uiSettings());
    this.ui.setUnlocked(this.discoveries.record.unlocked);
    this.ui.setDiscovered(this.discoveries.record.discovered);

    this.input = new InputController(this.canvas, {
      mode: (): InputMode => (this.mode === 'story' ? 'story' : this.mode === 'explore' ? 'explore' : 'none'),
      scroll: (px) => {
        this.hasScrolled = true;
        this.progress.scrollScreens(StoryProgressController.pixelsToScreens(px, this.rc.h));
        this.ui.poke();
      },
      pan: (dx, dy) => {
        this.camera.pan(dx, dy);
        if (this.following) this.setFollowing(false);
      },
      panEnd: (vx, vy) => this.camera.panEnd(vx, vy),
      zoom: (f, x, y) => this.camera.zoom(f, x, y),
      tap: (x, y, dbl) => this.onTap(x, y, dbl),
      key: (e) => this.onKey(e),
      activity: () => this.ui.poke(),
    });

    this.layoutMgr.onChange(() => this.resize());
    this.systemReduced.addEventListener?.('change', () => this.applyReduced());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.suspend();
      else {
        this.audio.resume();
        this.lastT = performance.now();
      }
    });
    // iPhone 上从后台回来时，声音常常要在用户手势里才能恢复
    for (const ev of ['pointerup', 'touchend', 'keydown']) window.addEventListener(ev, () => this.audio.wake(), { capture: true, passive: true });

    this.applyQuality(tier);
    this.audio.setMuted(this.prefs.muted);
    this.audio.setVolume(this.prefs.volume);
    void this.assets.load();
    // 开场界面显示时先下载开场要用的声音（静音时不必）
    if (!this.prefs.muted && !this.params.has('muted')) void this.assets.prefetchAudio();
    void loadWhaleArt();
    this.debugHooks();
    this.applyUrl();
  }

  get reduced(): boolean {
    return this.prefs.reducedMotion ?? this.systemReduced.matches;
  }

  private tierFor(q: QualityPref, device: 'phone' | 'tablet' | 'desktop'): 0 | 1 | 2 {
    if (q === 'high') return 2;
    if (q === 'medium') return 1;
    if (q === 'low') return 0;
    return guessInitialTier(device);
  }

  private applyQuality(tier: 0 | 1 | 2): void {
    this.quality = QUALITY[tier];
    this.rc.quality = this.quality;
    this.world.creatures.setQuality(this.quality);
    this.resize();
  }

  private applyReduced(): void {
    this.rc.reducedMotion = this.reduced;
    this.ui.updateSettings(this.uiSettings());
  }

  private resize(): void {
    const l = this.layoutMgr.layout;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality.dprCap);
    const w = Math.round(l.w * this.dpr);
    const h = Math.round(l.h * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.rc.dpr = this.dpr;
    this.rc.w = l.w;
    this.rc.h = l.h;
    this.rc.layout = l;
    this.camera.setViewport(l.w, l.h);
  }

  private uiSettings() {
    return {
      muted: this.prefs.muted,
      volume: this.prefs.volume,
      reduced: this.reduced,
      quality: this.prefs.quality,
      captions: this.prefs.captions,
    };
  }

  private savePrefs(): void {
    storage.savePrefs(this.prefs);
    this.ui.updateSettings(this.uiSettings());
  }

  // ------------------------------------------------------------ 界面事件

  private uiHandlers() {
    return {
      start: (explore: boolean) => this.start(explore),
      togglePlay: () => this.togglePlay(),
      restart: () => this.restart(),
      jump: (p: number) => this.dissolve(() => this.progress.jumpTo(p)),
      toggleMute: () => {
        this.prefs.muted = !this.prefs.muted;
        void this.unlockAudio();
        this.audio.setMuted(this.prefs.muted);
        this.savePrefs();
      },
      setVolume: (v: number) => {
        this.prefs.volume = v;
        if (v > 0 && this.prefs.muted) this.prefs.muted = false;
        this.audio.setVolume(v);
        this.audio.setMuted(this.prefs.muted);
        storage.savePrefs(this.prefs);
      },
      setReduced: (v: boolean) => {
        this.prefs.reducedMotion = v;
        this.savePrefs();
        this.applyReduced();
      },
      setQuality: (q: QualityPref) => {
        this.prefs.quality = q;
        this.perf.auto = q === 'auto';
        this.perf.set(this.tierFor(q, this.layoutMgr.layout.device));
        this.applyQuality(this.perf.tier);
        this.savePrefs();
      },
      setCaptions: (v: boolean) => {
        this.prefs.captions = v;
        this.savePrefs();
      },
      enterExplore: () => this.enterExplore(),
      exitExplore: () => this.exitExplore(),
      overview: () => {
        const o = this.explore.overviewFor(this.layoutMgr.layout.portrait);
        this.camera.flyTo(o.x, o.y, o.frameH);
        this.setFollowing(false);
      },
      setEcoSpeed: (s: EcoSpeed) => this.world.ecology.setSpeed(s),
      zoom: (f: number) => this.camera.zoom(f, this.rc.w / 2, this.rc.h / 2),
      follow: () => this.setFollowing(!this.following),
      closeInfo: () => {
        this.infoTarget = null;
        this.setFollowing(false);
      },
      resetRecord: () => {
        this.discoveries.reset();
        this.ui.setDiscovered([]);
      },
      activity: () => this.ui.poke(),
    };
  }

  /** 在用户手势中解锁声音，并加载声音素材（只加载一次） */
  private async unlockAudio(): Promise<void> {
    await this.audio.unlock();
    this.audio.setMuted(this.prefs.muted);
    this.audio.setVolume(this.prefs.volume);
    if (!this.audioLoading) {
      this.audioLoading = true;
      await this.assets.loadAudio(this.audio);
      this.audio.samplesReady();
    }
  }

  private start(explore: boolean): void {
    void this.unlockAudio();
    if (explore) {
      this.mode = 'story';
      this.enterExplore();
      return;
    }
    this.mode = 'story';
    this.progress.setPlaying(true);
    this.ui.poke();
  }

  private togglePlay(): void {
    this.progress.setPlaying(!this.progress.playing);
    this.ui.poke();
  }

  private restart(): void {
    this.dissolve(() => {
      this.progress.restart();
      this.progress.setPlaying(true);
    });
  }

  private enterExplore(): void {
    if (!this.discoveries.record.unlocked) return;
    this.storyReturnP = this.progress.p;
    const from = { ...this.narrative.currentShot };
    this.dissolve(() => {
      this.mode = 'explore';
      this.canvas.classList.add('explore');
      this.world.ecology.level = 0;
      this.world.ecology.setSpeed(1);
      this.explore.enter(from, this.layoutMgr.layout.portrait);
    });
  }

  private exitExplore(): void {
    this.dissolve(() => {
      this.mode = 'story';
      this.canvas.classList.remove('explore');
      this.ui.closeInfo();
      this.infoTarget = null;
      this.setFollowing(false);
      this.progress.jumpTo(this.storyReturnP);
    });
  }

  private setFollowing(on: boolean): void {
    this.following = on && !!this.infoTarget;
    this.camera.follow = this.following ? this.infoTarget : null;
    this.ui.setFollowing(this.following);
  }

  private onTap(x: number, y: number, dbl: boolean): void {
    this.ui.poke();
    if (this.mode !== 'explore') return;
    if (dbl) {
      this.camera.zoom(1.8, x, y);
      return;
    }
    const hit = this.explore.hitTest(this.rc, x, y);
    if (!hit || !CREATURE_INFO[hit.info]) {
      this.ui.closeInfo();
      this.infoTarget = null;
      this.setFollowing(false);
      return;
    }
    if (hit.info === 'pelvis') this.discoveries.discover('hidden-pelvis');
    this.discoveries.observe(hit.info);
    this.infoTarget = hit.target;
    this.setFollowing(false);
    this.ui.openInfo(hit.info, !!hit.target, false);
  }

  private onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      if (this.ui.closeOverlays()) return true;
      if (this.mode === 'explore') {
        this.exitExplore();
        return true;
      }
      return false;
    }
    if (this.mode === 'intro' && (e.key === 'Enter' || e.key === ' ')) {
      if ((e.target as HTMLElement)?.tagName === 'BUTTON') return false;
      this.start(false);
      return true;
    }
    if (e.key === ' ' && this.mode === 'story') {
      if ((e.target as HTMLElement)?.tagName === 'BUTTON') return false;
      this.togglePlay();
      return true;
    }
    if (e.key === 'm' || e.key === 'M') {
      this.uiHandlers().toggleMute();
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && this.mode === 'story') {
      this.restart();
      return true;
    }
    if (e.key === 'e' || e.key === 'E') {
      if (this.mode === 'story') this.enterExplore();
      else if (this.mode === 'explore') this.exitExplore();
      return true;
    }
    return false;
  }

  /** 以柔和的交叉溶解完成一次状态跳转（重新开始、跳章节、切换模式）。 */
  private dissolve(change: () => void): void {
    if (this.frameCount > 0) {
      if (!this.snapshot) this.snapshot = document.createElement('canvas');
      this.snapshot.width = this.canvas.width;
      this.snapshot.height = this.canvas.height;
      this.snapshot.getContext('2d')!.drawImage(this.canvas, 0, 0);
      this.dissolveT = 1;
    }
    change();
    this.audioJump = true;
    this.narrative.requestWarmup();
    this.input.cancelInertia();
  }

  // ------------------------------------------------------------ 主循环

  run(): void {
    this.resize();
    this.lastT = performance.now();
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      if (document.hidden) return;
      let dt = (t - this.lastT) / 1000;
      this.lastT = t;
      if (dt <= 0) return;
      this.perf.sample(dt * 1000);
      dt = Math.min(dt, 1 / 15);
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  private frame(dt: number): void {
    const rc = this.rc;
    const paused = this.mode === 'story' && !this.progress.playing;
    // 暂停时仅保留极轻微的氛围动画
    const ambient = paused ? 0.3 : 1;
    this.time += dt * ambient * (this.reduced ? 0.6 : 1);
    rc.time = this.time;
    rc.dt = dt;
    this.input.update(dt);

    let depth = 0;
    let p = 0;
    let stageId = 1;
    let captions: Array<{ text: string; sub?: string; a: number }> = [];
    let timeLabel: { text: string; a: number } | null = null;
    if (this.mode === 'explore') {
      const edt = this.explore.update(rc, dt);
      rc.eco = this.world.ecology.clock;
      void edt;
      if (this.following && this.infoTarget) this.camera.follow = this.infoTarget;
      this.discoveries.update(rc, this.world, this.camera.exploreFrameH, dt);
      depth = this.camera.cam.cy;
    } else {
      if (this.mode === 'story') this.progress.update(dt);
      rc.eco += dt * ambient;
      const f = this.narrative.update(rc, dt, paused);
      p = f.p;
      stageId = f.stage.id;
      captions = f.captions.map((c) => ({ text: c.c.text, sub: c.c.sub, a: c.a }));
      timeLabel = f.timeLabel;
      depth = this.camera.cam.cy;
    }

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.parallax.render(rc, this.world);

    if (this.dissolveT > 0 && this.snapshot) {
      const a = this.dissolveT * this.dissolveT * (3 - 2 * this.dissolveT);
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.globalAlpha = a;
      this.ctx.drawImage(this.snapshot, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx.globalAlpha = 1;
      this.dissolveT = Math.max(0, this.dissolveT - dt / 0.9);
    }

    // 声音（docs/sound/cue-sheet.md 1.9）：拍尾在 0.262–0.33 由下沉动作的最后几次摆尾驱动，其余时间是游动的相位
    const sf = this.mode === 'story' ? this.narrative.frame : null;
    const w1 = this.world.whale1;
    const mover = p < WHALE_SWITCH ? w1 : this.world.whale2;
    const beat = p >= 0.262 && p < 0.33;
    this.audio.update(dt, {
      mode: this.mode,
      p,
      total: this.progress.shown,
      paused,
      velocity: this.progress.velocity,
      autoRate: StoryProgressController.rateAt(p),
      jumped: this.audioJump,
      camDepth: depth,
      stroke: beat ? { phase: w1.state.beatPh, amp: w1.state.beat } : { phase: mover.phase, amp: mover.state.swim * mover.state.visible },
      sink: sf && p > 0.3 && p < 0.5 ? Math.max(0, sf.water.flowY) : 0,
      eco: this.mode === 'explore' ? this.world.ecology.eco : sf ? sf.eco : null,
      feast: sf && p > 0.55 && p < 0.72 ? this.world.feast.sound() : null,
      zoomFrameH: this.mode === 'explore' ? this.camera.exploreFrameH : undefined,
    });
    this.audioJump = false;

    const dA = window4(p, 0.3, 0.315, 0.53, 0.555) + window4(p, 0.83, 0.845, 0.94, 0.955);
    this.ui.update(
      {
        mode: this.mode,
        p,
        stageId,
        captions,
        timeLabel,
        depth,
        depthA: this.mode === 'story' ? clamp(dA) : 0,
        playing: this.progress.playing,
        unlocked: this.discoveries.record.unlocked,
        years: this.world.ecology.years,
        ecoSpeed: this.world.ecology.speed,
        zoom: this.explore.zoomLevel(this.camera.exploreFrameH),
        found: this.discoveries.found,
        total: this.discoveries.total,
        showHint: this.mode === 'story' && !this.hasScrolled && p > 0.004 && p < 0.05,
      },
      dt,
      `${this.perf.fps.toFixed(0)} fps · tier ${this.quality.name} · p ${p.toFixed(4)} · ${this.mode} · cam y ${this.camera.cam.cy.toFixed(1)} · frameH ${this.camera.cam.shot.frameH.toFixed(1)}`,
    );
    this.frameCount++;
    // 截图脚本等待 __done：鲸鱼的绘画加载完成、并且已经画过几帧之后
    if (whaleArt()) this.artFrames++;
    if (this.artFrames === 3) (window as unknown as { __done: boolean }).__done = true;
  }

  // ------------------------------------------------------------ 调试与测试接口

  private applyUrl(): void {
    const q = this.params;
    if (q.has('p')) {
      this.mode = 'story';
      this.progress.jumpTo(Number(q.get('p')) || 0, false);
      this.progress.setPlaying(q.has('play'));
      this.hasScrolled = true;
      this.narrative.requestWarmup(9);
    }
    if (q.has('explore')) {
      this.discoveries.unlockExplore();
      this.ui.setUnlocked(true);
      this.mode = 'story';
      this.storyReturnP = 0.78;
      this.mode = 'explore';
      this.canvas.classList.add('explore');
      this.world.ecology.level = Number(q.get('level') ?? 0);
      const o = this.explore.overviewFor(this.layoutMgr.layout.portrait);
      const fh = Number(q.get('fh') ?? o.frameH);
      const x = Number(q.get('x') ?? o.x);
      const y = Number(q.get('y') ?? o.y);
      this.camera.enterExplore({ tx: x, ty: y, frameH: fh, sx: 0.5, sy: 0.5, elev: 0, lat: 0 }, { x, y, frameH: fh });
    }
    if (q.has('reduced')) this.prefs.reducedMotion = true;
    if (q.has('muted')) this.prefs.muted = true;
  }

  private debugHooks(): void {
    (window as unknown as Record<string, unknown>).__wf = {
      app: this,
      setP: (p: number) => {
        this.mode = 'story';
        this.progress.jumpTo(p, false);
        this.progress.setPlaying(false);
      },
      stages: STAGES,
      profile,
      world: WORLD,
    };
  }
}
