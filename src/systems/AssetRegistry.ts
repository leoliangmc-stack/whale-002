import { overrideTexture, type TextureSet } from '../core/textures';
import type { AudioManager } from './AudioManager';

/**
 * AssetRegistry：正式美术 / 音频资源的替换接口。
 *
 * 第一版的所有画面都由程序实时绘制（占位但完整可用）。当正式资源就绪时，只需在
 * `public/assets/manifest.json` 中登记，例如：
 *
 * {
 *   "textures": { "krill": "sprites/krill.png", "caustic": "fx/caustic.png" },
 *   "audio": { "whaleCall": "audio/blue-whale-call.mp3", "spout": "audio/spout.mp3" }
 * }
 *
 * 纹理键见 core/textures.ts 的 TextureSet；音频键见 AudioManager.overrides 的使用处。
 * 鲸鱼与鲸骨使用 public/assets/whale/ 中的绘画（entities/WhaleArt.ts），沿脊线切成条带绘制；
 * 换成另一套绘画时，只需保持同一取景并更新 WhaleArt.ts 中的锚点与 WhaleBody.ts 中的轮廓。
 */
export interface AssetManifest {
  textures?: Partial<Record<keyof TextureSet, string>>;
  audio?: Record<string, string>;
}

export class AssetRegistry {
  manifest: AssetManifest = {};
  private loaded: Promise<void> | null = null;

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

  /** 在音频解锁后加载正式音频。 */
  async loadAudio(audio: AudioManager, base = './assets/'): Promise<void> {
    await this.load(base);
    const ctx = audio.context;
    const list = this.manifest.audio;
    if (!ctx || !list) return;
    await Promise.all(
      Object.entries(list).map(async ([key, path]) => {
        try {
          const buf = await (await fetch(base + path)).arrayBuffer();
          audio.overrides.set(key, await ctx.decodeAudioData(buf));
        } catch {
          /* 加载失败时继续使用合成声音 */
        }
      }),
    );
  }
}
