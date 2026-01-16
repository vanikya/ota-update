import * as fs from 'fs';
import nacl from 'tweetnacl';
import { loadSigningKeys, saveSigningKeys, SigningKeys } from '../config.js';

// Convert Uint8Array to hex string
function toHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert hex string to Uint8Array
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

// Generate a new Ed25519 key pair
export function generateKeyPair(): SigningKeys {
  const keyPair = nacl.sign.keyPair();

  return {
    publicKey: toHex(keyPair.publicKey),
    privateKey: toHex(keyPair.secretKey),
  };
}

// Sign a bundle with Ed25519
export function signBundle(bundlePath: string, privateKeyHex: string): string {
  const bundle = fs.readFileSync(bundlePath);
  const privateKey = fromHex(privateKeyHex);

  // Sign the bundle content
  const signature = nacl.sign.detached(bundle, privateKey);

  return toHex(signature);
}

// Verify a bundle signature
export function verifySignature(
  bundlePath: string,
  signatureHex: string,
  publicKeyHex: string
): boolean {
  const bundle = fs.readFileSync(bundlePath);
  const signature = fromHex(signatureHex);
  const publicKey = fromHex(publicKeyHex);

  return nacl.sign.detached.verify(bundle, signature, publicKey);
}

// Generate and save keys for an app
export function setupSigningForApp(appSlug: string): SigningKeys {
  // Check if keys already exist
  const existing = loadSigningKeys(appSlug);
  if (existing) {
    return existing;
  }

  // Generate new key pair
  const keys = generateKeyPair();
  saveSigningKeys(appSlug, keys);

  return keys;
}

// Get keys or throw if not found
export function getSigningKeys(appSlug: string): SigningKeys {
  const keys = loadSigningKeys(appSlug);
  if (!keys) {
    throw new Error(
      `No signing keys found for app "${appSlug}". ` +
      `Run "ota keys generate --app ${appSlug}" to create keys.`
    );
  }
  return keys;
}

// Sign a bundle for an app (convenience function)
export function signBundleForApp(appSlug: string, bundlePath: string): string {
  const keys = getSigningKeys(appSlug);
  return signBundle(bundlePath, keys.privateKey);
}

// Export public key in a format suitable for the server
export function exportPublicKey(appSlug: string): string {
  const keys = getSigningKeys(appSlug);
  return keys.publicKey;
}
