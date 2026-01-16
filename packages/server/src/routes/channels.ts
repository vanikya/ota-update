import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { Env, Channel, AuthContext, CreateChannelRequest } from '../types';
import { authMiddleware, getAuth, appAccessMiddleware } from '../middleware/auth';

const channels = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

// Apply auth middleware to all routes
channels.use('*', authMiddleware());
channels.use('*', appAccessMiddleware());

// List all channels for an app
channels.get('/', async (c) => {
  const appId = c.req.param('appId');

  const result = await c.env.DB.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM releases WHERE channel_id = c.id) as release_count,
           (SELECT version FROM releases WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1) as latest_version
    FROM channels c
    WHERE c.app_id = ?
    ORDER BY c.name
  `).bind(appId).all();

  return c.json({ channels: result.results || [] });
});

// Create a new channel
channels.post('/', async (c) => {
  const auth = getAuth(c);
  const appId = c.req.param('appId');

  if (auth.permissions === 'read') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const body = await c.req.json<CreateChannelRequest>();

  if (!body.name) {
    return c.json({ error: 'name is required' }, 400);
  }

  // Validate channel name format
  if (!/^[a-z0-9-]+$/.test(body.name)) {
    return c.json({ error: 'Channel name must contain only lowercase letters, numbers, and hyphens' }, 400);
  }

  // Check if channel already exists
  const existing = await c.env.DB.prepare(
    'SELECT id FROM channels WHERE app_id = ? AND name = ?'
  ).bind(appId, body.name).first();

  if (existing) {
    return c.json({ error: 'A channel with this name already exists for this app' }, 409);
  }

  const id = 'ch_' + nanoid(16);

  await c.env.DB.prepare(`
    INSERT INTO channels (id, app_id, name) VALUES (?, ?, ?)
  `).bind(id, appId, body.name).run();

  const channel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE id = ?'
  ).bind(id).first<Channel>();

  return c.json({ channel }, 201);
});

// Get a single channel
channels.get('/:channelId', async (c) => {
  const appId = c.req.param('appId');
  const channelId = c.req.param('channelId');

  const channel = await c.env.DB.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM releases WHERE channel_id = c.id) as release_count
    FROM channels c
    WHERE c.id = ? AND c.app_id = ?
  `).bind(channelId, appId).first();

  if (!channel) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  // Get recent releases for this channel
  const releases = await c.env.DB.prepare(`
    SELECT r.*, ro.percentage as rollout_percentage, ro.is_active as rollout_active
    FROM releases r
    LEFT JOIN rollouts ro ON r.id = ro.release_id
    WHERE r.channel_id = ?
    ORDER BY r.created_at DESC
    LIMIT 10
  `).bind(channelId).all();

  return c.json({
    channel,
    recentReleases: releases.results || [],
  });
});

// Update a channel (rename)
channels.patch('/:channelId', async (c) => {
  const auth = getAuth(c);
  const appId = c.req.param('appId');
  const channelId = c.req.param('channelId');

  if (auth.permissions === 'read') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const channel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE id = ? AND app_id = ?'
  ).bind(channelId, appId).first<Channel>();

  if (!channel) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  const body = await c.req.json<{ name?: string }>();

  if (!body.name) {
    return c.json({ error: 'name is required' }, 400);
  }

  // Validate channel name format
  if (!/^[a-z0-9-]+$/.test(body.name)) {
    return c.json({ error: 'Channel name must contain only lowercase letters, numbers, and hyphens' }, 400);
  }

  // Check if new name already exists
  const existing = await c.env.DB.prepare(
    'SELECT id FROM channels WHERE app_id = ? AND name = ? AND id != ?'
  ).bind(appId, body.name, channelId).first();

  if (existing) {
    return c.json({ error: 'A channel with this name already exists' }, 409);
  }

  await c.env.DB.prepare(
    'UPDATE channels SET name = ? WHERE id = ?'
  ).bind(body.name, channelId).run();

  const updatedChannel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE id = ?'
  ).bind(channelId).first<Channel>();

  return c.json({ channel: updatedChannel });
});

// Delete a channel
channels.delete('/:channelId', async (c) => {
  const auth = getAuth(c);
  const appId = c.req.param('appId');
  const channelId = c.req.param('channelId');

  if (auth.permissions !== 'full') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const channel = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE id = ? AND app_id = ?'
  ).bind(channelId, appId).first<Channel>();

  if (!channel) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  // Prevent deleting production channel
  if (channel.name === 'production') {
    return c.json({ error: 'Cannot delete the production channel' }, 400);
  }

  // Get all releases for this channel to clean up R2
  const releases = await c.env.DB.prepare(
    'SELECT id FROM releases WHERE channel_id = ?'
  ).bind(channelId).all<{ id: string }>();

  // Delete channel (cascades to releases and rollouts)
  await c.env.DB.prepare('DELETE FROM channels WHERE id = ?').bind(channelId).run();

  // Clean up R2 bundles for all releases
  for (const release of releases.results || []) {
    const prefix = `bundles/${appId}/${release.id}/`;
    const listed = await c.env.BUNDLES.list({ prefix });
    for (const object of listed.objects) {
      await c.env.BUNDLES.delete(object.key);
    }
  }

  return c.json({ success: true });
});

export default channels;
