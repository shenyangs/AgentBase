import { createOpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from "@agentbase/provider-openai-compatible";

export type OllamaProviderOptions = Omit<OpenAICompatibleProviderOptions, "baseUrl" | "name"> & {
  baseUrl?: string;
};

export function createOllamaProvider(options: OllamaProviderOptions) {
  return createOpenAICompatibleProvider({
    ...options,
    name: "ollama",
    baseUrl: options.baseUrl ?? "http://localhost:11434/v1"
  });
}
