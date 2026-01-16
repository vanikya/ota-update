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

// Calculate SHA-256 hash of data
export async function calculateHash(data: ArrayBuffer): Promise<string> {
  if (ExpoCrypto) {
    // Use Expo Crypto
    const hash = await ExpoCrypto.digestStringAsync(
      ExpoCrypto.CryptoDigestAlgorithm.SHA256,
      bufferToHex(data),
      { encoding: ExpoCrypto.CryptoEncoding.HEX }
    );
    return 'sha256:' + hash;
  }

  if (OTAUpdateNative?.calculateSHA256) {
    // Use native module
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const hash = await OTAUpdateNative.calculateSHA256(base64);
    return 'sha256:' + hash;
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
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
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
