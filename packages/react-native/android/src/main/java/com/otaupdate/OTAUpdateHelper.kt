package com.otaupdate

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageInfo
import android.os.Build
import android.util.Log
import java.io.File

/**
 * Helper object for OTA Update bundle loading.
 * This is called from MainApplication.getJSBundleFile() to get the OTA bundle path.
 *
 * Based on patterns from react-native-ota-hot-update and hot-updater libraries.
 */
object OTAUpdateHelper {
    private const val TAG = "OTAUpdate"
    private const val PREFS_NAME = "OTAUpdate"
    private const val KEY_BUNDLE_PATH = "BundlePath"
    private const val KEY_APP_VERSION = "AppVersion"

    /**
     * Get the JS bundle file path for React Native to load.
     * Returns the OTA bundle path if available and valid, otherwise null (loads default bundle).
     *
     * @param context Application context
     * @return Bundle file path or null
     */
    @JvmStatic
    fun getJSBundleFile(context: Context): String? {
        return try {
            Log.d(TAG, "=== OTAUpdateHelper.getJSBundleFile called ===")

            val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val bundlePath = prefs.getString(KEY_BUNDLE_PATH, null)
            val savedAppVersion = prefs.getString(KEY_APP_VERSION, null)
            val currentAppVersion = getAppVersionCode(context)

            Log.d(TAG, "Stored bundle path: $bundlePath")
            Log.d(TAG, "Saved app version: $savedAppVersion, Current app version: $currentAppVersion")

            // Clear bundle if app version changed (user updated the app)
            if (savedAppVersion != null && savedAppVersion != currentAppVersion.toString()) {
                Log.w(TAG, "App version changed from $savedAppVersion to $currentAppVersion, clearing OTA bundle")
                prefs.edit()
                    .remove(KEY_BUNDLE_PATH)
                    .remove(KEY_APP_VERSION)
                    .commit()
                return null
            }

            if (bundlePath.isNullOrEmpty()) {
                Log.d(TAG, "No OTA bundle path stored, loading default bundle")
                return null
            }

            val file = File(bundlePath)
            Log.d(TAG, "Checking file: ${file.absolutePath}")
            Log.d(TAG, "File exists: ${file.exists()}, canRead: ${file.canRead()}")

            if (!file.exists()) {
                Log.w(TAG, "OTA bundle file does not exist: $bundlePath")
                // Clear invalid path
                prefs.edit().remove(KEY_BUNDLE_PATH).commit()
                return null
            }

            if (!file.canRead()) {
                Log.w(TAG, "OTA bundle file is not readable: $bundlePath")
                prefs.edit().remove(KEY_BUNDLE_PATH).commit()
                return null
            }

            val fileSize = file.length()
            if (fileSize < 100) {
                Log.w(TAG, "OTA bundle file is too small (${fileSize} bytes), likely corrupted")
                prefs.edit().remove(KEY_BUNDLE_PATH).commit()
                return null
            }

            // Verify it looks like a JS file by checking first bytes
            try {
                val firstBytes = file.inputStream().use { it.readNBytes(50) }
                val preview = String(firstBytes, Charsets.UTF_8)
                Log.d(TAG, "Bundle preview: ${preview.take(30)}...")

                // Check for HTML (error pages)
                if (preview.contains("<!DOCTYPE") || preview.contains("<html") || preview.contains("<HTML")) {
                    Log.e(TAG, "OTA bundle appears to be HTML, not JavaScript - clearing")
                    prefs.edit().remove(KEY_BUNDLE_PATH).commit()
                    return null
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not verify bundle content: ${e.message}")
            }

            Log.d(TAG, "✓ Loading OTA bundle: $bundlePath ($fileSize bytes)")
            bundlePath
        } catch (e: Exception) {
            Log.e(TAG, "Error getting JS bundle file: ${e.message}", e)
            null
        }
    }

    /**
     * Get app version code for cache invalidation
     */
    @JvmStatic
    fun getAppVersionCode(context: Context): Long {
        return try {
            val packageInfo: PackageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(context.packageName, 0)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                packageInfo.versionCode.toLong()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error getting app version: ${e.message}")
            0L
        }
    }

    /**
     * Check if an OTA bundle is pending to be loaded.
     *
     * @param context Application context
     * @return true if OTA bundle is available
     */
    @JvmStatic
    fun hasPendingBundle(context: Context): Boolean {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val bundlePath = prefs.getString(KEY_BUNDLE_PATH, null)
        if (bundlePath.isNullOrEmpty()) return false
        return File(bundlePath).exists()
    }

    /**
     * Clear the pending OTA bundle.
     *
     * @param context Application context
     */
    @JvmStatic
    fun clearPendingBundle(context: Context) {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .remove(KEY_BUNDLE_PATH)
            .remove(KEY_APP_VERSION)
            .commit()
        Log.d(TAG, "Pending bundle cleared")
    }

    /**
     * Save the bundle path with app version for cache invalidation
     */
    @JvmStatic
    fun saveBundlePath(context: Context, bundlePath: String) {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val appVersion = getAppVersionCode(context)
        prefs.edit()
            .putString(KEY_BUNDLE_PATH, bundlePath)
            .putString(KEY_APP_VERSION, appVersion.toString())
            .commit()
        Log.d(TAG, "Bundle path saved: $bundlePath (app version: $appVersion)")
    }
}
