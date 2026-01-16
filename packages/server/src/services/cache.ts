import type { Env, CachedLatestRelease } from '../types';

const CACHE_TTL = 60; // 1 minute TTL for latest release cache

// Cache key generators
function latestReleaseKey(appSlug: string, channel: string, platform: string): string {
  return `latest:${appSlug}:${channel}:${platform}`;
}

function sessionKey(token: string): string {
  return `session:${token}`;
}

// Get latest release from cache
export async function getCachedLatestRelease(
  env: Env,
  appSlug: string,
  channel: string,
  platform: string
): Promise<CachedLatestRelease | null> {
  const key = latestReleaseKey(appSlug, channel, platform);
  const cached = await env.CACHE.get(key, 'json');
  return cached as CachedLatestRelease | null;
}

// Set latest release in cache
export async function setCachedLatestRelease(
  env: Env,
  appSlug: string,
  channel: string,
  platform: string,
  release: CachedLatestRelease
): Promise<void> {
  const key = latestReleaseKey(appSlug, channel, platform);
  await env.CACHE.put(key, JSON.stringify(release), { expirationTtl: CACHE_TTL });
}

// Invalidate latest release cache for all platforms
export async function invalidateLatestReleaseCache(
  env: Env,
  appSlug: string,
  channel: string
): Promise<void> {
  const platforms = ['ios', 'android', 'both'];
  await Promise.all(
    platforms.map(platform => {
      const key = latestReleaseKey(appSlug, channel, platform);
      return env.CACHE.delete(key);
    })
  );
}

// Session management
interface SessionData {
  organizationId: string;
  permissions: string;
  expiresAt: number;
}

export async function createSession(
  env: Env,
  token: string,
  data: Omit<SessionData, 'expiresAt'>,
  ttlSeconds: number = 3600 * 24 * 7 // 7 days default
): Promise<void> {
  const key = sessionKey(token);
  const session: SessionData = {
    ...data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  await env.CACHE.put(key, JSON.stringify(session), { expirationTtl: ttlSeconds });
}

export async function getSession(env: Env, token: string): Promise<SessionData | null> {
  const key = sessionKey(token);
  const session = await env.CACHE.get(key, 'json');
  if (!session) return null;

  const data = session as SessionData;
  if (data.expiresAt < Date.now()) {
    await env.CACHE.delete(key);
    return null;
  }

  return data;
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  const key = sessionKey(token);
  await env.CACHE.delete(key);
}

// Generic cache helpers
export async function getFromCache<T>(env: Env, key: string): Promise<T | null> {
  const value = await env.CACHE.get(key, 'json');
  return value as T | null;
}

export async function setInCache<T>(
  env: Env,
  key: string,
  value: T,
  ttlSeconds?: number
): Promise<void> {
  const options = ttlSeconds ? { expirationTtl: ttlSeconds } : undefined;
  await env.CACHE.put(key, JSON.stringify(value), options);
}

export async function deleteFromCache(env: Env, key: string): Promise<void> {
  await env.CACHE.delete(key);
}
