const MINI_WINDOW_ID_KEY = 'miniWindowId';

function closeMiniWindow() {
  chrome.storage.local.get([MINI_WINDOW_ID_KEY], (result) => {
    const id = result && result[MINI_WINDOW_ID_KEY];
    if (typeof id !== 'number') return;

    chrome.windows.remove(id, () => {
      chrome.storage.local.remove([MINI_WINDOW_ID_KEY], () => {});
    });
  });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'close-mini-window') {
    closeMiniWindow();
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get([MINI_WINDOW_ID_KEY], (result) => {
    const id = result && result[MINI_WINDOW_ID_KEY];
    if (id === windowId) {
      chrome.storage.local.remove([MINI_WINDOW_ID_KEY], () => {});
    }
  });
});

