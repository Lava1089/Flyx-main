/**
 * Provider Registry
 * 
 * Central registry mapping provider names to implementations.
 * Handles discovery, priority ordering, and config serialization.
 * Requirements: 2.3, 2.4, 2.5, 9.1, 9.2, 9.3
 */

import type { Provider, ProviderConfig, MediaType } from './types';

export class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();

  /**
   * Register a provider. Throws if a provider with the same name already exists.
   */
  register(provider: Provider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Provider "${provider.name}" is already registered`);
    }
    this.providers.set(provider.name, provider);
  }

  /**
   * Get a provider by name. Returns undefined if not found.
   */
  get(name: string): Provider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all enabled providers that support the given content type,
   * sorted by ascending priority (lower number = higher priority).
   */
  getForContent(mediaType: MediaType, metadata?: { isAnime?: boolean; isLive?: boolean }): Provider[] {
    return Array.from(this.providers.values())
      .filter(p => p.enabled && p.supportsContent(mediaType, metadata))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get all enabled providers.
   */
  getAllEnabled(): Provider[] {
    return Array.from(this.providers.values()).filter(p => p.enabled);
  }

  /**
   * Serialize all provider configurations to a JSON string.
   */
  serializeConfig(): string {
    const configs: ProviderConfig[] = Array.from(this.providers.values()).map(p => p.getConfig());
    return JSON.stringify(configs);
  }

  /**
   * Deserialize a JSON string back to an array of ProviderConfig objects.
   */
  static deserializeConfig(json: string): ProviderConfig[] {
    return JSON.parse(json) as ProviderConfig[];
  }
}
