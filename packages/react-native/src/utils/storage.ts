import { Platform, NativeModules } from 'react-native';

// Types
export interface StoredUpdate {
  releaseId: string;
  version: string;
  bundlePath: string;
  bundleHash: string;
  downloadedAt: number;
}

export interface StorageAdapter {
  getDocumentDirectory(): string;
  writeFile(path: string, data: string | ArrayBuffer): Promise<void>;
  readFile(path: string): Promise<string>;
  readFileAsBuffer(path: string): Promise<ArrayBuffer>;
  deleteFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  makeDirectory(path: string): Promise<void>;
}

// Helper to normalize file paths (remove file:// prefix)
function normalizePath(path: string): string {
  if (path.startsWith('file://')) {
    return path.slice(7);
  }
  return path;
}

// Try to use Expo FileSystem if available
// Use legacy API to avoid deprecation warnings in expo-file-system v54+
let ExpoFileSystem: any = null;
try {
  // Try legacy import first (expo-file-system v54+)
  ExpoFileSystem = require('expo-file-system/legacy');
} catch {
  try {
    // Fallback to regular import for older versions
    ExpoFileSystem = require('expo-file-system');
  } catch {
    // Expo not available, will use native module
  }
}

// Native module for bare React Native
const OTAUpdateNative = NativeModules.OTAUpdate;

// Expo implementation
class ExpoStorageAdapter implements StorageAdapter {
  getDocumentDirectory(): string {
    return ExpoFileSystem.documentDirectory || '';
  }

  async writeFile(path: string, data: string | ArrayBuffer): Promise<void> {
    if (data instanceof ArrayBuffer) {
      // Convert ArrayBuffer to base64
      const bytes = new Uint8Array(data);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      await ExpoFileSystem.writeAsStringAsync(path, base64, {
        encoding: ExpoFileSystem.EncodingType.Base64,
      });
    } else {
      await ExpoFileSystem.writeAsStringAsync(path, data);
    }
  }

  async readFile(path: string): Promise<string> {
    return ExpoFileSystem.readAsStringAsync(path);
  }

