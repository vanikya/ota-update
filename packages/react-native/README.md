# @vanikya/ota-react-native

> **Beta Notice**: This package is currently in beta. Testing is in progress and APIs may change. Use in production at your own discretion. We welcome feedback and bug reports via [GitHub Issues](https://github.com/vanikya/ota-update/issues).

React Native SDK for OTA (Over-The-Air) updates. A self-hosted alternative to CodePush and EAS Updates.

Works with both **Expo** and **bare React Native** apps.

## Installation

```bash
npm install @vanikya/ota-react-native
```

### For Expo apps

Install Expo dependencies:

```bash
npx expo install expo-file-system expo-crypto
```

### For bare React Native apps

Install pods (iOS):

```bash
cd ios && pod install
```

## Quick Start

### 1. Wrap your app with OTAProvider

```tsx
import { OTAProvider } from '@vanikya/ota-react-native';

export default function App() {
  return (
    <OTAProvider
      config={{
        serverUrl: 'https://your-server.workers.dev',
        appSlug: 'my-app',
        channel: 'production',
        // Optional: public key for signature verification
        publicKey: 'your-public-key-hex',
      }}
    >
      <YourApp />
    </OTAProvider>
  );
}
```

### 2. Use the update hook

```tsx
import { useOTAUpdate } from '@vanikya/ota-react-native';

function UpdateChecker() {
  const {
    isChecking,
    isDownloading,
    downloadProgress,
    availableUpdate,
    error,
    checkForUpdate,
    downloadAndApply,
  } = useOTAUpdate();

  // Check for updates on mount
  useEffect(() => {
    checkForUpdate();
  }, []);

  if (availableUpdate) {
    return (
      <View>
        <Text>Update available: v{availableUpdate.version}</Text>
        <Text>{availableUpdate.releaseNotes}</Text>
        <Button
          title={isDownloading ? `Downloading ${downloadProgress}%` : 'Update Now'}
          onPress={() => downloadAndApply()}
          disabled={isDownloading}
        />
      </View>
    );
  }

  return null;
}
```

## API Reference

### OTAProvider Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `config.serverUrl` | string | Yes | Your OTA server URL |
| `config.appSlug` | string | Yes | Your app's slug |
| `config.channel` | string | No | Release channel (default: 'production') |
| `config.publicKey` | string | No | Ed25519 public key for signature verification |
| `config.checkOnMount` | boolean | No | Auto-check for updates on mount |
| `config.applyOnDownload` | boolean | No | Auto-apply after download |

### useOTAUpdate Hook

```tsx
const {
  // State
  isChecking,          // boolean - checking for updates
  isDownloading,       // boolean - downloading update
  isApplying,          // boolean - applying update
  downloadProgress,    // number (0-100) - download progress
  availableUpdate,     // UpdateInfo | null - available update info
  error,               // Error | null - last error

  // Actions
  checkForUpdate,      // () => Promise<UpdateInfo | null>
  downloadUpdate,      // () => Promise<void>
  applyUpdate,         // () => Promise<void>
  downloadAndApply,    // () => Promise<void>
} = useOTAUpdate();
```

### UpdateInfo Type

```tsx
interface UpdateInfo {
  id: string;
  version: string;
  bundleUrl: string;
  bundleHash: string;
  bundleSignature: string | null;
  bundleSize: number;
  isMandatory: boolean;
  releaseNotes: string | null;
}
```

## Manual Update Control

For more control over the update process:

```tsx
import { useOTAUpdate } from '@vanikya/ota-react-native';

function UpdateManager() {
  const { checkForUpdate, downloadUpdate, applyUpdate, availableUpdate } = useOTAUpdate();

  const handleUpdate = async () => {
    // Step 1: Check for update
    const update = await checkForUpdate();

    if (update) {
      // Step 2: Download (user can continue using app)
      await downloadUpdate();

      // Step 3: Apply when ready (will restart app)
      // Could show a prompt or wait for app background
      await applyUpdate();
    }
  };

  return <Button title="Check for Updates" onPress={handleUpdate} />;
}
```

## Mandatory Updates

Handle mandatory updates that can't be skipped:

```tsx
function App() {
  const { availableUpdate, downloadAndApply } = useOTAUpdate();

  useEffect(() => {
    if (availableUpdate?.isMandatory) {
      // Force update for mandatory releases
      downloadAndApply();
    }
  }, [availableUpdate]);

  return <YourApp />;
}
```

## Error Handling

```tsx
function UpdateChecker() {
  const { error, checkForUpdate } = useOTAUpdate();

  if (error) {
    return (
      <View>
        <Text>Update check failed: {error.message}</Text>
        <Button title="Retry" onPress={checkForUpdate} />
      </View>
    );
  }

  return null;
}
```

## Server Setup

This SDK requires a backend server. See the [main repository](https://github.com/vanikya/ota-update) for:
- Server deployment (Cloudflare Workers)
- CLI tool for publishing updates

## How It Works

1. **Check**: App contacts server to check for newer version
2. **Download**: Bundle is downloaded and stored locally
3. **Verify**: Hash and signature are verified
4. **Apply**: App restarts with new bundle

Updates are stored locally, so the app works offline after the first download.

## License

MIT
