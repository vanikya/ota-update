package com.otaupdate

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import java.io.File

/**
 * Helper object for OTA Update bundle loading.
 * This is called from MainApplication.getJSBundleFile() to get the OTA bundle path.
 */
object OTAUpdateHelper {
    private const val TAG = "OTAUpdate"
    private const val PREFS_NAME = "OTAUpdate"
    private const val KEY_BUNDLE_PATH = "BundlePath"

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
            val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val bundlePath = prefs.getString(KEY_BUNDLE_PATH, null)

            Log.d(TAG, "getJSBundleFile called, stored path: $bundlePath")

            if (bundlePath.isNullOrEmpty()) {
                Log.d(TAG, "No OTA bundle path stored, loading default bundle")
                return null
            }

            val file = File(bundlePath)
            if (!file.exists()) {
                Log.w(TAG, "OTA bundle file does not exist: $bundlePath")
                // Clear invalid path
                prefs.edit().remove(KEY_BUNDLE_PATH).commit()
                return null
            }

            if (!file.canRead()) {
                Log.w(TAG, "OTA bundle file is not readable: $bundlePath")
                return null
            }

            val fileSize = file.length()
            if (fileSize < 100) {
                Log.w(TAG, "OTA bundle file is too small (${fileSize} bytes), likely corrupted")
                prefs.edit().remove(KEY_BUNDLE_PATH).commit()
                return null
            }

            Log.d(TAG, "Loading OTA bundle: $bundlePath ($fileSize bytes)")
            bundlePath
        } catch (e: Exception) {
            Log.e(TAG, "Error getting JS bundle file: ${e.message}", e)
            null
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
        prefs.edit().remove(KEY_BUNDLE_PATH).commit()
        Log.d(TAG, "Pending bundle cleared")
    }
}
