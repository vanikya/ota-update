-- OTA Update System Database Schema
-- Cloudflare D1 (SQLite)

-- Organizations/Teams
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

-- API Keys for authentication
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  name TEXT,
  permissions TEXT DEFAULT 'full' CHECK (permissions IN ('full', 'read', 'deploy')),
  created_at INTEGER DEFAULT (unixepoch()),
  last_used_at INTEGER,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Apps
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'both')),
  signing_public_key TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Channels (production, staging, beta, etc.)
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(app_id, name),
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);

-- Releases
CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  version TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  bundle_signature TEXT,
  bundle_size INTEGER NOT NULL,
  min_app_version TEXT,
  max_app_version TEXT,
  is_mandatory INTEGER DEFAULT 0,
  release_notes TEXT,
  metadata TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  created_by TEXT,
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES api_keys(id) ON DELETE SET NULL
);

-- Rollout configuration
CREATE TABLE IF NOT EXISTS rollouts (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL UNIQUE,
  percentage INTEGER DEFAULT 100 CHECK (percentage >= 0 AND percentage <= 100),
  is_active INTEGER DEFAULT 1,
  started_at INTEGER DEFAULT (unixepoch()),
  completed_at INTEGER,
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
);

-- Update events for analytics
CREATE TABLE IF NOT EXISTS update_events (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  release_id TEXT,
  device_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('check', 'download', 'apply', 'success', 'failure', 'rollback')),
  app_version TEXT,
  os_version TEXT,
  device_info TEXT,
  error_message TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_apps_org ON apps(organization_id);
CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug);
CREATE INDEX IF NOT EXISTS idx_channels_app ON channels(app_id);
CREATE INDEX IF NOT EXISTS idx_releases_app_channel ON releases(app_id, channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_releases_channel ON releases(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rollouts_release ON rollouts(release_id, is_active);
CREATE INDEX IF NOT EXISTS idx_events_app ON update_events(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_release ON update_events(release_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_device ON update_events(device_id, created_at DESC);
