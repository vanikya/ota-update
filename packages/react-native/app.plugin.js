const { withMainApplication, withAppDelegate } = require('@expo/config-plugins');

/**
 * OTA Update Expo Config Plugin
 *
 * This plugin modifies the native code to enable OTA bundle loading:
 * - Android: Overrides getJSBundleFile() in MainApplication.kt using OTAUpdateHelper
 * - iOS: Modifies bundleURL() in AppDelegate.swift
 *
 * The modifications check SharedPreferences (Android) / UserDefaults (iOS)
 * for a pending OTA bundle path and load it instead of the default bundle.
 */

function withOTAUpdateAndroid(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    // Check if already modified
    if (contents.includes('OTAUpdateHelper')) {
      console.log('[OTAUpdate] Android: OTAUpdateHelper already present, skipping');
      return config;
    }

    // Add import for OTAUpdateHelper
    const packageMatch = contents.match(/^package\s+[\w.]+\s*\n/m);
    if (packageMatch) {
      const insertPos = packageMatch.index + packageMatch[0].length;
      // Check if import section exists
      if (!contents.includes('import com.otaupdate.OTAUpdateHelper')) {
        const importStatement = `\nimport com.otaupdate.OTAUpdateHelper\n`;
        contents = contents.slice(0, insertPos) + importStatement + contents.slice(insertPos);
      }
    }

    // The getJSBundleFile override that uses our helper
    const getJSBundleFileOverride = `
      override fun getJSBundleFile(): String? {
        return OTAUpdateHelper.getJSBundleFile(applicationContext)
      }
`;

    // Strategy 1: Look for "object : DefaultReactNativeHost" pattern
    // This handles most Expo SDK 50+ apps
    const defaultHostPattern = /(object\s*:\s*DefaultReactNativeHost\s*\([^)]*\)\s*\{)/;

    if (defaultHostPattern.test(contents)) {
      contents = contents.replace(
        defaultHostPattern,
        `$1${getJSBundleFileOverride}`
      );
      console.log('[OTAUpdate] Android: Successfully injected getJSBundleFile (DefaultReactNativeHost pattern)');
      config.modResults.contents = contents;
      return config;
    }

    // Strategy 2: Look for "override val reactNativeHost" with object block
    const reactNativeHostPattern = /(override\s+val\s+reactNativeHost[^=]*=\s*object[^{]*\{)/;

    if (reactNativeHostPattern.test(contents)) {
      contents = contents.replace(
        reactNativeHostPattern,
        `$1${getJSBundleFileOverride}`
      );
      console.log('[OTAUpdate] Android: Successfully injected getJSBundleFile (reactNativeHost pattern)');
      config.modResults.contents = contents;
      return config;
    }

    // Strategy 3: Look for any ReactNativeHost object block
    const anyHostPattern = /(ReactNativeHost\s*\([^)]*\)\s*\{)/;

    if (anyHostPattern.test(contents)) {
      contents = contents.replace(
        anyHostPattern,
        `$1${getJSBundleFileOverride}`
      );
      console.log('[OTAUpdate] Android: Successfully injected getJSBundleFile (generic ReactNativeHost pattern)');
      config.modResults.contents = contents;
      return config;
    }

    // Strategy 4: Find the class and look for the host definition more flexibly
    // Look for "override fun getUseDeveloperSupport" and insert before it
    const devSupportPattern = /([\t ]*)(override\s+fun\s+getUseDeveloperSupport)/;

    if (devSupportPattern.test(contents)) {
      const indentMatch = contents.match(devSupportPattern);
      const indent = indentMatch ? indentMatch[1] : '      ';
      const overrideCode = `${indent}override fun getJSBundleFile(): String? {\n${indent}  return OTAUpdateHelper.getJSBundleFile(applicationContext)\n${indent}}\n\n${indent}`;
      contents = contents.replace(
        devSupportPattern,
        `${overrideCode}$2`
      );
      console.log('[OTAUpdate] Android: Successfully injected getJSBundleFile (before getUseDeveloperSupport)');
      config.modResults.contents = contents;
      return config;
    }

    // Strategy 5: Last resort - find any class with Application and inject
    // Look for the ReactApplication interface implementation
    const reactAppPattern = /(class\s+\w+\s*:\s*Application\s*\(\s*\)\s*,\s*ReactApplication\s*\{)/;

    if (reactAppPattern.test(contents)) {
      // Find where to inject - after the class opening
      const classMatch = contents.match(reactAppPattern);
      if (classMatch) {
        const insertPos = classMatch.index + classMatch[0].length;
        const helperComment = `
  // OTA Update: Override to load OTA bundle if available
  private fun getOTABundleFile(): String? {
    return OTAUpdateHelper.getJSBundleFile(applicationContext)
  }
`;
        contents = contents.slice(0, insertPos) + helperComment + contents.slice(insertPos);
        console.log('[OTAUpdate] Android: Added OTA helper method to Application class');
        console.log('[OTAUpdate] Android: WARNING - You may need to manually wire getJSBundleFile() override');
      }
    }

    // Log the current MainApplication structure for debugging
    console.warn('[OTAUpdate] Android: Could not find standard injection point');
    console.warn('[OTAUpdate] Android: Please ensure your MainApplication.kt has a ReactNativeHost definition');
    console.warn('[OTAUpdate] Android: You may need to manually add the getJSBundleFile override');
    console.warn('[OTAUpdate] Android: See https://vanikya.github.io/ota-update/ for manual setup instructions');

    // Log first 100 lines for debugging
    const lines = contents.split('\n').slice(0, 100);
    console.log('[OTAUpdate] Android: First 100 lines of MainApplication.kt:');
    lines.forEach((line, i) => {
      if (line.includes('ReactNativeHost') || line.includes('DefaultReactNativeHost') ||
          line.includes('getJSBundleFile') || line.includes('override')) {
        console.log(`  ${i + 1}: ${line}`);
      }
    });

    config.modResults.contents = contents;
    return config;
  });
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
        NSLog("[OTAUpdate] OTA bundle not found at path: %@", path)
        // Clear invalid path
        UserDefaults.standard.removeObject(forKey: "OTAUpdateBundlePath")
      }
    }
    NSLog("[OTAUpdate] Loading default bundle")
    return nil
  }