  async readFileAsBuffer(path: string): Promise<ArrayBuffer> {
    const base64 = await ExpoFileSystem.readAsStringAsync(path, {
      encoding: ExpoFileSystem.EncodingType.Base64,
    });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async deleteFile(path: string): Promise<void> {
    await ExpoFileSystem.deleteAsync(path, { idempotent: true });
  }

  async exists(path: string): Promise<boolean> {
    const info = await ExpoFileSystem.getInfoAsync(path);
    return info.exists;
  }

  async makeDirectory(path: string): Promise<void> {
    await ExpoFileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

// Native implementation for bare React Native
class NativeStorageAdapter implements StorageAdapter {
  getDocumentDirectory(): string {
    if (!OTAUpdateNative) {
      throw new Error('OTAUpdate native module not found. Did you link the library?');
    }
    return OTAUpdateNative.getDocumentDirectory();
  }

  async writeFile(path: string, data: string | ArrayBuffer): Promise<void> {
    if (!OTAUpdateNative) {
      throw new Error('OTAUpdate native module not found');
    }

    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      await OTAUpdateNative.writeFileBase64(path, base64);
    } else {
      await OTAUpdateNative.writeFile(path, data);
    }
  }

  async readFile(path: string): Promise<string> {
    if (!OTAUpdateNative) {
      throw new Error('OTAUpdate native module not found');
    }
    return OTAUpdateNative.readFile(path);
  }

  async readFileAsBuffer(path: string): Promise<ArrayBuffer> {
    if (!OTAUpdateNative) {
      throw new Error('OTAUpdate native module not found');
    }
    const base64: string = await OTAUpdateNative.readFileBase64(path);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async deleteFile(path: string): Promise<void> {
    if (!OTAUpdateNative) {
      throw new Error('OTAUpdate native module not found');
    }
    await OTAUpdateNative.deleteFile(path);
  }

  async exists(path: string): Promise<boolean> {
    if (!OTAUpdateNative) {
      throw new Error('OTAUpdate native module not found');
    }
    return OTAUpdateNative.exists(path);
  }

  async makeDirectory(path: string): Promise<void> {
    if (!OTAUpdateNative) {
      throw new Error('OTAUpdate native module not found');
    }
    await OTAUpdateNative.makeDirectory(path);
  }
}

// Factory function to get the appropriate storage adapter
export function getStorageAdapter(): StorageAdapter {
  if (ExpoFileSystem) {
    return new ExpoStorageAdapter();
  }

  if (OTAUpdateNative) {
    return new NativeStorageAdapter();
  }

  throw new Error(
    'No storage adapter available. Install expo-file-system or link the OTAUpdate native module.'
  );
}

// Update storage manager
export class UpdateStorage {
  private storage: StorageAdapter;
  private baseDir: string;
  private baseDirNormalized: string;
  private isExpo: boolean;

  constructor() {
    this.storage = getStorageAdapter();
    this.isExpo = !!ExpoFileSystem;
    this.baseDir = `${this.storage.getDocumentDirectory()}ota-update/`;
    // Keep a normalized version for native module calls
    this.baseDirNormalized = normalizePath(this.baseDir);
  }

  private async ensureDirectory(): Promise<void> {
    const exists = await this.storage.exists(this.baseDir);
    if (!exists) {
      await this.storage.makeDirectory(this.baseDir);
    }
  }

  // Get normalized path (without file:// prefix) for native module compatibility
  getNormalizedPath(path: string): string {
    return normalizePath(path);
  }

  async saveBundle(releaseId: string, data: ArrayBuffer): Promise<string> {
    await this.ensureDirectory();

    const bundlePath = `${this.baseDir}${releaseId}.bundle`;
    await this.storage.writeFile(bundlePath, data);

    // Return normalized path for native module compatibility
    return normalizePath(bundlePath);
  }

  // Get the raw bundle path (with file:// for Expo) - for internal storage operations
  private getRawBundlePath(releaseId: string): string {
    return `${this.baseDir}${releaseId}.bundle`;
  }

  async getBundlePath(releaseId: string): Promise<string | null> {
    const bundlePath = this.getRawBundlePath(releaseId);
    const exists = await this.storage.exists(bundlePath);
    // Return normalized path for native module compatibility
    return exists ? normalizePath(bundlePath) : null;
  }

  async readBundle(releaseId: string): Promise<ArrayBuffer | null> {
    const bundlePath = this.getRawBundlePath(releaseId);
    const exists = await this.storage.exists(bundlePath);
    if (!exists) return null;

    // Use raw path for storage operations (expo needs file:// prefix)
    return this.storage.readFileAsBuffer(bundlePath);
  }

  async deleteBundle(releaseId: string): Promise<void> {
    const bundlePath = this.getRawBundlePath(releaseId);
    if (await this.storage.exists(bundlePath)) {
      await this.storage.deleteFile(bundlePath);
    }
  }

  async saveMetadata(update: StoredUpdate): Promise<void> {
    await this.ensureDirectory();

    const metadataPath = `${this.baseDir}current.json`;
    await this.storage.writeFile(metadataPath, JSON.stringify(update));
  }

  async getMetadata(): Promise<StoredUpdate | null> {
    const metadataPath = `${this.baseDir}current.json`;

    try {
      if (await this.storage.exists(metadataPath)) {
        const content = await this.storage.readFile(metadataPath);
        return JSON.parse(content);
      }
    } catch {
      // Corrupted metadata, return null
    }

    return null;
  }

  async clearMetadata(): Promise<void> {
    const metadataPath = `${this.baseDir}current.json`;
    if (await this.storage.exists(metadataPath)) {
      await this.storage.deleteFile(metadataPath);
    }
  }

  async cleanOldBundles(keepReleaseId: string): Promise<void> {
    // For now, we just keep one bundle at a time
    // In a more advanced implementation, we might keep a few for rollback
  }

  /**
   * Register the bundle path with the native module.
   * This saves the path to SharedPreferences (Android) or UserDefaults (iOS)
   * so the app can load the OTA bundle on restart.
   *
   * @param bundlePath The normalized path to the bundle file
   * @param restart Whether to restart the app immediately
   * @returns true if successfully registered with native module, false otherwise
   */
  async registerBundleWithNative(bundlePath: string, restart: boolean = false): Promise<boolean> {
    try {
      if (OTAUpdateNative?.applyBundle) {
        // Ensure path is normalized before passing to native module
        const normalizedPath = normalizePath(bundlePath);
        await OTAUpdateNative.applyBundle(normalizedPath, restart);
        return true;
      } else {
        // Native module not available - this is expected for Expo Go
        // but should work for EAS Build apps
        if (__DEV__) {
          console.log('[OTAUpdate] Native module not available. Update will apply on next build with native modules.');
        }
        return false;
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[OTAUpdate] Failed to register bundle with native module:', error);
      }
      return false;
    }
  }

  /**
   * Clear the pending bundle from native storage.
   * This removes the bundle path from SharedPreferences (Android) or UserDefaults (iOS).
   */
  async clearNativePendingBundle(): Promise<void> {
    try {
      if (OTAUpdateNative?.clearPendingBundle) {
        await OTAUpdateNative.clearPendingBundle();
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[OTAUpdate] Failed to clear pending bundle:', error);
      }
    }
  }
}
