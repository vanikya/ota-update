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

    // Validate content type if available
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      throw new Error('Server returned HTML instead of JavaScript bundle. Check your server configuration.');
    }

    const data = await response.arrayBuffer();

    // Basic validation: check if content looks like JavaScript
    // JavaScript bundles typically start with specific patterns
    if (!this.isValidJavaScriptBundle(data)) {
      throw new Error('Downloaded content does not appear to be a valid JavaScript bundle');
    }

    return data;
  }

  private isValidJavaScriptBundle(data: ArrayBuffer): boolean {
    // Check minimum size (a valid bundle should be at least a few bytes)
    if (data.byteLength < 10) {
      return false;
    }

    // Read first 1000 bytes as string to check content
    const bytes = new Uint8Array(data, 0, Math.min(1000, data.byteLength));
    let preview = '';
    for (let i = 0; i < bytes.length; i++) {
      preview += String.fromCharCode(bytes[i]);
    }
    const trimmed = preview.trim();

    // Check for HTML indicators (common error page patterns)
    if (
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('<HTML') ||
      trimmed.includes('<head>') ||
      trimmed.includes('<body>')
    ) {
      return false;
    }

    // JavaScript bundles typically start with:
    // - var, let, const (variable declarations)
    // - (function or !function (IIFEs)
    // - "use strict"
    // - Object.defineProperty (common in transpiled code)
    // - __d( (Metro bundler format)
    // - Comments: // or /*
    const jsPatterns = [
      /^var\s/,
      /^let\s/,
      /^const\s/,
      /^\(function/,
      /^!function/,
      /^["']use strict["']/,
      /^Object\.defineProperty/,
      /^__d\(/,
      /^\/[/*]/,
      /^"use strict"/,
      /^__BUNDLE_START_TIME__/,
    ];

    for (const pattern of jsPatterns) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }

    // Also accept if it contains common JS tokens (for minified bundles)
    if (
      trimmed.includes('function') ||
      trimmed.includes('exports') ||
      trimmed.includes('require(') ||
      trimmed.includes('__d(')
    ) {
      return true;
    }

    return false;
  }
}

export function getDeviceInfo(): { os: string; osVersion: string } {
  return {
    os: Platform.OS,
    osVersion: Platform.Version.toString(),
  };
}
