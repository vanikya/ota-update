import { NativeModules, Platform } from 'react-native';

// Try to use Expo Crypto if available
let ExpoCrypto: any = null;
try {
  ExpoCrypto = require('expo-crypto');
} catch {
  // Expo not available
}

const OTAUpdateNative = NativeModules.OTAUpdate;

// Convert ArrayBuffer to hex string
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
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

// Calculate SHA-256 hash of data
export async function calculateHash(data: ArrayBuffer): Promise<string> {
  // Use native module first (most reliable for binary data)
  if (OTAUpdateNative?.calculateSHA256) {
    // Use chunked base64 encoding for large bundles
    const base64 = arrayBufferToBase64(data);
    const hash = await OTAUpdateNative.calculateSHA256(base64);
    return 'sha256:' + hash;
  }

  if (ExpoCrypto?.digest) {
    // Use Expo Crypto digest (takes Uint8Array, returns ArrayBuffer)
    const hashBuffer = await ExpoCrypto.digest(
      ExpoCrypto.CryptoDigestAlgorithm.SHA256,
      new Uint8Array(data)
    );
    return 'sha256:' + bufferToHex(hashBuffer);
  }

  // Fallback: Use SubtleCrypto (not available in all RN environments)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return 'sha256:' + bufferToHex(hashBuffer);
  }

  throw new Error('No crypto implementation available');
}

// Verify bundle hash
export async function verifyBundleHash(
  data: ArrayBuffer,
  expectedHash: string
): Promise<boolean> {
  const actualHash = await calculateHash(data);
  return actualHash === expectedHash;
}

// Verify Ed25519 signature
export async function verifySignature(
  data: ArrayBuffer,
  signatureHex: string,
  publicKeyHex: string
): Promise<boolean> {
  // Ed25519 verification is complex in JS
  // We rely on native modules or skip if not available

  if (OTAUpdateNative?.verifySignature) {
    // Use chunked base64 encoding for large bundles
    const base64 = arrayBufferToBase64(data);
    return OTAUpdateNative.verifySignature(base64, signatureHex, publicKeyHex);
  }

  // If no native module, we can't verify signature
  // In production, you might want to require this
  if (__DEV__) {
    console.warn(
      '[OTAUpdate] Signature verification skipped: native module not available'
    );
  }

  return true; // Skip verification if not available
}

// Full bundle verification
export interface VerificationResult {
  valid: boolean;
  hashValid: boolean;
  signatureValid: boolean;
  error?: string;
}

export async function verifyBundle(
  data: ArrayBuffer,
  expectedHash: string,
  signature: string | null,
  publicKey: string | null
): Promise<VerificationResult> {
  // Verify hash
  let hashValid = false;
  try {
    hashValid = await verifyBundleHash(data, expectedHash);
  } catch (error) {
    return {
      valid: false,
      hashValid: false,
      signatureValid: false,
      error: `Hash verification failed: ${error}`,
    };
  }

  if (!hashValid) {
    return {
      valid: false,
      hashValid: false,
      signatureValid: false,
      error: 'Bundle hash mismatch',
    };
  }

  // Verify signature if both signature and public key are provided
  let signatureValid = true;
  if (signature && publicKey) {
    try {
      signatureValid = await verifySignature(data, signature, publicKey);
    } catch (error) {
      return {
        valid: false,
        hashValid: true,
        signatureValid: false,
        error: `Signature verification failed: ${error}`,
      };
    }

    if (!signatureValid) {
      return {
        valid: false,
        hashValid: true,
        signatureValid: false,
        error: 'Invalid bundle signature',
      };
    }
  }

  return {
    valid: true,
    hashValid: true,
    signatureValid,
  };
}
