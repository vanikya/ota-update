const { withAppDelegate } = require('@expo/config-plugins');

/**
 * OTA Update Expo Config Plugin
 *
 * This plugin modifies the native code to enable OTA bundle loading:
 * - Android: Uses Expo Package interface (ReactNativeHostHandler) via expo-module.config.json
 *            No MainApplication.kt modification needed!
 * - iOS: Modifies bundleURL() in AppDelegate.swift
 */

function withOTAUpdateAndroid(config) {
  // Android bundle loading is handled by OTAUpdateExpoPackage implementing
  // expo.modules.core.interfaces.Package with ReactNativeHostHandler.
  // This is registered via expo-module.config.json and discovered by Expo automatically.
  console.log('[OTAUpdate] Android: Using Expo Package interface (ReactNativeHostHandler)');
  return config;
}

function withOTAUpdateIOS(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;

    // Check if already modified
    if (contents.includes('OTAUpdateBundlePath')) {
      console.log('[OTAUpdate] iOS: OTAUpdateBundlePath already present, skipping');
      return config;
    }

    // For Swift AppDelegate
    if (config.modResults.language === 'swift') {
      // Helper function to get OTA bundle URL
      const helperFunction = `
  // OTA Update: Check for downloaded bundle
  private func getOTABundleURL() -> URL? {
    let bundlePath = UserDefaults.standard.string(forKey: "OTAUpdateBundlePath")
    NSLog("[OTAUpdate] getOTABundleURL called, stored path: %@", bundlePath ?? "nil")
    if let path = bundlePath {
      let fileManager = FileManager.default
      if fileManager.fileExists(atPath: path) {
        if let attrs = try? fileManager.attributesOfItem(atPath: path),
           let size = attrs[.size] as? Int64 {
          NSLog("[OTAUpdate] Loading OTA bundle: %@ (%lld bytes)", path, size)
        }
        return URL(fileURLWithPath: path)
      } else {
        NSLog("[OTAUpdate] OTA bundle not found at path: %@, clearing", path)
        UserDefaults.standard.removeObject(forKey: "OTAUpdateBundlePath")
      }
    }
    NSLog("[OTAUpdate] Loading default bundle")
    return nil
  }
`;

      // Strategy 1: Look for bundleURL()
      const bundleURLPattern1 = /(func\s+bundleURL\s*\(\s*\)\s*->\s*URL\?\s*\{)([\s\S]*?)(\n\s*\})/;

      if (bundleURLPattern1.test(contents)) {
        contents = contents.replace(
          bundleURLPattern1,
          (match, funcStart, funcBody, funcEnd) => {
            if (funcBody.includes('getOTABundleURL')) {
              return match;
            }
            return `${funcStart}
    // OTA Update: Check for downloaded bundle first
    if let otaBundle = getOTABundleURL() {
      return otaBundle
    }
${funcBody}${funcEnd}${helperFunction}`;
          }
        );
        console.log('[OTAUpdate] iOS: Successfully modified bundleURL');
        config.modResults.contents = contents;
        return config;
      }

      // Strategy 2: Look for sourceURL(for bridge:)
      const sourceURLPattern = /(func\s+sourceURL\s*\(\s*for\s+bridge\s*:\s*RCTBridge\s*\)\s*->\s*URL\?\s*\{)([\s\S]*?)(\n\s*\})/;

      if (sourceURLPattern.test(contents)) {
        contents = contents.replace(
          sourceURLPattern,
          (match, funcStart, funcBody, funcEnd) => {
            if (funcBody.includes('getOTABundleURL')) {
              return match;
            }
            return `${funcStart}
    // OTA Update: Check for downloaded bundle first
    if let otaBundle = getOTABundleURL() {
      return otaBundle
    }
${funcBody}${funcEnd}${helperFunction}`;
          }
        );
        console.log('[OTAUpdate] iOS: Successfully modified sourceURL');
        config.modResults.contents = contents;
        return config;
      }

      console.warn('[OTAUpdate] iOS: Could not find bundleURL or sourceURL method');
    } else if (config.modResults.language === 'objc' || config.modResults.language === 'objcpp') {
      // Objective-C AppDelegate
      const sourceURLPattern = /(- \(NSURL \*\)sourceURLForBridge:\(RCTBridge \*\)bridge\s*\{)([\s\S]*?)(\n\})/;

      if (sourceURLPattern.test(contents)) {
        const helperCode = `
  // OTA Update: Check for OTA bundle
  NSString *bundlePath = [[NSUserDefaults standardUserDefaults] stringForKey:@"OTAUpdateBundlePath"];
  if (bundlePath && [[NSFileManager defaultManager] fileExistsAtPath:bundlePath]) {
    NSLog(@"[OTAUpdate] Loading OTA bundle: %@", bundlePath);
    return [NSURL fileURLWithPath:bundlePath];
  }
  NSLog(@"[OTAUpdate] Loading default bundle");
`;
        contents = contents.replace(
          sourceURLPattern,
          (match, funcStart, funcBody, funcEnd) => {
            if (funcBody.includes('OTAUpdateBundlePath')) {
              return match;
            }
            return `${funcStart}${helperCode}${funcBody}${funcEnd}`;
          }
        );
        console.log('[OTAUpdate] iOS: Successfully modified sourceURLForBridge (Obj-C)');
        config.modResults.contents = contents;
        return config;
      }
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = function withOTAUpdate(config) {
  config = withOTAUpdateAndroid(config);
  config = withOTAUpdateIOS(config);
  return config;
};

module.exports.withOTAUpdateAndroid = withOTAUpdateAndroid;
module.exports.withOTAUpdateIOS = withOTAUpdateIOS;
