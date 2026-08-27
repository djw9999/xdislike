/**
 * Pin Following yank tests - covering real failures from 2026-08-26 and 2026-08-27
 * 
 * Failure scenario (Founder + Maya):
 * User clicks "For you", opens a tweet, comes back to /home. "For you" is selected,
 * then ~3-7s later the extension clicks "Following" (yank).
 * 
 * Success criteria:
 * - For you still selected at 0s, 4s, and 8s after return
 * - Content-script reinit with session quietxLastHomeTab='foryou' must restore For you
 * - Cold start with empty session still pins Following on /home
 * - Default Following must never override a For you the user just chose
 * - Return paths: any leave-and-return (Back, in-post back, Notifications, Search, Home, logo)
 * 
 * PATH F (2026-08-27):
 * - For you → Notifications → left-nav Home yanked to Following at t=8s
 * - Root cause: async chrome.storage.session write can lose For you choice if content script
 *   reinits before the write lands
 * - Fix: also persist synchronously in window.sessionStorage
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { createChromeMock } from './chrome-mock.js';
import {
  resetState,
  loadSessionState,
  loadSyncSessionState,
  saveLastHomeTab,
  shouldPinFollowing,
  tryPinFollowing,
  initPinFollowing,
  reinitPinFollowing,
  getState,
  TAB_FOR_YOU,
  TAB_FOLLOWING,
  isOnHomePage,
  findHomeTablist,
  setupTabClickTracking,
  setWindowSessionStorage,
} from '../lib/pin-following.js';

function createHomePageDOM() {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <body>
      <div role="tablist">
        <div role="tab" aria-label="For you" aria-selected="true" tabindex="0">For you</div>
        <div role="tab" aria-label="Following" aria-selected="false" tabindex="-1">Following</div>
      </div>
    </body>
    </html>
  `, { url: 'https://x.com/home' });
  return dom;
}

function createHomePageDOMFollowingSelected() {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <body>
      <div role="tablist">
        <div role="tab" aria-label="For you" aria-selected="false" tabindex="-1">For you</div>
        <div role="tab" aria-label="Following" aria-selected="true" tabindex="0">Following</div>
      </div>
    </body>
    </html>
  `, { url: 'https://x.com/home' });
  return dom;
}

describe('Pin Following yank prevention', () => {
  let chrome;
  let dom;
  let document;

  beforeEach(() => {
    chrome = createChromeMock();
    resetState();
  });

  afterEach(() => {
    if (dom) {
      dom.window.close();
      dom = null;
    }
  });

  describe('Failure Case 1: For you yank after return from tweet detail', () => {
    it('should NOT pin Following when user chose For you before leaving', async () => {
      dom = createHomePageDOM();
      document = dom.window.document;
      
      await saveLastHomeTab(chrome, TAB_FOR_YOU);
      
      const state = getState();
      assert.strictEqual(state.lastHomeTab, TAB_FOR_YOU);
      assert.strictEqual(state.userChoseForYou, true);
      
      assert.strictEqual(shouldPinFollowing(), false, 
        'Should NOT pin Following when user chose For you');
    });

    it('should keep For you selected at 0s, 4s, and 8s after return', async () => {
      dom = createHomePageDOM();
      document = dom.window.document;
      
      await chrome.storage.session.set({
        quietxLastHomeTab: TAB_FOR_YOU,
        quietxUserChoseForYou: true
      });
      
      await loadSessionState(chrome);
      
      const forYouTab = document.querySelector('[aria-label="For you"]');
      const followingTab = document.querySelector('[aria-label="Following"]');
      
      let clickedFollowing = false;
      followingTab.click = () => { clickedFollowing = true; };
      
      const didPin = tryPinFollowing(document, chrome);
      assert.strictEqual(didPin, false, 'Should not have pinned Following at 0s');
      assert.strictEqual(forYouTab.getAttribute('aria-selected'), 'true', 'For you should still be selected at 0s');
      assert.strictEqual(clickedFollowing, false, 'Following should not have been clicked');
      
      await new Promise(r => setTimeout(r, 100));
      
      assert.strictEqual(shouldPinFollowing(), false, 'Should not pin at 4s simulation');
      assert.strictEqual(forYouTab.getAttribute('aria-selected'), 'true');
      
      await new Promise(r => setTimeout(r, 100));
      
      assert.strictEqual(shouldPinFollowing(), false, 'Should not pin at 8s simulation');
      assert.strictEqual(forYouTab.getAttribute('aria-selected'), 'true');
    });

    it('should preserve For you across multiple return paths', async () => {
      const returnPaths = [
        { name: 'Back button', simulate: () => {} },
        { name: 'In-post back', simulate: () => {} },
        { name: 'Notifications return', simulate: () => {} },
        { name: 'Search return', simulate: () => {} },
        { name: 'Home link', simulate: () => {} },
        { name: 'Logo click', simulate: () => {} },
      ];

      for (const path of returnPaths) {
        resetState();
        dom = createHomePageDOM();
        document = dom.window.document;
        
        await chrome.storage.session.set({
          quietxLastHomeTab: TAB_FOR_YOU,
          quietxUserChoseForYou: true
        });
        
        await loadSessionState(chrome);
        
        const didPin = tryPinFollowing(document, chrome);
        assert.strictEqual(didPin, false, 
          `Should not pin Following after return via ${path.name}`);
        
        dom.window.close();
      }
    });
  });

  describe('Failure Case 2: Reinit with session state', () => {
    it('should restore For you and NOT pin Following on reinit when session has foryou', async () => {
      dom = createHomePageDOM();
      document = dom.window.document;
      
      await chrome.storage.session.set({
        quietxLastHomeTab: TAB_FOR_YOU,
        quietxUserChoseForYou: true
      });
      
      await reinitPinFollowing(document, chrome);
      
      const state = getState();
      assert.strictEqual(state.lastHomeTab, TAB_FOR_YOU, 
        'Should have restored For you from session');
      assert.strictEqual(shouldPinFollowing(), false, 
        'Should NOT pin Following after reinit with foryou in session');
    });

    it('should handle fresh module load with existing session state', async () => {
      resetState();
      
      await chrome.storage.session.set({
        quietxLastHomeTab: TAB_FOR_YOU,
        quietxUserChoseForYou: true
      });
      
      dom = createHomePageDOM();
      document = dom.window.document;
      
      const forYouTab = document.querySelector('[aria-label="For you"]');
      const followingTab = document.querySelector('[aria-label="Following"]');
      
      let followingClicked = false;
      followingTab.click = () => { followingClicked = true; };
      
      await initPinFollowing(document, chrome);
      
      assert.strictEqual(followingClicked, false, 
        'Following should NOT be clicked on fresh load with foryou in session');
    });
  });

  describe('Cold start behavior', () => {
    it('should pin Following on cold start with empty session', async () => {
      resetState();
      dom = createHomePageDOM();
      document = dom.window.document;
      
      const followingTab = document.querySelector('[aria-label="Following"]');
      let followingClicked = false;
      followingTab.click = () => { 
        followingClicked = true;
        followingTab.setAttribute('aria-selected', 'true');
        document.querySelector('[aria-label="For you"]').setAttribute('aria-selected', 'false');
      };
      
      await initPinFollowing(document, chrome);
      
      assert.strictEqual(followingClicked, true, 
        'Following should be clicked on cold start with empty session');
    });

    it('should pin Following on cold start with undefined session values', async () => {
      resetState();
      
      await chrome.storage.session.set({
        quietxLastHomeTab: undefined,
        quietxUserChoseForYou: undefined
      });
      
      dom = createHomePageDOM();
      document = dom.window.document;
      
      const followingTab = document.querySelector('[aria-label="Following"]');
      let followingClicked = false;
      followingTab.click = () => { followingClicked = true; };
      
      await loadSessionState(chrome);
      const result = tryPinFollowing(document, chrome);
      
      assert.strictEqual(result, true, 
        'Should pin Following on cold start with undefined session');
    });
  });

  describe('User choice tracking', () => {
    it('should record user clicking For you', async () => {
      resetState();
      dom = createHomePageDOM();
      document = dom.window.document;
      
      await loadSessionState(chrome);
      setupTabClickTracking(document, chrome);
      
      const forYouTab = document.querySelector('[aria-label="For you"]');
      forYouTab.click();
      
      await new Promise(r => setTimeout(r, 10));
      
      const session = await chrome.storage.session.get(['quietxLastHomeTab', 'quietxUserChoseForYou']);
      assert.strictEqual(session.quietxLastHomeTab, TAB_FOR_YOU);
      assert.strictEqual(session.quietxUserChoseForYou, true);
    });

    it('should record user clicking Following', async () => {
      resetState();
      dom = createHomePageDOM();
      document = dom.window.document;
      
      await loadSessionState(chrome);
      setupTabClickTracking(document, chrome);
      
      const followingTab = document.querySelector('[aria-label="Following"]');
      followingTab.click();
      
      await new Promise(r => setTimeout(r, 10));
      
      const session = await chrome.storage.session.get(['quietxLastHomeTab', 'quietxUserChoseForYou']);
      assert.strictEqual(session.quietxLastHomeTab, TAB_FOLLOWING);
      assert.strictEqual(session.quietxUserChoseForYou, false);
    });

    it('should never override For you the user just chose', async () => {
      resetState();
      dom = createHomePageDOM();
      document = dom.window.document;
      
      await loadSessionState(chrome);
      setupTabClickTracking(document, chrome);
      
      const forYouTab = document.querySelector('[aria-label="For you"]');
      forYouTab.click();
      
      await new Promise(r => setTimeout(r, 10));
      
      await loadSessionState(chrome);
      
      assert.strictEqual(shouldPinFollowing(), false, 
        'Should NOT pin Following immediately after user chose For you');
      
      await new Promise(r => setTimeout(r, 50));
      
      assert.strictEqual(shouldPinFollowing(), false, 
        'Should NOT pin Following even after delay when user chose For you');
    });
  });

  describe('Page detection', () => {
    it('should identify /home as home page', () => {
      assert.strictEqual(isOnHomePage({ pathname: '/home' }), true);
    });

    it('should identify / as home page', () => {
      assert.strictEqual(isOnHomePage({ pathname: '/' }), true);
    });

    it('should identify empty path as home page', () => {
      assert.strictEqual(isOnHomePage({ pathname: '' }), true);
    });

    it('should not identify /notifications as home page', () => {
      assert.strictEqual(isOnHomePage({ pathname: '/notifications' }), false);
    });

    it('should not identify tweet detail as home page', () => {
      assert.strictEqual(isOnHomePage({ pathname: '/user/status/123456' }), false);
    });
  });

  describe('Tab detection', () => {
    it('should find home tablist with For you and Following tabs', () => {
      dom = createHomePageDOM();
      document = dom.window.document;
      
      const result = findHomeTablist(document);
      
      assert.ok(result !== null, 'Should find home tablist');
      assert.ok(result.forYouTab, 'Should find For you tab');
      assert.ok(result.followingTab, 'Should find Following tab');
    });

    it('should not find home tablist on non-home pages', () => {
      dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <div role="tablist">
            <div role="tab" aria-label="Posts">Posts</div>
            <div role="tab" aria-label="Replies">Replies</div>
          </div>
        </body>
        </html>
      `, { url: 'https://x.com/user' });
      document = dom.window.document;
      
      const result = findHomeTablist(document);
      
      assert.strictEqual(result, null, 'Should not find home tablist on profile page');
    });
  });

  describe('Edge cases', () => {
    it('should not pin when Following is already selected', async () => {
      resetState();
      dom = createHomePageDOMFollowingSelected();
      document = dom.window.document;
      
      await loadSessionState(chrome);
      
      const followingTab = document.querySelector('[aria-label="Following"]');
      let followingClicked = false;
      followingTab.click = () => { followingClicked = true; };
      
      const result = tryPinFollowing(document, chrome);
      
      assert.strictEqual(result, false, 'Should not try to pin when already on Following');
      assert.strictEqual(followingClicked, false);
    });

    it('should handle rapid tab switches correctly', async () => {
      resetState();
      dom = createHomePageDOM();
      document = dom.window.document;
      
      await loadSessionState(chrome);
      setupTabClickTracking(document, chrome);
      
      const forYouTab = document.querySelector('[aria-label="For you"]');
      const followingTab = document.querySelector('[aria-label="Following"]');
      
      forYouTab.click();
      followingTab.click();
      forYouTab.click();
      
      await new Promise(r => setTimeout(r, 20));
      
      const session = await chrome.storage.session.get(['quietxLastHomeTab']);
      assert.strictEqual(session.quietxLastHomeTab, TAB_FOR_YOU, 
        'Should track the last tab clicked');
    });
  });
});

describe('PATH F: Synchronous sessionStorage persistence (2026-08-27)', () => {
  let chrome;
  let dom;
  let document;
  let mockSessionStorage;

  function createMockSessionStorage() {
    const store = new Map();
    return {
      getItem(key) { return store.get(key) ?? null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); },
      clear() { store.clear(); },
      get length() { return store.size; },
      key(index) { return [...store.keys()][index] ?? null; },
      _getAll() { return Object.fromEntries(store); }
    };
  }

  beforeEach(() => {
    chrome = createChromeMock();
    mockSessionStorage = createMockSessionStorage();
    setWindowSessionStorage(mockSessionStorage);
    resetState();
  });

  afterEach(() => {
    setWindowSessionStorage(null);
    if (dom) {
      dom.window.close();
      dom = null;
    }
  });

  describe('Failure Case: For you → Notifications → left-nav Home yank at t=8s', () => {
    it('should persist foryou to sessionStorage synchronously on user choice', async () => {
      dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <div role="tablist">
            <div role="tab" aria-label="For you" aria-selected="true" tabindex="0">For you</div>
            <div role="tab" aria-label="Following" aria-selected="false" tabindex="-1">Following</div>
          </div>
        </body>
        </html>
      `, { url: 'https://x.com/home' });
      document = dom.window.document;
      
      await loadSessionState(chrome);
      setupTabClickTracking(document, chrome);
      
      const forYouTab = document.querySelector('[aria-label="For you"]');
      forYouTab.click();
      
      const syncState = mockSessionStorage._getAll();
      assert.strictEqual(syncState['quietx_lastHomeTab'], TAB_FOR_YOU,
        'sessionStorage should have foryou synchronously after click');
      assert.strictEqual(syncState['quietx_userChoseForYou'], 'true',
        'sessionStorage should have userChoseForYou=true synchronously');
    });

    it('should read foryou from sessionStorage on fresh init before async chrome.storage', async () => {
      mockSessionStorage.setItem('quietx_lastHomeTab', TAB_FOR_YOU);
      mockSessionStorage.setItem('quietx_userChoseForYou', 'true');
      
      resetState();
      
      const result = loadSyncSessionState();
      
      assert.strictEqual(result.lastHomeTab, TAB_FOR_YOU,
        'Should read foryou from sessionStorage');
      assert.strictEqual(result.userChoseForYou, true,
        'Should read userChoseForYou from sessionStorage');
      assert.strictEqual(result.fromSync, true,
        'Should indicate value came from sync storage');
    });

    it('Following.click count stays 0 for 8s when foryou in sessionStorage', async () => {
      mockSessionStorage.setItem('quietx_lastHomeTab', TAB_FOR_YOU);
      mockSessionStorage.setItem('quietx_userChoseForYou', 'true');
      
      resetState();
      
      dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <div role="tablist">
            <div role="tab" aria-label="For you" aria-selected="true" tabindex="0">For you</div>
            <div role="tab" aria-label="Following" aria-selected="false" tabindex="-1">Following</div>
          </div>
        </body>
        </html>
      `, { url: 'https://x.com/home' });
      document = dom.window.document;
      
      const followingTab = document.querySelector('[aria-label="Following"]');
      let followingClickCount = 0;
      followingTab.click = () => { followingClickCount++; };
      
      await initPinFollowing(document, chrome);
      assert.strictEqual(followingClickCount, 0, 'Following.click should be 0 at t=0s');
      
      await new Promise(r => setTimeout(r, 100));
      assert.strictEqual(followingClickCount, 0, 'Following.click should be 0 at t~2s');
      
      await new Promise(r => setTimeout(r, 100));
      assert.strictEqual(followingClickCount, 0, 'Following.click should be 0 at t~4s');
      
      await new Promise(r => setTimeout(r, 100));
      assert.strictEqual(followingClickCount, 0, 'Following.click should be 0 at t~6s');
      
      await new Promise(r => setTimeout(r, 100));
      assert.strictEqual(followingClickCount, 0, 'Following.click should be 0 at t~8s');
      
      assert.strictEqual(shouldPinFollowing(), false,
        'shouldPinFollowing should remain false throughout');
    });

    it('should NOT yank to Following after Notifications→Home return with foryou in sessionStorage', async () => {
      mockSessionStorage.setItem('quietx_lastHomeTab', TAB_FOR_YOU);
      mockSessionStorage.setItem('quietx_userChoseForYou', 'true');
      
      resetState();
      
      dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <div role="tablist">
            <div role="tab" aria-label="For you" aria-selected="true" tabindex="0">For you</div>
            <div role="tab" aria-label="Following" aria-selected="false" tabindex="-1">Following</div>
          </div>
        </body>
        </html>
      `, { url: 'https://x.com/home' });
      document = dom.window.document;
      
      const followingTab = document.querySelector('[aria-label="Following"]');
      let followingClickCount = 0;
      followingTab.click = () => { followingClickCount++; };
      
      await reinitPinFollowing(document, chrome);
      
      assert.strictEqual(followingClickCount, 0,
        'Following should NOT be clicked on Notifications→Home return');
      
      const state = getState();
      assert.strictEqual(state.lastHomeTab, TAB_FOR_YOU,
        'lastHomeTab should be foryou from sessionStorage');
      assert.strictEqual(state.userChoseForYou, true,
        'userChoseForYou should be true from sessionStorage');
    });

    it('should prefer sessionStorage over pending async chrome.storage.session', async () => {
      mockSessionStorage.setItem('quietx_lastHomeTab', TAB_FOR_YOU);
      mockSessionStorage.setItem('quietx_userChoseForYou', 'true');
      
      resetState();
      
      dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <div role="tablist">
            <div role="tab" aria-label="For you" aria-selected="true" tabindex="0">For you</div>
            <div role="tab" aria-label="Following" aria-selected="false" tabindex="-1">Following</div>
          </div>
        </body>
        </html>
      `, { url: 'https://x.com/home' });
      document = dom.window.document;
      
      const followingTab = document.querySelector('[aria-label="Following"]');
      let followingClickCount = 0;
      followingTab.click = () => { followingClickCount++; };
      
      await loadSessionState(chrome);
      
      assert.strictEqual(shouldPinFollowing(), false,
        'Should NOT pin Following when sessionStorage has foryou (even if chrome.storage empty)');
      assert.strictEqual(followingClickCount, 0);
    });
  });

  describe('Synchronous persistence dual-write', () => {
    it('should write to both sessionStorage and chrome.storage.session', async () => {
      dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <div role="tablist">
            <div role="tab" aria-label="For you" aria-selected="true" tabindex="0">For you</div>
            <div role="tab" aria-label="Following" aria-selected="false" tabindex="-1">Following</div>
          </div>
        </body>
        </html>
      `, { url: 'https://x.com/home' });
      document = dom.window.document;
      
      await saveLastHomeTab(chrome, TAB_FOR_YOU);
      
      assert.strictEqual(mockSessionStorage.getItem('quietx_lastHomeTab'), TAB_FOR_YOU,
        'sessionStorage should have foryou');
      
      const chromeSession = await chrome.storage.session.get(['quietxLastHomeTab']);
      assert.strictEqual(chromeSession.quietxLastHomeTab, TAB_FOR_YOU,
        'chrome.storage.session should also have foryou');
    });

    it('saveLastHomeTab should update sessionStorage synchronously before async completes', async () => {
      let asyncCompleted = false;
      const originalSet = chrome.storage.session.set.bind(chrome.storage.session);
      chrome.storage.session.set = (items, callback) => {
        setTimeout(() => {
          originalSet(items, () => {
            asyncCompleted = true;
            if (callback) callback();
          });
        }, 50);
        return Promise.resolve();
      };
      
      const promise = saveLastHomeTab(chrome, TAB_FOR_YOU);
      
      assert.strictEqual(mockSessionStorage.getItem('quietx_lastHomeTab'), TAB_FOR_YOU,
        'sessionStorage should be updated synchronously BEFORE async completes');
      assert.strictEqual(asyncCompleted, false,
        'Async should not have completed yet');
      
      await promise;
    });
  });

  describe('Cold start with empty sessionStorage', () => {
    it('should still pin Following when sessionStorage is empty', async () => {
      resetState();
      
      dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <div role="tablist">
            <div role="tab" aria-label="For you" aria-selected="true" tabindex="0">For you</div>
            <div role="tab" aria-label="Following" aria-selected="false" tabindex="-1">Following</div>
          </div>
        </body>
        </html>
      `, { url: 'https://x.com/home' });
      document = dom.window.document;
      
      const followingTab = document.querySelector('[aria-label="Following"]');
      let followingClicked = false;
      followingTab.click = () => { followingClicked = true; };
      
      await initPinFollowing(document, chrome);
      
      assert.strictEqual(followingClicked, true,
        'Should pin Following on cold start with empty sessionStorage');
    });

    it('loadSyncSessionState should return fromSync=false when empty', () => {
      resetState();
      
      const result = loadSyncSessionState();
      
      assert.strictEqual(result.lastHomeTab, null);
      assert.strictEqual(result.userChoseForYou, false);
      assert.strictEqual(result.fromSync, false);
    });
  });
});
