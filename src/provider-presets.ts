/**
 * Well-known OpenAI-compatible providers. Every entry works with the app's
 * /v1/chat/completions + /v1/models flow — the user only needs to pick one,
 * paste their API key, and choose a model.
 */
export interface ProviderPreset {
  name: string;
  baseUrl: string;
  /** Short Arabic hint shown under the chips row when selected. */
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', note: 'أكبر تجميعة وفيه موديلات مجانية' },
  {
    name: 'Free OneByte (OmniRoute)',
    baseUrl: 'http://192.168.1.10:20128/v1',
    note: 'بوابة OmniRoute المجانية — شغّلها على كمبيوترك وبدّلي الـ IP بمكان جهازك',
  },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', note: 'رخيص وقوي' },
  { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', note: 'مدخل OpenAI-compatible' },
  { name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', note: 'مدخل OpenAI-compatible' },
  { name: 'Qwen (DashScope)', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
  { name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  { name: 'GMI Cloud', baseUrl: 'https://api.gmi-serving.com/v1' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', note: 'سرعة عالية جدًا' },
  { name: 'Together', baseUrl: 'https://api.together.xyz/v1' },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { name: 'xAI Grok', baseUrl: 'https://api.x.ai/v1' },
  { name: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1' },
  { name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1' },
  { name: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1' },
  { name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.ai/v1' },
  { name: 'Z.ai GLM', baseUrl: 'https://api.z.ai/api/paas/v4' },
  { name: 'Ollama (محلي)', baseUrl: 'http://localhost:11434/v1', note: 'على نفس الجهاز' },
  { name: 'LM Studio (محلي)', baseUrl: 'http://localhost:1234/v1', note: 'على نفس الجهاز' },
];
