import type { ProviderOption } from "@/lib/types";

function getAvailableProviders(): ProviderOption[] {
  const providers: ProviderOption[] = ["auto"];

  if (process.env.OPENAI_API_KEY?.trim()) {
    providers.push("openai");
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    providers.push("anthropic");
  }

  providers.push("mock");
  return providers;
}

export function getRuntimeInfo() {
  const availableProviders = getAvailableProviders();
  const defaultProvider =
    (process.env.DEFAULT_PROVIDER as ProviderOption | undefined) || "auto";

  const resolvedProvider =
    defaultProvider !== "auto" && availableProviders.includes(defaultProvider)
      ? defaultProvider
      : availableProviders.includes("openai")
        ? "openai"
        : availableProviders.includes("anthropic")
          ? "anthropic"
          : "mock";

  const model =
    resolvedProvider === "openai"
      ? process.env.LLM_MODEL || "gpt-4.1-mini"
      : resolvedProvider === "anthropic"
        ? process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest"
        : "mock-fallback-v1";

  return {
    providerMode: resolvedProvider,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    availableProviders,
    defaultProvider,
    model,
    nodeVersion: process.version,
    storage: "postgresql",
  };
}
