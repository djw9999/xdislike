document.addEventListener('DOMContentLoaded', () => {
  restoreState();
  wireMiniWindowButtons();
  wireSettings();
  wireLicenseActivation();
});

const POLAR_ORG_ID = 'bf5e3e6c-d148-45fc-b3e0-c5594d693edb';
const POLAR_VALIDATE_URL = 'https://api.polar.sh/v1/customer-portal/license-keys/validate';

let statusResetTimer = null;

async function validateLicenseKey(key) {
  try {
    const response = await fetch(POLAR_VALIDATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key: key,
        organization_id: POLAR_ORG_ID
      })
    });

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        return { valid: false, error: 'invalid', message: 'Invalid key or not found' };
      }
      return { valid: false, error: 'network', message: 'Server error' };
    }

    const data = await response.json();
    if (data.status === 'granted') {
      return { valid: true, data };
    }
    return { valid: false, error: 'invalid', data };
  } catch (error) {
    console.error('License validation error:', error);
    return { valid: false, error: 'network', message: error.message };
  }
}

function restoreState() {
  chrome.storage.local.get(['licenseKey', 'isPro', 'mergeCommunityTabs', 'blockAds', 'pinFollowing', 'hideGrokChrome', 'hideGrokPosts', 'hideDiscoverMore', 'hideMediaPreview', 'hideViews', 'hideTrends', 'hideTweetGrokIcon', 'cleanerOwnReplies', 'foldBotReplies'], (result) => {
    const hasStoredGrant = result.licenseKey && result.isPro;

    if (hasStoredGrant) {
      updateUI(true);

      validateLicenseKey(result.licenseKey).then((validation) => {
        if (validation.valid) {
          return;
        }

        if (validation.error === 'network') {
          return;
        }

        chrome.storage.local.set({ isPro: false }, () => {
          updateUI(false);
        });
      });
    } else {
      updateUI(false);
    }

    const mergeEl = document.getElementById('merge-community-tabs');
    if (mergeEl) mergeEl.checked = !!result.mergeCommunityTabs;

    const blockAdsEl = document.getElementById('block-ads');
    if (blockAdsEl) {
      if (hasStoredGrant) {
        blockAdsEl.checked = result.blockAds !== false;
      } else {
        blockAdsEl.checked = !!result.blockAds;
      }
    }

    const pinFollowingEl = document.getElementById('pin-following');
    if (pinFollowingEl) {
      if (hasStoredGrant) {
        pinFollowingEl.checked = result.pinFollowing !== false;
      } else {
        pinFollowingEl.checked = !!result.pinFollowing;
      }
    }

    const hideGrokEl = document.getElementById('hide-grok-chrome');
    if (hideGrokEl) {
      if (hasStoredGrant) {
        hideGrokEl.checked = result.hideGrokChrome !== false;
      } else {
        hideGrokEl.checked = !!result.hideGrokChrome;
      }
    }

    const hideGrokPostsEl = document.getElementById('hide-grok-posts');
    if (hideGrokPostsEl) {
      if (hasStoredGrant) {
        hideGrokPostsEl.checked = result.hideGrokPosts !== false;
      } else {
        hideGrokPostsEl.checked = !!result.hideGrokPosts;
      }
    }

    const hideDiscoverMoreEl = document.getElementById('hide-discover-more');
    if (hideDiscoverMoreEl) {
      if (hasStoredGrant) {
        hideDiscoverMoreEl.checked = result.hideDiscoverMore !== false;
      } else {
        hideDiscoverMoreEl.checked = !!result.hideDiscoverMore;
      }
    }

    const hideMediaPreviewEl = document.getElementById('hide-media-preview');
    if (hideMediaPreviewEl) {
      // Default OFF: require explicit true (even for Pro / hasStoredGrant)
      hideMediaPreviewEl.checked = result.hideMediaPreview === true;
    }

    const hideViewsEl = document.getElementById('hide-views');
    if (hideViewsEl) {
      if (hasStoredGrant) {
        hideViewsEl.checked = result.hideViews !== false;
      } else {
        hideViewsEl.checked = !!result.hideViews;
      }
    }

    const hideTrendsEl = document.getElementById('hide-trends');
    if (hideTrendsEl) {
      if (hasStoredGrant) {
        hideTrendsEl.checked = result.hideTrends !== false;
      } else {
        hideTrendsEl.checked = !!result.hideTrends;
      }
    }

    const hideTweetGrokIconEl = document.getElementById('hide-tweet-grok-icon');
    if (hideTweetGrokIconEl) {
      if (hasStoredGrant) {
        hideTweetGrokIconEl.checked = result.hideTweetGrokIcon !== false;
      } else {
        hideTweetGrokIconEl.checked = !!result.hideTweetGrokIcon;
      }
    }

    const cleanerOwnRepliesEl = document.getElementById('cleaner-own-replies');
    if (cleanerOwnRepliesEl) {
      if (hasStoredGrant) {
        cleanerOwnRepliesEl.checked = result.cleanerOwnReplies !== false;
      } else {
        cleanerOwnRepliesEl.checked = !!result.cleanerOwnReplies;
      }
    }

    const foldBotRepliesEl = document.getElementById('fold-bot-replies');
    if (foldBotRepliesEl) {
      // Default OFF: require explicit true (even for Pro / hasStoredGrant)
      foldBotRepliesEl.checked = result.foldBotReplies === true;
    }
  });
}

