import { CREATURE_INFO } from '../config/creatures';
import { DISCOVERIES, type DiscoveryDef } from '../config/discoveries';
import { STAGES } from '../config/stages';
import type { QualityPref } from '../core/storage';
import type { DeviceClass } from '../core/types';
import type { ZoomLevel } from '../scenes/ExploreScene';
import type { EcoSpeed } from '../systems/EcologyManager';
import { ICON } from './icons';

/** 界面层：开场、章节与字幕、控制栏、自由探索工具、科普面板、设置与探索记录。 */

export interface UIFrame {
  mode: 'intro' | 'story' | 'explore';
  p: number;
  stageId: number;
  captions: Array<{ text: string; sub?: string; a: number }>;
  timeLabel: { text: string; a: number } | null;
  depth: number;
  depthA: number;
  playing: boolean;
  unlocked: boolean;
  years: number;
  ecoSpeed: EcoSpeed;
  zoom: ZoomLevel;
  found: number;
  total: number;
  showHint: boolean;
}

export interface UIHandlers {
  start(explore: boolean): void;
  togglePlay(): void;
  restart(): void;
  jump(p: number): void;
  toggleMute(): void;
  setVolume(v: number): void;
  setReduced(v: boolean): void;
  setQuality(q: QualityPref): void;
  setCaptions(v: boolean): void;
  enterExplore(): void;
  exitExplore(): void;
  overview(): void;
  setEcoSpeed(s: EcoSpeed): void;
  zoom(f: number): void;
  follow(): void;
  closeInfo(): void;
  resetRecord(): void;
  activity(): void;
  toggleNarration(): void;
}

export interface UISettings {
  muted: boolean;
  volume: number;
  reduced: boolean;
  quality: QualityPref;
  captions: boolean;
  narration: boolean;
}

type Attrs = Record<string, string | number | boolean | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, html = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  if (html) el.innerHTML = html;
  return el;
}

function btn(icon: string, label: string, opts: { cls?: string; aria?: string; labelCls?: string } = {}): HTMLButtonElement {
  const b = h('button', { class: `btn ${opts.cls ?? ''}`, type: 'button', 'aria-label': opts.aria ?? label });
  b.innerHTML = `${icon}<span class="lbl ${opts.labelCls ?? ''}">${label}</span>`;
  return b;
}

const ZONE = (d: number) => (d < 200 ? '透光层' : d < 1000 ? '弱光层' : d < 4000 ? '无光层' : '深渊层');

export class UI {
  private readonly root: HTMLElement;
  private intro!: HTMLElement;
  private chapter!: HTMLElement;
  private captions!: HTMLElement;
  private timeLabel!: HTMLElement;
  private depth!: HTMLElement;
  private depthMark!: HTMLElement;
  private depthVal!: HTMLElement;
  private hint!: HTMLElement;
  private bar!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private muteBtn!: HTMLButtonElement;
  private voiceBtn!: HTMLButtonElement;
  private volInput!: HTMLInputElement;
  private exploreBtn!: HTMLButtonElement;
  private fill!: HTMLElement;
  private ticks: HTMLButtonElement[] = [];
  private exTop!: HTMLElement;
  private exBottom!: HTMLElement;
  private exYears!: HTMLElement;
  private exFound!: HTMLElement;
  private speedBtns: Record<string, HTMLButtonElement> = {};
  private zoomLabel!: HTMLElement;
  private exHint!: HTMLElement;
  private info!: HTMLElement;
  private followBtn!: HTMLButtonElement;
  private settings!: HTMLElement;
  private log!: HTMLElement;
  private toast!: HTMLElement;
  private debug: HTMLElement | null = null;
  private toastTimer = 0;
  private idle = 0;
  private last: Partial<Record<string, string>> = {};
  private captionsOn = true;
  private discovered = new Set<string>();

