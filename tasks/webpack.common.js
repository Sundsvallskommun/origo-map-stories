const { execSync } = require('child_process');
const webpack = require('webpack');

// Build marker baked into the bundle: CI commit, else local HEAD, else 'dev'.
function resolveBuildSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch (e) {
    return 'dev';
  }
}

module.exports = {
  entry: ['./index.js'],
  module: {
    rules: [{
      test: /\.(js)$/,
      exclude: /node_modules/
    }]
  },
  externals: ['Origo'],
  resolve: {
    extensions: ['*', '.js', '.scss']
  },
  plugins: [
    new webpack.DefinePlugin({
      __BUILD_SHA__: JSON.stringify(resolveBuildSha())
    })
  ]
};
