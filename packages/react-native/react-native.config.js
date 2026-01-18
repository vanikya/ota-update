module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath: 'import com.otaupdate.OTAUpdatePackage;',
        packageInstance: 'new OTAUpdatePackage()',
      },
      ios: {
        // iOS uses Swift, auto-detected
      },
    },
  },
};
