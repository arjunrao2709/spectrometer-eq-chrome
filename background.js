chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getStreamId') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ error: 'No active tab found.' });
        return;
      }
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabs[0].id }, (streamId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ streamId });
        }
      });
    });
    return true;
  }
});
