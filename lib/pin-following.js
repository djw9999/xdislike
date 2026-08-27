/**
 * Pin Following feature with session persistence
 * 
 * Behavior:
 * - On /home, auto-selects "Following" tab unless user previously chose "For you"
 * - Remembers user's last explicit tab choice in chrome.storage.session
 * - Does NOT override "For you" if user just selected it (no yank)
 * - Cold start with empty session pins Following
 * - Re-init must restore last choice, not always pin Following
 */

const STORAGE_KEY_LAST_HOME_TAB = 'quietxLastHomeTab';
const STORAGE_KEY_USER_CHOSE_FOR_YOU = 'quietxUserChoseForYou';

export const TAB_FOR_YOU = 'foryou';
export const TAB_FOLLOWING = 'following';

let lastHomeTab = null;
let userChoseForYou = false;
let initialized = false;
let storageReady = false;
let pendingPinFollowing = false;

function isElement(obj) {
  return obj && typeof obj === 'object' && typeof obj.querySelector === 'function';
}

export function isForYouLabel(label) {
  if (!label) return false;
  const s = label.trim().toLowerCase();
  return (
    s === 'for you' ||
    s === 'for-you' ||
    s === '为你推荐' ||
    s === '为你' ||
    s.includes('for you') ||
    s.includes('为你')
  );
}

export function isFollowingLabel(label) {
  if (!label) return false;
  const s = label.trim().toLowerCase();
  return (
    s === 'following' ||
    s === '正在关注' ||
    s === '关注' ||
    s.includes('following') ||
    s.includes('关注')
  );
}

export function getTabLabel(tab) {
  if (!isElement(tab) && !(tab && tab.getAttribute)) return '';
  const aria = tab.getAttribute ? tab.getAttribute('aria-label') : '';
  if (aria && aria.trim()) return aria.trim();
  return (tab.textContent || '').trim();
}

export function findHomeTablist(document) {
  const tablists = document.querySelectorAll('[role="tablist"]');
  for (const tablist of tablists) {
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    if (tabs.length >= 2) {
      const first = getTabLabel(tabs[0]);
      const second = getTabLabel(tabs[1]);
      if (isForYouLabel(first) && isFollowingLabel(second)) {
        return { tablist, forYouTab: tabs[0], followingTab: tabs[1] };
      }
      if (isFollowingLabel(first) && isForYouLabel(second)) {
        return { tablist, forYouTab: tabs[1], followingTab: tabs[0] };
      }
    }
  }
  return null;
}

export function findSelectedTab(tabs) {
  for (const tab of tabs) {
    if (tab.getAttribute('aria-selected') === 'true') return tab;
  }
  for (const tab of tabs) {
    if (tab.tabIndex === 0) return tab;
  }
  return null;
}

export function isOnHomePage(location) {
  const pathname = location?.pathname || '';
  return pathname === '/home' || pathname === '/' || pathname === '';
}

export function getState() {
  return { lastHomeTab, userChoseForYou, initialized, storageReady };
}

export function resetState() {
  lastHomeTab = null;
  userChoseForYou = false;
  initialized = false;
  storageReady = false;
  pendingPinFollowing = false;
}

export async function loadSessionState(chrome) {
  return new Promise((resolve) => {
    chrome.storage.session.get([STORAGE_KEY_LAST_HOME_TAB, STORAGE_KEY_USER_CHOSE_FOR_YOU], (result) => {
      lastHomeTab = result[STORAGE_KEY_LAST_HOME_TAB] || null;
      userChoseForYou = !!result[STORAGE_KEY_USER_CHOSE_FOR_YOU];
      storageReady = true;
      resolve({ lastHomeTab, userChoseForYou });
    });
  });
}

export async function saveLastHomeTab(chrome, tabType) {
  lastHomeTab = tabType;
  const isForYou = tabType === TAB_FOR_YOU;
  userChoseForYou = isForYou;
  
  return new Promise((resolve) => {
    chrome.storage.session.set({
      [STORAGE_KEY_LAST_HOME_TAB]: tabType,
      [STORAGE_KEY_USER_CHOSE_FOR_YOU]: isForYou
    }, resolve);
  });
}

export function shouldPinFollowing() {
  if (!storageReady) return false;
  if (lastHomeTab === TAB_FOR_YOU) return false;
  if (userChoseForYou) return false;
  return true;
}

export function tryPinFollowing(document, chrome) {
  if (!isOnHomePage(document.location)) return false;
  if (!shouldPinFollowing()) return false;
  
  const result = findHomeTablist(document);
  if (!result) return false;
  
  const { forYouTab, followingTab } = result;
  const selected = findSelectedTab([forYouTab, followingTab]);
  
  if (selected === followingTab) {
    return false;
  }
  
  if (selected === forYouTab) {
    if (userChoseForYou) {
      return false;
    }
  }
  
  followingTab.click();
  saveLastHomeTab(chrome, TAB_FOLLOWING);
  return true;
}

export function recordUserTabChoice(tabType, chrome) {
  saveLastHomeTab(chrome, tabType);
}

export function setupTabClickTracking(document, chrome) {
  const result = findHomeTablist(document);
  if (!result) return null;
  
  const { forYouTab, followingTab } = result;
  
  const forYouHandler = () => {
    recordUserTabChoice(TAB_FOR_YOU, chrome);
  };
  
  const followingHandler = () => {
    recordUserTabChoice(TAB_FOLLOWING, chrome);
  };
  
  forYouTab.addEventListener('click', forYouHandler, true);
  followingTab.addEventListener('click', followingHandler, true);
  
  return {
    cleanup: () => {
      forYouTab.removeEventListener('click', forYouHandler, true);
      followingTab.removeEventListener('click', followingHandler, true);
    }
  };
}

export async function initPinFollowing(document, chrome, options = {}) {
  if (initialized && !options.force) return;
  initialized = true;
  
  await loadSessionState(chrome);
  
  if (isOnHomePage(document.location)) {
    setupTabClickTracking(document, chrome);
    
    if (shouldPinFollowing()) {
      if (options.delay) {
        await new Promise(r => setTimeout(r, options.delay));
      }
      tryPinFollowing(document, chrome);
    }
  }
}

export function reinitPinFollowing(document, chrome) {
  return initPinFollowing(document, chrome, { force: true });
}
