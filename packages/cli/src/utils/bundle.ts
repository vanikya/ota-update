import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import * as crypto from 'crypto';

export interface BundleResult {
  bundlePath: string;
  sourcemapPath?: string;
  bundleSize: number;
  hash: string;
}

export interface BundleOptions {
  platform: 'ios' | 'android';
  dev?: boolean;
  outputDir?: string;
  entryFile?: string;
  resetCache?: boolean;
}

// Detect if this is an Expo or bare React Native project
export function detectProjectType(cwd: string = process.cwd()): 'expo' | 'bare' | null {
  const packageJsonPath = path.join(cwd, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps['expo']) {
      return 'expo';
    }

    if (deps['react-native']) {
      return 'bare';
    }

    return null;
  } catch {
    return null;
  }
}

// Create JS bundle using Metro bundler
export async function createBundle(
  options: BundleOptions,
  cwd: string = process.cwd()
): Promise<BundleResult> {
  const projectType = detectProjectType(cwd);

  if (!projectType) {
    throw new Error('Not a React Native or Expo project');
  }

  const outputDir = options.outputDir || path.join(cwd, '.ota-update');
  const bundleFileName = `index.${options.platform}.bundle`;
  const sourcemapFileName = `index.${options.platform}.bundle.map`;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const bundlePath = path.join(outputDir, bundleFileName);
  const sourcemapPath = path.join(outputDir, sourcemapFileName);

  // For Expo, detect entry file from package.json "main" field or use node_modules/expo/AppEntry.js
  let entryFile = options.entryFile;

  if (!entryFile) {
    if (projectType === 'expo') {
      // Check package.json for main entry
      const packageJsonPath = path.join(cwd, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      if (packageJson.main && fs.existsSync(path.join(cwd, packageJson.main))) {
        entryFile = packageJson.main;
      } else if (fs.existsSync(path.join(cwd, 'index.js'))) {
        entryFile = 'index.js';
      } else if (fs.existsSync(path.join(cwd, 'App.js'))) {
        entryFile = 'node_modules/expo/AppEntry.js';
      } else if (fs.existsSync(path.join(cwd, 'App.tsx'))) {
        entryFile = 'node_modules/expo/AppEntry.js';
      } else {
        // Expo Router or other setups - use expo's AppEntry
        entryFile = 'node_modules/expo/AppEntry.js';
      }
    } else {
      // Bare React Native
      entryFile = fs.existsSync(path.join(cwd, `index.${options.platform}.js`))
        ? `index.${options.platform}.js`
        : 'index.js';
    }
  }

  if (projectType === 'expo') {
    await bundleWithExpo(cwd, {
      platform: options.platform,
      entryFile,
      bundlePath,
      sourcemapPath,
      dev: options.dev ?? false,
      resetCache: options.resetCache,
    });
  } else {
    await bundleWithMetro(cwd, {
      platform: options.platform,
      entryFile,
      bundlePath,
      sourcemapPath,
      dev: options.dev ?? false,
      resetCache: options.resetCache,
    });
  }

  // Calculate hash
  const bundleContent = fs.readFileSync(bundlePath);
  const hash = 'sha256:' + crypto.createHash('sha256').update(bundleContent).digest('hex');

  return {
    bundlePath,
    sourcemapPath: fs.existsSync(sourcemapPath) ? sourcemapPath : undefined,
    bundleSize: bundleContent.length,
    hash,
  };
}

interface BundleConfig {
  platform: 'ios' | 'android';
  entryFile: string;
  bundlePath: string;
  sourcemapPath: string;
  dev: boolean;
  resetCache?: boolean;
}

async function bundleWithExpo(cwd: string, config: BundleConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      'expo', 'export:embed',
      '--platform', config.platform,
      '--entry-file', config.entryFile,
      '--bundle-output', config.bundlePath,
      '--sourcemap-output', config.sourcemapPath,
      '--dev', config.dev.toString(),
    ];

    if (config.resetCache) {
      args.push('--reset-cache');
    }

    console.log(`Running: npx ${args.join(' ')}`);

    const proc = spawn('npx', args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Expo bundle failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

async function bundleWithMetro(cwd: string, config: BundleConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      'react-native', 'bundle',
      '--platform', config.platform,
      '--entry-file', config.entryFile,
      '--bundle-output', config.bundlePath,
      '--sourcemap-output', config.sourcemapPath,
      '--dev', config.dev.toString(),
    ];

    if (config.resetCache) {
      args.push('--reset-cache');
    }

    console.log(`Running: npx ${args.join(' ')}`);

    const proc = spawn('npx', args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Metro bundle failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// Clean up bundle output directory
export function cleanBundleOutput(cwd: string = process.cwd()): void {
  const outputDir = path.join(cwd, '.ota-update');

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
}

// Get bundle info without creating a new one
export function getBundleInfo(bundlePath: string): { size: number; hash: string } | null {
  if (!fs.existsSync(bundlePath)) {
    return null;
  }

  const content = fs.readFileSync(bundlePath);
  const hash = 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');

  return {
    size: content.length,
    hash,
  };
}
