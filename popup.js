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
      return { valid: false, error: 'network', message: 'Network error or invalid request' };
    }

    const data = await response.json();
    return { valid: data.status === 'granted', data };
  } catch (error) {
    console.error('License validation error:', error);
    return { valid: false, error: 'network', message: error.message };
  }
}

function restoreState() {
  chrome.storage.local.get(['licenseKey', 'isPro', 'mergeCommunityTabs', 'blockAds'], (result) => {
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
    if (blockAdsEl) blockAdsEl.checked = !!result.blockAds;
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

    activateBtn.innerText = 'Verifying...';
    activateBtn.disabled = true;

    try {
      const validation = await validateLicenseKey(key);

      if (validation.valid) {
        await chrome.storage.local.set({ licenseKey: key, isPro: true });
        updateUI(true);
        setStatus('ACTIVATED', false, 2000);
      } else {
        if (validation.error === 'network') {
          setStatus('OFFLINE', true, 3000);
        } else {
          setStatus('INVALID KEY', true, 3000);
        }
      }
    } catch (error) {
      console.error(error);
      setStatus('ERROR', true, 3000);
    } finally {
      activateBtn.innerText = 'Activate License';
      activateBtn.disabled = false;
    }
  });
}

function wireSettings() {
  const mergeEl = document.getElementById('merge-community-tabs');
  const blockAdsEl = document.getElementById('block-ads');

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
