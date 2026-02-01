const { withMainApplication, withAppDelegate } = require('@expo/config-plugins');

/**
 * OTA Update Expo Config Plugin
 *
 * This plugin modifies the native code to enable OTA bundle loading:
 * - Android: Overrides getJSBundleFile() or sets jsBundleFilePath in MainApplication.kt
 * - iOS: Modifies bundleURL() in AppDelegate.swift
 *
 * Supports both old architecture (getJSBundleFile override) and
 * new architecture (jsBundleFilePath parameter in getDefaultReactHost).
 */

function withOTAUpdateAndroid(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    // Check if already modified
    if (contents.includes('OTAUpdateHelper') || contents.includes('com.otaupdate')) {
      console.log('[OTAUpdate] Android: OTAUpdateHelper already present, skipping');
      return config;
    }

    console.log('[OTAUpdate] Android: Analyzing MainApplication.kt structure...');

    // Add import for OTAUpdateHelper at the top
    const packageMatch = contents.match(/^package\s+[\w.]+\s*\n/m);
    if (packageMatch) {
      const insertPos = packageMatch.index + packageMatch[0].length;
      const importStatement = `\nimport com.otaupdate.OTAUpdateHelper\n`;
      contents = contents.slice(0, insertPos) + importStatement + contents.slice(insertPos);
      console.log('[OTAUpdate] Android: Added import for OTAUpdateHelper');
    }

    let injected = false;

    // ============================================================
    // Strategy 1: React Native 0.82+ NEW ARCHITECTURE
    // Look for: getDefaultReactHost(applicationContext, ...) and add jsBundleFilePath parameter
    // ============================================================
    const newArchPattern = /getDefaultReactHost\s*\(\s*\n?\s*applicationContext\s*,/;
    if (newArchPattern.test(contents)) {
      console.log('[OTAUpdate] Android: Detected React Native 0.82+ (new architecture)');

      // Find the getDefaultReactHost call and add jsBundleFilePath parameter
      // Pattern: getDefaultReactHost(applicationContext, packageList, ...)
      const reactHostRegex = /(getDefaultReactHost\s*\(\s*\n?\s*)(applicationContext)(\s*,)/g;

      if (reactHostRegex.test(contents)) {
        contents = contents.replace(
          /(getDefaultReactHost\s*\(\s*\n?\s*)(applicationContext)(\s*,)/,
          '$1$2$3\n        jsBundleFilePath = OTAUpdateHelper.getJSBundleFile(applicationContext),'
        );
        console.log('[OTAUpdate] Android: Injected jsBundleFilePath parameter (new architecture)');
        injected = true;
      }
    }

    // ============================================================
    // Strategy 2: Look for reactHost with getDefaultReactHost
    // override val reactHost: ReactHost get() = getDefaultReactHost(...)
    // ============================================================
    if (!injected) {
      const reactHostGetPattern = /(override\s+val\s+reactHost\s*:\s*ReactHost\s+get\s*\(\s*\)\s*=\s*getDefaultReactHost\s*\()([^)]*)\)/;
      if (reactHostGetPattern.test(contents)) {
        console.log('[OTAUpdate] Android: Detected reactHost with getDefaultReactHost');

        contents = contents.replace(
          reactHostGetPattern,
          (match, prefix, params) => {
            if (params.includes('jsBundleFilePath')) {
              return match; // Already has it
            }
            // Add jsBundleFilePath to the parameters
            const newParams = params.trim() + ',\n        jsBundleFilePath = OTAUpdateHelper.getJSBundleFile(applicationContext)';
            return `${prefix}${newParams})`;
          }
        );
        console.log('[OTAUpdate] Android: Injected jsBundleFilePath in reactHost getter');
        injected = true;
      }
    }

    // ============================================================
    // Strategy 3: Old architecture - DefaultReactNativeHost with object block
    // Look for: object : DefaultReactNativeHost(this) { ... }
    // ============================================================
    if (!injected) {
      const defaultHostPattern = /(object\s*:\s*DefaultReactNativeHost\s*\([^)]*\)\s*\{)/;
      if (defaultHostPattern.test(contents)) {
        console.log('[OTAUpdate] Android: Detected DefaultReactNativeHost (old architecture)');

        const getJSBundleFileOverride = `
        override fun getJSBundleFile(): String? {
          return OTAUpdateHelper.getJSBundleFile(applicationContext)
        }
`;
        contents = contents.replace(defaultHostPattern, `$1${getJSBundleFileOverride}`);
        console.log('[OTAUpdate] Android: Injected getJSBundleFile override');
        injected = true;
      }
    }

    // ============================================================
    // Strategy 4: Look for override fun getUseDeveloperSupport and insert before it
    // ============================================================
    if (!injected) {
      const devSupportPattern = /([ \t]*)(override\s+fun\s+getUseDeveloperSupport\s*\(\s*\))/;
      if (devSupportPattern.test(contents)) {
        console.log('[OTAUpdate] Android: Found getUseDeveloperSupport, inserting before it');

        const match = contents.match(devSupportPattern);
        const indent = match ? match[1] : '        ';

        const getJSBundleFileOverride = `${indent}override fun getJSBundleFile(): String? {
${indent}  return OTAUpdateHelper.getJSBundleFile(applicationContext)
${indent}}

${indent}`;

        contents = contents.replace(devSupportPattern, `${getJSBundleFileOverride}$2`);
        console.log('[OTAUpdate] Android: Injected getJSBundleFile before getUseDeveloperSupport');
        injected = true;
      }
    }

    // ============================================================
    // Strategy 5: Look for ReactNativeHost in any form
    // ============================================================
    if (!injected) {
      const anyHostPattern = /(:\s*ReactNativeHost\s*\{)/;
      if (anyHostPattern.test(contents)) {
        console.log('[OTAUpdate] Android: Found ReactNativeHost block');

        const getJSBundleFileOverride = `
        override fun getJSBundleFile(): String? {
          return OTAUpdateHelper.getJSBundleFile(applicationContext)
        }
`;
        contents = contents.replace(anyHostPattern, `$1${getJSBundleFileOverride}`);
        console.log('[OTAUpdate] Android: Injected getJSBundleFile in ReactNativeHost');
        injected = true;
      }
    }

    if (!injected) {
      console.warn('[OTAUpdate] Android: ⚠️ Could not find injection point!');
      console.warn('[OTAUpdate] Android: Please manually add getJSBundleFile override');
      console.warn('[OTAUpdate] Android: See documentation for manual setup');

      // Log relevant lines for debugging
      const lines = contents.split('\n');
      console.log('[OTAUpdate] Android: Relevant lines in MainApplication.kt:');
      lines.forEach((line, i) => {
        if (line.includes('ReactNativeHost') ||
            line.includes('DefaultReactNativeHost') ||
            line.includes('getDefaultReactHost') ||
            line.includes('reactHost') ||
            line.includes('getJSBundleFile') ||
            line.includes('jsBundleFilePath')) {
          console.log(`  ${i + 1}: ${line.trim()}`);
        }
      });
    }

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
        NSLog("[OTAUpdate] OTA bundle not found at path: %@, clearing", path)
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
        console.log('[OTAUpdate] iOS: Successfully modified bundleURL');
        config.modResults.contents = contents;
        return config;
      }

      // Strategy 2: Look for sourceURL(for bridge:) pattern
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
