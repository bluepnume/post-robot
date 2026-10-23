/* @flow */
/* eslint import/no-default-export: off */

import { getKarmaConfig } from "@krakenjs/karma-config-grumbler";

import { WEBPACK_CONFIG_TEST } from "./webpack.config";

// karma only auto-loads `karma-*` plugins from the top-level node_modules,
// and npm nests karma-webpack under karma-config-grumbler. Load it from there.
const karmaWebpackPath = require.resolve("karma-webpack", {
  paths: [require.resolve("@krakenjs/karma-config-grumbler")],
});
// eslint-disable-next-line import/no-dynamic-require, security/detect-non-literal-require
const karmaWebpack = require(karmaWebpackPath);

export default function configKarma(karma: Object) {
  const karmaConfig = getKarmaConfig(karma, {
    basePath: __dirname,
    webpack: WEBPACK_CONFIG_TEST,
    plugins: ["karma-*", karmaWebpack],
  });

  karma.set(karmaConfig);
}