  constructor(
    root: HTMLElement,
    private readonly hd: UIHandlers,
    private readonly device: DeviceClass,
    private settingsState: UISettings,
  ) {
    this.root = root;
    this.captionsOn = settingsState.captions;
    this.buildIntro();
    this.buildStory();
    this.buildExplore();
    this.buildPanels();
    this.updateSettings(settingsState);
    if (new URLSearchParams(location.search).has('debug')) {
      this.debug = h('div', { id: 'debug' });
      root.appendChild(this.debug);
    }
  }

  // ------------------------------------------------------------ 构建

  private buildIntro(): void {
    const touch = this.device !== 'desktop';
    this.intro = h('section', { id: 'intro', class: 'interactive', 'aria-labelledby': 'intro-title' });
    this.intro.innerHTML = `
      <h1 id="intro-title">鲸落</h1>
      <div class="sub">深海之境</div>
      <div class="en">Whale Fall · The Living Abyss</div>
      <p class="tagline">跟随一头蓝鲸，从阳光照耀的海洋沉入幽暗深海。<br>一头鲸鱼的生命结束，可以成为无数生命的新起点。</p>
      <div class="actions"></div>
      <div class="how">${touch ? '手指<b>向上滑动</b>推进故事，向下滑动回看' : '滚动<b>鼠标滚轮</b>推进或回看故事，空格键暂停'}<br>故事也会缓缓自动播放，随时可以暂停观察</div>
      <div class="opts"></div>`;
    const actions = this.intro.querySelector('.actions')!;
    const start = btn(ICON.play, '开始旅程', { cls: 'primary' });
    start.addEventListener('click', () => this.hd.start(false));
    actions.appendChild(start);
    const ex = btn(ICON.explore, '直接自由探索', { cls: 'intro-explore' });
    ex.addEventListener('click', () => this.hd.start(true));
    ex.style.display = 'none';
    actions.appendChild(ex);
    const opts = this.intro.querySelector('.opts')!;
    const snd = btn(this.settingsState.muted ? ICON.mute : ICON.sound, this.settingsState.muted ? '声音：关' : '声音：开');
    snd.setAttribute('aria-pressed', String(!this.settingsState.muted));
    snd.addEventListener('click', () => {
      this.hd.toggleMute();
    });
    snd.classList.add('intro-sound');
    opts.appendChild(snd);
    const nv = btn(this.settingsState.narration ? ICON.voice : ICON.voiceOff, this.settingsState.narration ? '旁白：开' : '旁白：关');
    nv.setAttribute('aria-pressed', String(this.settingsState.narration));
    nv.classList.add('intro-voice');
    nv.addEventListener('click', () => this.hd.toggleNarration());
    opts.appendChild(nv);
    const rm = btn(ICON.motion, '减少动态效果');
    rm.setAttribute('aria-pressed', String(this.settingsState.reduced));
    rm.classList.add('intro-motion');
    rm.addEventListener('click', () => this.hd.setReduced(!this.settingsState.reduced));
    opts.appendChild(rm);
    this.root.appendChild(this.intro);
  }

