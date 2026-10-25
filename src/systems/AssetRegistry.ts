import { overrideTexture, type TextureSet } from '../core/textures';
import type { AudioEntry, AudioManager } from './AudioManager';

/**
 * AssetRegistry：正式美术 / 音频资源的替换接口。
 *
 * 第一版的所有画面都由程序实时绘制（占位但完整可用）。当正式资源就绪时，只需在
 * `public/assets/manifest.json` 中登记，例如：
 *
 * {
 *   "textures": { "krill": "sprites/krill.png", "caustic": "fx/caustic.png" },
 *   "audio": { "A01": { "file": "audio/A01_uw-open.mp3", "batch": 0, "loop": [0.2, 30.2], "lufs": -18.4 } }
 * }
 *
 * 纹理键见 core/textures.ts 的 TextureSet。音频由 scripts/sound-build.py 生成并写入 manifest：
 * 键是 docs/sound/cue-sheet.md 的素材编号（A 循环床、F 一次性音效、V 鲸鸣），batch 是加载批次
 * （0 常驻，1 开场，2 海面，3 深海，4 海床，见 AudioManager），loop 是循环区间（秒），lufs 是实测响度。
 * 鲸鱼与鲸骨使用 public/assets/whale/ 中的绘画（entities/WhaleArt.ts），沿脊线切成条带绘制；
 * 换成另一套绘画时，只需保持同一取景并更新 WhaleArt.ts 中的锚点与 WhaleBody.ts 中的轮廓。
 */
export interface AssetManifest {
  textures?: Partial<Record<keyof TextureSet, string>>;
  audio?: Record<string, string | AudioEntry>;
}

export class AssetRegistry {
  manifest: AssetManifest = {};
  private loaded: Promise<void> | null = null;
  /** 预先下载的音频文件（解码要等声音在用户手势中解锁之后，这里只先把字节取回来） */
  private readonly prefetched = new Map<string, Promise<ArrayBuffer | null>>();

  load(base = './assets/'): Promise<void> {
    this.loaded ??= this.loadManifest(base);
    return this.loaded;
  }

  private async loadManifest(base: string): Promise<void> {
    try {
      const res = await fetch(base + 'manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      this.manifest = (await res.json()) as AssetManifest;
    } catch {
      return; // 没有清单时使用程序化资源
    }
    const tex = this.manifest.textures ?? {};
    await Promise.all(
      Object.entries(tex).map(
        ([key, path]) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              overrideTexture(key as keyof TextureSet, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = base + path;
          }),
      ),
    );
  }

  /**
   * 开场界面显示时就先下载常驻与开场批次（0、1）的音频字节：点击“开始”之后只需解码，
   * 开场第 3 秒鲸鱼入场时的叫声就能准时响起。
   */
  async prefetchAudio(base = './assets/'): Promise<void> {
    await this.load(base);
    const list = this.manifest.audio ?? {};
    for (const [key, v] of Object.entries(list)) {
      const e = typeof v === 'string' ? { file: v, batch: 0 } : v;
      if ((e.batch ?? 0) > 1 || this.prefetched.has(key)) continue;
      this.prefetched.set(
        key,
        fetch(base + e.file)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null),
      );
    }
  }

  /**
   * 在音频解锁后登记声音素材：第 0 批（常驻的循环床与拍尾）加载完成后返回，其余批次由 AudioManager
   * 按叙事进度按需加载、离开后释放。单个文件加载失败时这个声音只是缺席（不播放任何替代声音）。
   */
  async loadAudio(audio: AudioManager, base = './assets/'): Promise<void> {
    await this.load(base);
    const ctx = audio.context;
    const list = this.manifest.audio;
    if (!ctx || !list) return;
    const entries: Record<string, AudioEntry> = {};
    for (const [key, v] of Object.entries(list)) entries[key] = typeof v === 'string' ? { file: v, batch: 0 } : v;
    await audio.attachCatalog(entries, async (key, e) => {
      try {
        // 预先下载过的只用一次（解码会占用这块内存；之后再加载时重新下载）
        const pre = this.prefetched.get(key);
        this.prefetched.delete(key);
        const bytes = (pre && (await pre)) || (await fetch(base + e.file).then((r) => (r.ok ? r.arrayBuffer() : null)));
        if (!bytes) return null;
        return await ctx.decodeAudioData(bytes);
      } catch {
        return null;
      }
    });
  }
}
