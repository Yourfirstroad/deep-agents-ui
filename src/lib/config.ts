export interface DenoiseConfig {
  enabled: boolean;
  repeatMinPages: number;
  repeatMaxlen: number;
  maxDeleteRatio: number;
  pictureDescription: boolean; // 图片理解(千问 VL,慢但内容更全)
}

export const DEFAULT_DENOISE_CONFIG: DenoiseConfig = {
  enabled: true,
  repeatMinPages: 3,
  repeatMaxlen: 60,
  maxDeleteRatio: 0.3,
  pictureDescription: true,
};

export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey?: string;
  denoise?: DenoiseConfig;
}

const CONFIG_KEY = "deep-agent-config";

export function getConfig(): StandaloneConfig | null {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem(CONFIG_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function saveConfig(config: StandaloneConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}