function updateUI(isPro) {
  const form = document.getElementById('activation-form');
  const features = document.getElementById('main-features');
  const status = document.getElementById('ready-status');

  if (isPro) {
    if (form) form.style.display = 'none';
    if (features) features.style.display = 'grid';
    if (status) {
      status.innerText = 'PRO';
      status.classList.remove('locked');
    }
  } else {
    if (form) form.style.display = 'grid';
    if (features) features.style.display = 'none';
    if (status) {
      status.innerText = 'LOCKED';
      status.classList.add('locked');
    }
  }
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
      chrome.storage.local.get(['isPro'], (result) => {
        if (result.isPro) {
          status.innerText = 'PRO';
          status.classList.remove('locked');
        } else {
          status.innerText = 'LOCKED';
          status.classList.add('locked');
        }
      });
    }, resetAfterMs);
  }
}

function wireLicenseActivation() {
  const activateBtn = document.getElementById('activate-btn');
  if (!activateBtn) return;

  activateBtn.addEventListener('click', async () => {
    const keyInput = document.getElementById('license-key');
    const key = keyInput ? keyInput.value.trim() : '';

    if (!key) {
      setStatus('ENTER KEY', true, 2000);
      return;
    }

    setStatus('VERIFYING', true, 0);
    activateBtn.innerText = 'Verifying...';
    activateBtn.disabled = true;

    try {
      const validation = await validateLicenseKey(key);

      if (validation.valid) {
        const current = await chrome.storage.local.get(['blockAds', 'pinFollowing', 'hideGrokChrome', 'hideGrokPosts', 'hideDiscoverMore', 'hideMediaPreview', 'hideViews', 'hideTrends', 'hideTweetGrokIcon', 'cleanerOwnReplies', 'foldBotReplies']);
        const updates = { licenseKey: key, isPro: true };
        if (current.blockAds === undefined) {
          updates.blockAds = true;
        }
        if (current.pinFollowing === undefined) {
          updates.pinFollowing = true;
        }
        if (current.hideGrokChrome === undefined) {
          updates.hideGrokChrome = true;
        }
        if (current.hideGrokPosts === undefined) {
          updates.hideGrokPosts = true;
        }
        if (current.hideDiscoverMore === undefined) {
          updates.hideDiscoverMore = true;
        }
        if (current.hideViews === undefined) {
          updates.hideViews = true;
        }
        if (current.hideTrends === undefined) {
          updates.hideTrends = true;
        }
        if (current.hideTweetGrokIcon === undefined) {
          updates.hideTweetGrokIcon = true;
        }
        if (current.cleanerOwnReplies === undefined) {
          updates.cleanerOwnReplies = true;
        }
        await chrome.storage.local.set(updates);
        updateUI(true);
        const blockAdsEl = document.getElementById('block-ads');
        if (blockAdsEl) {
          blockAdsEl.checked = current.blockAds !== false;
        }
        const pinFollowingEl = document.getElementById('pin-following');
        if (pinFollowingEl) {
          pinFollowingEl.checked = current.pinFollowing !== false;
        }
        const hideGrokEl = document.getElementById('hide-grok-chrome');
        if (hideGrokEl) {
          hideGrokEl.checked = current.hideGrokChrome !== false;
        }
        const hideGrokPostsEl = document.getElementById('hide-grok-posts');
        if (hideGrokPostsEl) {
          hideGrokPostsEl.checked = current.hideGrokPosts !== false;
        }
        const hideDiscoverMoreEl = document.getElementById('hide-discover-more');
        if (hideDiscoverMoreEl) {
          hideDiscoverMoreEl.checked = current.hideDiscoverMore !== false;
        }
        const hideMediaPreviewEl = document.getElementById('hide-media-preview');
        if (hideMediaPreviewEl) {
          hideMediaPreviewEl.checked = current.hideMediaPreview === true;
        }
        const hideViewsEl = document.getElementById('hide-views');
        if (hideViewsEl) {
          hideViewsEl.checked = current.hideViews !== false;
        }
        const hideTrendsEl = document.getElementById('hide-trends');
        if (hideTrendsEl) {
          hideTrendsEl.checked = current.hideTrends !== false;
        }
        const hideTweetGrokIconEl = document.getElementById('hide-tweet-grok-icon');
        if (hideTweetGrokIconEl) {
          hideTweetGrokIconEl.checked = current.hideTweetGrokIcon !== false;
        }
        const cleanerOwnRepliesEl = document.getElementById('cleaner-own-replies');
        if (cleanerOwnRepliesEl) {
          cleanerOwnRepliesEl.checked = current.cleanerOwnReplies !== false;
        }
        const foldBotRepliesEl = document.getElementById('fold-bot-replies');
        if (foldBotRepliesEl) {
          foldBotRepliesEl.checked = current.foldBotReplies === true;
        }
        setStatus('ACTIVATED', false, 2000);
      } else if (validation.error === 'network') {
        setStatus('OFFLINE', true, 3000);
      } else {
        setStatus('INVALID KEY', true, 3000);
      }
    } catch (error) {
      console.error(error);
      setStatus('OFFLINE', true, 3000);
    } finally {
      activateBtn.innerText = 'Activate License';
      activateBtn.disabled = false;
    }
  });
}

function persistToggle(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const persist = () => {
    chrome.storage.local.set({ [key]: !!el.checked });
  };
  el.addEventListener('change', persist);
  const card = el.closest('label');
  if (card) {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      el.checked = !el.checked;
      persist();
    });
  }
}

function wireSettings() {
  persistToggle('merge-community-tabs', 'mergeCommunityTabs');
  persistToggle('block-ads', 'blockAds');
  persistToggle('pin-following', 'pinFollowing');
  persistToggle('hide-grok-chrome', 'hideGrokChrome');
  persistToggle('hide-grok-posts', 'hideGrokPosts');
  persistToggle('hide-discover-more', 'hideDiscoverMore');
  persistToggle('hide-media-preview', 'hideMediaPreview');
  persistToggle('hide-views', 'hideViews');
  persistToggle('hide-trends', 'hideTrends');
  persistToggle('hide-tweet-grok-icon', 'hideTweetGrokIcon');
  persistToggle('cleaner-own-replies', 'cleanerOwnReplies');
  persistToggle('fold-bot-replies', 'foldBotReplies');
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    persistToggle,
    restoreState,
    updateUI,
    validateLicenseKey,
    wireSettings
  };
}
