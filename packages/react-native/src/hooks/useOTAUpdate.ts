import { useState, useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { OTAApiClient, ReleaseInfo, getDeviceInfo } from '../utils/api';
import { UpdateStorage, StoredUpdate } from '../utils/storage';
import { verifyBundle, VerificationResult } from '../utils/verification';

export interface OTAUpdateConfig {
  serverUrl: string;
  appSlug: string;
  channel?: string;
  appVersion: string;
  publicKey?: string;
  checkOnMount?: boolean;
  checkOnForeground?: boolean;
}

export interface UpdateInfo {
  version: string;
  releaseId: string;
  bundleSize: number;
  isMandatory: boolean;
  releaseNotes: string | null;
}

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'applying'
  | 'error'
  | 'up-to-date';

export interface UseOTAUpdateResult {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress | null;
  error: Error | null;
  currentVersion: string | null;
  isDismissed: boolean;
  checkForUpdate: () => Promise<UpdateInfo | null>;
  downloadUpdate: () => Promise<void>;
  applyUpdate: (restartApp?: boolean) => Promise<void>;
  clearPendingUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  resetDismiss: () => void;
}

// Generate or get device ID
async function getDeviceId(): Promise<string> {
  // Try to get from native module or AsyncStorage
  // For simplicity, we generate a random one and ideally persist it
  // In production, use a proper device ID solution
  const id = `device_${Math.random().toString(36).substring(2, 15)}`;
  return id;
}

export function useOTAUpdate(config: OTAUpdateConfig): UseOTAUpdateResult {
  const {
    serverUrl,
    appSlug,
    channel = 'production',
    appVersion,
    publicKey,
    checkOnMount = true,
    checkOnForeground = true,
  } = config;

  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  const apiClient = useRef(new OTAApiClient(serverUrl));
  const storage = useRef(new UpdateStorage());
  const deviceIdRef = useRef<string | null>(null);
  const releaseRef = useRef<ReleaseInfo | null>(null);

  // Load current version on mount
  useEffect(() => {
    const loadCurrentVersion = async () => {
      const metadata = await storage.current.getMetadata();
      if (metadata) {
        setCurrentVersion(metadata.version);
      }
    };
    loadCurrentVersion();
  }, []);

  // Get device ID
  const getDeviceIdCached = useCallback(async () => {
    if (!deviceIdRef.current) {
      deviceIdRef.current = await getDeviceId();
    }
    return deviceIdRef.current;
  }, []);

  // Check for updates
  const checkForUpdate = useCallback(async (): Promise<UpdateInfo | null> => {
    try {
      setStatus('checking');
      setError(null);

      const deviceId = await getDeviceIdCached();
      const currentMetadata = await storage.current.getMetadata();

      const response = await apiClient.current.checkUpdate({
        appSlug,
        channel,
        platform: Platform.OS as 'ios' | 'android',
        currentVersion: currentMetadata?.version || null,
        appVersion,
        deviceId,
      });

      if (!response.updateAvailable || !response.release) {
        setStatus('up-to-date');
        return null;
      }

      releaseRef.current = response.release;

      const info: UpdateInfo = {
        version: response.release.version,
        releaseId: response.release.id,
        bundleSize: response.release.bundleSize,
        isMandatory: response.release.isMandatory,
        releaseNotes: response.release.releaseNotes,
      };

      // Reset dismiss state if this is a different version than what was previously dismissed
      if (!updateInfo || updateInfo.version !== info.version) {
        setIsDismissed(false);
      }

      setUpdateInfo(info);
      setStatus('available');

      return info;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setStatus('error');
      return null;
    }
  }, [appSlug, channel, appVersion, getDeviceIdCached]);

  // Download update
  const downloadUpdate = useCallback(async (): Promise<void> => {
    if (!releaseRef.current) {
      throw new Error('No update available to download');
    }

    const release = releaseRef.current;
    const deviceId = await getDeviceIdCached();

    try {
      setStatus('downloading');
      setDownloadProgress({ downloadedBytes: 0, totalBytes: release.bundleSize, percentage: 0 });

      // Report download start
      apiClient.current.reportEvent({
        appSlug,
        releaseId: release.id,
        deviceId,
        eventType: 'download',
        appVersion,
        deviceInfo: getDeviceInfo(),
      });

      // Download bundle
      const bundleData = await apiClient.current.downloadBundle(release.bundleUrl);

      setDownloadProgress({
        downloadedBytes: bundleData.byteLength,
        totalBytes: release.bundleSize,
        percentage: 100,
      });

      // Verify bundle
      setStatus('verifying');

      const verification = await verifyBundle(
        bundleData,
        release.bundleHash,
        release.bundleSignature,
        publicKey || null
      );

      if (!verification.valid) {
        throw new Error(verification.error || 'Bundle verification failed');
      }

      // Save bundle
      const bundlePath = await storage.current.saveBundle(release.id, bundleData);

      // Save metadata
      await storage.current.saveMetadata({
        releaseId: release.id,
        version: release.version,
        bundlePath,
        bundleHash: release.bundleHash,
        downloadedAt: Date.now(),
      });

      // Register the bundle path with native module (for next app restart)
      // This saves to SharedPreferences (Android) / UserDefaults (iOS)
      const registered = await storage.current.registerBundleWithNative(bundlePath, false);

      if (__DEV__) {
        if (registered) {
          console.log('[OTAUpdate] Bundle registered with native module. Will apply on app restart.');
        } else {
          console.log('[OTAUpdate] Could not register with native module. If using Expo Go, this is expected.');
        }
      }

      setStatus('ready');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Report failure
      apiClient.current.reportEvent({
        appSlug,
        releaseId: release.id,
        deviceId,
        eventType: 'failure',
        errorMessage: error.message,
        appVersion,
        deviceInfo: getDeviceInfo(),
      });

      setError(error);
      setStatus('error');
      throw error;
    }
  }, [appSlug, appVersion, publicKey, getDeviceIdCached]);

  // Apply update
  const applyUpdate = useCallback(async (restartApp: boolean = true): Promise<void> => {
    const metadata = await storage.current.getMetadata();

    if (!metadata) {
      throw new Error('No update available to apply');
    }

    const deviceId = await getDeviceIdCached();

    try {
      setStatus('applying');

      // Report apply
      apiClient.current.reportEvent({
        appSlug,
        releaseId: metadata.releaseId,
        deviceId,
        eventType: 'apply',
        appVersion,
        deviceInfo: getDeviceInfo(),
      });

      // Register bundle path with native module and optionally restart
      // This ensures the path is saved to SharedPreferences/UserDefaults
      const registered = await storage.current.registerBundleWithNative(metadata.bundlePath, restartApp);

      if (!registered && restartApp) {
        // Native module not available
        if (__DEV__) {
          console.log('[OTAUpdate] Update ready. Close and reopen the app to apply the update.');
          console.log('[OTAUpdate] Note: For Expo Go, OTA updates require a native build (EAS Build).');
        }
      } else if (registered && !restartApp) {
        if (__DEV__) {
          console.log('[OTAUpdate] Update registered. Will apply on next app restart.');
        }
      }

      // Report success (this might not run if app restarts)
      apiClient.current.reportEvent({
        appSlug,
        releaseId: metadata.releaseId,
        deviceId,
        eventType: 'success',
        appVersion,
        deviceInfo: getDeviceInfo(),
      });

      setCurrentVersion(metadata.version);
      setStatus('idle');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      apiClient.current.reportEvent({
        appSlug,
        releaseId: metadata.releaseId,
        deviceId,
        eventType: 'failure',
        errorMessage: error.message,
        appVersion,
        deviceInfo: getDeviceInfo(),
      });

      setError(error);
      setStatus('error');
      throw error;
    }
  }, [appSlug, appVersion, getDeviceIdCached]);

  // Clear pending update
  const clearPendingUpdate = useCallback(async (): Promise<void> => {
    const metadata = await storage.current.getMetadata();

    if (metadata) {
      await storage.current.deleteBundle(metadata.releaseId);
      await storage.current.clearMetadata();
    }

    // Also clear from native storage (SharedPreferences/UserDefaults)
    await storage.current.clearNativePendingBundle();

    setUpdateInfo(null);
    releaseRef.current = null;
    setStatus('idle');
  }, []);

  // Dismiss the update notification (user can hide the banner)
  const dismissUpdate = useCallback(() => {
    setIsDismissed(true);
  }, []);

  // Reset dismiss state (useful when a new update is found)
  const resetDismiss = useCallback(() => {
    setIsDismissed(false);
  }, []);

  // Check on mount
  useEffect(() => {
    if (checkOnMount) {
      checkForUpdate();
    }
  }, [checkOnMount, checkForUpdate]);

  // Check on foreground
  useEffect(() => {
    if (!checkOnForeground) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active' && status === 'idle') {
        checkForUpdate();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [checkOnForeground, checkForUpdate, status]);

  return {
    status,
    updateInfo,
    downloadProgress,
    error,
    currentVersion,
    isDismissed,
    checkForUpdate,
    downloadUpdate,
    applyUpdate,
    clearPendingUpdate,
    dismissUpdate,
    resetDismiss,
  };
}
