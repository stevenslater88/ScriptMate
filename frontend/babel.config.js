module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-worklets/plugin must be LAST in the plugins array
      // This is required for react-native-reanimated 4.x
      'react-native-worklets/plugin',
    ],
  };
};
