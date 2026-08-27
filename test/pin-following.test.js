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
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { createChromeMock } from './chrome-mock.js';
import {
  resetState,
  loadSessionState,
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
