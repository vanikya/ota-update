import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { Env, App, AuthContext, CreateAppRequest } from '../types';
import { authMiddleware, getAuth } from '../middleware/auth';

const apps = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

// Apply auth middleware to all routes
apps.use('*', authMiddleware());

// List all apps for the organization
apps.get('/', async (c) => {
  const auth = getAuth(c);

  const result = await c.env.DB.prepare(`
    SELECT * FROM apps WHERE organization_id = ? ORDER BY created_at DESC
  `).bind(auth.organizationId).all<App>();

  return c.json({ apps: result.results || [] });
});

// Create a new app
apps.post('/', async (c) => {
  const auth = getAuth(c);

  if (auth.permissions === 'read') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const body = await c.req.json<CreateAppRequest>();

  if (!body.name || !body.slug || !body.platform) {
    return c.json({ error: 'name, slug, and platform are required' }, 400);
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(body.slug)) {
    return c.json({ error: 'slug must contain only lowercase letters, numbers, and hyphens' }, 400);
  }

  // Validate platform
  if (!['ios', 'android', 'both'].includes(body.platform)) {
    return c.json({ error: 'platform must be ios, android, or both' }, 400);
  }

  // Check if slug already exists
  const existing = await c.env.DB.prepare(
    'SELECT id FROM apps WHERE slug = ?'
  ).bind(body.slug).first();

  if (existing) {
    return c.json({ error: 'An app with this slug already exists' }, 409);
  }

  const id = 'app_' + nanoid(16);

  await c.env.DB.prepare(`
    INSERT INTO apps (id, organization_id, name, slug, platform, signing_public_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    auth.organizationId,
    body.name,
    body.slug,
    body.platform,
    body.signingPublicKey || null
  ).run();

  // Create default channels
  const productionChannelId = 'ch_' + nanoid(16);
  const stagingChannelId = 'ch_' + nanoid(16);

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO channels (id, app_id, name) VALUES (?, ?, ?)'
    ).bind(productionChannelId, id, 'production'),
    c.env.DB.prepare(
      'INSERT INTO channels (id, app_id, name) VALUES (?, ?, ?)'
    ).bind(stagingChannelId, id, 'staging'),
  ]);

  const app = await c.env.DB.prepare(
    'SELECT * FROM apps WHERE id = ?'
  ).bind(id).first<App>();

  return c.json({ app }, 201);
});

// Get a single app
apps.get('/:appId', async (c) => {
  const auth = getAuth(c);
  const appId = c.req.param('appId');

  const app = await c.env.DB.prepare(`
    SELECT * FROM apps WHERE id = ? AND organization_id = ?
  `).bind(appId, auth.organizationId).first<App>();

  if (!app) {
    return c.json({ error: 'App not found' }, 404);
  }

  // Get channels for this app
  const channels = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE app_id = ? ORDER BY name'
  ).bind(appId).all();

  // Get recent releases count
  const releaseCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM releases WHERE app_id = ?'
  ).bind(appId).first<{ count: number }>();

  return c.json({
    app,
    channels: channels.results || [],
    releaseCount: releaseCount?.count || 0,
  });
});

// Update an app
apps.patch('/:appId', async (c) => {
  const auth = getAuth(c);
  const appId = c.req.param('appId');

  if (auth.permissions === 'read') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const app = await c.env.DB.prepare(`
    SELECT * FROM apps WHERE id = ? AND organization_id = ?
  `).bind(appId, auth.organizationId).first<App>();

  if (!app) {
    return c.json({ error: 'App not found' }, 404);
  }

  const body = await c.req.json<Partial<CreateAppRequest>>();

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (body.name) {
    updates.push('name = ?');
    values.push(body.name);
  }

  if (body.signingPublicKey !== undefined) {
    updates.push('signing_public_key = ?');
    values.push(body.signingPublicKey || null);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  values.push(appId);

  await c.env.DB.prepare(`
    UPDATE apps SET ${updates.join(', ')} WHERE id = ?
  `).bind(...values).run();

  const updatedApp = await c.env.DB.prepare(
    'SELECT * FROM apps WHERE id = ?'
  ).bind(appId).first<App>();

  return c.json({ app: updatedApp });
});

// Delete an app
apps.delete('/:appId', async (c) => {
  const auth = getAuth(c);
  const appId = c.req.param('appId');

  if (auth.permissions !== 'full') {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const app = await c.env.DB.prepare(`
    SELECT * FROM apps WHERE id = ? AND organization_id = ?
  `).bind(appId, auth.organizationId).first<App>();

  if (!app) {
    return c.json({ error: 'App not found' }, 404);
  }

  // Delete app (cascades to channels, releases, rollouts due to FK constraints)
  await c.env.DB.prepare('DELETE FROM apps WHERE id = ?').bind(appId).run();

  // Clean up R2 bundles
  const prefix = `bundles/${appId}/`;
  const listed = await c.env.BUNDLES.list({ prefix });
  for (const object of listed.objects) {
    await c.env.BUNDLES.delete(object.key);
  }

  return c.json({ success: true });
});

export default apps;
