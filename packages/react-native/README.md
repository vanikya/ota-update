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

1. Install pods (iOS):

```bash
cd ios && pod install
```

2. **IMPORTANT**: You must manually configure native code to load OTA bundles. Without this, downloaded bundles will never be applied.

#### Android Setup (MainApplication.kt)

Add the `getJSBundleFile()` override inside your `ReactNativeHost`:

```kotlin
import android.content.SharedPreferences
import java.io.File

// Inside your MainApplication class, find the ReactNativeHost and add:
override fun getJSBundleFile(): String? {
    val prefs: SharedPreferences = applicationContext.getSharedPreferences("OTAUpdate", android.content.Context.MODE_PRIVATE)
    val bundlePath = prefs.getString("BundlePath", null)
    if (bundlePath != null && File(bundlePath).exists()) {
        return bundlePath
    }
    return null  // Falls back to default bundle
}
```

Example full `MainApplication.kt`:

```kotlin
package com.yourapp

import android.app.Application
import android.content.SharedPreferences
import java.io.File
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.defaults.DefaultReactNativeHost

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {
            // ADD THIS METHOD for OTA updates
            override fun getJSBundleFile(): String? {
                val prefs: SharedPreferences = applicationContext.getSharedPreferences("OTAUpdate", android.content.Context.MODE_PRIVATE)
                val bundlePath = prefs.getString("BundlePath", null)
                if (bundlePath != null && File(bundlePath).exists()) {
                    return bundlePath
                }
                return null
            }

            override fun getPackages() = PackageList(this).packages
            override fun getJSMainModuleName() = "index"
            override fun getUseDeveloperSupport() = BuildConfig.DEBUG
            override val isNewArchEnabled = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled = BuildConfig.IS_HERMES_ENABLED
        }

    // ... rest of your MainApplication
}
```

#### iOS Setup (AppDelegate.swift)

Modify `bundleURL()` to check for OTA bundles first:

```swift
// Add this helper function inside AppDelegate class
private func getOTABundleURL() -> URL? {
    if let bundlePath = UserDefaults.standard.string(forKey: "OTAUpdateBundlePath") {
        if FileManager.default.fileExists(atPath: bundlePath) {
            return URL(fileURLWithPath: bundlePath)
        }
    }
    return nil
}

// Modify or add this bundleURL function
func bundleURL() -> URL? {
    // Check for downloaded OTA bundle first
    if let otaBundle = getOTABundleURL() {
        return otaBundle
    }
    #if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
}
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

## Troubleshooting

### Update downloads but doesn't apply after restart

This is usually because the native code to load OTA bundles is missing. Check:

1. **For Expo apps**: Make sure you rebuilt the app with EAS Build after adding the plugin. OTA updates do NOT work in Expo Go.

2. **For bare React Native**: Make sure you added the native code changes described in the "For bare React Native apps" section above.

3. **Verify native code was injected**: During the EAS build, look for these log messages:
   - `[OTAUpdate] Android: Successfully injected getJSBundleFile`
   - `[OTAUpdate] iOS: Successfully modified bundleURL`

4. **Check if bundle path is saved**: The path is stored in:
   - Android: SharedPreferences key `"BundlePath"` in `"OTAUpdate"` preferences
   - iOS: UserDefaults key `"OTAUpdateBundlePath"`

### Bundle downloads but hash verification fails

1. Make sure your server is returning the actual JavaScript bundle, not an HTML error page
2. Check that the bundle wasn't corrupted during upload
3. Try re-publishing the release with `ota release`

### App crashes after OTA update

Call `clearCorruptedBundle()` on app startup to recover:

```tsx
import { UpdateStorage } from '@vanikya/ota-react-native';

// In your App.tsx or entry point
useEffect(() => {
  const storage = new UpdateStorage();
  storage.clearCorruptedBundle();
}, []);
```

### Debugging

Enable debug logs by checking `__DEV__` console output. The SDK logs:
- `[OTAUpdate] Bundle registered with native module`
- `[OTAUpdate] Bundle verified successfully`
- `[OTAUpdate] Update ready`

## License

MIT
