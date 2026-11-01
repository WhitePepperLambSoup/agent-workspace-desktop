import type { ProviderProtocol } from '../../../shared/api'
import type { MessageKey } from '../i18n/messages'

export interface ProviderPreset {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  /** The model a new profile starts with; empty when the user has to name one. */
  model: string
  /** Where the provider hands out API keys; absent for a server that needs none. */
  keyUrl?: string
  note: MessageKey
  /** The name in the reader's language, where it has one of its own there. */
  nameKey?: MessageKey
}

/** Cloud services, the same list and first models as the Android app's first-use setup. */
export const CLOUD_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', keyUrl: 'https://platform.deepseek.com/api_keys', note: 'setup.note.china' },
  { id: 'qwen', name: 'Qwen (Alibaba Cloud)', nameKey: 'setup.name.qwen', protocol: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash', keyUrl: 'https://bailian.console.aliyun.com/', note: 'setup.note.china' },
  { id: 'kimi', name: 'Kimi (Moonshot)', nameKey: 'setup.name.kimi', protocol: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6', keyUrl: 'https://platform.moonshot.cn/console/api-keys', note: 'setup.note.china' },
  { id: 'glm', name: 'GLM (Zhipu)', nameKey: 'setup.name.glm', protocol: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', note: 'setup.note.china' },
  { id: 'openai', name: 'OpenAI', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.6-sol', keyUrl: 'https://platform.openai.com/api-keys', note: 'setup.note.abroad' },
  { id: 'anthropic', name: 'Claude (Anthropic)', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys', note: 'setup.note.abroad' },
  { id: 'gemini', name: 'Gemini (Google)', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/apikey', note: 'setup.note.abroad' },
  { id: 'xai', name: 'Grok (xAI)', protocol: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7', keyUrl: 'https://console.x.ai/', note: 'setup.note.abroad' },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: '', keyUrl: 'https://openrouter.ai/keys', note: 'setup.note.abroad' },
]

/**
 * Local model servers. Loopback addresses use 127.0.0.1 because only a literal
 * loopback IP is trusted for provider egress without a prompt.
 */
export const LOCAL_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'ollama-local', name: 'Ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: '', note: 'setup.note.local' },
  { id: 'lm-studio', name: 'LM Studio', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1', model: '', note: 'setup.note.local' },
  { id: 'llama-cpp', name: 'llama.cpp', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', model: '', note: 'setup.note.local' },
  { id: 'vllm', name: 'vLLM', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', model: '', note: 'setup.note.local' },
]

/** Any other service that speaks the OpenAI protocol; the user gives its address. */
export const CUSTOM_PROVIDER_PRESET: ProviderPreset = {
  id: 'custom', name: 'Custom', protocol: 'openai-compatible', baseUrl: '', model: '', note: 'setup.note.custom',
}

export function isLocalPreset(preset: ProviderPreset): boolean {
  return LOCAL_PROVIDER_PRESETS.some((item) => item.id === preset.id)
}

/** The first choice offered: one that works on networks in China for Chinese readers. */
export function defaultPresetFor(locale: string): ProviderPreset {
  const id = locale.startsWith('zh') ? 'deepseek' : 'openai'
  return CLOUD_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? CLOUD_PROVIDER_PRESETS[0]!
}

const HEALTH_ERRORS: Record<string, MessageKey> = {
  provider_auth_failed: 'setup.error.auth',
  provider_credential_missing: 'setup.error.keyNeeded',
  provider_model_not_found: 'setup.error.model',
  provider_billing_required: 'setup.error.billing',
  provider_rate_limited: 'setup.error.rateLimit',
  provider_service_unavailable: 'setup.error.service',
  provider_transport_unavailable: 'setup.error.network',
  provider_timeout: 'setup.error.network',
  invalid_provider: 'setup.error.invalid',
}

/** A provider's own problem, from its health check's code, in the reader's language. */
export function healthErrorKey(code: string | null): MessageKey {
  return (code ? HEALTH_ERRORS[code] : undefined) ?? 'setup.error.failed'
}
