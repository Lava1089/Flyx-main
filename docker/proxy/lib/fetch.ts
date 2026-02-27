/**
 * Thin wrappers around native fetch with User-Agent injection and timeout.
 * Replaces the old nodeFetch (http/https) utility with Bun's native fetch.
 */

import { USER_AGENT } from "./helpers";

const DEFAULT_TIMEOUT = 20_000;

function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "User-Agent": USER_AGENT, ...extra };
}

export async function fetchText(
  url: string,
  headers: Record<string, string> = {},
  timeout = DEFAULT_TIMEOUT,
): Promise<{ status: number; text: string; headers: Headers }> {
  const res = await fetch(url, {
    headers: buildHeaders(headers),
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

export async function fetchJson<T = unknown>(
  url: string,
  headers: Record<string, string> = {},
  timeout = DEFAULT_TIMEOUT,
): Promise<{ status: number; data: T; headers: Headers }> {
  const res = await fetch(url, {
    headers: buildHeaders(headers),
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });
  const data = (await res.json()) as T;
  return { status: res.status, data, headers: res.headers };
}

export async function fetchBinary(
  url: string,
  headers: Record<string, string> = {},
  timeout = DEFAULT_TIMEOUT,
): Promise<{ status: number; body: ArrayBuffer; headers: Headers }> {
  const res = await fetch(url, {
    headers: buildHeaders(headers),
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });
  const body = await res.arrayBuffer();
  return { status: res.status, body, headers: res.headers };
}
