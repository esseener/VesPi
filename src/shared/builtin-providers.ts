export interface BuiltinProvider {
  key: string
  label: string
  baseUrl: string
  api: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai'
}

/** OMP-ready providers. Users only paste a key; base URL/API stay preset. */
export const BUILTIN_PROVIDERS: BuiltinProvider[] = [
  { key: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions' },
  { key: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages' },
  { key: 'google', label: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-generative-ai' },
  { key: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
  { key: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions' },
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions' },
  { key: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', api: 'openai-completions' },
  { key: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1', api: 'openai-completions' },
  { key: 'together', label: 'Together', baseUrl: 'https://api.together.xyz/v1', api: 'openai-completions' },
  { key: 'fireworks', label: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', api: 'openai-completions' },
]

export const BUILTIN_PROVIDER_KEYS = new Set(BUILTIN_PROVIDERS.map((item) => item.key))

export function isBuiltinProviderKey(key: string): boolean {
  return BUILTIN_PROVIDER_KEYS.has(key.trim())
}
