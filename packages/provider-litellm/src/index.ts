import { createOpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from "@agentbase/provider-openai-compatible";

export type LiteLLMProviderOptions = Omit<OpenAICompatibleProviderOptions, "name"> & {
  teamId?: string;
};

export function createLiteLLMProvider(options: LiteLLMProviderOptions) {
  return createOpenAICompatibleProvider({
    ...options,
    name: "litellm",
    headers: {
      ...(options.teamId ? { "x-litellm-team-id": options.teamId } : {}),
      ...options.headers
    }
  });
}
