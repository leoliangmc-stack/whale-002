// 画质分级。手机默认中档，性能监测会在掉帧时自动降级。

export interface QualitySettings {
  tier: 0 | 1 | 2;
  name: 'low' | 'medium' | 'high';
  dprCap: number;
  krill: number;
  /** 磷虾群中“远处成群的小磷虾”斑点图的层数 */
  krillSpecks: number;
  snow: number;
  caustics: boolean;
  spout: number;
  sediment: number;
  bubbles: number;
  seabedDetail: number;
  creatureDensity: number;
  softGlow: boolean;
}

export const QUALITY: Record<0 | 1 | 2, QualitySettings> = {
  0: {
    tier: 0,
    name: 'low',
    dprCap: 1.25,
    krill: 420,
    krillSpecks: 3,
    snow: 80,
    caustics: false,
    spout: 70,
    sediment: 90,
    bubbles: 30,
    seabedDetail: 0.45,
    creatureDensity: 0.55,
    softGlow: false,
  },
  1: {
    tier: 1,
    name: 'medium',
    dprCap: 2,
    krill: 800,
    krillSpecks: 5,
    snow: 150,
    caustics: true,
    spout: 120,
    sediment: 170,
    bubbles: 60,
    seabedDetail: 0.75,
    creatureDensity: 0.8,
    softGlow: true,
  },
  2: {
    tier: 2,
    name: 'high',
    dprCap: 2,
    krill: 1250,
    krillSpecks: 7,
    snow: 240,
    caustics: true,
    spout: 170,
    sediment: 260,
    bubbles: 90,
    seabedDetail: 1,
    creatureDensity: 1,
    softGlow: true,
  },
};

/** 根据设备特征估计初始画质。 */
export function guessInitialTier(device: 'phone' | 'tablet' | 'desktop'): 0 | 1 | 2 {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (device === 'phone') return cores >= 6 && mem >= 4 ? 1 : 0;
  if (device === 'tablet') return cores >= 4 ? 1 : 0;
  return cores >= 4 ? 2 : 1;
}
