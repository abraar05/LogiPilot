/**
 * Capacitor configuration — Android packaging for StockPilot.
 *
 * StockPilot is a static web app, so Capacitor simply wraps the folder in a
 * native shell. The APK is built from `webDir`, so the same files that run on
 * the web are what ships inside the app.
 *
 * Prerequisites
 *   npm install @capacitor/core @capacitor/cli @capacitor/android
 *   npx cap add android
 *   npx cap sync android
 *   npx cap open android      # then Build > Generate Signed Bundle / APK
 *
 * See tools/build-android.md for the full walkthrough, including the
 * GitHub Actions workflow that produces a signed APK with no local setup.
 */

const config = {
  appId: 'app.logipilot.ops',
  appName: 'LogiPilot',
  // Built by `node tools/build-web.mjs` — a clean copy of the app shell.
  // Never point this at the repository root: Capacitor would copy
  // node_modules, the Android project and the tooling into the APK.
  webDir: 'www',
  android: {
    // The inventory UI is a normal web view; keep the default bridge.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#0a0d13',
      showSpinner: false,
      androidSpinnerStyle: 'small',
    },
  },
};

module.exports = config;