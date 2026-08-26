document.addEventListener('DOMContentLoaded', () => {
  restoreState();
  wireMiniWindowButtons();
  wireSettings();
});

let statusResetTimer = null;

function restoreState() {
  chrome.storage.local.get(['mergeCommunityTabs', 'blockAds', 'isPro', 'hideGrokChrome', 'hideGrokPosts', 'hideDiscoverMore'], (result) => {
    updateUI();
    const mergeEl = document.getElementById('merge-community-tabs');
    if (mergeEl) mergeEl.checked = !!result.mergeCommunityTabs;
    const blockAdsEl = document.getElementById('block-ads');
    if (blockAdsEl) blockAdsEl.checked = !!result.blockAds;

    const isPro = !!result.isPro;
    const hideGrokChromeEl = document.getElementById('hide-grok-chrome');
    const hideGrokChromeCard = document.getElementById('hide-grok-chrome-card');

    if (hideGrokChromeEl && hideGrokChromeCard) {
      if (isPro) {
        hideGrokChromeEl.disabled = false;
        hideGrokChromeCard.classList.remove('locked');
        hideGrokChromeEl.checked = result.hideGrokChrome !== false;
      } else {
        hideGrokChromeEl.disabled = true;
        hideGrokChromeCard.classList.add('locked');
        hideGrokChromeEl.checked = false;
      }
    }

    const hideGrokPostsEl = document.getElementById('hide-grok-posts');
    const hideGrokPostsCard = document.getElementById('hide-grok-posts-card');

    if (hideGrokPostsEl && hideGrokPostsCard) {
      if (isPro) {
        hideGrokPostsEl.disabled = false;
        hideGrokPostsCard.classList.remove('locked');
        hideGrokPostsEl.checked = result.hideGrokPosts !== false;
      } else {
        hideGrokPostsEl.disabled = true;
        hideGrokPostsCard.classList.add('locked');
        hideGrokPostsEl.checked = false;
      }
    }

    const hideDiscoverMoreEl = document.getElementById('hide-discover-more');
    const hideDiscoverMoreCard = document.getElementById('hide-discover-more-card');

    if (hideDiscoverMoreEl && hideDiscoverMoreCard) {
      if (isPro) {
        hideDiscoverMoreEl.disabled = false;
        hideDiscoverMoreCard.classList.remove('locked');
        hideDiscoverMoreEl.checked = result.hideDiscoverMore !== false;
      } else {
        hideDiscoverMoreEl.disabled = true;
        hideDiscoverMoreCard.classList.add('locked');
        hideDiscoverMoreEl.checked = false;
      }
    }
  });
}

function updateUI() {
  const features = document.getElementById('main-features');

  if (features) {
    features.style.display = 'grid';
  }

  setStatus('READY');
}

function setStatus(label, locked = false, resetAfterMs = 0) {
  const status = document.getElementById('ready-status');
  if (!status) return;

  if (statusResetTimer) {
    clearTimeout(statusResetTimer);
    statusResetTimer = null;
  }

  status.innerText = label;
  status.classList.toggle('locked', locked);

  if (resetAfterMs > 0) {
    statusResetTimer = window.setTimeout(() => {
      statusResetTimer = null;
      setStatus('READY');
    }, resetAfterMs);
  }
}

function wireSettings() {
  const mergeEl = document.getElementById('merge-community-tabs');
  const blockAdsEl = document.getElementById('block-ads');
  const hideGrokChromeEl = document.getElementById('hide-grok-chrome');
  const hideGrokPostsEl = document.getElementById('hide-grok-posts');
  const hideDiscoverMoreEl = document.getElementById('hide-discover-more');

  if (mergeEl) {
    mergeEl.addEventListener('change', async () => {
      await chrome.storage.local.set({ mergeCommunityTabs: !!mergeEl.checked });
    });
  }

  if (blockAdsEl) {
    blockAdsEl.addEventListener('change', async () => {
      await chrome.storage.local.set({ blockAds: !!blockAdsEl.checked });
    });
  }

  if (hideGrokChromeEl) {
    hideGrokChromeEl.addEventListener('change', async () => {
      await chrome.storage.local.set({ hideGrokChrome: !!hideGrokChromeEl.checked });
    });
  }

  if (hideGrokPostsEl) {
    hideGrokPostsEl.addEventListener('change', async () => {
      await chrome.storage.local.set({ hideGrokPosts: !!hideGrokPostsEl.checked });
    });
  }

  if (hideDiscoverMoreEl) {
    hideDiscoverMoreEl.addEventListener('change', async () => {
      await chrome.storage.local.set({ hideDiscoverMore: !!hideDiscoverMoreEl.checked });
    });
  }
}

const MINI_WINDOW_ID_KEY = 'miniWindowId';

function wireMiniWindowButtons() {
  const openBtn = document.getElementById('open-mini-btn');
  const closeBtn = document.getElementById('close-mini-btn');

  if (openBtn) openBtn.addEventListener('click', openOrFocusMiniWindow);
  if (closeBtn) closeBtn.addEventListener('click', closeMiniWindow);

  const cleanBtn = document.getElementById('open-cleaner-btn');
  if (cleanBtn) {
    cleanBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'TOGGLE_CLEANER_MODE' }, (response) => {
             if (chrome.runtime.lastError) {
                 setStatus('OPEN X TAB', true, 2200);
             } else {
                 setStatus(response && response.enabled ? 'CLEANUP ON' : 'CLEANUP OFF', false, 1800);
             }
          });
        } else {
             setStatus('OPEN X TAB', true, 2200);
        }
      });
    });
  }
}

function openOrFocusMiniWindow() {
  chrome.storage.local.get([MINI_WINDOW_ID_KEY], (result) => {
    const existingId = result && result[MINI_WINDOW_ID_KEY];

    if (typeof existingId === 'number') {
      chrome.windows.get(existingId, (win) => {
        if (!chrome.runtime.lastError && win) {
          chrome.windows.update(existingId, { focused: true }, () => {});
          setStatus('MINI READY', false, 1800);
          return;
        }

        chrome.storage.local.remove([MINI_WINDOW_ID_KEY], () => {
          createMiniWindow();
        });
      });
      return;
    }

    createMiniWindow();
  });
}

function createMiniWindow() {
  chrome.windows.create(
    {
      url: 'https://x.com/home',
      type: 'popup',
      width: 420,
      height: 800,
      focused: true
    },
    (win) => {
      if (chrome.runtime.lastError || !win || typeof win.id !== 'number') return;

      chrome.storage.local.set({ [MINI_WINDOW_ID_KEY]: win.id }, () => {
        setStatus('MINI READY', false, 1800);
      });
    }
  );
}

function closeMiniWindow() {
  chrome.storage.local.get([MINI_WINDOW_ID_KEY], (result) => {
    const id = result && result[MINI_WINDOW_ID_KEY];
    if (typeof id !== 'number') {
      return;
    }

    chrome.windows.remove(id, () => {
      chrome.storage.local.remove([MINI_WINDOW_ID_KEY], () => {
        setStatus('MINI CLOSED', false, 1800);
      });
    });
  });
}
