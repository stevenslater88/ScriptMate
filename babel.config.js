module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-reanimated/plugin must be LAST in the plugins array
      // It includes worklets internally - do NOT add react-native-worklets/plugin separately
      'react-native-reanimated/plugin',
    ],
  };
};