  private buildStory(): void {
    this.chapter = h('div', { id: 'chapter', class: 'fade', 'aria-live': 'polite' });
    this.captions = h('div', { id: 'captions', class: 'fade', 'aria-live': 'polite' });
    this.timeLabel = h('div', { id: 'timelabel', class: 'fade hidden' });
    this.depth = h('div', { id: 'depth', class: 'fade hidden', 'aria-hidden': 'true' });
    this.depth.innerHTML = '<div class="rail"></div><div class="mark"></div><div class="val"></div>';
    this.depthMark = this.depth.querySelector('.mark')!;
    this.depthVal = this.depth.querySelector('.val')!;
    const touch = this.device !== 'desktop';
    this.hint = h('div', { id: 'hint', class: 'fade hidden' }, `<span>${touch ? '向上滑动，继续故事' : '向下滚动，继续故事'}</span>${ICON.down}`);

    this.bar = h('nav', { id: 'bar', 'aria-label': '叙事控制' });
    const tl = h('div', { id: 'timeline', role: 'group', 'aria-label': '章节进度' });
    tl.innerHTML = '<div class="track"></div><div class="fill"></div>';
    this.fill = tl.querySelector('.fill')!;
    for (const st of STAGES) {
      const t = h('button', { class: 'tick', type: 'button', 'aria-label': `第 ${st.id} 章：${st.title}` });
      t.style.left = `${st.start * 100}%`;
      t.innerHTML = `<span class="tip">${st.id}. ${st.title}</span>`;
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hd.jump(st.start + 0.0005);
      });
      tl.appendChild(t);
      this.ticks.push(t);
    }
    tl.addEventListener('click', (e) => {
      const r = tl.getBoundingClientRect();
      this.hd.jump(Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width)));
    });
    const row1 = h('div', { class: 'row' });
    row1.appendChild(tl);
    const row2 = h('div', { class: 'row' });
    this.playBtn = btn(ICON.pause, '暂停');
    this.playBtn.addEventListener('click', () => this.hd.togglePlay());
    const restart = btn(ICON.restart, '重新开始', { labelCls: 'm-hide' });
    restart.addEventListener('click', () => this.hd.restart());
    this.muteBtn = btn(ICON.sound, '声音', { labelCls: 'm-hide' });
    this.muteBtn.addEventListener('click', () => this.hd.toggleMute());
    const vol = h('label', { class: 'vol interactive' });
    this.volInput = h('input', { type: 'range', min: 0, max: 1, step: 0.05, 'aria-label': '音量' }) as HTMLInputElement;
    this.volInput.value = String(this.settingsState.volume);
    this.volInput.addEventListener('input', () => this.hd.setVolume(Number(this.volInput.value)));
    vol.appendChild(this.muteBtn);
    vol.appendChild(this.volInput);
    this.voiceBtn = btn(ICON.voice, '旁白', { labelCls: 'm-hide' });
    this.voiceBtn.addEventListener('click', () => this.hd.toggleNarration());
    const gear = btn(ICON.gear, '设置', { labelCls: 'm-hide' });
    gear.addEventListener('click', () => this.openPanel(this.settings));
    this.exploreBtn = btn(ICON.lock, '自由探索');
    this.exploreBtn.addEventListener('click', () => {
      if (this.exploreBtn.getAttribute('aria-disabled') === 'true') {
        this.showToast('自由探索', '完成一次完整的鲸落旅程后解锁。也可以随时点击进度条跳到任意章节。');
      } else this.hd.enterExplore();
    });
    row2.append(this.playBtn, restart, vol, this.voiceBtn, h('div', { class: 'spacer' }), gear, this.exploreBtn);
    this.bar.append(row1, row2);
    this.bar.addEventListener('pointermove', () => this.hd.activity());
    this.root.append(this.chapter, this.captions, this.timeLabel, this.depth, this.hint, this.bar);
  }

  private buildExplore(): void {
    this.exTop = h('div', { id: 'explore-top', class: 'fade hidden' });
    const back = btn(ICON.back, '返回故事');
    back.addEventListener('click', () => this.hd.exitExplore());
    const badge = h('div', { class: 'badge' }, '自由探索 · 鲸骨栖息地');
    this.exYears = h('div', { class: 'badge', 'aria-live': 'off' });
    this.exFound = h('button', { class: 'btn', type: 'button', 'aria-label': '探索记录' });
    this.exFound.addEventListener('click', () => this.openLog());
    this.exTop.append(back, badge, this.exYears, h('div', { class: 'spacer', style: 'flex:1' }), this.exFound);

    this.exBottom = h('div', { id: 'explore-bottom', class: 'fade hidden' });
    const time = h('div', { class: 'seg', role: 'group', 'aria-label': '生态时间' });
    const mk = (s: EcoSpeed, icon: string, label: string) => {
      const b = btn(icon, label);
      b.addEventListener('click', () => this.hd.setEcoSpeed(s));
      this.speedBtns[s] = b;
      time.appendChild(b);
    };
    mk(0, ICON.pause, '暂停时间');
    mk(1, ICON.play, '正常');
    mk(4, ICON.ffwd, '加速');
    const zoom = h('div', { class: 'seg', role: 'group', 'aria-label': '观察距离' });
    const zout = btn(ICON.minus, '拉远', { labelCls: 'm-hide' });
    zout.addEventListener('click', () => this.hd.zoom(0.6));
    const zin = btn(ICON.plus, '靠近', { labelCls: 'm-hide' });
    zin.addEventListener('click', () => this.hd.zoom(1.65));
    this.zoomLabel = h('span', { class: 'zoomlabel', 'aria-live': 'polite' });
    zoom.append(zout, this.zoomLabel, zin);
    const home = btn(ICON.home, '返回全景');
    home.addEventListener('click', () => this.hd.overview());
    this.exBottom.append(time, zoom, home);

    const touch = this.device !== 'desktop';
    this.exHint = h('div', { id: 'explore-hint', class: 'fade hidden' });
    this.exHint.innerHTML = touch
      ? '单指拖动 · 移动视角<br>双指捏合 · 靠近或拉远<br>轻点生物 · 查看介绍'
      : '拖动鼠标 · 移动视角<br>滚动滚轮 · 靠近或拉远<br>点击生物或骨骼 · 查看介绍';
    this.root.append(this.exTop, this.exBottom, this.exHint);
  }

  private buildPanels(): void {
    // 科普介绍
    this.info = h('aside', { id: 'info', class: 'panel hidden', role: 'dialog', 'aria-label': '观察介绍' });
    this.root.appendChild(this.info);
    // 设置
    this.settings = h('section', { id: 'settings', class: 'panel hidden', role: 'dialog', 'aria-label': '设置' });
    this.root.appendChild(this.settings);
    this.renderSettings();
    // 探索记录
    this.log = h('section', { id: 'log', class: 'panel hidden', role: 'dialog', 'aria-label': '探索记录' });
    this.root.appendChild(this.log);
    // 提示
    this.toast = h('div', { id: 'toast', class: 'hidden', role: 'status', 'aria-live': 'polite' });
    this.root.appendChild(this.toast);
  }

  private renderSettings(): void {
    const s = this.settingsState;
    const chip = (label: string, on: boolean, fn: () => void) => {
      const c = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(on) }, label);
      c.addEventListener('click', fn);
      return c;
    };
    this.settings.innerHTML = '<h3>设置</h3>';
    const close = btn(ICON.close, '关闭', { cls: 'close-x', labelCls: 'm-hide' });
    close.addEventListener('click', () => this.closePanel(this.settings));
    this.settings.appendChild(close);
    const row = (title: string, desc: string, right: HTMLElement) => {
      const r = h('div', { class: 'setrow' });
      const l = h('div', {}, `${title}<div class="desc">${desc}</div>`);
      r.append(l, right);
      this.settings.appendChild(r);
    };
    const snd = h('div', { class: 'chips' });
    snd.append(chip('开', !s.muted, () => s.muted && this.hd.toggleMute()), chip('关', s.muted, () => !s.muted && this.hd.toggleMute()));
    row('声音', '静音后，故事仍可通过画面完整理解', snd);
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, 'aria-label': '音量' }) as HTMLInputElement;
    vol.value = String(s.volume);
    vol.style.accentColor = 'var(--cyan)';
    vol.addEventListener('input', () => this.hd.setVolume(Number(vol.value)));
    row('音量', '', vol);
    const rm = h('div', { class: 'chips' });
    rm.append(chip('开', s.reduced, () => this.hd.setReduced(true)), chip('关', !s.reduced, () => this.hd.setReduced(false)));
    row('减少动态效果', '降低镜头晃动、粒子与生物的运动幅度', rm);
    const cap = h('div', { class: 'chips' });
    cap.append(chip('开', s.captions, () => this.hd.setCaptions(true)), chip('关', !s.captions, () => this.hd.setCaptions(false)));
    row('字幕', '', cap);
    const nar = h('div', { class: 'chips' });
    nar.append(chip('开', s.narration, () => !s.narration && this.hd.toggleNarration()), chip('关', !s.narration, () => s.narration && this.hd.toggleNarration()));
    row('旁白', '一位女声朗读字幕；说话时环境声会自动压低', nar);
    const q = h('div', { class: 'chips' });
    const qs: Array<[QualityPref, string]> = [
      ['auto', '自动'],
      ['high', '高'],
      ['medium', '中'],
      ['low', '低'],
    ];
    for (const [k, label] of qs) q.appendChild(chip(label, s.quality === k, () => this.hd.setQuality(k)));
    row('画质', '“自动”会在设备吃力时降低特效密度', q);
    const reset = h('button', { class: 'chip', type: 'button' }, '清除');
    reset.addEventListener('click', () => {
      this.hd.resetRecord();
      this.showToast('探索记录', '已清除。');
    });
    row('探索记录', '清除已发现的隐藏生物', reset);
    const credit = h('div', { class: 'desc credit' }, '声音是真实的水听器与野外录音（MBARI、NOAA 等，CC BY / 公共领域 / CC0），旁白由开源语音模型生成；来源与许可见项目 README。');
    this.settings.appendChild(credit);
  }

  updateSettings(s: UISettings): void {
    this.settingsState = s;
    this.captionsOn = s.captions;
    this.renderSettings();
    this.muteBtn.innerHTML = `${s.muted ? ICON.mute : ICON.sound}<span class="lbl m-hide">${s.muted ? '已静音' : '声音'}</span>`;
    this.muteBtn.setAttribute('aria-label', s.muted ? '取消静音' : '静音');
    this.volInput.value = String(s.volume);
    this.voiceBtn.innerHTML = `${s.narration ? ICON.voice : ICON.voiceOff}<span class="lbl m-hide">${s.narration ? '旁白' : '旁白已关'}</span>`;
    this.voiceBtn.setAttribute('aria-label', s.narration ? '关闭旁白' : '打开旁白');
    this.voiceBtn.setAttribute('aria-pressed', String(s.narration));
    const nv = this.intro.querySelector('.intro-voice');
    if (nv) {
      nv.innerHTML = `${s.narration ? ICON.voice : ICON.voiceOff}<span class="lbl">${s.narration ? '旁白：开' : '旁白：关'}</span>`;
      nv.setAttribute('aria-pressed', String(s.narration));
    }
    const snd = this.intro.querySelector('.intro-sound');
    if (snd) {
      snd.innerHTML = `${s.muted ? ICON.mute : ICON.sound}<span class="lbl">${s.muted ? '声音：关' : '声音：开'}</span>`;
      snd.setAttribute('aria-pressed', String(!s.muted));
    }
    this.intro.querySelector('.intro-motion')?.setAttribute('aria-pressed', String(s.reduced));
  }

  setUnlocked(unlocked: boolean): void {
    this.exploreBtn.innerHTML = `${unlocked ? ICON.explore : ICON.lock}<span class="lbl">自由探索</span>`;
    this.exploreBtn.setAttribute('aria-disabled', String(!unlocked));
    this.exploreBtn.setAttribute('aria-label', unlocked ? '进入自由探索' : '自由探索（完成一次旅程后解锁）');
    const ex = this.intro.querySelector<HTMLElement>('.intro-explore');
    if (ex) ex.style.display = unlocked ? '' : 'none';
  }

  setDiscovered(ids: string[]): void {
    this.discovered = new Set(ids);
  }

  // ------------------------------------------------------------ 面板

  private openPanel(p: HTMLElement): void {
    for (const x of [this.settings, this.log]) if (x !== p) x.classList.add('hidden');
    p.classList.remove('hidden');
    p.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  private closePanel(p: HTMLElement): void {
    p.classList.add('hidden');
  }

  closeOverlays(): boolean {
    let any = false;
    for (const p of [this.settings, this.log, this.info]) {
      if (!p.classList.contains('hidden')) {
        p.classList.add('hidden');
        any = true;
      }
    }
    if (any) this.hd.closeInfo();
    return any;
  }

  private openLog(): void {
    this.log.innerHTML = '<h3>探索记录</h3>';
    const close = btn(ICON.close, '关闭', { cls: 'close-x', labelCls: 'm-hide' });
    close.addEventListener('click', () => this.closePanel(this.log));
    this.log.appendChild(close);
    const ul = h('ul', { class: 'loglist' });
    DISCOVERIES.forEach((d: DiscoveryDef, i: number) => {
      const found = this.discovered.has(d.id);
      const li = h('li', { class: found ? 'found' : '' });
      li.innerHTML = `<span class="dot">${found ? '✦' : i + 1}</span><div>${found ? `<b>${d.title}</b><br>${d.line}` : `<span>尚未发现</span><div class="h">提示：${d.hint}</div>`}</div>`;
      ul.appendChild(li);
    });
    this.log.appendChild(ul);
    this.openPanel(this.log);
  }

  openInfo(key: string, canFollow: boolean, following: boolean): void {
    const e = CREATURE_INFO[key];
    if (!e) return;
    this.info.innerHTML = `<h2>${e.name}</h2>${e.latin ? `<div class="latin">${e.latin}</div>` : ''}<p>${e.desc}</p>${e.fact ? `<div class="fact">${e.fact}</div>` : ''}<div class="acts"></div>`;
    const acts = this.info.querySelector('.acts')!;
    if (canFollow) {
      this.followBtn = btn(ICON.follow, following ? '停止跟随' : '跟随观察');
      this.followBtn.setAttribute('aria-pressed', String(following));
      this.followBtn.addEventListener('click', () => this.hd.follow());
      acts.appendChild(this.followBtn);
    }
    const close = btn(ICON.close, '关闭');
    close.addEventListener('click', () => {
      this.info.classList.add('hidden');
      this.hd.closeInfo();
    });
    acts.appendChild(close);
    this.info.classList.remove('hidden');
  }

  setFollowing(on: boolean): void {
    if (!this.followBtn) return;
    this.followBtn.innerHTML = `${ICON.follow}<span class="lbl">${on ? '停止跟随' : '跟随观察'}</span>`;
    this.followBtn.setAttribute('aria-pressed', String(on));
  }

  closeInfo(): void {
    this.info.classList.add('hidden');
  }

  showToast(title: string, line: string, ms = 4200): void {
    this.toast.innerHTML = `<b>${title}</b><br>${line}`;
    this.toast.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), ms);
  }

  discoveryToast(d: DiscoveryDef): void {
    this.discovered.add(d.id);
    this.showToast(`新发现 · ${d.title}`, d.line, 6000);
  }

  // ------------------------------------------------------------ 每帧更新（只在变化时写 DOM）

  private set(key: string, value: string, apply: () => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }

  poke(): void {
    this.idle = 0;
  }

  update(f: UIFrame, dt: number, debugText = ''): void {
    this.idle += dt;
    const story = f.mode === 'story';
    const explore = f.mode === 'explore';
    this.set('mode', f.mode, () => {
      this.intro.classList.toggle('hidden', f.mode !== 'intro');
      // 隐藏的面板不可聚焦，避免键盘误触
      this.intro.inert = f.mode !== 'intro';
      if (f.mode !== 'intro' && this.intro.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      this.exTop.inert = !explore;
      this.exBottom.inert = !explore;
      this.bar.inert = !story;
      for (const el of [this.chapter, this.captions, this.bar]) el.classList.toggle('hidden', !story);
      for (const el of [this.exTop, this.exBottom]) el.classList.toggle('hidden', !explore);
      if (!explore) this.info.classList.add('hidden');
      if (explore) {
        this.exHint.classList.remove('hidden');
        window.setTimeout(() => this.exHint.classList.add('hidden'), 4200);
      } else this.exHint.classList.add('hidden');
    });
    if (this.debug) this.debug.textContent = debugText;
    if (story) this.updateStory(f);
    if (explore) this.updateExplore(f);
  }

  private updateStory(f: UIFrame): void {
    const st = STAGES[f.stageId - 1];
    this.set('chapter', String(st.id), () => {
      this.chapter.innerHTML = `<span class="num">${String(st.id).padStart(2, '0')} / 10</span><span class="title">${st.title}</span><span class="en">${st.en}</span>`;
    });
    const caps = this.captionsOn ? f.captions : [];
    const capKey = caps.map((c) => c.text).join('|');
    this.set('caps', capKey, () => {
      this.captions.innerHTML = caps.map((c) => `<span class="caption">${c.text}${c.sub ? `<small>${c.sub}</small>` : ''}</span>`).join('');
    });
    const spans = this.captions.children;
    for (let i = 0; i < spans.length && i < caps.length; i++) (spans[i] as HTMLElement).style.opacity = caps[i].a.toFixed(3);

    const tl = f.timeLabel;
    this.set('tl', tl ? tl.text : '', () => {
      this.timeLabel.textContent = tl ? `时间流逝 · ${tl.text}` : '';
    });
    this.timeLabel.classList.toggle('hidden', !tl || tl.a < 0.05);
    if (tl) this.timeLabel.style.opacity = tl.a.toFixed(3);

    const showDepth = f.depthA > 0.05;
    this.depth.classList.toggle('hidden', !showDepth);
    if (showDepth) {
      const d = Math.max(0, f.depth);
      const t = Math.min(1, Math.log10(1 + d) / Math.log10(1 + 1800));
      this.depthMark.style.top = `${t * 100}%`;
      this.depthVal.style.top = `${t * 100}%`;
      this.depth.style.opacity = f.depthA.toFixed(3);
      const key = `${Math.round(d / 10)}`;
      this.set('depth', key, () => {
        this.depthVal.innerHTML = `${Math.round(d).toLocaleString('zh-CN')} 米<small>${ZONE(d)}</small>`;
      });
    }
    this.fill.style.width = `${(f.p * 100).toFixed(2)}%`;
    this.set('tick', String(f.stageId), () => {
      this.ticks.forEach((t, i) => {
        t.classList.toggle('cur', i === f.stageId - 1);
        t.classList.toggle('done', i < f.stageId - 1);
      });
    });
    this.set('play', String(f.playing), () => {
      this.playBtn.innerHTML = `${f.playing ? ICON.pause : ICON.play}<span class="lbl">${f.playing ? '暂停' : '播放'}</span>`;
      this.playBtn.setAttribute('aria-label', f.playing ? '暂停故事' : '继续播放故事');
    });
    this.set('unlocked', String(f.unlocked), () => this.setUnlocked(f.unlocked));
    this.hint.classList.toggle('hidden', !f.showHint);
    const idle = this.idle > 3.5 && f.playing;
    this.bar.classList.toggle('idle', idle);
  }

  private updateExplore(f: UIFrame): void {
    this.set('years', String(f.years), () => {
      this.exYears.innerHTML = `生态时间 · 鲸落约 <b>${f.years}</b> 年`;
    });
    this.set('speed', String(f.ecoSpeed), () => {
      for (const [k, b] of Object.entries(this.speedBtns)) b.setAttribute('aria-pressed', String(Number(k) === f.ecoSpeed));
    });
    this.set('zoom', f.zoom, () => {
      this.zoomLabel.textContent = f.zoom;
    });
    this.set('found', `${f.found}/${f.total}`, () => {
      this.exFound.innerHTML = `${ICON.book}<span class="lbl">发现 ${f.found}/${f.total}</span>`;
    });
  }
}
