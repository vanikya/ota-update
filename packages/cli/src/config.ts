import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.ota-update');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const KEYS_DIR = path.join(CONFIG_DIR, 'keys');

export interface Config {
  apiKey?: string;
  serverUrl: string;
  defaultApp?: string;
  defaultChannel?: string;
}

const defaultConfig: Config = {
  serverUrl: 'https://ota-update-server.your-domain.workers.dev',
};

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): Config {
  ensureConfigDir();

  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...defaultConfig };
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...defaultConfig, ...JSON.parse(content) };
  } catch {
    return { ...defaultConfig };
  }
}

export function saveConfig(config: Partial<Config>): void {
  ensureConfigDir();

  const existing = loadConfig();
  const merged = { ...existing, ...config };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), {
    mode: 0o600,
  });
}

export function getApiKey(): string | undefined {
  const config = loadConfig();
  return config.apiKey || process.env.OTA_UPDATE_API_KEY;
}

export function getServerUrl(): string {
  const config = loadConfig();
  return process.env.OTA_UPDATE_SERVER_URL || config.serverUrl;
}

// Signing key management
export interface SigningKeys {
  publicKey: string;
  privateKey: string;
}

export function getKeysPath(appSlug: string): string {
  return path.join(KEYS_DIR, `${appSlug}.json`);
}

export function loadSigningKeys(appSlug: string): SigningKeys | null {
  const keysPath = getKeysPath(appSlug);

  if (!fs.existsSync(keysPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(keysPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function saveSigningKeys(appSlug: string, keys: SigningKeys): void {
  ensureConfigDir();
  const keysPath = getKeysPath(appSlug);
  fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

export function deleteSigningKeys(appSlug: string): void {
  const keysPath = getKeysPath(appSlug);
  if (fs.existsSync(keysPath)) {
    fs.unlinkSync(keysPath);
  }
}

// Project config (ota-update.json in project root)
export interface ProjectConfig {
  appSlug: string;
  channel?: string;
  platform?: 'ios' | 'android' | 'both';
  bundleOutput?: string;
  sourcemapOutput?: string;
}

export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  const configPath = path.join(cwd, 'ota-update.json');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function saveProjectConfig(config: ProjectConfig, cwd: string = process.cwd()): void {
  const configPath = path.join(cwd, 'ota-update.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
