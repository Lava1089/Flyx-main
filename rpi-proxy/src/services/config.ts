/**
 * Environment Variable Validation
 * Validates required config at startup and logs missing values.
 * Requirements: 3.2, 3.7
 */

import type { RPIConfig } from '../types';

/** Validate and return the server configuration from environment variables */
export function loadConfig(): RPIConfig {
  const missing: string[] = [];

  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === 'change-this-secret-key') {
    console.warn('[Config] ⚠️  API_KEY is not set or is using the default value');
  }

  const portStr = process.env.PORT;
  const port = portStr ? parseInt(portStr, 10) : 3001;
  if (portStr && isNaN(port)) {
    missing.push('PORT (invalid number)');
  }

  if (missing.length > 0) {
    console.error(`[Config] ❌ Missing or invalid environment variables: ${missing.join(', ')}`);
  }

  const config: RPIConfig = {
    port,
    apiKey: apiKey ?? 'change-this-secret-key',
  };

  console.log(`[Config] ✅ Loaded — port=${config.port}, apiKey=${config.apiKey.substring(0, 4)}***`);
  return config;
}
