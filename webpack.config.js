const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const WebpackObfuscator = require('webpack-obfuscator');
const TerserPlugin = require('terser-webpack-plugin');
const fs = require('fs');

// Create a custom entry file that combines both scripts
const createCombinedEntry = () => {
  const mainContent = fs.readFileSync('./scripts/main.js', 'utf8');
  const uiHandlerContent = fs.readFileSync('./scripts/ui-handler.js', 'utf8');
  
  const combinedContent = `
// Combined entry point for webpack bundling
// This file combines main.js and ui-handler.js

${mainContent}

${uiHandlerContent}
`;
  
  fs.writeFileSync('./temp-combined-entry.js', combinedContent);
};

// Create the combined entry file
createCombinedEntry();

module.exports = {
  mode: 'production',
  entry: './temp-combined-entry.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.[contenthash].js',
    clean: true,
  },
  devtool: false, // Disable source maps
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true, // Remove console.log statements
            drop_debugger: true, // Remove debugger statements
          },
          mangle: true, // Mangle variable names
        },
      }),
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
      filename: 'index.html',
      inject: 'body',
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeRedundantAttributes: true,
        useShortDoctype: true,
        removeEmptyAttributes: true,
        removeStyleLinkTypeAttributes: true,
        keepClosingSlash: true,
        minifyJS: true,
        minifyCSS: true,
        minifyURLs: true,
      },
    }),
    new WebpackObfuscator({
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 1,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.4,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 1,
      transformObjectKeys: true,
      renameGlobals: true,
      rotateStringArray: true,
      shuffleStringArray: true,
      splitStrings: true,
      splitStringsChunkLength: 5,
      unicodeEscapeSequence: false,
    }, ['excluded_bundle_name.js']),
  ],
  resolve: {
    extensions: ['.js', '.ts'],
  },
};
