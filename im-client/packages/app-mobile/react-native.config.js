module.exports = {
  dependencies: {
    'react-native-nitro-audio-manager': {
      platforms: {
        android: {
          packageImportPath:
            'import com.margelo.nitro.audiomanager.AudioManagerPackage;',
          packageInstance: 'new AudioManagerPackage()',
        },
      },
    },
  },
};
