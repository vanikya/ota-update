// Cloudflare bindings
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  BUNDLES: R2Bucket;
  ENVIRONMENT: string;
}

// Database models
export interface Organization {
  id: string;
  name: string;
  created_at: number;
}

export interface ApiKey {
  id: string;
  organization_id: string;
  key_hash: string;
  name: string | null;
  permissions: 'full' | 'read' | 'deploy';
  created_at: number;
  last_used_at: number | null;
}

export interface App {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  platform: 'ios' | 'android' | 'both';
  signing_public_key: string | null;
  created_at: number;
}

export interface Channel {
  id: string;
  app_id: string;
  name: string;
  created_at: number;
}

export interface Release {
  id: string;
  app_id: string;
  channel_id: string;
  version: string;
  bundle_id: string;
  bundle_hash: string;
  bundle_signature: string | null;
  bundle_size: number;
  min_app_version: string | null;
  max_app_version: string | null;
  is_mandatory: number;
  release_notes: string | null;
  metadata: string | null;
  created_at: number;
  created_by: string | null;
}

export interface Rollout {
  id: string;
  release_id: string;
  percentage: number;
  is_active: number;
  started_at: number;
  completed_at: number | null;
}

export interface UpdateEvent {
  id: string;
  app_id: string;
  release_id: string | null;
  device_id: string;
  event_type: 'check' | 'download' | 'apply' | 'success' | 'failure' | 'rollback';
  app_version: string | null;
  os_version: string | null;
  device_info: string | null;
  error_message: string | null;
  created_at: number;
}

// API request/response types
export interface CheckUpdateRequest {
  appSlug: string;
  channel: string;
  platform: 'ios' | 'android';
  currentVersion: string | null;
  appVersion: string;
  deviceId: string;
  deviceInfo?: {
    os: string;
    osVersion: string;
    [key: string]: unknown;
  };
}

export interface CheckUpdateResponse {
  updateAvailable: boolean;
  release?: {
    id: string;
    version: string;
    bundleUrl: string;
    bundleHash: string;
    bundleSignature: string | null;
    bundleSize: number;
    isMandatory: boolean;
    releaseNotes: string | null;
  };
}

export interface ReportEventRequest {
  appSlug: string;
  releaseId: string | null;
  deviceId: string;
  eventType: 'check' | 'download' | 'apply' | 'success' | 'failure' | 'rollback';
  errorMessage?: string;
  appVersion?: string;
  deviceInfo?: {
    os: string;
    osVersion: string;
    [key: string]: unknown;
  };
}

export interface CreateAppRequest {
  name: string;
  slug: string;
  platform: 'ios' | 'android' | 'both';
  signingPublicKey?: string;
}

export interface CreateChannelRequest {
  name: string;
}

export interface CreateReleaseRequest {
  version: string;
  channelName: string;
  minAppVersion?: string;
  maxAppVersion?: string;
  isMandatory?: boolean;
  releaseNotes?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateRolloutRequest {
  percentage: number;
}

// KV cache types
export interface CachedLatestRelease {
  releaseId: string;
  version: string;
  bundleHash: string;
  bundleSignature: string | null;
  bundleSize: number;
  isMandatory: boolean;
  minAppVersion: string | null;
  maxAppVersion: string | null;
  releaseNotes: string | null;
}

// Auth context
export interface AuthContext {
  organizationId: string;
  apiKeyId: string;
  permissions: 'full' | 'read' | 'deploy';
}
