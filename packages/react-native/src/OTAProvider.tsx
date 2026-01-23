import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from 'react';
import { Alert, Platform } from 'react-native';
import {
  useOTAUpdate,
  OTAUpdateConfig,
  UseOTAUpdateResult,
  UpdateStatus,
  UpdateInfo,
} from './hooks/useOTAUpdate';
import { UpdateStorage } from './utils/storage';

// Context type
interface OTAContextValue extends UseOTAUpdateResult {
  config: OTAUpdateConfig;
}

const OTAContext = createContext<OTAContextValue | null>(null);

// Provider props
export interface OTAProviderProps {
  children: ReactNode;
  config: OTAUpdateConfig;
  onUpdateAvailable?: (info: UpdateInfo) => void;
  onUpdateDownloaded?: () => void;
  onError?: (error: Error) => void;
  showMandatoryUpdateAlert?: boolean;
  mandatoryUpdateAlertTitle?: string;
  mandatoryUpdateAlertMessage?: string;
}

export function OTAProvider({
  children,
  config,
  onUpdateAvailable,
  onUpdateDownloaded,
  onError,
  showMandatoryUpdateAlert = true,
  mandatoryUpdateAlertTitle = 'Update Required',
  mandatoryUpdateAlertMessage = 'A new version is available and must be installed to continue.',
}: OTAProviderProps) {
  const ota = useOTAUpdate(config);
  const [handledMandatory, setHandledMandatory] = useState(false);
  const initRef = useRef(false);

  // Startup initialization - check for and clear corrupted bundles
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const initializeOTA = async () => {
      try {
        const storage = new UpdateStorage();

        // Check for corrupted bundle and clear it
        const wasCorrupted = await storage.clearCorruptedBundle();
        if (wasCorrupted && __DEV__) {
          console.log('[OTAUpdate] Cleared corrupted bundle on startup');
        }

        // Also validate that if there's a pending bundle path, the file actually exists
        const metadata = await storage.getMetadata();
        if (metadata && metadata.bundlePath) {
          const bundleExists = await storage.validateBundle(metadata.releaseId);
          if (!bundleExists) {
            if (__DEV__) {
              console.log('[OTAUpdate] Bundle file missing or invalid, clearing metadata');
            }
            await storage.clearMetadata();
            await storage.clearNativePendingBundle();
          }
        }
      } catch (error) {
        if (__DEV__) {
          console.error('[OTAUpdate] Startup initialization error:', error);
        }
      }
    };

    initializeOTA();
  }, []);

  // Handle callbacks
  useEffect(() => {
    if (ota.status === 'available' && ota.updateInfo) {
      onUpdateAvailable?.(ota.updateInfo);

      // Handle mandatory updates
      if (
        showMandatoryUpdateAlert &&
        ota.updateInfo.isMandatory &&
        !handledMandatory
      ) {
        setHandledMandatory(true);

        Alert.alert(mandatoryUpdateAlertTitle, mandatoryUpdateAlertMessage, [
          {
            text: 'Update Now',
            onPress: async () => {
              try {
                await ota.downloadUpdate();
                await ota.applyUpdate(true);
              } catch (error) {
                // Error is handled by the hook
              }
            },
          },
        ]);
      }
    }
  }, [
    ota.status,
    ota.updateInfo,
    onUpdateAvailable,
    showMandatoryUpdateAlert,
    handledMandatory,
    mandatoryUpdateAlertTitle,
    mandatoryUpdateAlertMessage,
    ota.downloadUpdate,
    ota.applyUpdate,
  ]);

  useEffect(() => {
    if (ota.status === 'ready') {
      onUpdateDownloaded?.();
    }
  }, [ota.status, onUpdateDownloaded]);

  useEffect(() => {
    if (ota.error) {
      onError?.(ota.error);
    }
  }, [ota.error, onError]);

  const contextValue: OTAContextValue = {
    ...ota,
    config,
  };

  return (
    <OTAContext.Provider value={contextValue}>{children}</OTAContext.Provider>
  );
}

// Hook to use OTA context
export function useOTA(): OTAContextValue {
  const context = useContext(OTAContext);

  if (!context) {
    throw new Error('useOTA must be used within an OTAProvider');
  }

  return context;
}

// Higher-order component
export function withOTA<P extends object>(
  Component: React.ComponentType<P & { ota: OTAContextValue }>
): React.FC<P> {
  return function WithOTA(props: P) {
    const ota = useOTA();
    return <Component {...props} ota={ota} />;
  };
}

// Utility component for update banner
export interface UpdateBannerProps {
  renderAvailable?: (info: UpdateInfo, download: () => void) => ReactNode;
  renderDownloading?: (progress: number) => ReactNode;
  renderReady?: (apply: () => void) => ReactNode;
}

export function UpdateBanner({
  renderAvailable,
  renderDownloading,
  renderReady,
}: UpdateBannerProps) {
  const ota = useOTA();

  if (ota.status === 'available' && ota.updateInfo && renderAvailable) {
    return <>{renderAvailable(ota.updateInfo, ota.downloadUpdate)}</>;
  }

  if (ota.status === 'downloading' && ota.downloadProgress && renderDownloading) {
    return <>{renderDownloading(ota.downloadProgress.percentage)}</>;
  }

  if (ota.status === 'ready' && renderReady) {
    return <>{renderReady(() => ota.applyUpdate(true))}</>;
  }

  return null;
}
