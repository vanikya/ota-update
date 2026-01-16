import fetch, { Response, RequestInit } from 'node-fetch';
import FormData from 'form-data';
import * as fs from 'fs';
import { getApiKey, getServerUrl } from '../config.js';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const serverUrl = getServerUrl();
  const apiKey = getApiKey();

  const url = `${serverUrl}${endpoint}`;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body instanceof FormData
      ? options.body
      : options.body
        ? JSON.stringify(options.body)
        : undefined,
  } as RequestInit);

  const data = await response.json() as T | { error: string };

  if (!response.ok) {
    const errorData = data as { error: string };
    throw new ApiError(response.status, errorData.error || 'Request failed', data);
  }

  return data as T;
}

// Organization & Auth
export async function createOrganization(name: string) {
  return request<{
    organization: { id: string; name: string };
    apiKey: string;
    warning: string;
  }>('/api/v1/organizations', {
    method: 'POST',
    body: { name },
  });
}

export async function listApiKeys() {
  return request<{
    apiKeys: Array<{
      id: string;
      name: string;
      permissions: string;
      created_at: number;
      last_used_at: number | null;
    }>;
  }>('/api/v1/api-keys');
}

export async function createApiKey(name?: string, permissions?: string) {
  return request<{
    apiKey: string;
    id: string;
    permissions: string;
    warning: string;
  }>('/api/v1/api-keys', {
    method: 'POST',
    body: { name, permissions },
  });
}

export async function deleteApiKey(keyId: string) {
  return request<{ success: boolean }>(`/api/v1/api-keys/${keyId}`, {
    method: 'DELETE',
  });
}

// Apps
export async function listApps() {
  return request<{
    apps: Array<{
      id: string;
      name: string;
      slug: string;
      platform: string;
      created_at: number;
    }>;
  }>('/api/v1/apps');
}

export async function createApp(data: {
  name: string;
  slug: string;
  platform: 'ios' | 'android' | 'both';
  signingPublicKey?: string;
}) {
  return request<{
    app: {
      id: string;
      name: string;
      slug: string;
      platform: string;
    };
  }>('/api/v1/apps', {
    method: 'POST',
    body: data,
  });
}

export async function getApp(appId: string) {
  return request<{
    app: {
      id: string;
      name: string;
      slug: string;
      platform: string;
      signing_public_key: string | null;
    };
    channels: Array<{ id: string; name: string }>;
    releaseCount: number;
  }>(`/api/v1/apps/${appId}`);
}

export async function deleteApp(appId: string) {
  return request<{ success: boolean }>(`/api/v1/apps/${appId}`, {
    method: 'DELETE',
  });
}

// Channels
export async function listChannels(appId: string) {
  return request<{
    channels: Array<{
      id: string;
      name: string;
      release_count: number;
      latest_version: string | null;
    }>;
  }>(`/api/v1/apps/${appId}/channels`);
}

export async function createChannel(appId: string, name: string) {
  return request<{
    channel: { id: string; name: string };
  }>(`/api/v1/apps/${appId}/channels`, {
    method: 'POST',
    body: { name },
  });
}

export async function deleteChannel(appId: string, channelId: string) {
  return request<{ success: boolean }>(
    `/api/v1/apps/${appId}/channels/${channelId}`,
    { method: 'DELETE' }
  );
}

// Releases
export async function listReleases(appId: string, channel?: string) {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : '';
  return request<{
    releases: Array<{
      id: string;
      version: string;
      bundle_size: number;
      is_mandatory: number;
      created_at: number;
      rollout_percentage: number;
      rollout_active: number;
      channel_name: string;
    }>;
    total: number;
  }>(`/api/v1/apps/${appId}/releases${query}`);
}

export async function createRelease(
  appId: string,
  bundlePath: string,
  metadata: {
    version: string;
    channelName: string;
    minAppVersion?: string;
    maxAppVersion?: string;
    isMandatory?: boolean;
    releaseNotes?: string;
    signature?: string;
  },
  sourcemapPath?: string
) {
  const form = new FormData();

  // Add bundle file
  form.append('bundle', fs.createReadStream(bundlePath), {
    filename: 'bundle.js',
    contentType: 'application/javascript',
  });

  // Add sourcemap if provided
  if (sourcemapPath && fs.existsSync(sourcemapPath)) {
    form.append('sourceMap', fs.createReadStream(sourcemapPath), {
      filename: 'bundle.js.map',
      contentType: 'application/json',
    });
  }

  // Add metadata
  form.append('metadata', JSON.stringify({
    version: metadata.version,
    channelName: metadata.channelName,
    minAppVersion: metadata.minAppVersion,
    maxAppVersion: metadata.maxAppVersion,
    isMandatory: metadata.isMandatory,
    releaseNotes: metadata.releaseNotes,
  }));

  // Add signature if provided
  if (metadata.signature) {
    form.append('signature', metadata.signature);
  }

  const serverUrl = getServerUrl();
  const apiKey = getApiKey();

  const response = await fetch(`${serverUrl}/api/v1/apps/${appId}/releases`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: form,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(
      response.status,
      (data as { error: string }).error || 'Failed to create release',
      data
    );
  }

  return data as { release: { id: string; version: string } };
}

export async function updateRollout(appId: string, releaseId: string, percentage: number) {
  return request<{
    rollout: { percentage: number; is_active: number };
  }>(`/api/v1/apps/${appId}/releases/${releaseId}/rollout`, {
    method: 'PATCH',
    body: { percentage },
  });
}

export async function rollbackRelease(appId: string, releaseId: string) {
  return request<{
    success: boolean;
    message: string;
  }>(`/api/v1/apps/${appId}/releases/${releaseId}/rollback`, {
    method: 'POST',
  });
}

// Analytics
export async function getAnalytics(appId: string, days: number = 7) {
  return request<{
    period: { days: number; since: string };
    summary: {
      uniqueDevices: number;
      eventCounts: Record<string, number>;
      successRate: number | null;
    };
    daily: Array<{ date: string; event_type: string; count: number }>;
    errorBreakdown: Array<{ error_message: string; count: number }>;
    appVersions: Array<{ app_version: string; device_count: number }>;
  }>(`/api/v1/apps/${appId}/analytics?days=${days}`);
}
