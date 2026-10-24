/**
 * 本地存储：用户偏好与探索记录。所有读写都包裹在 try/catch 中——
 * 隐私模式或禁用存储时体验照常运行，只是不会记住设置。
 */

export type QualityPref = 'auto' | 'high' | 'medium' | 'low';

export interface Prefs {
  muted: boolean;
  volume: number;
  /** null 表示跟随系统的“减少动态效果”设置 */
  reducedMotion: boolean | null;
  quality: QualityPref;
  captions: boolean;
  /** 旁白（女声朗读字幕） */
  narration: boolean;
}

export interface ExploreRecord {
  unlocked: boolean;
  discovered: string[];
  observed: string[];
}

const KEY_PREFS = 'whalefall.prefs.v1';
const KEY_RECORD = 'whalefall.record.v1';

const DEFAULT_PREFS: Prefs = { muted: false, volume: 0.8, reducedMotion: null, quality: 'auto', captions: true, narration: true };
const DEFAULT_RECORD: ExploreRecord = { unlocked: false, discovered: [], observed: [] };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return { ...fallback };
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存储不可用：忽略 */
  }
}

export const storage = {
  prefs(): Prefs {
    return read(KEY_PREFS, DEFAULT_PREFS);
  },
  savePrefs(p: Prefs): void {
    write(KEY_PREFS, p);
  },
  record(): ExploreRecord {
    const r = read(KEY_RECORD, DEFAULT_RECORD);
    return { unlocked: !!r.unlocked, discovered: [...(r.discovered ?? [])], observed: [...(r.observed ?? [])] };
  },
  saveRecord(r: ExploreRecord): void {
    write(KEY_RECORD, r);
  },
};
