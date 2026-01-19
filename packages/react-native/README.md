# @vanikya/ota-react-native

> **Beta Notice**: This package is currently in beta. Testing is in progress and APIs may change. Use in production at your own discretion. We welcome feedback and bug reports via [GitHub Issues](https://github.com/vanikya/ota-update/issues).

**[Documentation](https://vanikya.github.io/ota-update/)** | **[GitHub](https://github.com/vanikya/ota-update)** | **[npm](https://www.npmjs.com/package/@vanikya/ota-react-native)**

React Native SDK for OTA (Over-The-Air) updates. A self-hosted alternative to CodePush and EAS Updates.

Works with both **Expo** and **bare React Native** apps.

## Installation

```bash
npm install @vanikya/ota-react-native
```

### For Expo apps (EAS Build)

1. Install Expo dependencies:

```bash
npx expo install expo-file-system expo-crypto
```

2. Add the config plugin to your `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": [
      "@vanikya/ota-react-native"
    ]
  }
}
```

3. Rebuild your app with EAS Build:

```bash
eas build --platform android
# or
eas build --platform ios
```

> **Important**: OTA updates require a native build with EAS Build. They will NOT work in Expo Go because the plugin modifies native code to load custom bundles.

### For bare React Native apps

Install pods (iOS):

```bash
cd ios && pod install
```

## Quick Start

### 1. Wrap your app with OTAProvider

```tsx
import { OTAProvider } from '@vanikya/ota-react-native';
import Constants from 'expo-constants';

export default function App() {
  return (
    <OTAProvider
      config={{
        serverUrl: 'https://your-server.workers.dev',
        appSlug: 'my-app',
        channel: 'production',
        appVersion: Constants.expoConfig?.version || '1.0.0',
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
| `config.appVersion` | string | Yes | Your native app version (e.g., "1.0.0") |
| `config.channel` | string | No | Release channel (default: 'production') |
| `config.publicKey` | string | No | Ed25519 public key for signature verification |
| `config.checkOnMount` | boolean | No | Auto-check for updates on mount |
| `config.checkOnForeground` | boolean | No | Auto-check when app comes to foreground |

### useOTAUpdate Hook

```tsx
const {
  // State
  status,              // UpdateStatus - current status
  isChecking,          // boolean - checking for updates
  isDownloading,       // boolean - downloading update
  isApplying,          // boolean - applying update
  downloadProgress,    // DownloadProgress | null - download progress
  updateInfo,          // UpdateInfo | null - available update info
  error,               // Error | null - last error
  isDismissed,         // boolean - whether user dismissed the update

  // Actions
  checkForUpdate,      // () => Promise<UpdateInfo | null>
  downloadUpdate,      // () => Promise<void>
  applyUpdate,         // (restartApp?: boolean) => Promise<void>
  clearPendingUpdate,  // () => Promise<void>
  dismissUpdate,       // () => void - dismiss update notification
  resetDismiss,        // () => void - reset dismiss state
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
  const { updateInfo, downloadAndApply } = useOTAUpdate();

  useEffect(() => {
    if (updateInfo?.isMandatory) {
      // Force update for mandatory releases
      downloadAndApply();
    }
  }, [updateInfo]);

  return <YourApp />;
}
```

## Dismissable Update Banner

Allow users to dismiss optional updates:

```tsx
function UpdateBanner() {
  const { updateInfo, isDismissed, dismissUpdate, downloadAndApply, isDownloading } = useOTAUpdate();

  // Don't show if no update or user dismissed
  if (!updateInfo || isDismissed) {
    return null;
  }

  // Force mandatory updates (can't dismiss)
  if (updateInfo.isMandatory) {
    return (
      <View>
        <Text>Required update: v{updateInfo.version}</Text>
        <Button title="Update Now" onPress={downloadAndApply} />
      </View>
    );
  }

  return (
    <View>
      <Text>Update available: v{updateInfo.version}</Text>
      <Button title="Update" onPress={downloadAndApply} disabled={isDownloading} />
      <Button title="Later" onPress={dismissUpdate} />
    </View>
  );
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

### How Expo Plugin Works

For Expo apps built with EAS Build, the config plugin modifies the native code to enable OTA updates:

**Android** (`MainApplication.kt`):
- Overrides `getJSBundleFile()` to check SharedPreferences for a downloaded bundle path
- If a valid bundle exists, it loads that instead of the built-in bundle

**iOS** (`AppDelegate.swift`):
- Modifies `bundleURL()` to check UserDefaults for a downloaded bundle path
- If a valid bundle exists, it returns that URL instead of the built-in bundle

When you call `applyUpdate()` or the download completes:
1. The bundle is saved to the device's document directory
2. The path is registered with native storage (SharedPreferences/UserDefaults)
3. On the next app restart, the native code loads the OTA bundle

> **Note**: OTA updates only work on EAS Build apps, not Expo Go, because Expo Go doesn't include the native module.

## Version Targeting

Target specific native app versions when publishing updates using the CLI:

```bash
# Only send updates to app versions >= 2.0.0
ota release --app my-app --min-app-version 2.0.0

# Only send updates to app versions between 2.0.0 and 2.5.0
ota release --app my-app --min-app-version 2.0.0 --max-app-version 2.5.0
```

This is useful when:
- You have breaking changes that only work with newer native builds
- You want to phase out support for older app versions
- Different native versions have different API requirements

## Recovering from Corrupted Updates

If an OTA update becomes corrupted (causing app crashes), you can clear it:

```tsx
import { UpdateStorage } from '@vanikya/ota-react-native';

// On app startup, check for and clear corrupted bundles
async function recoverFromCorruptedUpdate() {
  const storage = new UpdateStorage();
  const wasCorrupted = await storage.clearCorruptedBundle();
  if (wasCorrupted) {
    console.log('Cleared corrupted OTA bundle, app will use built-in bundle');
  }
}
```

The SDK now validates downloaded bundles to prevent HTML error pages or corrupted files from being saved as bundles.

## License

MIT
