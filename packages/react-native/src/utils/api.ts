import { Platform } from 'react-native';

export interface CheckUpdateRequest {
  appSlug: string;
  channel: string;
  platform: 'ios' | 'android';
  currentVersion: string | null;
  appVersion: string;
  deviceId: string;
}

export interface ReleaseInfo {
  id: string;
  version: string;
  bundleUrl: string;
  bundleHash: string;
  bundleSignature: string | null;
  bundleSize: number;
  isMandatory: boolean;
  releaseNotes: string | null;
}

export interface CheckUpdateResponse {
  updateAvailable: boolean;
  release?: ReleaseInfo;
}

export interface ReportEventRequest {
  appSlug: string;
  releaseId: string | null;
  deviceId: string;
  eventType: 'download' | 'apply' | 'success' | 'failure' | 'rollback';
  errorMessage?: string;
  appVersion?: string;
  deviceInfo?: {
    os: string;
    osVersion: string;
    [key: string]: unknown;
  };
}

export class OTAApiClient {
  private serverUrl: string;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  async checkUpdate(request: CheckUpdateRequest): Promise<CheckUpdateResponse> {
    const response = await fetch(`${this.serverUrl}/api/v1/check-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error((error as { error: string }).error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async reportEvent(request: ReportEventRequest): Promise<void> {
    try {
      await fetch(`${this.serverUrl}/api/v1/report-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });
    } catch (error) {
      // Silently fail analytics - don't block the app
      if (__DEV__) {
        console.warn('[OTAUpdate] Failed to report event:', error);
      }
    }
  }

  async downloadBundle(bundleUrl: string): Promise<ArrayBuffer> {
    const response = await fetch(bundleUrl);

    if (!response.ok) {
      throw new Error(`Failed to download bundle: HTTP ${response.status}`);
    }

    return response.arrayBuffer();
  }
}

export function getDeviceInfo(): { os: string; osVersion: string } {
  return {
    os: Platform.OS,
    osVersion: Platform.Version.toString(),
  };
}
