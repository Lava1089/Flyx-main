/**
 * SOCKS5 Proxy Pool Manager
 * Fetches, validates, and maintains a pool of working SOCKS5 proxies.
 * Provides round-robin selection and failure tracking.
 * Requirement: 3.5
 */
import type { Socks5PoolConfig, ProxySelection } from '../types';
/** Main pool refresh: fetch lists, validate, update pool */
export declare function refreshProxyPool(config?: Socks5PoolConfig): Promise<void>;
/** Get next proxy from the validated pool (round-robin) */
export declare function getNextProxy(): ProxySelection;
/** Mark a proxy as failed */
export declare function markProxyFailed(proxyStr: string): void;
/** Get pool status for debugging */
export declare function getPoolStatus(): Record<string, unknown>;
/** Start periodic pool refresh */
export declare function startPoolRefresh(config?: Socks5PoolConfig): void;
/** Stop periodic pool refresh */
export declare function stopPoolRefresh(): void;
//# sourceMappingURL=socks5-pool.d.ts.map