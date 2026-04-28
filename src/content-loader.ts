const appUrl = chrome.runtime.getURL('pierre-app.js');

console.info('[GitLab Pierre] Loader 0.4.10 active.');

void import(/* @vite-ignore */ appUrl).catch((error: unknown) => {
  console.error('[GitLab Pierre] Failed to load Pierre app bundle.', error);
});
