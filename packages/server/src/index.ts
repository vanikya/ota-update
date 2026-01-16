import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { nanoid } from 'nanoid';
import type { Env, AuthContext, Organization } from './types';
import { generateApiKey } from './middleware/auth';
import apps from './routes/apps';
import channels from './routes/channels';
import releases from './routes/releases';
import updates from './routes/updates';
import analytics from './routes/analytics';

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors());
app.use('*', logger());

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'OTA Update Server',
    version: '0.1.0',
    status: 'healthy',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Public API routes (no auth required)
app.route('/api/v1', updates);

// Organization management (bootstrap)
app.post('/api/v1/organizations', async (c) => {
  const body = await c.req.json<{ name: string }>();

  if (!body.name) {
    return c.json({ error: 'name is required' }, 400);
  }

  const orgId = 'org_' + nanoid(16);

  // Create organization
  await c.env.DB.prepare(`
    INSERT INTO organizations (id, name) VALUES (?, ?)
  `).bind(orgId, body.name).run();

  // Generate API key
  const { key, hash } = await generateApiKey();
  const apiKeyId = 'key_' + nanoid(16);

  await c.env.DB.prepare(`
    INSERT INTO api_keys (id, organization_id, key_hash, name, permissions)
    VALUES (?, ?, ?, 'Default API Key', 'full')
  `).bind(apiKeyId, orgId, hash).run();

  const org = await c.env.DB.prepare(
    'SELECT * FROM organizations WHERE id = ?'
  ).bind(orgId).first<Organization>();

  return c.json({
    organization: org,
    apiKey: key,
    warning: 'Save this API key securely. It will not be shown again.',
  }, 201);
});

// Generate additional API key for an organization (requires existing key)
app.post('/api/v1/api-keys', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const providedKey = authHeader.substring(7);

  // Hash and verify
  const encoder = new TextEncoder();
  const data = encoder.encode(providedKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const existingKey = await c.env.DB.prepare(
    'SELECT organization_id, permissions FROM api_keys WHERE key_hash = ?'
  ).bind(keyHash).first<{ organization_id: string; permissions: string }>();

  if (!existingKey || existingKey.permissions !== 'full') {
    return c.json({ error: 'Invalid API key or insufficient permissions' }, 401);
  }

  const body = await c.req.json<{ name?: string; permissions?: 'full' | 'read' | 'deploy' }>();

  const { key, hash } = await generateApiKey();
  const apiKeyId = 'key_' + nanoid(16);

  await c.env.DB.prepare(`
    INSERT INTO api_keys (id, organization_id, key_hash, name, permissions)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    apiKeyId,
    existingKey.organization_id,
    hash,
    body.name || 'API Key',
    body.permissions || 'full'
  ).run();

  return c.json({
    apiKey: key,
    id: apiKeyId,
    permissions: body.permissions || 'full',
    warning: 'Save this API key securely. It will not be shown again.',
  }, 201);
});

// List API keys for organization (shows metadata only, not keys)
app.get('/api/v1/api-keys', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const providedKey = authHeader.substring(7);

  // Hash and verify
  const encoder = new TextEncoder();
  const data = encoder.encode(providedKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const existingKey = await c.env.DB.prepare(
    'SELECT organization_id FROM api_keys WHERE key_hash = ?'
  ).bind(keyHash).first<{ organization_id: string }>();

  if (!existingKey) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  const keys = await c.env.DB.prepare(`
    SELECT id, name, permissions, created_at, last_used_at
    FROM api_keys
    WHERE organization_id = ?
    ORDER BY created_at DESC
  `).bind(existingKey.organization_id).all();

  return c.json({ apiKeys: keys.results || [] });
});

// Delete API key
app.delete('/api/v1/api-keys/:keyId', async (c) => {
  const authHeader = c.req.header('Authorization');
  const keyIdToDelete = c.req.param('keyId');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const providedKey = authHeader.substring(7);

  // Hash and verify
  const encoder = new TextEncoder();
  const data = encoder.encode(providedKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  const existingKey = await c.env.DB.prepare(
    'SELECT id, organization_id, permissions FROM api_keys WHERE key_hash = ?'
  ).bind(keyHash).first<{ id: string; organization_id: string; permissions: string }>();

  if (!existingKey || existingKey.permissions !== 'full') {
    return c.json({ error: 'Invalid API key or insufficient permissions' }, 401);
  }

  // Prevent deleting the key being used
  if (existingKey.id === keyIdToDelete) {
    return c.json({ error: 'Cannot delete the API key you are using' }, 400);
  }

  // Verify key belongs to same organization
  const keyToDelete = await c.env.DB.prepare(
    'SELECT organization_id FROM api_keys WHERE id = ?'
  ).bind(keyIdToDelete).first<{ organization_id: string }>();

  if (!keyToDelete || keyToDelete.organization_id !== existingKey.organization_id) {
    return c.json({ error: 'API key not found' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(keyIdToDelete).run();

  return c.json({ success: true });
});

// Authenticated API routes
const authenticatedRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();
authenticatedRoutes.route('/apps', apps);
authenticatedRoutes.route('/apps/:appId/channels', channels);
authenticatedRoutes.route('/apps/:appId/releases', releases);
authenticatedRoutes.route('/apps/:appId/analytics', analytics);

app.route('/api/v1', authenticatedRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
