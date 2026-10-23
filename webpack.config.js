/* @flow */
/* eslint import/no-nodejs-modules: off, import/no-default-export: off, import/default: off */

import type { WebpackConfig } from "@krakenjs/webpack-config-grumbler/index.flow";
import {
  getWebpackConfig,
  getNextVersion,
} from "@krakenjs/webpack-config-grumbler";
import { argv } from "yargs";

import pkg from "./package.json";
import globals from "./globals";

// sandestin ships modern ES modules; the bundler here predates `??` and
// `?.`, and the stock babel rule skips anything under a `dist` folder. Give
// it its own rule that only brings the syntax down to what webpack can read.
const SANDESTIN_RULE = {
  test: /[\\/]sandestin[\\/]dist[\\/].*\.js$/,
  loader: require.resolve("babel-loader"),
  options: {
    babelrc: false,
    configFile: false,
    presets: [
      [
        require.resolve("@babel/preset-env"),
        { targets: { chrome: "79" }, modules: false },
      ],
    ],
    plugins: [require.resolve("@babel/plugin-proposal-class-properties")],
  },
};

const withSandestin = (config: WebpackConfig): WebpackConfig => {
  // $FlowFixMe
  config.module.rules.unshift(SANDESTIN_RULE);
  return config;
};

export const FILE_NAME = "post-robot";
export const MODULE_NAME = "postRobot";

const postRobotGlobals = {
  ...globals.__POST_ROBOT__,
  __GLOBAL_KEY__: `__post_robot_${getNextVersion(pkg, argv.level)}__`,
};

export const WEBPACK_CONFIG: WebpackConfig = withSandestin(
  getWebpackConfig({
    filename: `${FILE_NAME}.js`,
    modulename: MODULE_NAME,
    minify: false,
    vars: {
      ...globals,

      __POST_ROBOT__: {
        ...postRobotGlobals,
        __IE_POPUP_SUPPORT__: false,
        __GLOBAL_MESSAGE_SUPPORT__: false,
      },
    },
  })
);

export const WEBPACK_CONFIG_MIN: WebpackConfig = withSandestin(
  getWebpackConfig({
    filename: `${FILE_NAME}.min.js`,
    modulename: MODULE_NAME,
    minify: true,
    vars: {
      ...globals,

      __POST_ROBOT__: {
        ...postRobotGlobals,
        __IE_POPUP_SUPPORT__: false,
        __GLOBAL_MESSAGE_SUPPORT__: false,
      },
    },
  })
);

export const WEBPACK_CONFIG_IE: WebpackConfig = withSandestin(
  getWebpackConfig({
    filename: `${FILE_NAME}.ie.js`,
    modulename: MODULE_NAME,
    minify: false,
    vars: {
      ...globals,
      __POST_ROBOT__: postRobotGlobals,
    },
  })
);

export const WEBPACK_CONFIG_IE_MIN: WebpackConfig = withSandestin(
  getWebpackConfig({
    filename: `${FILE_NAME}.ie.min.js`,
    modulename: MODULE_NAME,
    minify: true,
    vars: {
      ...globals,
      __POST_ROBOT__: postRobotGlobals,
    },
  })
);

export const WEBPACK_CONFIG_TEST: WebpackConfig = withSandestin(
  getWebpackConfig({
    modulename: MODULE_NAME,
    minify: false,
    test: true,
    vars: {
      ...globals,
      __POST_ROBOT__: postRobotGlobals,
    },
  })
);

export default [
  WEBPACK_CONFIG,
  WEBPACK_CONFIG_MIN,
  WEBPACK_CONFIG_IE,
  WEBPACK_CONFIG_IE_MIN,
];
