# OTA Update - Usage Guide

This guide explains how to integrate OTA Update into your existing Expo or React Native app.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Server Setup](#server-setup)
- [CLI Setup](#cli-setup)
- [SDK Installation](#sdk-installation)
  - [Expo Apps](#expo-apps)
  - [Bare React Native Apps](#bare-react-native-apps)
- [App Integration](#app-integration)
- [Publishing Updates](#publishing-updates)
- [Advanced Usage](#advanced-usage)
- [Migrating from EAS Updates](#migrating-from-eas-updates)
- [Migrating from CodePush](#migrating-from-codepush)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Node.js 18+
- An Expo (SDK 49+) or React Native (0.70+) app
- Access to the OTA Update server (self-hosted or provided)

---

## Server Setup

If you're self-hosting, deploy the server first. See the main [README.md](../README.md) for deployment instructions.

**Your server URL:** `https://ota-update-server.muddy-grass-140b.workers.dev`

---

## CLI Setup

### 1. Install the CLI

```bash
# Option A: Install globally from npm (when published)
npm install -g @ota-update/cli

# Option B: Use from local build
cd /path/to/ota-update/packages/cli
npm install
npm run build
```

### 2. Login to the Server

```bash
# Interactive login
ota login

# Or with flags
ota login \
  --server https://ota-update-server.muddy-grass-140b.workers.dev \
  --api-key YOUR_API_KEY
```

### 3. Create Your App

```bash
# Create an app with code signing enabled
ota apps create \
  --name "My App" \
  --slug my-app \
  --platform both

# This creates:
# - Your app on the server
# - Default channels: production, staging
# - Signing keys in ~/.ota-update/keys/
```

### 4. Initialize in Your Project

```bash
cd /path/to/your/react-native-app

# Create ota-update.json config file
ota init
```

This creates `ota-update.json`:

```json
{
  "appSlug": "my-app",
  "channel": "production",
  "platform": "both"
}
```

---

## SDK Installation

### Expo Apps

#### Step 1: Install the SDK

```bash
# Install the OTA Update SDK
npx expo install @ota-update/react-native

# Install required Expo dependencies
npx expo install expo-file-system expo-crypto
```

#### Step 2: No Native Changes Required

Expo handles everything automatically. The SDK uses `expo-file-system` for storage and `expo-crypto` for verification.

---

### Bare React Native Apps

#### Step 1: Install the SDK

```bash
npm install @ota-update/react-native
# or
yarn add @ota-update/react-native
```

#### Step 2: iOS Setup

```bash
cd ios
pod install
cd ..
```

The native module is auto-linked. No manual changes required.

#### Step 3: Android Setup

The native module is auto-linked. No manual changes required.

If you have issues, ensure your `android/app/build.gradle` has:

```gradle
dependencies {
    implementation project(':ota-update-react-native')
}
```

---

## App Integration

### Basic Setup

Wrap your app with `OTAProvider`:

```tsx
// App.tsx
import React from 'react';
import { OTAProvider } from '@ota-update/react-native';

// Import your app version
const APP_VERSION = '1.0.0'; // Or from package.json

export default function App() {
  return (
    <OTAProvider
      config={{
        serverUrl: 'https://ota-update-server.muddy-grass-140b.workers.dev',
        appSlug: 'my-app',
        appVersion: APP_VERSION,
        channel: __DEV__ ? 'staging' : 'production',
      }}
    >
      <YourApp />
    </OTAProvider>
  );
}
```

### Configuration Options

```tsx
<OTAProvider
  config={{
    // Required
    serverUrl: 'https://your-server.workers.dev',
    appSlug: 'my-app',
    appVersion: '1.0.0',

    // Optional
    channel: 'production',        // Default: 'production'
    publicKey: 'your-public-key', // For signature verification
    checkOnMount: true,           // Check on app start (default: true)
    checkOnForeground: true,      // Check when app foregrounds (default: true)
  }}

  // Event callbacks
  onUpdateAvailable={(info) => {
    console.log('Update available:', info.version);
  }}
  onUpdateDownloaded={() => {
    console.log('Update downloaded and ready');
  }}
  onError={(error) => {
    console.error('OTA error:', error);
  }}

  // Mandatory update handling
  showMandatoryUpdateAlert={true}
  mandatoryUpdateAlertTitle="Update Required"
  mandatoryUpdateAlertMessage="Please update to continue using the app."
>
```

### Using the Hook

Access update state and controls anywhere in your app:

```tsx
import { useOTA } from '@ota-update/react-native';

function MyComponent() {
  const {
    // State
    status,           // 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
    updateInfo,       // { version, releaseNotes, isMandatory, bundleSize }
    downloadProgress, // { downloadedBytes, totalBytes, percentage }
    error,            // Error object if status is 'error'
    currentVersion,   // Currently installed OTA version

    // Actions
    checkForUpdate,   // () => Promise<UpdateInfo | null>
    downloadUpdate,   // () => Promise<void>
    applyUpdate,      // (restart?: boolean) => Promise<void>
    clearPendingUpdate, // () => Promise<void>
  } = useOTA();

  return (
    // Your UI
  );
}
```

### Example: Update Banner

```tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useOTA } from '@ota-update/react-native';

export function UpdateBanner() {
  const { status, updateInfo, downloadProgress, downloadUpdate, applyUpdate } = useOTA();

  if (status === 'available' && updateInfo) {
    return (
      <TouchableOpacity style={styles.banner} onPress={downloadUpdate}>
        <Text style={styles.text}>
          Update available: v{updateInfo.version}
        </Text>
        <Text style={styles.subtext}>Tap to download</Text>
      </TouchableOpacity>
    );
  }

  if (status === 'downloading' && downloadProgress) {
    return (
      <View style={[styles.banner, styles.downloading]}>
        <Text style={styles.text}>
          Downloading... {Math.round(downloadProgress.percentage)}%
        </Text>
      </View>
    );
  }

  if (status === 'ready') {
    return (
      <TouchableOpacity
        style={[styles.banner, styles.ready]}
        onPress={() => applyUpdate(true)}
      >
        <Text style={styles.text}>Update ready!</Text>
        <Text style={styles.subtext}>Tap to restart</Text>
      </TouchableOpacity>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#2196F3',
    padding: 12,
    alignItems: 'center',
  },
  downloading: {
    backgroundColor: '#FF9800',
  },
  ready: {
    backgroundColor: '#4CAF50',
  },
  text: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  subtext: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
  },
});
```

### Example: Settings Screen

```tsx
import React from 'react';
import { View, Text, Button, Alert } from 'react-native';
import { useOTA } from '@ota-update/react-native';

export function SettingsScreen() {
  const {
    status,
    currentVersion,
    updateInfo,
    checkForUpdate,
    downloadUpdate,
    applyUpdate
  } = useOTA();

  const handleCheckUpdate = async () => {
    const update = await checkForUpdate();
    if (!update) {
      Alert.alert('Up to date', 'You have the latest version.');
    }
  };

  const handleDownload = async () => {
    try {
      await downloadUpdate();
      Alert.alert(
        'Update Ready',
        'Restart the app to apply the update.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Restart Now', onPress: () => applyUpdate(true) },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to download update.');
    }
  };

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold' }}>App Updates</Text>

      <Text style={{ marginTop: 10 }}>
        Current OTA Version: {currentVersion || 'None'}
      </Text>

      <Text style={{ marginTop: 5, color: '#666' }}>
        Status: {status}
      </Text>

      {status === 'idle' && (
        <Button title="Check for Updates" onPress={handleCheckUpdate} />
      )}

      {status === 'checking' && (
        <Text>Checking for updates...</Text>
      )}

      {status === 'available' && updateInfo && (
        <View style={{ marginTop: 10 }}>
          <Text>New version available: {updateInfo.version}</Text>
          {updateInfo.releaseNotes && (
            <Text style={{ color: '#666' }}>{updateInfo.releaseNotes}</Text>
          )}
          <Button title="Download Update" onPress={handleDownload} />
        </View>
      )}

      {status === 'downloading' && (
        <Text>Downloading update...</Text>
      )}

      {status === 'ready' && (
        <Button title="Restart to Apply Update" onPress={() => applyUpdate(true)} />
      )}
    </View>
  );
}
```

### Example: Silent Background Updates

```tsx
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useOTA } from '@ota-update/react-native';

export function useSilentUpdates() {
  const { status, checkForUpdate, downloadUpdate, applyUpdate } = useOTA();

  useEffect(() => {
    // Auto-download when update is available
    if (status === 'available') {
      downloadUpdate();
    }
  }, [status]);

  useEffect(() => {
    // Apply update when app goes to background (next launch will use new version)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' && status === 'ready') {
        applyUpdate(false); // Don't restart, apply on next launch
      }
    });

    return () => subscription.remove();
  }, [status]);
}
```

---

## Publishing Updates

### Basic Release

```bash
# Navigate to your React Native project
cd /path/to/your/app

# Publish an update
ota release \
  --app my-app \
  --channel production \
  --version 1.0.1 \
  --platform ios \
  --notes "Bug fixes and improvements"
```

### Release Options

```bash
ota release \
  --app my-app \                    # App slug (or use ota-update.json)
  --channel production \            # Channel name
  --version 1.0.1 \                 # Semantic version
  --platform ios \                  # ios or android
  --notes "Release notes" \         # Optional release notes
  --mandatory \                     # Force users to update
  --rollout 10 \                    # Start with 10% of users
  --min-app-version 1.0.0 \         # Minimum native app version
  --max-app-version 2.0.0           # Maximum native app version
```

### Gradual Rollout

```bash
# Start with 10%
ota release --app my-app --version 1.0.1 --platform ios --rollout 10

# Monitor analytics
ota analytics --app my-app

# Increase to 50%
# First, get the release ID
ota releases --app my-app

# Then update rollout (via API or future CLI command)

# Full rollout
ota release --app my-app --version 1.0.1 --platform ios --rollout 100
```

### Rollback

```bash
# Interactive rollback
ota rollback --app my-app --channel production

# Rollback to specific version
ota rollback --app my-app --release rel_xxxxx
```

### Multi-Platform Release

```bash
# Release for both platforms
ota release --app my-app --version 1.0.1 --platform ios
ota release --app my-app --version 1.0.1 --platform android
```

---

## Advanced Usage

### Multiple Channels

```bash
# Create channels
ota channels create staging --app my-app
ota channels create beta --app my-app

# Release to staging first
ota release --app my-app --channel staging --version 1.0.1 --platform ios

# Test, then promote to production
ota release --app my-app --channel production --version 1.0.1 --platform ios
```

### Environment-Based Channels

```tsx
// App.tsx
const getChannel = () => {
  if (__DEV__) return 'development';
  if (Config.ENV === 'staging') return 'staging';
  return 'production';
};

<OTAProvider
  config={{
    serverUrl: 'https://your-server.workers.dev',
    appSlug: 'my-app',
    appVersion: '1.0.0',
    channel: getChannel(),
  }}
>
```

### Code Signing

```bash
# Generate signing keys (done automatically on app create)
ota keys generate --app my-app

# Export public key (to add to your app config)
ota keys export --app my-app
```

Add to your app:

```tsx
<OTAProvider
  config={{
    serverUrl: 'https://your-server.workers.dev',
    appSlug: 'my-app',
    appVersion: '1.0.0',
    publicKey: 'your-public-key-hex-string',
  }}
>
```

### Using Without Provider

```tsx
import { useOTAUpdate } from '@ota-update/react-native';

function MyComponent() {
  const ota = useOTAUpdate({
    serverUrl: 'https://your-server.workers.dev',
    appSlug: 'my-app',
    appVersion: '1.0.0',
  });

  // Use ota.checkForUpdate(), etc.
}
```

---

## Migrating from EAS Updates

### Step 1: Remove EAS Updates

```bash
# Uninstall expo-updates
npx expo install --remove expo-updates
```

### Step 2: Update app.json

```diff
{
  "expo": {
-   "updates": {
-     "url": "https://u.expo.dev/xxx",
-     "enabled": true
-   },
-   "runtimeVersion": {
-     "policy": "sdkVersion"
-   },
  }
}
```

### Step 3: Replace Code

```diff
- import * as Updates from 'expo-updates';
+ import { useOTA } from '@ota-update/react-native';

function MyComponent() {
- const checkUpdate = async () => {
-   const update = await Updates.checkForUpdateAsync();
-   if (update.isAvailable) {
-     await Updates.fetchUpdateAsync();
-     await Updates.reloadAsync();
-   }
- };

+ const { checkForUpdate, downloadUpdate, applyUpdate } = useOTA();
+
+ const checkUpdate = async () => {
+   const update = await checkForUpdate();
+   if (update) {
+     await downloadUpdate();
+     await applyUpdate(true);
+   }
+ };
}
```

### API Mapping

| EAS Updates | OTA Update |
|-------------|------------|
| `Updates.checkForUpdateAsync()` | `checkForUpdate()` |
| `Updates.fetchUpdateAsync()` | `downloadUpdate()` |
| `Updates.reloadAsync()` | `applyUpdate(true)` |
| `Updates.isAvailable` | `status === 'available'` |
| `Updates.manifest` | `updateInfo` |

---

## Migrating from CodePush

### Step 1: Remove CodePush

```bash
npm uninstall react-native-code-push
```

Remove CodePush from native files (iOS `AppDelegate`, Android `MainApplication`).

### Step 2: Replace Code

```diff
- import codePush from 'react-native-code-push';
+ import { OTAProvider } from '@ota-update/react-native';

- const App = () => { ... };
- export default codePush(codePushOptions)(App);

+ const App = () => {
+   return (
+     <OTAProvider config={{...}}>
+       <YourApp />
+     </OTAProvider>
+   );
+ };
+ export default App;
```

### API Mapping

| CodePush | OTA Update |
|----------|------------|
| `codePush.sync()` | Auto via `OTAProvider` |
| `codePush.checkForUpdate()` | `checkForUpdate()` |
| `codePush.sync(InstallMode.IMMEDIATE)` | `applyUpdate(true)` |
| `codePush.sync(InstallMode.ON_NEXT_RESTART)` | `applyUpdate(false)` |
| Deployment keys | Channels (`production`, `staging`) |

---

## Troubleshooting

### "No update available" when there should be

1. **Check channel name** matches between app and release
2. **Check app version** compatibility (`minAppVersion`, `maxAppVersion`)
3. **Check rollout percentage** - your device may not be in the rollout group
4. **Clear cache**: `await clearPendingUpdate()`

### Bundle verification failed

1. Ensure signing keys match between CLI and server
2. Re-generate keys: `ota keys generate --app my-app`
3. Update your app's `publicKey` config

### Native module not found (bare RN)

```bash
# iOS
cd ios && pod install && cd ..

# Android - clean build
cd android && ./gradlew clean && cd ..
```

### Download fails

1. Check network connectivity
2. Verify server URL is correct
3. Check server logs: `wrangler tail`

### Update not applying

For Expo: Updates apply on next app restart by default.

For bare RN: Ensure native module is properly linked and `applyUpdate(true)` is called.

---

## CLI Command Reference

```bash
# Authentication
ota login                    # Interactive login
ota logout                   # Clear credentials
ota whoami                   # Show current user

# Apps
ota apps list                # List all apps
ota apps create              # Create new app
ota apps info <id>           # Get app details
ota apps delete <id>         # Delete app

# Channels
ota channels list            # List channels
ota channels create <name>   # Create channel
ota channels delete <name>   # Delete channel

# Releases
ota release                  # Publish update
ota releases                 # List releases
ota rollback                 # Rollback to previous

# Analytics
ota analytics                # View update stats

# Keys
ota keys generate            # Generate signing keys
ota keys export              # Export public key

# Project
ota init                     # Initialize project config
```

---

## Support

- **Issues**: [GitHub Issues](https://github.com/your-org/ota-update/issues)
- **Documentation**: [Full README](../README.md)
