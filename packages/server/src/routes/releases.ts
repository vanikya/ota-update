import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { Env, Release, AuthContext, CreateReleaseRequest, App, Channel } from '../types';
import { authMiddleware, getAuth, appAccessMiddleware } from '../middleware/auth';
import { uploadBundle, uploadSourceMap, uploadManifest, calculateBundleHash, deleteBundle, getBundleUrl } from '../services/storage';
import { createRollout, updateRolloutPercentage, deactivatePreviousRollouts, rollbackToRelease, getRolloutStatus } from '../services/rollout';
import { invalidateLatestReleaseCache } from '../services/cache';

const releases = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

// Apply auth middleware to all routes
releases.use('*', authMiddleware());
releases.use('*', appAccessMiddleware());

// List releases for an app
releases.get('/', async (c) => {
  const appId = c.req.param('appId');
  const channelName = c.req.query('channel');
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  let query = `
    SELECT r.*, ro.percentage as rollout_percentage, ro.is_active as rollout_active, ch.name as channel_name
    FROM releases r
    LEFT JOIN rollouts ro ON r.id = ro.release_id
    LEFT JOIN channels ch ON r.channel_id = ch.id
    WHERE r.app_id = ?
  `;
  const params: (string | number)[] = [appId];

  if (channelName) {
    query += ' AND ch.name = ?';
    params.push(channelName);
  }

  query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = await c.env.DB.prepare(query).bind(...params).all();

  // Get total count
  let countQuery = 'SELECT COUNT(*) as count FROM releases r LEFT JOIN channels ch ON r.channel_id = ch.id WHERE r.app_id = ?';
  const countParams: string[] = [appId];
  if (channelName) {
    countQuery += ' AND ch.name = ?';
    countParams.push(channelName);
  }
  const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>();

  return c.json({
    releases: result.results || [],
    total: countResult?.count || 0,
    limit,
    offset,
  });
});

