import { Hono } from 'hono';
import type { Env, AuthContext } from '../types';
import { authMiddleware, appAccessMiddleware } from '../middleware/auth';

const analytics = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

// Apply auth middleware to all routes
analytics.use('*', authMiddleware(['read', 'deploy', 'full']));
analytics.use('*', appAccessMiddleware());

// Get analytics overview for an app
analytics.get('/', async (c) => {
  const appId = c.req.param('appId')!;
  const days = parseInt(c.req.query('days') || '7', 10);
  const releaseId = c.req.query('releaseId');

  const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

  // Build base query
  let baseCondition = 'app_id = ? AND created_at >= ?';
  const baseParams: (string | number)[] = [appId, since];

  if (releaseId) {
    baseCondition += ' AND release_id = ?';
    baseParams.push(releaseId);
  }

  // Get event counts by type
  const eventCounts = await c.env.DB.prepare(`
    SELECT event_type, COUNT(*) as count
    FROM update_events
    WHERE ${baseCondition}
    GROUP BY event_type
  `).bind(...baseParams).all<{ event_type: string; count: number }>();

  // Get unique devices
  const uniqueDevices = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT device_id) as count
    FROM update_events
    WHERE ${baseCondition}
  `).bind(...baseParams).first<{ count: number }>();

  // Get daily breakdown
  const dailyStats = await c.env.DB.prepare(`
    SELECT
      date(created_at, 'unixepoch') as date,
      event_type,
      COUNT(*) as count
    FROM update_events
    WHERE ${baseCondition}
    GROUP BY date, event_type
    ORDER BY date DESC
  `).bind(...baseParams).all<{ date: string; event_type: string; count: number }>();

  // Calculate success rate
  const successCount = eventCounts.results?.find(e => e.event_type === 'success')?.count || 0;
  const failureCount = eventCounts.results?.find(e => e.event_type === 'failure')?.count || 0;
  const totalAttempts = successCount + failureCount;
  const successRate = totalAttempts > 0 ? (successCount / totalAttempts) * 100 : null;

  // Get error breakdown if there are failures
  let errorBreakdown: { error_message: string; count: number }[] = [];
  if (failureCount > 0) {
    const errors = await c.env.DB.prepare(`
      SELECT error_message, COUNT(*) as count
      FROM update_events
      WHERE ${baseCondition} AND event_type = 'failure' AND error_message IS NOT NULL
      GROUP BY error_message
      ORDER BY count DESC
      LIMIT 10
    `).bind(...baseParams).all<{ error_message: string; count: number }>();
    errorBreakdown = errors.results || [];
  }

  // Get app version breakdown
  const appVersions = await c.env.DB.prepare(`
    SELECT app_version, COUNT(DISTINCT device_id) as device_count
    FROM update_events
    WHERE ${baseCondition} AND app_version IS NOT NULL
    GROUP BY app_version
    ORDER BY device_count DESC
    LIMIT 20
  `).bind(...baseParams).all<{ app_version: string; device_count: number }>();

  return c.json({
    period: {
      days,
      since: new Date(since * 1000).toISOString(),
    },
    summary: {
      uniqueDevices: uniqueDevices?.count || 0,
      eventCounts: Object.fromEntries(
        (eventCounts.results || []).map(e => [e.event_type, e.count])
      ),
      successRate: successRate !== null ? Math.round(successRate * 100) / 100 : null,
    },
    daily: dailyStats.results || [],
    errorBreakdown,
    appVersions: appVersions.results || [],
  });
});

// Get analytics for a specific release
analytics.get('/releases/:releaseId', async (c) => {
  const appId = c.req.param('appId')!;
  const releaseId = c.req.param('releaseId')!;

  // Verify release belongs to app
  const release = await c.env.DB.prepare(`
    SELECT r.*, ch.name as channel_name
    FROM releases r
    LEFT JOIN channels ch ON r.channel_id = ch.id
    WHERE r.id = ? AND r.app_id = ?
  `).bind(releaseId, appId).first();

  if (!release) {
    return c.json({ error: 'Release not found' }, 404);
  }

  // Get funnel metrics
  const funnel = await c.env.DB.prepare(`
    SELECT event_type, COUNT(DISTINCT device_id) as unique_devices, COUNT(*) as total_events
    FROM update_events
    WHERE release_id = ?
    GROUP BY event_type
  `).bind(releaseId).all<{ event_type: string; unique_devices: number; total_events: number }>();

  // Get adoption over time
  const adoption = await c.env.DB.prepare(`
    SELECT
      date(created_at, 'unixepoch') as date,
      COUNT(DISTINCT CASE WHEN event_type = 'success' THEN device_id END) as successful_devices
    FROM update_events
    WHERE release_id = ?
    GROUP BY date
    ORDER BY date
  `).bind(releaseId).all<{ date: string; successful_devices: number }>();

  // Get device OS breakdown
  const osBreakdown = await c.env.DB.prepare(`
    SELECT os_version, COUNT(DISTINCT device_id) as device_count
    FROM update_events
    WHERE release_id = ? AND os_version IS NOT NULL
    GROUP BY os_version
    ORDER BY device_count DESC
    LIMIT 10
  `).bind(releaseId).all<{ os_version: string; device_count: number }>();

  return c.json({
    release,
    funnel: Object.fromEntries(
      (funnel.results || []).map(f => [f.event_type, {
        uniqueDevices: f.unique_devices,
        totalEvents: f.total_events,
      }])
    ),
    adoptionOverTime: adoption.results || [],
    osBreakdown: osBreakdown.results || [],
  });
});

// Get devices that failed to update
analytics.get('/failures', async (c) => {
  const appId = c.req.param('appId')!;
  const releaseId = c.req.query('releaseId');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  let query = `
    SELECT device_id, release_id, error_message, app_version, os_version, device_info, created_at
    FROM update_events
    WHERE app_id = ? AND event_type = 'failure'
  `;
  const params: (string | number)[] = [appId];

  if (releaseId) {
    query += ' AND release_id = ?';
    params.push(releaseId);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const failures = await c.env.DB.prepare(query).bind(...params).all();

  // Get total count
  let countQuery = 'SELECT COUNT(*) as count FROM update_events WHERE app_id = ? AND event_type = \'failure\'';
  const countParams: (string | number)[] = [appId];
  if (releaseId) {
    countQuery += ' AND release_id = ?';
    countParams.push(releaseId);
  }
  const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>();

  return c.json({
    failures: failures.results || [],
    total: countResult?.count || 0,
    limit,
    offset,
  });
});

export default analytics;
