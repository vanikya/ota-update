import type { Env, Release, Rollout } from '../types';

// Determine if a device should receive an update based on rollout percentage
export function shouldReceiveUpdate(deviceId: string, percentage: number): boolean {
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;

  // Use consistent hashing based on device ID to ensure same device always gets same result
  const hash = simpleHash(deviceId);
  const bucket = hash % 100;
  return bucket < percentage;
}

// Simple string hash function (consistent across calls)
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Compare semver versions
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;

    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  return 0;
}

// Check if app version is within acceptable range for a release
export function isAppVersionCompatible(
  appVersion: string,
  minAppVersion: string | null,
  maxAppVersion: string | null
): boolean {
  if (minAppVersion && compareVersions(appVersion, minAppVersion) < 0) {
    return false;
  }
  if (maxAppVersion && compareVersions(appVersion, maxAppVersion) > 0) {
    return false;
  }
  return true;
}

// Get the latest active release for an app/channel considering rollout
export interface ReleaseWithRollout extends Release {
  rollout_percentage: number;
}

export async function getLatestActiveRelease(
  env: Env,
  appId: string,
  channelId: string,
  deviceId: string,
  appVersion: string
): Promise<ReleaseWithRollout | null> {
  // Get releases with active rollouts, ordered by creation date (newest first)
  const releases = await env.DB.prepare(`
    SELECT
      r.*,
      ro.percentage as rollout_percentage
    FROM releases r
    JOIN rollouts ro ON r.id = ro.release_id
    WHERE r.app_id = ?
      AND r.channel_id = ?
      AND ro.is_active = 1
    ORDER BY r.created_at DESC
    LIMIT 10
  `).bind(appId, channelId).all<ReleaseWithRollout>();

  if (!releases.results || releases.results.length === 0) {
    return null;
  }

  // Find the first release that:
  // 1. Is compatible with the app version
  // 2. The device qualifies for based on rollout percentage
  for (const release of releases.results) {
    if (!isAppVersionCompatible(appVersion, release.min_app_version, release.max_app_version)) {
      continue;
    }

    if (shouldReceiveUpdate(deviceId, release.rollout_percentage)) {
      return release;
    }
  }

  return null;
}

// Create a rollout for a release
export async function createRollout(
  env: Env,
  rolloutId: string,
  releaseId: string,
  percentage: number = 100
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO rollouts (id, release_id, percentage, is_active)
    VALUES (?, ?, ?, 1)
  `).bind(rolloutId, releaseId, percentage).run();
}

// Update rollout percentage
export async function updateRolloutPercentage(
  env: Env,
  releaseId: string,
  percentage: number
): Promise<void> {
  const completedAt = percentage >= 100 ? 'unixepoch()' : 'NULL';

  await env.DB.prepare(`
    UPDATE rollouts
    SET percentage = ?, completed_at = ${completedAt}
    WHERE release_id = ?
  `).bind(percentage, releaseId).run();
}

// Deactivate all other rollouts for a channel when a new release is made active
export async function deactivatePreviousRollouts(
  env: Env,
  appId: string,
  channelId: string,
  excludeReleaseId: string
): Promise<void> {
  await env.DB.prepare(`
    UPDATE rollouts
    SET is_active = 0, completed_at = unixepoch()
    WHERE release_id IN (
      SELECT id FROM releases
      WHERE app_id = ? AND channel_id = ? AND id != ?
    ) AND is_active = 1
  `).bind(appId, channelId, excludeReleaseId).run();
}

// Get rollout status for a release
export async function getRolloutStatus(env: Env, releaseId: string): Promise<Rollout | null> {
  const result = await env.DB.prepare(`
    SELECT * FROM rollouts WHERE release_id = ?
  `).bind(releaseId).first<Rollout>();

  return result;
}

// Perform a rollback to a previous release
export async function rollbackToRelease(
  env: Env,
  appId: string,
  channelId: string,
  targetReleaseId: string
): Promise<void> {
  // Deactivate current active rollouts
  await env.DB.prepare(`
    UPDATE rollouts
    SET is_active = 0, completed_at = unixepoch()
    WHERE release_id IN (
      SELECT id FROM releases
      WHERE app_id = ? AND channel_id = ?
    ) AND is_active = 1
  `).bind(appId, channelId).run();

  // Activate the target release's rollout
  await env.DB.prepare(`
    UPDATE rollouts
    SET is_active = 1, percentage = 100, completed_at = NULL, started_at = unixepoch()
    WHERE release_id = ?
  `).bind(targetReleaseId).run();
}
