import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  NativeModules,
  Platform,
} from 'react-native';

const { OTAUpdate } = NativeModules;

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warn';
}

interface OTADebugPanelProps {
  testBundleUrl?: string;
  serverUrl?: string;
  appSlug?: string;
}

/**
 * Debug panel for testing OTA update functionality.
 * Use this component during development to verify:
 * - Native module is linked correctly
 * - Downloads work properly
 * - Hash calculation works
 * - SharedPreferences/UserDefaults are saved
 * - Bundle loading on restart
 */
export function OTADebugPanel({ testBundleUrl, serverUrl, appSlug }: OTADebugPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { time, message, type }]);
  };

  const clearLogs = () => setLogs([]);

  // Check native module on mount
  useEffect(() => {
    if (OTAUpdate) {
      addLog('Native module found', 'success');
      const docDir = OTAUpdate.getDocumentDirectory?.();
      if (docDir) {
        addLog(`Document directory: ${docDir}`, 'info');
      }
    } else {
      addLog('Native module NOT found - OTA will not work!', 'error');
    }
  }, []);

  const testNativeModule = async () => {
    addLog('Testing native module...');

    if (!OTAUpdate) {
      addLog('Native module not available', 'error');
      return;
    }

    try {
      // Test getDocumentDirectory
      const docDir = OTAUpdate.getDocumentDirectory();
      addLog(`getDocumentDirectory: ${docDir}`, 'success');

      // Test file operations
      const testPath = `${docDir}ota-test.txt`;
      await OTAUpdate.writeFile(testPath, 'Hello OTA!');
      addLog(`writeFile: ${testPath}`, 'success');

      const content = await OTAUpdate.readFile(testPath);
      addLog(`readFile: "${content}"`, 'success');

      const exists = await OTAUpdate.exists(testPath);
      addLog(`exists: ${exists}`, 'success');

      await OTAUpdate.deleteFile(testPath);
      addLog('deleteFile: success', 'success');

      const existsAfter = await OTAUpdate.exists(testPath);
      addLog(`exists after delete: ${existsAfter}`, 'success');

    } catch (error: any) {
      addLog(`Error: ${error.message}`, 'error');
    }
  };

  const testDownload = async () => {
    if (!testBundleUrl) {
      addLog('No testBundleUrl provided', 'warn');
      return;
    }

    if (!OTAUpdate?.downloadFile) {
      addLog('downloadFile not available', 'error');
      return;
    }

    try {
      const docDir = OTAUpdate.getDocumentDirectory();
      const destPath = `${docDir}ota-update/test-bundle.js`;

      addLog(`Downloading from: ${testBundleUrl}`);
      addLog(`Destination: ${destPath}`);

      const startTime = Date.now();
      const result = await OTAUpdate.downloadFile(testBundleUrl, destPath);
      const duration = Date.now() - startTime;

      addLog(`Download complete in ${duration}ms`, 'success');
      addLog(`File size: ${result.fileSize} bytes`, 'success');

      // Verify file exists
      const exists = await OTAUpdate.exists(destPath);
      addLog(`File exists: ${exists}`, exists ? 'success' : 'error');

    } catch (error: any) {
      addLog(`Download failed: ${error.message}`, 'error');
    }
  };

  const testHashCalculation = async () => {
    if (!OTAUpdate?.calculateSHA256FromFile) {
      addLog('calculateSHA256FromFile not available', 'error');
      return;
    }

    try {
      const docDir = OTAUpdate.getDocumentDirectory();
      const testPath = `${docDir}ota-update/test-bundle.js`;

      const exists = await OTAUpdate.exists(testPath);
      if (!exists) {
        addLog('Test bundle not found. Run "Test Download" first.', 'warn');
        return;
      }

      addLog('Calculating hash...');
      const startTime = Date.now();
      const hash = await OTAUpdate.calculateSHA256FromFile(testPath);
      const duration = Date.now() - startTime;

      addLog(`Hash: ${hash}`, 'success');
      addLog(`Calculated in ${duration}ms`, 'success');

    } catch (error: any) {
      addLog(`Hash calculation failed: ${error.message}`, 'error');
    }
  };

  const testApplyBundle = async () => {
    if (!OTAUpdate?.applyBundle) {
      addLog('applyBundle not available', 'error');
      return;
    }

    try {
      const docDir = OTAUpdate.getDocumentDirectory();
      const testPath = `${docDir}ota-update/test-bundle.js`;

      const exists = await OTAUpdate.exists(testPath);
      if (!exists) {
        addLog('Test bundle not found. Run "Test Download" first.', 'warn');
        return;
      }

      addLog(`Registering bundle: ${testPath}`);
      await OTAUpdate.applyBundle(testPath, false); // Don't restart
      addLog('Bundle registered (no restart)', 'success');

      // Verify it was saved
      const savedPath = await OTAUpdate.getPendingBundlePath();
      addLog(`Saved path: ${savedPath}`, savedPath === testPath ? 'success' : 'error');

    } catch (error: any) {
      addLog(`Apply failed: ${error.message}`, 'error');
    }
  };

  const testGetPendingBundle = async () => {
    if (!OTAUpdate?.getPendingBundlePath) {
      addLog('getPendingBundlePath not available', 'error');
      return;
    }

    try {
      const path = await OTAUpdate.getPendingBundlePath();
      if (path) {
        addLog(`Pending bundle: ${path}`, 'success');
        const exists = await OTAUpdate.exists(path);
        addLog(`File exists: ${exists}`, exists ? 'success' : 'error');
      } else {
        addLog('No pending bundle', 'info');
      }
    } catch (error: any) {
      addLog(`Error: ${error.message}`, 'error');
    }
  };

  const testClearPendingBundle = async () => {
    if (!OTAUpdate?.clearPendingBundle) {
      addLog('clearPendingBundle not available', 'error');
      return;
    }

    try {
      await OTAUpdate.clearPendingBundle();
      addLog('Pending bundle cleared', 'success');
    } catch (error: any) {
      addLog(`Error: ${error.message}`, 'error');
    }
  };

  const testApplyAndRestart = async () => {
    if (!OTAUpdate?.applyBundle) {
      addLog('applyBundle not available', 'error');
      return;
    }

    try {
      const docDir = OTAUpdate.getDocumentDirectory();
      const testPath = `${docDir}ota-update/test-bundle.js`;

      const exists = await OTAUpdate.exists(testPath);
      if (!exists) {
        addLog('Test bundle not found. Run "Test Download" first.', 'warn');
        return;
      }

      addLog('Applying bundle and restarting...');
      addLog('App will restart in ~200ms');
      await OTAUpdate.applyBundle(testPath, true); // Restart

    } catch (error: any) {
      addLog(`Error: ${error.message}`, 'error');
    }
  };

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return '#4CAF50';
      case 'error': return '#F44336';
      case 'warn': return '#FF9800';
      default: return '#2196F3';
    }
  };

  if (!isExpanded) {
    return (
      <TouchableOpacity
        style={styles.collapsedButton}
        onPress={() => setIsExpanded(true)}
      >
        <Text style={styles.collapsedButtonText}>OTA Debug</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>OTA Debug Panel</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={clearLogs} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsExpanded(false)} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>Hide</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.infoText}>Platform: {Platform.OS}</Text>
        <Text style={styles.infoText}>
          Native Module: {OTAUpdate ? 'Available' : 'NOT FOUND'}
        </Text>
      </View>

      <ScrollView style={styles.buttonContainer} horizontal showsHorizontalScrollIndicator={false}>
        <TouchableOpacity style={styles.button} onPress={testNativeModule}>
          <Text style={styles.buttonText}>Test Module</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testDownload}>
          <Text style={styles.buttonText}>Test Download</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testHashCalculation}>
          <Text style={styles.buttonText}>Test Hash</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testApplyBundle}>
          <Text style={styles.buttonText}>Register Bundle</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testGetPendingBundle}>
          <Text style={styles.buttonText}>Get Pending</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testClearPendingBundle}>
          <Text style={styles.buttonText}>Clear Pending</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={testApplyAndRestart}>
          <Text style={styles.buttonText}>Apply + Restart</Text>
        </TouchableOpacity>
      </ScrollView>

      <ScrollView style={styles.logContainer}>
        {logs.length === 0 ? (
          <Text style={styles.emptyLog}>Tap a button to start testing...</Text>
        ) : (
          logs.map((log, index) => (
            <View key={index} style={styles.logEntry}>
              <Text style={[styles.logTime]}>{log.time}</Text>
              <Text style={[styles.logMessage, { color: getLogColor(log.type) }]}>
                {log.message}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '60%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  collapsedButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: '#6C63FF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  collapsedButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4e',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#2a2a4e',
    borderRadius: 4,
  },
  headerButtonText: {
    color: '#aaa',
    fontSize: 12,
  },
  info: {
    padding: 8,
    backgroundColor: '#2a2a4e',
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  infoText: {
    color: '#888',
    fontSize: 11,
  },
  buttonContainer: {
    padding: 8,
    flexGrow: 0,
  },
  button: {
    backgroundColor: '#6C63FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: 8,
  },
  dangerButton: {
    backgroundColor: '#F44336',
  },
  buttonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  logContainer: {
    flex: 1,
    padding: 8,
  },
  emptyLog: {
    color: '#666',
    textAlign: 'center',
    marginTop: 20,
  },
  logEntry: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4e',
  },
  logTime: {
    color: '#666',
    fontSize: 10,
    width: 70,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logMessage: {
    flex: 1,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

export default OTADebugPanel;