// Create a new release (upload bundle)
releases.post('/', async (c) => {
  const auth = getAuth(c);
  const appId = c.req.param('appId');

  if (auth.permissions === 'read') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  // Get app info
  const app = await c.env.DB.prepare(
    'SELECT * FROM apps WHERE id = ?'
  ).bind(appId).first<App>();

  if (!app) {
    return c.json({ error: 'App not found' }, 404);
  }

  // Parse multipart form data
  const formData = await c.req.formData();
  const bundleFile = formData.get('bundle') as File | null;
  const sourceMapFile = formData.get('sourceMap') as File | null;
  const metadataStr = formData.get('metadata') as string | null;

  if (!bundleFile) {
    return c.json({ error: 'bundle file is required' }, 400);
  }

  let metadata: CreateReleaseRequest;
  try {
    metadata = metadataStr ? JSON.parse(metadataStr) : {};
  } catch {
    return c.json({ error: 'Invalid metadata JSON' }, 400);
  }

  if (!metadata.version || !metadata.channelName) {
    return c.json({ error: 'version and channelName are required in metadata' }, 400);
  }

  // Get channel
  const channel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE app_id = ? AND name = ?'
  ).bind(appId, metadata.channelName).first<Channel>();

  if (!channel) {
    return c.json({ error: `Channel '${metadata.channelName}' not found` }, 404);
  }

  // Check if version already exists for this channel
  const existingRelease = await c.env.DB.prepare(
    'SELECT id FROM releases WHERE app_id = ? AND channel_id = ? AND version = ?'
  ).bind(appId, channel.id, metadata.version).first();

  if (existingRelease) {
    return c.json({ error: `Version ${metadata.version} already exists for this channel` }, 409);
  }

  // Read bundle data
  const bundleData = await bundleFile.arrayBuffer();
  const bundleHash = await calculateBundleHash(bundleData);

  // Get signature from form data if provided
  const bundleSignature = formData.get('signature') as string | null;

  // Generate release ID
  const releaseId = 'rel_' + nanoid(16);

  // Upload bundle to R2
  const bundleKey = await uploadBundle(c.env, appId, releaseId, bundleData);

  // Upload source map if provided
  if (sourceMapFile) {
    const sourceMapData = await sourceMapFile.arrayBuffer();
    await uploadSourceMap(c.env, appId, releaseId, sourceMapData);
  }

  // Upload manifest
  await uploadManifest(c.env, appId, releaseId, {
    releaseId,
    version: metadata.version,
    bundleHash,
    bundleSize: bundleData.byteLength,
    createdAt: Date.now(),
  });

  // Insert release into database
  await c.env.DB.prepare(`
    INSERT INTO releases (
      id, app_id, channel_id, version, bundle_id, bundle_hash, bundle_signature,
      bundle_size, min_app_version, max_app_version, is_mandatory, release_notes,
      metadata, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    releaseId,
    appId,
    channel.id,
    metadata.version,
    bundleKey,
    bundleHash,
    bundleSignature,
    bundleData.byteLength,
    metadata.minAppVersion || null,
    metadata.maxAppVersion || null,
    metadata.isMandatory ? 1 : 0,
    metadata.releaseNotes || null,
    metadata.metadata ? JSON.stringify(metadata.metadata) : null,
    auth.apiKeyId
  ).run();

  // Create rollout (default 100%)
  const rolloutId = 'ro_' + nanoid(16);
  await createRollout(c.env, rolloutId, releaseId, 100);

  // Deactivate previous rollouts for this channel
  await deactivatePreviousRollouts(c.env, appId, channel.id, releaseId);

  // Invalidate cache
  await invalidateLatestReleaseCache(c.env, app.slug, channel.name);

  const release = await c.env.DB.prepare(`
    SELECT r.*, ro.percentage as rollout_percentage, ro.is_active as rollout_active
    FROM releases r
    LEFT JOIN rollouts ro ON r.id = ro.release_id
    WHERE r.id = ?
  `).bind(releaseId).first();

  return c.json({ release }, 201);
});

// Get a single release
releases.get('/:releaseId', async (c) => {
  const appId = c.req.param('appId');
  const releaseId = c.req.param('releaseId');

  const release = await c.env.DB.prepare(`
    SELECT r.*, ro.percentage as rollout_percentage, ro.is_active as rollout_active,
           ch.name as channel_name
    FROM releases r
    LEFT JOIN rollouts ro ON r.id = ro.release_id
    LEFT JOIN channels ch ON r.channel_id = ch.id
    WHERE r.id = ? AND r.app_id = ?
  `).bind(releaseId, appId).first();

  if (!release) {
    return c.json({ error: 'Release not found' }, 404);
  }

  // Get analytics summary
  const analytics = await c.env.DB.prepare(`
    SELECT event_type, COUNT(*) as count
    FROM update_events
    WHERE release_id = ?
    GROUP BY event_type
  `).bind(releaseId).all();

  return c.json({
    release,
    analytics: analytics.results || [],
  });
});

// Update rollout percentage
releases.patch('/:releaseId/rollout', async (c) => {
  const auth = getAuth(c);
  const appId = c.req.param('appId');
  const releaseId = c.req.param('releaseId');

  if (auth.permissions === 'read') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const release = await c.env.DB.prepare(`
    SELECT r.*, ch.name as channel_name
    FROM releases r
    LEFT JOIN channels ch ON r.channel_id = ch.id
    WHERE r.id = ? AND r.app_id = ?
  `).bind(releaseId, appId).first<Release & { channel_name: string }>();

  if (!release) {
    return c.json({ error: 'Release not found' }, 404);
  }

  const body = await c.req.json<{ percentage: number }>();

  if (typeof body.percentage !== 'number' || body.percentage < 0 || body.percentage > 100) {
    return c.json({ error: 'percentage must be a number between 0 and 100' }, 400);
  }

  await updateRolloutPercentage(c.env, releaseId, body.percentage);

  // Get app slug for cache invalidation
  const app = await c.env.DB.prepare(
    'SELECT slug FROM apps WHERE id = ?'
  ).bind(appId).first<{ slug: string }>();

  if (app) {
    await invalidateLatestReleaseCache(c.env, app.slug, release.channel_name);
  }

  const rollout = await getRolloutStatus(c.env, releaseId);

  return c.json({ rollout });
});

// Rollback to a previous release
releases.post('/:releaseId/rollback', async (c) => {
  const auth = getAuth(c);
  const appId = c.req.param('appId');
  const releaseId = c.req.param('releaseId');

  if (auth.permissions === 'read') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const release = await c.env.DB.prepare(`
    SELECT r.*, ch.name as channel_name
    FROM releases r
    LEFT JOIN channels ch ON r.channel_id = ch.id
    WHERE r.id = ? AND r.app_id = ?
  `).bind(releaseId, appId).first<Release & { channel_name: string }>();

  if (!release) {
    return c.json({ error: 'Release not found' }, 404);
  }

  await rollbackToRelease(c.env, appId, release.channel_id, releaseId);

  // Get app slug for cache invalidation
  const app = await c.env.DB.prepare(
    'SELECT slug FROM apps WHERE id = ?'
  ).bind(appId).first<{ slug: string }>();

  if (app) {
    await invalidateLatestReleaseCache(c.env, app.slug, release.channel_name);
  }

  return c.json({
    success: true,
    message: `Rolled back to version ${release.version}`,
  });
});

// Delete a release
releases.delete('/:releaseId', async (c) => {
  const auth = getAuth(c);
  const appId = c.req.param('appId');
  const releaseId = c.req.param('releaseId');

  if (auth.permissions !== 'full') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const release = await c.env.DB.prepare(`
    SELECT r.*, ch.name as channel_name
    FROM releases r
    LEFT JOIN channels ch ON r.channel_id = ch.id
    WHERE r.id = ? AND r.app_id = ?
  `).bind(releaseId, appId).first<Release & { channel_name: string }>();

  if (!release) {
    return c.json({ error: 'Release not found' }, 404);
  }

  // Check if this is the only active release
  const activeRollouts = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM rollouts ro
    JOIN releases r ON ro.release_id = r.id
    WHERE r.channel_id = ? AND ro.is_active = 1
  `).bind(release.channel_id).first<{ count: number }>();

  if (activeRollouts && activeRollouts.count === 1) {
    // Check if the release being deleted is the active one
    const currentRollout = await getRolloutStatus(c.env, releaseId);
    if (currentRollout && currentRollout.is_active) {
      return c.json({
        error: 'Cannot delete the only active release. Deploy a new version or rollback first.',
      }, 400);
    }
  }

  // Delete from database (cascades to rollout)
  await c.env.DB.prepare('DELETE FROM releases WHERE id = ?').bind(releaseId).run();

  // Delete from R2
  await deleteBundle(c.env, appId, releaseId);

  // Invalidate cache
  const app = await c.env.DB.prepare(
    'SELECT slug FROM apps WHERE id = ?'
  ).bind(appId).first<{ slug: string }>();

  if (app) {
    await invalidateLatestReleaseCache(c.env, app.slug, release.channel_name);
  }

  return c.json({ success: true });
});

export default releases;
