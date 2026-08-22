// Chromium in the container has no user namespace to sandbox into, so the
// headless launcher needs `--no-sandbox`. Point CHROME_BIN at a Chromium
// binary (see README) before running `npm test`.
module.exports = function (config) {
  config.set({
    frameworks: ['jasmine'],
    plugins: [require('karma-jasmine'), require('karma-chrome-launcher')],
    browsers: ['ChromeHeadlessNoSandbox'],
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
    reporters: ['progress'],
    restartOnFileChange: true,
  });
};
