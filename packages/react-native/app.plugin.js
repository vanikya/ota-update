const { withMainApplication, withAppDelegate } = require('@expo/config-plugins');

/**
 * OTA Update Expo Config Plugin
 *
 * This plugin modifies the native code to enable OTA bundle loading:
 * - Android: Modifies MainApplication.kt to override getJSBundleFile and getBundleAssetName
 * - iOS: Modifies bundleURL() in AppDelegate.swift
 */

function withOTAUpdateAndroid(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    // Check if already modified
    if (contents.includes('OTAUpdateHelper')) {
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
    // Strategy 1: Look for DefaultReactNativeHost and add overrides
    // This works for both old and new architecture Expo apps
    // ============================================================
    const defaultHostPattern = /(object\s*:\s*DefaultReactNativeHost\s*\([^)]*\)\s*\{)/;
    if (defaultHostPattern.test(contents)) {
      console.log('[OTAUpdate] Android: Detected DefaultReactNativeHost');

      const bundleOverride = `
        override fun getJSBundleFile(): String? {
          return OTAUpdateHelper.getJSBundleFile(applicationContext)
        }

        override fun getBundleAssetName(): String? {
          // Return null if OTA bundle exists to force using getJSBundleFile
          val otaBundle = OTAUpdateHelper.getJSBundleFile(applicationContext)
          if (otaBundle != null) {
            return null
          }
          return super.getBundleAssetName()
        }
`;
      contents = contents.replace(defaultHostPattern, `$1${bundleOverride}`);
      console.log('[OTAUpdate] Android: Injected getJSBundleFile and getBundleAssetName overrides');
      injected = true;
    }

    // ============================================================
    // Strategy 2: Look for getUseDeveloperSupport and insert before it
    // ============================================================
    if (!injected) {
      const devSupportPattern = /([ \t]*)(override\s+fun\s+getUseDeveloperSupport\s*\(\s*\))/;
      if (devSupportPattern.test(contents)) {
        console.log('[OTAUpdate] Android: Found getUseDeveloperSupport, inserting before it');

        const match = contents.match(devSupportPattern);
        const indent = match ? match[1] : '        ';

        const bundleOverride = `${indent}override fun getJSBundleFile(): String? {
${indent}  return OTAUpdateHelper.getJSBundleFile(applicationContext)
${indent}}

${indent}override fun getBundleAssetName(): String? {
${indent}  val otaBundle = OTAUpdateHelper.getJSBundleFile(applicationContext)
${indent}  if (otaBundle != null) {
${indent}    return null
${indent}  }
${indent}  return super.getBundleAssetName()
${indent}}

${indent}`;

        contents = contents.replace(devSupportPattern, `${bundleOverride}$2`);
        console.log('[OTAUpdate] Android: Injected bundle overrides before getUseDeveloperSupport');
        injected = true;
      }
    }

    if (!injected) {
      console.warn('[OTAUpdate] Android: ⚠️ Could not find injection point!');
      console.warn('[OTAUpdate] Android: Please manually add getJSBundleFile override');

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
