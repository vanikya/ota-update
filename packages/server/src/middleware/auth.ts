import { Context, MiddlewareHandler } from 'hono';
import type { Env, AuthContext, ApiKey } from '../types';

// Hash API key using SHA-256
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a new API key
export async function generateApiKey(): Promise<{ key: string; hash: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const key = 'ota_' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await hashApiKey(key);
  return { key, hash };
}

// Authentication middleware
export function authMiddleware(requiredPermissions?: ('full' | 'read' | 'deploy')[]): MiddlewareHandler<{ Bindings: Env; Variables: { auth: AuthContext } }> {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const apiKey = authHeader.substring(7);
    const keyHash = await hashApiKey(apiKey);

    // Look up API key in database
    const result = await c.env.DB.prepare(
      'SELECT id, organization_id, permissions FROM api_keys WHERE key_hash = ?'
    ).bind(keyHash).first<Pick<ApiKey, 'id' | 'organization_id' | 'permissions'>>();

    if (!result) {
      return c.json({ error: 'Invalid API key' }, 401);
    }

    // Check permissions if required
    if (requiredPermissions && requiredPermissions.length > 0) {
      if (!requiredPermissions.includes(result.permissions) && result.permissions !== 'full') {
        return c.json({ error: 'Insufficient permissions' }, 403);
      }
    }

    // Update last_used_at
    await c.env.DB.prepare(
      'UPDATE api_keys SET last_used_at = unixepoch() WHERE id = ?'
    ).bind(result.id).run();

    // Set auth context
    c.set('auth', {
      organizationId: result.organization_id,
      apiKeyId: result.id,
      permissions: result.permissions,
    });

    await next();
  };
}

// Get auth context from Hono context
export function getAuth(c: Context<{ Variables: { auth: AuthContext } }>): AuthContext {
  return c.get('auth');
}

// Check if user has permission for an app
export async function checkAppAccess(
  c: Context<{ Bindings: Env; Variables: { auth: AuthContext } }>,
  appId: string
): Promise<boolean> {
  const auth = getAuth(c);
  const app = await c.env.DB.prepare(
    'SELECT organization_id FROM apps WHERE id = ?'
  ).bind(appId).first<{ organization_id: string }>();

  return app !== null && app.organization_id === auth.organizationId;
}

// Middleware to verify app ownership
export function appAccessMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: { auth: AuthContext } }> {
  return async (c, next) => {
    const appId = c.req.param('appId');
    if (!appId) {
      return c.json({ error: 'App ID required' }, 400);
    }

    const hasAccess = await checkAppAccess(c, appId);
    if (!hasAccess) {
      return c.json({ error: 'App not found or access denied' }, 404);
    }

    await next();
  };
}
