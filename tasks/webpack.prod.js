const path = require('path');
const { merge } = require('webpack-merge');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const common = require('./webpack.common');

module.exports = merge(common, {
  optimization: {
    nodeEnv: 'production',
    minimize: true
  },
  performance: {
    hints: false
  },
  output: {
    path: path.resolve(__dirname, '../build/js'),
    filename: 'origo-map-stories.min.js',
    libraryTarget: 'var',
    libraryExport: 'default',
    library: 'OrigoMapStories'
  },
  devtool: false,
  mode: 'production',
  module: {
    rules: [{
      test: /\.(sc|c)ss$/,
      use: [
        MiniCssExtractPlugin.loader,
        'css-loader',
        'sass-loader'
      ]
    }]
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: '../css/origo-map-stories.min.css'
    })
  ]
});
