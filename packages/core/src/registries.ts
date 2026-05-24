import type { ModelProvider, ProviderRegistry, ToolsetManifest, ToolsetRegistry } from "./types";

export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  constructor(providers: ModelProvider[] = []) {
    for (const provider of providers) {
      this.registerProvider(provider);
    }
  }

  listProviders(): string[] {
    return [...this.providers.keys()].sort();
  }

  getProvider(name: string): ModelProvider | undefined {
    return this.providers.get(name);
  }

  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.name, provider);
  }
}

export class InMemoryToolsetRegistry implements ToolsetRegistry {
  private readonly manifests = new Map<string, ToolsetManifest>();

  constructor(manifests: ToolsetManifest[] = []) {
    for (const manifest of manifests) {
      this.registerToolset(manifest);
    }
  }

  listToolsets(): ToolsetManifest[] {
    return [...this.manifests.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  getToolset(name: string): ToolsetManifest | undefined {
    return this.manifests.get(name);
  }

  registerToolset(manifest: ToolsetManifest): void {
    this.manifests.set(manifest.name, manifest);
  }
}
