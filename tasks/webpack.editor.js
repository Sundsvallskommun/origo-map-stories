const path = require('path');

module.exports = {
  entry: './src/geoJsonEditor.js',
  output: {
    path: path.resolve(__dirname, '../../origo'),
    filename: 'editor.js'
  },
  mode: 'development',
  devtool: 'source-map',
  module: {
    rules: [
      // ol imports its own CSS; bundle it into the JS via style-loader
      { test: /\.css$/, use: ['style-loader', 'css-loader'] }
    ]
  },
  resolve: {
    extensions: ['.js']
  }
};
