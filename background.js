// Open the side panel when the toolbar icon is clicked.
// The side panel stays open while the user browses and interacts with the page,
// unlike a popup which closes on any outside click.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

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
