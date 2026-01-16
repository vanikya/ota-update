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

// Try to use Expo FileSystem if available
let ExpoFileSystem: any = null;
try {
  ExpoFileSystem = require('expo-file-system');
} catch {
  // Expo not available, will use native module
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

  constructor() {
    this.storage = getStorageAdapter();
    this.baseDir = `${this.storage.getDocumentDirectory()}ota-update/`;
  }

  private async ensureDirectory(): Promise<void> {
    const exists = await this.storage.exists(this.baseDir);
    if (!exists) {
      await this.storage.makeDirectory(this.baseDir);
    }
  }

  async saveBundle(releaseId: string, data: ArrayBuffer): Promise<string> {
    await this.ensureDirectory();

    const bundlePath = `${this.baseDir}${releaseId}.bundle`;
    await this.storage.writeFile(bundlePath, data);

    return bundlePath;
  }

  async getBundlePath(releaseId: string): Promise<string | null> {
    const bundlePath = `${this.baseDir}${releaseId}.bundle`;
    const exists = await this.storage.exists(bundlePath);
    return exists ? bundlePath : null;
  }

  async readBundle(releaseId: string): Promise<ArrayBuffer | null> {
    const bundlePath = await this.getBundlePath(releaseId);
    if (!bundlePath) return null;

    return this.storage.readFileAsBuffer(bundlePath);
  }

  async deleteBundle(releaseId: string): Promise<void> {
    const bundlePath = `${this.baseDir}${releaseId}.bundle`;
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
}
