const appUrl = chrome.runtime.getURL('pierre-app.js');

console.info('[GitLab Pierre] Loader __APP_VERSION__ active.');

void import(appUrl).catch((error) => {
  console.error('[GitLab Pierre] Failed to load Pierre app bundle.', error);
});
