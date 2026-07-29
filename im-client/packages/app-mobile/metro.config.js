const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// monorepo（npm workspaces）：依赖 hoist 到 im-client/node_modules，
// @im/sdk-core、@im/sdk-rn 以软链形式落在同处。Metro 必须：
//   1) watch monorepo 根，才能读到软链的 workspace 源码；
//   2) 同时从 app 本地与 monorepo 根两处 node_modules 解析（react-native 等被 hoist）。
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
