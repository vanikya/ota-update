import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { Env, CheckUpdateRequest, CheckUpdateResponse, ReportEventRequest, App, Channel, CachedLatestRelease } from '../types';
import { getCachedLatestRelease, setCachedLatestRelease } from '../services/cache';
import { getLatestActiveRelease, compareVersions, isAppVersionCompatible, shouldReceiveUpdate } from '../services/rollout';
import { getBundleUrl, getBundle } from '../services/storage';

const updates = new Hono<{ Bindings: Env }>();

// Check for updates (public endpoint)
updates.post('/check-update', async (c) => {
  const body = await c.req.json<CheckUpdateRequest>();

  // Validate required fields
  if (!body.appSlug || !body.channel || !body.platform || !body.appVersion || !body.deviceId) {
    return c.json({ error: 'appSlug, channel, platform, appVersion, and deviceId are required' }, 400);
  }

  // Validate platform
  if (!['ios', 'android'].includes(body.platform)) {
    return c.json({ error: 'platform must be ios or android' }, 400);
  }

  // Get app by slug
  const app = await c.env.DB.prepare(`
    SELECT * FROM apps WHERE slug = ?
  `).bind(body.appSlug).first<App>();

  if (!app) {
    return c.json({ error: 'App not found' }, 404);
  }

  // Check platform compatibility
  if (app.platform !== 'both' && app.platform !== body.platform) {
    return c.json({ error: 'Platform not supported for this app' }, 400);
  }

  // Get channel
  const channel = await c.env.DB.prepare(`
    SELECT * FROM channels WHERE app_id = ? AND name = ?
  `).bind(app.id, body.channel).first<Channel>();

  if (!channel) {
    return c.json({ error: `Channel '${body.channel}' not found` }, 404);
  }

  // Record check event
  const eventId = 'evt_' + nanoid(16);
  await c.env.DB.prepare(`
    INSERT INTO update_events (id, app_id, device_id, event_type, app_version, device_info)
    VALUES (?, ?, ?, 'check', ?, ?)
  `).bind(
    eventId,
    app.id,
    body.deviceId,
    body.appVersion,
    body.deviceInfo ? JSON.stringify(body.deviceInfo) : null
  ).run();

  // Try to get from cache first
  let cachedRelease = await getCachedLatestRelease(c.env, body.appSlug, body.channel, body.platform);

  if (!cachedRelease) {
    // Get latest active release from database
    const release = await getLatestActiveRelease(c.env, app.id, channel.id, body.deviceId, body.appVersion);

    if (!release) {
      const response: CheckUpdateResponse = { updateAvailable: false };
      return c.json(response);
    }

    // Cache the result
    cachedRelease = {
      releaseId: release.id,
      version: release.version,
      bundleHash: release.bundle_hash,
      bundleSignature: release.bundle_signature,
      bundleSize: release.bundle_size,
      isMandatory: release.is_mandatory === 1,
      minAppVersion: release.min_app_version,
      maxAppVersion: release.max_app_version,
      releaseNotes: release.release_notes,
    };

    await setCachedLatestRelease(c.env, body.appSlug, body.channel, body.platform, cachedRelease);
  }

  // Check version compatibility
  if (!isAppVersionCompatible(body.appVersion, cachedRelease.minAppVersion, cachedRelease.maxAppVersion)) {
    const response: CheckUpdateResponse = { updateAvailable: false };
    return c.json(response);
  }

  // Check if device should receive update based on rollout
  // (Re-check in case rollout percentage changed since cache)
  const rollout = await c.env.DB.prepare(`
    SELECT percentage FROM rollouts WHERE release_id = ? AND is_active = 1
  `).bind(cachedRelease.releaseId).first<{ percentage: number }>();

  if (!rollout || !shouldReceiveUpdate(body.deviceId, rollout.percentage)) {
    const response: CheckUpdateResponse = { updateAvailable: false };
    return c.json(response);
  }

  // Check if current version is already the latest
  if (body.currentVersion && compareVersions(body.currentVersion, cachedRelease.version) >= 0) {
    const response: CheckUpdateResponse = { updateAvailable: false };
    return c.json(response);
  }

  // Get base URL for bundle
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const response: CheckUpdateResponse = {
    updateAvailable: true,
    release: {
      id: cachedRelease.releaseId,
      version: cachedRelease.version,
      bundleUrl: getBundleUrl(baseUrl, app.id, cachedRelease.releaseId),
      bundleHash: cachedRelease.bundleHash,
      bundleSignature: cachedRelease.bundleSignature,
      bundleSize: cachedRelease.bundleSize,
      isMandatory: cachedRelease.isMandatory,
      releaseNotes: cachedRelease.releaseNotes,
    },
  };

  return c.json(response);
});

// Report update event (public endpoint)
updates.post('/report-event', async (c) => {
  const body = await c.req.json<ReportEventRequest>();

  // Validate required fields
  if (!body.appSlug || !body.deviceId || !body.eventType) {
    return c.json({ error: 'appSlug, deviceId, and eventType are required' }, 400);
  }

  // Validate event type
  const validEventTypes = ['download', 'apply', 'success', 'failure', 'rollback'];
  if (!validEventTypes.includes(body.eventType)) {
    return c.json({ error: `eventType must be one of: ${validEventTypes.join(', ')}` }, 400);
  }

  // Get app by slug
  const app = await c.env.DB.prepare(`
    SELECT id FROM apps WHERE slug = ?
  `).bind(body.appSlug).first<{ id: string }>();

  if (!app) {
    return c.json({ error: 'App not found' }, 404);
  }

  // Record event
  const eventId = 'evt_' + nanoid(16);
  await c.env.DB.prepare(`
    INSERT INTO update_events (id, app_id, release_id, device_id, event_type, app_version, os_version, device_info, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    eventId,
    app.id,
    body.releaseId || null,
    body.deviceId,
    body.eventType,
    body.appVersion || null,
    body.deviceInfo?.osVersion || null,
    body.deviceInfo ? JSON.stringify(body.deviceInfo) : null,
    body.errorMessage || null
  ).run();

  return c.json({ success: true });
});

// Download bundle (public endpoint with integrity verification)
updates.get('/bundles/:appId/:releaseId/bundle.js', async (c) => {
  const appId = c.req.param('appId');
  const releaseId = c.req.param('releaseId');

  // Verify release exists and is active
  const release = await c.env.DB.prepare(`
    SELECT r.bundle_hash FROM releases r
    JOIN rollouts ro ON r.id = ro.release_id
    WHERE r.id = ? AND r.app_id = ?
  `).bind(releaseId, appId).first<{ bundle_hash: string }>();

  if (!release) {
    return c.json({ error: 'Bundle not found' }, 404);
  }

  // Get bundle from R2
  const bundle = await getBundle(c.env, appId, releaseId);

  if (!bundle) {
    return c.json({ error: 'Bundle file not found' }, 404);
  }

  // Return bundle with appropriate headers
  return new Response(bundle.body, {
    headers: {
      'Content-Type': 'application/javascript',
      'Content-Length': bundle.size.toString(),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Bundle-Hash': release.bundle_hash,
    },
  });
});

export default updates;
