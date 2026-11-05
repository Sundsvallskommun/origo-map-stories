const path = require('path');
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
  output: {
    path: path.resolve(__dirname, '../../origo/plugins'),
    filename: 'origo-map-stories.js',
    libraryTarget: 'var',
    libraryExport: 'default',
    library: 'OrigoMapStories'
  },
  mode: 'development',
  devtool: 'source-map',
  module: {
    rules: [{
      test: /\.scss$/,
      use: ['style-loader', 'css-loader', 'sass-loader']
    }]
  }
});
