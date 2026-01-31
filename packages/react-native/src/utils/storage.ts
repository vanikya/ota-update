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
  // Download file directly to disk without going through JS memory
  downloadToFile(url: string, destPath: string): Promise<{ fileSize: number }>;
  // Calculate SHA256 hash from file path (without loading into memory)
  calculateHashFromFile?(path: string): Promise<string>;
}

// Helper to normalize file paths (remove file:// prefix)
function normalizePath(path: string): string {
  if (path.startsWith('file://')) {
    return path.slice(7);
  }
  return path;
}

// Convert ArrayBuffer to base64 in chunks to avoid btoa() size limits
// btoa() can fail for strings > 2MB on some JS engines
// Chunk size must be multiple of 3 to avoid base64 padding issues between chunks
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // 32766 is divisible by 3, so each chunk produces valid base64 without padding (except last)
  const chunkSize = 32766;
  const chunks: string[] = [];

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    let binary = '';
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
    chunks.push(btoa(binary));
  }

  return chunks.join('');
}

// Convert base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
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
      // Convert ArrayBuffer to base64 using chunked approach for large bundles
      const base64 = arrayBufferToBase64(data);
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

  async downloadToFile(url: string, destPath: string): Promise<{ fileSize: number }> {
    // Use Expo's downloadAsync which downloads directly to file
    // This bypasses JS memory entirely - critical for large bundles
    if (__DEV__) {
      console.log('[OTAUpdate] Expo: Starting download from:', url);
      console.log('[OTAUpdate] Expo: Destination:', destPath);
    }

    const result = await ExpoFileSystem.downloadAsync(url, destPath);

    if (__DEV__) {
      console.log('[OTAUpdate] Expo: Download status:', result.status);
    }

    if (result.status !== 200) {
      throw new Error(`Download failed with status ${result.status}`);
    }

    // Get file size
    const info = await ExpoFileSystem.getInfoAsync(destPath);
    const fileSize = (info as any).size || 0;

    if (__DEV__) {
      console.log('[OTAUpdate] Expo: Downloaded file size:', fileSize, 'bytes');
    }

    return { fileSize };
  }

  async calculateHashFromFile(path: string): Promise<string> {
    // For Expo, we need to read the file and use expo-crypto
    // Try to use expo-crypto if available
    let ExpoCrypto: any = null;
    try {
      ExpoCrypto = require('expo-crypto');
    } catch {
      // expo-crypto not available
    }

    if (__DEV__) {
      console.log('[OTAUpdate] Expo: Calculating hash for:', path);
    }

    // Get file info first to log size
    const fileInfo = await ExpoFileSystem.getInfoAsync(path);
    if (__DEV__ && fileInfo.exists) {
      console.log('[OTAUpdate] File size:', (fileInfo as any).size, 'bytes');
    }

    if (ExpoCrypto?.digest) {
      // Read file as base64 and convert to Uint8Array for hashing
      const base64 = await ExpoFileSystem.readAsStringAsync(path, {
        encoding: ExpoFileSystem.EncodingType.Base64,
      });

      if (__DEV__) {
        console.log('[OTAUpdate] File read as base64, length:', base64.length);
      }

      // Decode base64 to binary - this is what the server hashes
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      if (__DEV__) {
        console.log('[OTAUpdate] Decoded to binary, length:', bytes.length);
      }

      // Hash the binary data
      const hashBuffer = await ExpoCrypto.digest(
        ExpoCrypto.CryptoDigestAlgorithm.SHA256,
        bytes
      );

      // Convert ArrayBuffer to hex
      const hashBytes = new Uint8Array(hashBuffer);
      const hexHash = Array.from(hashBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      if (__DEV__) {
        console.log('[OTAUpdate] Hash calculated:', hexHash);
      }

      return hexHash;
    }

    // Fallback to SubtleCrypto if available
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const base64 = await ExpoFileSystem.readAsStringAsync(path, {
        encoding: ExpoFileSystem.EncodingType.Base64,
      });
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const hashBuffer = await crypto.subtle.digest('SHA-256', bytes.buffer);
      const hashBytes = new Uint8Array(hashBuffer);
      return Array.from(hashBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }

    throw new Error('No crypto implementation available for hash calculation');
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
      // Convert ArrayBuffer to base64 using chunked approach for large bundles
      const base64 = arrayBufferToBase64(data);
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

  async downloadToFile(url: string, destPath: string): Promise<{ fileSize: number }> {
    if (!OTAUpdateNative) {
      throw new Error('OTAUpdate native module not found');
    }

    // Use native module's downloadFile method if available (preferred)
    if (OTAUpdateNative.downloadFile) {
      if (__DEV__) {
        console.log('[OTAUpdate] Native: Starting download from:', url);
        console.log('[OTAUpdate] Native: Destination:', destPath);
      }

      const result = await OTAUpdateNative.downloadFile(url, destPath);
      const fileSize = result.fileSize || 0;

      if (__DEV__) {
        console.log('[OTAUpdate] Native: Downloaded file size:', fileSize, 'bytes');
      }

      return { fileSize };
    }

    // Fallback: download via fetch and write in chunks
    // This is less efficient but works without native download support
    if (__DEV__) {
      console.log('[OTAUpdate] Native: Using fetch fallback for download');
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const data = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(data);
    await OTAUpdateNative.writeFileBase64(destPath, base64);

    if (__DEV__) {
      console.log('[OTAUpdate] Native: Fallback download complete, size:', data.byteLength);
    }

    return { fileSize: data.byteLength };
  }

  async calculateHashFromFile(path: string): Promise<string> {
    if (!OTAUpdateNative) {
      throw new Error('OTAUpdate native module not found');
    }

    // Use native module's calculateSHA256FromFile if available (preferred - streams file)
    if (OTAUpdateNative.calculateSHA256FromFile) {
      if (__DEV__) {
        console.log('[OTAUpdate] Native: Calculating hash for:', path);
      }

      const hash = await OTAUpdateNative.calculateSHA256FromFile(path);

      if (__DEV__) {
        console.log('[OTAUpdate] Native: Hash calculated:', hash);
      }

      return hash;
    }

    // Fallback: read file as base64 and use the base64 hash method
    // This loads the file into memory, but is better than nothing
    if (OTAUpdateNative.calculateSHA256 && OTAUpdateNative.readFileBase64) {
      if (__DEV__) {
        console.log('[OTAUpdate] Native: Using fallback hash calculation (loads file into memory)');
      }

      const base64 = await OTAUpdateNative.readFileBase64(path);
      return OTAUpdateNative.calculateSHA256(base64);
    }

    throw new Error('No hash calculation method available');
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
   * Download bundle directly to file, bypassing JS memory.
   * Critical for large bundles (5MB+).
   *
   * @param url The URL to download from
   * @param releaseId The release ID (used for filename)
   * @returns The normalized file path where bundle was saved
   */
  async downloadBundleToFile(url: string, releaseId: string): Promise<{ path: string; fileSize: number }> {
    await this.ensureDirectory();

    const bundlePath = `${this.baseDir}${releaseId}.bundle`;
    const result = await this.storage.downloadToFile(url, bundlePath);

    // Return normalized path for native module compatibility
    return {
      path: normalizePath(bundlePath),
      fileSize: result.fileSize,
    };
  }

  /**
   * Calculate SHA256 hash of a stored bundle file.
   * Uses streaming to avoid loading entire file into memory.
   *
   * @param releaseId The release ID of the bundle
   * @returns The hash string (without 'sha256:' prefix)
   */
  async calculateBundleHash(releaseId: string): Promise<string> {
    const bundlePath = this.getRawBundlePath(releaseId);

    if (!await this.storage.exists(bundlePath)) {
      throw new Error('Bundle file not found');
    }

    if (this.storage.calculateHashFromFile) {
      return this.storage.calculateHashFromFile(bundlePath);
    }

    // Fallback: read file into memory and calculate hash
    // This is not ideal for large files but works as a fallback
    const data = await this.storage.readFileAsBuffer(bundlePath);
    const bytes = new Uint8Array(data);

    // Use SubtleCrypto if available
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', bytes.buffer);
      const hashBytes = new Uint8Array(hashBuffer);
      return Array.from(hashBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }

    throw new Error('No hash calculation method available');
  }

  /**
   * Validate that a stored bundle is a valid JavaScript file.
   * This helps detect corrupted downloads (e.g., HTML error pages saved as bundles).
   *
   * @param releaseId The release ID to validate
   * @returns true if bundle is valid JavaScript, false otherwise
   */
  async validateBundle(releaseId: string): Promise<boolean> {
    try {
      const bundleData = await this.readBundle(releaseId);
      if (!bundleData) {
        return false;
      }

      // Check minimum size
      if (bundleData.byteLength < 10) {
        return false;
      }

      // Read first 1000 bytes to check content
      const bytes = new Uint8Array(bundleData, 0, Math.min(1000, bundleData.byteLength));
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

      // Accept if it looks like JavaScript
      const jsIndicators = [
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

      for (const pattern of jsIndicators) {
        if (pattern.test(trimmed)) {
          return true;
        }
      }

      // Also check for common JS tokens in minified bundles
      if (
        trimmed.includes('function') ||
        trimmed.includes('exports') ||
        trimmed.includes('require(') ||
        trimmed.includes('__d(')
      ) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Clear corrupted bundle if detected.
   * Call this on app startup to recover from bad OTA updates.
   *
   * @returns true if a corrupted bundle was cleared, false otherwise
   */
  async clearCorruptedBundle(): Promise<boolean> {
    try {
      const metadata = await this.getMetadata();
      if (!metadata) {
        return false;
      }

      const isValid = await this.validateBundle(metadata.releaseId);
      if (!isValid) {
        if (__DEV__) {
          console.warn('[OTAUpdate] Detected corrupted bundle, clearing...');
        }

        // Clear the corrupted bundle
        await this.deleteBundle(metadata.releaseId);
        await this.clearMetadata();
        await this.clearNativePendingBundle();

        return true;
      }

      return false;
    } catch (error) {
      if (__DEV__) {
        console.error('[OTAUpdate] Error checking bundle:', error);
      }
      return false;
    }
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
