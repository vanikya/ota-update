# OTA Update

> **Beta Notice**: This package is currently in beta. Testing is in progress and APIs may change. Use in production at your own discretion. We welcome feedback and bug reports via [GitHub Issues](https://github.com/vanikya/ota-update/issues).

**[Documentation](https://vanikya.github.io/ota-update/)** | **[npm](https://www.npmjs.com/package/@vanikya/ota-react-native)** | **[CLI](https://www.npmjs.com/package/@vanikya/ota-cli)**

A self-hosted Over-The-Air (OTA) update system for React Native and Expo apps. Replace EAS Updates or Microsoft CodePush with your own infrastructure built on Cloudflare's edge network.

## Features

- **Edge-deployed** - Powered by Cloudflare Workers for global low-latency updates
- **Multi-channel releases** - Production, staging, beta, or custom channels
- **Percentage-based rollouts** - Gradually roll out updates to minimize risk
- **Instant rollbacks** - Revert to any previous release with one command
- **Code signing** - Ed25519 signatures ensure bundle authenticity
- **Analytics** - Track update adoption, success rates, and errors
- **Works everywhere** - Supports both Expo and bare React Native apps

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────┐
│  React Native   │────▶│         Cloudflare Workers               │
│     App         │◀────│  (API + Bundle serving)                  │
└─────────────────┘     └──────────────────────────────────────────┘
                                          │
                        ┌─────────────────┼─────────────────┐
                        ▼                 ▼                 ▼
                   ┌─────────┐      ┌─────────┐      ┌─────────┐
                   │   D1    │      │   KV    │      │   R2    │
                   │(metadata)│      │ (cache) │      │(bundles)│
                   └─────────┘      └─────────┘      └─────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- Cloudflare account (free tier works)

### 1. Clone and Install

```bash
git clone https://github.com/vanikya/ota-update.git
cd ota-update
npm install
```

### 2. Set Up Cloudflare Resources

```bash
# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create ota-update-db
# Copy the database_id from output

# Create KV namespace
wrangler kv:namespace create CACHE
# Copy the id from output

# Create R2 bucket
wrangler r2 bucket create ota-update-bundles
```

### 3. Configure the Server

Edit `packages/server/wrangler.toml` with your resource IDs:

```toml
name = "ota-update-server"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "ota-update-db"
database_id = "YOUR_D1_DATABASE_ID"  # <-- Replace this

[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_KV_NAMESPACE_ID"  # <-- Replace this

[[r2_buckets]]
binding = "BUNDLES"
bucket_name = "ota-update-bundles"
```

### 4. Deploy the Server

```bash
cd packages/server

# Run database migrations
npm run db:migrate:prod

# Deploy to Cloudflare Workers
npm run deploy
```

Note your Worker URL (e.g., `https://ota-update-server.your-server.workers.dev`)

### 5. Set Up the CLI

```bash
cd packages/cli
npm install
npm run build

# Create a symlink for global access (optional)
npm link
```

### 6. Create Your Organization

```bash
# Login and create organization
ota login

# Follow the prompts to:
# 1. Enter your Worker URL
# 2. Create a new organization
# 3. Save your API key (shown only once!)
```

### 7. Create an App

```bash
# Create a new app with code signing
ota apps create --name "My App" --slug my-app --platform both --init

# This creates:
# - App on the server with production/staging channels
# - Signing keys in ~/.ota-update/keys/
# - ota-update.json in your project
```

---

## Client SDK Integration

### Installation

```bash
# For Expo projects
npx expo install @vanikya/ota-react-native

# For bare React Native
npm install @vanikya/ota-react-native
cd ios && pod install
```

### Basic Usage

```tsx
// App.tsx
import React from 'react';
import { OTAProvider } from '@vanikya/ota-react-native';
import { version } from './package.json';

export default function App() {
  return (
    <OTAProvider
      config={{
        serverUrl: 'https://ota-update-server.your-server.workers.dev',
        appSlug: 'my-app',
        appVersion: version,
        channel: 'production',
      }}
      onUpdateAvailable={(info) => {
        console.log('Update available:', info.version);
      }}
    >
      <MainApp />
    </OTAProvider>
  );
}
```

### Using the Hook

```tsx
import { useOTA } from '@vanikya/ota-react-native';

function UpdateButton() {
  const {
    status,
    updateInfo,
    downloadProgress,
    checkForUpdate,
    downloadUpdate,
    applyUpdate
  } = useOTA();

  if (status === 'available' && updateInfo) {
    return (
      <View>
        <Text>Version {updateInfo.version} available!</Text>
        <Button title="Download" onPress={downloadUpdate} />
      </View>
    );
  }

  if (status === 'downloading' && downloadProgress) {
    return <Text>Downloading: {downloadProgress.percentage}%</Text>;
  }

  if (status === 'ready') {
    return <Button title="Restart to Update" onPress={() => applyUpdate(true)} />;
  }

  return null;
}
```

### Update Banner Component

```tsx
import { UpdateBanner } from '@vanikya/ota-react-native';

function App() {
  return (
    <OTAProvider config={config}>
      <UpdateBanner
        renderAvailable={(info, download) => (
          <TouchableOpacity onPress={download} style={styles.banner}>
            <Text>Update to v{info.version}</Text>
          </TouchableOpacity>
        )}
        renderDownloading={(progress) => (
          <View style={styles.banner}>
            <Text>Downloading... {progress}%</Text>
          </View>
        )}
        renderReady={(apply) => (
          <TouchableOpacity onPress={apply} style={styles.banner}>
            <Text>Tap to restart and update</Text>
          </TouchableOpacity>
        )}
      />
      <MainApp />
    </OTAProvider>
  );
}
```

---

## CLI Reference

### Authentication

```bash
# Login (interactive)
ota login

# Login with API key
ota login --api-key YOUR_API_KEY --server https://your-worker.workers.dev

# Check current auth
ota whoami

# Logout
ota logout
```

### App Management

```bash
# List apps
ota apps list

# Create app
ota apps create --name "My App" --slug my-app --platform both

# Get app details
ota apps info app_xxxxx

# Delete app
ota apps delete app_xxxxx --force
```

### Releases

```bash
# Publish a release (builds bundle automatically)
ota release -v 1.0.1 --channel production --platform ios

# With release notes
ota release -v 1.0.1 --notes "Bug fixes and improvements"

# Mandatory update
ota release -v 1.0.1 --mandatory

# Gradual rollout (10% of users)
ota release -v 1.0.1 --rollout 10

# Use pre-built bundle
ota release -v 1.0.1 --bundle ./dist/main.jsbundle

# List releases
ota releases --app my-app --channel production
```

### Rollbacks

```bash
# Interactive rollback
ota rollback --app my-app --channel production

# Rollback to specific release
ota rollback --app my-app --release rel_xxxxx
```

### Channels

```bash
# List channels
ota channels list --app my-app

# Create channel
ota channels create beta --app my-app

# Delete channel
ota channels delete beta --app my-app --force
```

### Analytics

```bash
# View analytics (last 7 days)
ota analytics --app my-app

# Custom time range
ota analytics --app my-app --days 30
```

### Code Signing

```bash
# Generate signing keys
ota keys generate --app my-app

# Export public key (for server)
ota keys export --app my-app
```

---

## Project Configuration

Create `ota-update.json` in your React Native project root:

```json
{
  "appSlug": "my-app",
  "channel": "production",
  "platform": "both"
}
```

With this file, you can omit `--app` and `--channel` from CLI commands.

---

## API Reference

### Public Endpoints (No Auth Required)

#### Check for Updates

```bash
POST /api/v1/check-update
Content-Type: application/json

{
  "appSlug": "my-app",
  "channel": "production",
  "platform": "ios",
  "currentVersion": "1.0.0",
  "appVersion": "2.0.0",
  "deviceId": "device-uuid"
}
```

Response:
```json
{
  "updateAvailable": true,
  "release": {
    "id": "rel_xxxxx",
    "version": "1.0.1",
    "bundleUrl": "https://...",
    "bundleHash": "sha256:...",
    "bundleSize": 1234567,
    "isMandatory": false,
    "releaseNotes": "Bug fixes"
  }
}
```

#### Report Event

```bash
POST /api/v1/report-event
Content-Type: application/json

{
  "appSlug": "my-app",
  "releaseId": "rel_xxxxx",
  "deviceId": "device-uuid",
  "eventType": "success",
  "appVersion": "2.0.0"
}
```

### Authenticated Endpoints

All require `Authorization: Bearer <api_key>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/apps` | List apps |
| POST | `/api/v1/apps` | Create app |
| GET | `/api/v1/apps/:id` | Get app details |
| DELETE | `/api/v1/apps/:id` | Delete app |
| GET | `/api/v1/apps/:appId/channels` | List channels |
| POST | `/api/v1/apps/:appId/channels` | Create channel |
| DELETE | `/api/v1/apps/:appId/channels/:id` | Delete channel |
| GET | `/api/v1/apps/:appId/releases` | List releases |
| POST | `/api/v1/apps/:appId/releases` | Create release |
| PATCH | `/api/v1/apps/:appId/releases/:id/rollout` | Update rollout |
| POST | `/api/v1/apps/:appId/releases/:id/rollback` | Rollback |
| GET | `/api/v1/apps/:appId/analytics` | Get analytics |

---

## Security

### Code Signing

OTA Update uses Ed25519 signatures to verify bundle authenticity:

1. **Key Generation**: When you create an app with `--signing`, a key pair is generated
2. **Signing**: The CLI signs bundles before upload
3. **Verification**: The SDK verifies signatures before applying updates

Keys are stored in `~/.ota-update/keys/<app-slug>.json`. **Keep your private keys secure!**

### API Keys

- API keys are hashed (SHA-256) before storage
- Keys are never logged or displayed after creation
- Use different keys for CI/CD with restricted permissions:

```bash
# Create deploy-only key
ota api-keys create --name "CI Deploy" --permissions deploy
```

### Best Practices

1. **Never commit** `.ota-update/` or API keys to version control
2. Use **environment variables** for CI/CD: `OTA_UPDATE_API_KEY`
3. Enable **mandatory updates** for security-critical fixes
4. Use **gradual rollouts** to catch issues early
5. Monitor **analytics** for failed updates

---

## Development

### Local Development

```bash
# Start server locally
cd packages/server
npm run dev

# The server runs at http://localhost:8787
```

### Testing

```bash
# Test the API
curl http://localhost:8787/health

# Create test organization
curl -X POST http://localhost:8787/api/v1/organizations \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Org"}'
```

### Project Structure

```
ota-update/
├── packages/
│   ├── server/          # Cloudflare Workers API
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   └── middleware/
│   │   └── wrangler.toml
│   │
│   ├── cli/             # Command-line tool
│   │   └── src/
│   │       ├── commands/
│   │       └── utils/
│   │
│   └── react-native/    # Client SDK
│       ├── src/
│       ├── ios/
│       └── android/
│
└── package.json         # Workspace root
```

---

## Troubleshooting

### "No update available" when there should be

1. Check channel name matches
2. Verify `appVersion` compatibility (min/max)
3. Check rollout percentage (device may not be in rollout group)
4. Clear SDK cache: `await ota.clearPendingUpdate()`

### Bundle verification failed

1. Ensure signing keys match between CLI and server
2. Re-generate keys: `ota keys generate --app my-app`
3. Update app's public key on server

### CLI can't connect to server

1. Verify server URL in `~/.ota-update/config.json`
2. Check API key is valid: `ota whoami`
3. Ensure Worker is deployed: `wrangler tail`

### Native module not found (bare RN)

1. iOS: Run `cd ios && pod install`
2. Android: Rebuild the app
3. Check autolinking is working

---

## License

MIT

---

## Contributing

Contributions welcome! Please read our contributing guidelines before submitting PRs.