`;

      // Strategy 1: Look for bundleURL() with flexible pattern
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
        console.log('[OTAUpdate] iOS: Successfully modified bundleURL (pattern 1)');
        config.modResults.contents = contents;
        return config;
      }

      // Strategy 2: Look for sourceURL(for bridge:) pattern (older Expo versions)
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
        console.log('[OTAUpdate] iOS: Successfully modified sourceURL (pattern 2)');
        config.modResults.contents = contents;
        return config;
      }

      // Strategy 3: Add bundleURL method if it doesn't exist but class exists
      const appDelegateClassPattern = /(class\s+AppDelegate\s*[^{]*\{)/;

      if (appDelegateClassPattern.test(contents) && !contents.includes('func bundleURL')) {
        const newBundleURLMethod = `
  // OTA Update: Bundle URL with OTA support
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
${helperFunction}
`;
        contents = contents.replace(
          appDelegateClassPattern,
          `$1${newBundleURLMethod}`
        );
        console.log('[OTAUpdate] iOS: Successfully added bundleURL method (pattern 3)');
        config.modResults.contents = contents;
        return config;
      }

      console.warn('[OTAUpdate] iOS: Could not find suitable injection point');
      console.warn('[OTAUpdate] iOS: Please manually modify AppDelegate.swift');
      console.warn('[OTAUpdate] iOS: See https://vanikya.github.io/ota-update/ for manual setup instructions');
    } else if (config.modResults.language === 'objc' || config.modResults.language === 'objcpp') {
      // Objective-C AppDelegate (older Expo versions)
      const sourceURLPattern = /(- \(NSURL \*\)sourceURLForBridge:\(RCTBridge \*\)bridge\s*\{)([\s\S]*?)(\n\})/;

      if (sourceURLPattern.test(contents)) {
        const helperCode = `
  // Check for OTA bundle
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

// Export individual functions for testing
module.exports.withOTAUpdateAndroid = withOTAUpdateAndroid;
module.exports.withOTAUpdateIOS = withOTAUpdateIOS;
