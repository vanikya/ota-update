import type { Env } from '../types';

export interface BundleManifest {
  releaseId: string;
  version: string;
  bundleHash: string;
  bundleSize: number;
  createdAt: number;
  assets?: string[];
}

// Upload bundle to R2
export async function uploadBundle(
  env: Env,
  appId: string,
  releaseId: string,
  bundle: ArrayBuffer,
  contentType: string = 'application/javascript'
): Promise<string> {
  const key = `bundles/${appId}/${releaseId}/bundle.js`;

  await env.BUNDLES.put(key, bundle, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  return key;
}

// Upload source map to R2 (optional)
export async function uploadSourceMap(
  env: Env,
  appId: string,
  releaseId: string,
  sourceMap: ArrayBuffer
): Promise<string> {
  const key = `bundles/${appId}/${releaseId}/bundle.js.map`;

  await env.BUNDLES.put(key, sourceMap, {
    httpMetadata: {
      contentType: 'application/json',
    },
  });

  return key;
}

// Upload manifest to R2
export async function uploadManifest(
  env: Env,
  appId: string,
  releaseId: string,
  manifest: BundleManifest
): Promise<void> {
  const key = `bundles/${appId}/${releaseId}/manifest.json`;

  await env.BUNDLES.put(key, JSON.stringify(manifest), {
    httpMetadata: {
      contentType: 'application/json',
    },
  });
}

// Get bundle from R2
export async function getBundle(
  env: Env,
  appId: string,
  releaseId: string
): Promise<R2ObjectBody | null> {
  const key = `bundles/${appId}/${releaseId}/bundle.js`;
  return env.BUNDLES.get(key);
}

// Get manifest from R2
export async function getManifest(
  env: Env,
  appId: string,
  releaseId: string
): Promise<BundleManifest | null> {
  const key = `bundles/${appId}/${releaseId}/manifest.json`;
  const object = await env.BUNDLES.get(key);

  if (!object) return null;

  const text = await object.text();
  return JSON.parse(text);
}

// Delete bundle and associated files from R2
export async function deleteBundle(
  env: Env,
  appId: string,
  releaseId: string
): Promise<void> {
  const prefix = `bundles/${appId}/${releaseId}/`;

  // List all objects with the prefix
  const listed = await env.BUNDLES.list({ prefix });

  // Delete all objects
  for (const object of listed.objects) {
    await env.BUNDLES.delete(object.key);
  }
}

// Generate signed URL for bundle download (using R2 presigned URLs would require additional setup)
// For now, we serve through the worker
export function getBundleUrl(baseUrl: string, appId: string, releaseId: string): string {
  return `${baseUrl}/api/v1/bundles/${appId}/${releaseId}/bundle.js`;
}

// Calculate SHA-256 hash of bundle
export async function calculateBundleHash(bundle: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bundle);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
