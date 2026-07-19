// Bring-your-own-key settings for AI quiz generation. The host's provider and
// API key live in their browser only — we never store them server-side; the key
// is sent to our server once per generation and used transiently to call the
// provider. Clearing site data removes it.
export type AIProvider = "openrouter" | "anthropic" | "openai";

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
}

const KEY = "presento.aiConfig.v1";

const PROVIDERS: AIProvider[] = ["openrouter", "anthropic", "openai"];

// OpenRouter first — it's the only one a host can use without adding a card.
export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openrouter: "Free",
  anthropic: "Claude",
  openai: "ChatGPT",
};

// A developer API key is its own signup, separate from a Claude/ChatGPT
// subscription — so link hosts straight to the right console.
export const PROVIDER_KEY_HELP: Record<AIProvider, { url: string; label: string; hint: string }> = {
  openrouter: {
    url: "https://openrouter.ai/keys",
    label: "Get a free OpenRouter key",
    hint: "Starts with sk-or-. Free to create, no card needed. Questions are a bit rougher than the paid options.",
  },
  anthropic: {
    url: "https://console.anthropic.com/settings/keys",
    label: "Get an Anthropic API key",
    hint: "Starts with sk-ant-. Needs prepaid API credit — a Claude.ai subscription doesn't include this.",
  },
  openai: {
    url: "https://platform.openai.com/api-keys",
    label: "Get an OpenAI API key",
    hint: "Starts with sk-. Needs prepaid API credit — a ChatGPT subscription doesn't include this.",
  },
};

export const PROVIDER_KEY_PREFIX: Record<AIProvider, string> = {
  openrouter: "sk-or-…",
  anthropic: "sk-ant-…",
  openai: "sk-…",
};

export const providerList = () => PROVIDERS;

export function loadAIConfig(): AIConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && PROVIDERS.includes(parsed.provider) && typeof parsed.apiKey === "string") {
      return { provider: parsed.provider, apiKey: parsed.apiKey };
    }
  } catch (error) {
    console.error("Failed to read AI config:", error);
  }
  return null;
}

export function saveAIConfig(config: AIConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch (error) {
    console.error("Failed to save AI config:", error);
  }
}

export function clearAIConfig() {
  localStorage.removeItem(KEY);
}
