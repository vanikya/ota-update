const { withMainApplication, withAppDelegate } = require('@expo/config-plugins');

/**
 * OTA Update Expo Config Plugin
 *
 * This plugin modifies the native code to enable OTA bundle loading:
 * - Android: Overrides getJSBundleFile() in MainApplication.kt
 * - iOS: Modifies bundleURL() in AppDelegate.swift
 *
 * The modifications check SharedPreferences (Android) / UserDefaults (iOS)
 * for a pending OTA bundle path and load it instead of the default bundle.
 */

function withOTAUpdateAndroid(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    // Check if already modified
    if (contents.includes('getJSBundleFile')) {
      console.log('[OTAUpdate] Android: getJSBundleFile already present, skipping');
      return config;
    }

    // Add imports if not present
    if (!contents.includes('import android.content.SharedPreferences')) {
      // Find the package declaration and add imports after it
      const packageMatch = contents.match(/^package\s+[\w.]+\s*\n/m);
      if (packageMatch) {
        const insertPos = packageMatch.index + packageMatch[0].length;
        const imports = `\nimport android.content.SharedPreferences\nimport java.io.File\n`;
        contents = contents.slice(0, insertPos) + imports + contents.slice(insertPos);
      }
    }

    // Strategy 1: Look for "override val reactNativeHost" pattern (Expo SDK 50+)
    // This is more reliable than matching getUseDeveloperSupport
    const reactNativeHostPattern = /(override\s+val\s+reactNativeHost\s*:\s*ReactNativeHost\s*=\s*object\s*:\s*DefaultReactNativeHost\s*\(\s*this\s*\)\s*\{)/;

    if (reactNativeHostPattern.test(contents)) {
      const getJSBundleFileOverride = `
      override fun getJSBundleFile(): String? {
        val prefs: SharedPreferences = applicationContext.getSharedPreferences("OTAUpdate", android.content.Context.MODE_PRIVATE)
        val bundlePath = prefs.getString("BundlePath", null)
        android.util.Log.d("OTAUpdate", "getJSBundleFile called, stored path: $bundlePath")
        if (bundlePath != null) {
          val file = File(bundlePath)
          if (file.exists() && file.canRead()) {
            android.util.Log.d("OTAUpdate", "Loading OTA bundle: $bundlePath (${file.length()} bytes)")
            return bundlePath
          } else {
            android.util.Log.w("OTAUpdate", "OTA bundle not found or not readable: $bundlePath, exists=${file.exists()}")
          }
        }
        android.util.Log.d("OTAUpdate", "Loading default bundle")
        return null
      }
`;
      contents = contents.replace(
        reactNativeHostPattern,
        `$1${getJSBundleFileOverride}`
      );
      console.log('[OTAUpdate] Android: Successfully injected getJSBundleFile (pattern 1)');
      config.modResults.contents = contents;
      return config;
    }

    // Strategy 2: Look for DefaultReactNativeHost with different formatting
    const altPattern = /(object\s*:\s*DefaultReactNativeHost\s*\(\s*this\s*\)\s*\{)/;

    if (altPattern.test(contents)) {
      const getJSBundleFileOverride = `
      override fun getJSBundleFile(): String? {
        val prefs: SharedPreferences = applicationContext.getSharedPreferences("OTAUpdate", android.content.Context.MODE_PRIVATE)
        val bundlePath = prefs.getString("BundlePath", null)
        android.util.Log.d("OTAUpdate", "getJSBundleFile called, stored path: $bundlePath")
        if (bundlePath != null) {
          val file = File(bundlePath)
          if (file.exists() && file.canRead()) {
            android.util.Log.d("OTAUpdate", "Loading OTA bundle: $bundlePath (${file.length()} bytes)")
            return bundlePath
          } else {
            android.util.Log.w("OTAUpdate", "OTA bundle not found or not readable: $bundlePath, exists=${file.exists()}")
          }
        }
        android.util.Log.d("OTAUpdate", "Loading default bundle")
        return null
      }
`;
      contents = contents.replace(
        altPattern,
        `$1${getJSBundleFileOverride}`
      );
      console.log('[OTAUpdate] Android: Successfully injected getJSBundleFile (pattern 2)');
      config.modResults.contents = contents;
      return config;
    }

    // Strategy 3: Look for getUseDeveloperSupport with flexible whitespace
    const devSupportPattern = /(override\s+fun\s+getUseDeveloperSupport\s*\(\s*\)\s*[:\s]*Boolean\s*[=\{])/;

    if (devSupportPattern.test(contents)) {
      const getJSBundleFileOverride = `override fun getJSBundleFile(): String? {
        val prefs: SharedPreferences = applicationContext.getSharedPreferences("OTAUpdate", android.content.Context.MODE_PRIVATE)
        val bundlePath = prefs.getString("BundlePath", null)
        android.util.Log.d("OTAUpdate", "getJSBundleFile called, stored path: $bundlePath")
        if (bundlePath != null) {
          val file = File(bundlePath)
          if (file.exists() && file.canRead()) {
            android.util.Log.d("OTAUpdate", "Loading OTA bundle: $bundlePath (${file.length()} bytes)")
            return bundlePath
          } else {
            android.util.Log.w("OTAUpdate", "OTA bundle not found or not readable: $bundlePath, exists=${file.exists()}")
          }
        }
        android.util.Log.d("OTAUpdate", "Loading default bundle")
        return null
      }

      `;
      contents = contents.replace(
        devSupportPattern,
        `${getJSBundleFileOverride}$1`
      );
      console.log('[OTAUpdate] Android: Successfully injected getJSBundleFile (pattern 3)');
      config.modResults.contents = contents;
      return config;
    }

    // Strategy 4: Look for ReactNativeHost in any form
    const genericPattern = /(ReactNativeHost\s*[\(\{])/;

    if (genericPattern.test(contents)) {
      // Find the opening brace after ReactNativeHost and insert after it
      const match = contents.match(/ReactNativeHost[^{]*\{/);
      if (match) {
        const insertPos = match.index + match[0].length;
        const getJSBundleFileOverride = `
      override fun getJSBundleFile(): String? {
        val prefs: SharedPreferences = applicationContext.getSharedPreferences("OTAUpdate", android.content.Context.MODE_PRIVATE)
        val bundlePath = prefs.getString("BundlePath", null)
        android.util.Log.d("OTAUpdate", "getJSBundleFile called, stored path: $bundlePath")
        if (bundlePath != null) {
          val file = File(bundlePath)
          if (file.exists() && file.canRead()) {
            android.util.Log.d("OTAUpdate", "Loading OTA bundle: $bundlePath (${file.length()} bytes)")
            return bundlePath
          } else {
            android.util.Log.w("OTAUpdate", "OTA bundle not found or not readable: $bundlePath, exists=${file.exists()}")
          }
        }
        android.util.Log.d("OTAUpdate", "Loading default bundle")
        return null
      }
`;
        contents = contents.slice(0, insertPos) + getJSBundleFileOverride + contents.slice(insertPos);
        console.log('[OTAUpdate] Android: Successfully injected getJSBundleFile (pattern 4)');
        config.modResults.contents = contents;
        return config;
      }
    }

    console.warn('[OTAUpdate] Android: Could not find suitable injection point for getJSBundleFile');
    console.warn('[OTAUpdate] Android: Please manually add getJSBundleFile override to MainApplication.kt');
    console.warn('[OTAUpdate] Android: See https://vanikya.github.io/ota-update/ for manual setup instructions');

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
      }
    }
    NSLog("[OTAUpdate] Loading default bundle")
    return nil
  }
`;

      // Strategy 1: Look for bundleURL() with flexible pattern
      // Match: func bundleURL() -> URL? { ... } with any content inside
      const bundleURLPattern1 = /(func\s+bundleURL\s*\(\s*\)\s*->\s*URL\?\s*\{)([\s\S]*?)(\n\s*\})/;

      if (bundleURLPattern1.test(contents)) {
        contents = contents.replace(
          bundleURLPattern1,
          (match, funcStart, funcBody, funcEnd) => {
            // Check if it already has OTA check
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
    return [NSURL fileURLWithPath:bundlePath];
  }
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
