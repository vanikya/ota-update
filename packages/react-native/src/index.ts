// Main exports
export { OTAProvider, useOTA, withOTA, UpdateBanner } from './OTAProvider';
export type { OTAProviderProps, UpdateBannerProps } from './OTAProvider';

// Debug component (for development/testing)
export { OTADebugPanel } from './components/OTADebugPanel';

// Hook export
export { useOTAUpdate } from './hooks/useOTAUpdate';
export type {
  OTAUpdateConfig,
  UpdateInfo,
  DownloadProgress,
  UpdateStatus,
  UseOTAUpdateResult,
} from './hooks/useOTAUpdate';

// Utilities
export { OTAApiClient, getDeviceInfo } from './utils/api';
export type {
  CheckUpdateRequest,
  CheckUpdateResponse,
  ReleaseInfo,
  ReportEventRequest,
} from './utils/api';

export { UpdateStorage, getStorageAdapter } from './utils/storage';
export type { StoredUpdate, StorageAdapter } from './utils/storage';

export {
  calculateHash,
  verifyBundleHash,
  verifySignature,
  verifyBundle,
} from './utils/verification';
export type { VerificationResult } from './utils/verification';

// Version info
export const VERSION = '0.2.11';
