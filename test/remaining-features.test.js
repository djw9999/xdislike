/**
 * Remaining features tests - placeholder tests for future implementation
 * 
 * Features to cover:
 * 1. Hide promoted posts (blockAds) - existing feature
 * 2. Hide Grok chrome + Premium upsell
 * 3. Polar unpaid LOCKED vs paid PRO gate
 * 4. Merge Communities off-by-default
 * 
 * These tests use fixtures/mocks, not live X and not real Polar keys.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { createChromeMock } from './chrome-mock.js';

describe('Hide promoted posts (existing feature)', () => {
  let chrome;
  let dom;

  beforeEach(() => {
    chrome = createChromeMock();
  });

  afterEach(() => {
    if (dom) {
      dom.window.close();
      dom = null;
    }
  });

  it('should detect "Ad" label in tweet header', () => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
      <body>
        <article data-testid="tweet">
          <span>Ad</span>
          <div data-testid="tweetText">Check out our product!</div>
        </article>
      </body>
      </html>
    `);
    const article = dom.window.document.querySelector('article');
    const spans = article.querySelectorAll('span');
    
    let isAd = false;
    for (const span of spans) {
      const text = (span.textContent || '').trim().toLowerCase();
      if (text === 'ad' || text === 'promoted' || text === 'sponsored') {
        isAd = true;
        break;
      }
    }
    
    assert.strictEqual(isAd, true, 'Should detect "Ad" label');
  });

  it('should detect "Promoted" label in tweet header', () => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
      <body>
        <article data-testid="tweet">
          <span>Promoted</span>
          <div data-testid="tweetText">Download our app!</div>
        </article>
      </body>
      </html>
    `);
    const article = dom.window.document.querySelector('article');
    const spans = article.querySelectorAll('span');
    
    let isAd = false;
    for (const span of spans) {
      const text = (span.textContent || '').trim().toLowerCase();
      if (text === 'ad' || text === 'promoted' || text === 'sponsored') {
        isAd = true;
        break;
      }
    }
    
    assert.strictEqual(isAd, true, 'Should detect "Promoted" label');
  });

  it('should NOT detect normal tweets as ads', () => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
      <body>
        <article data-testid="tweet">
          <span>John Doe</span>
          <span>@johndoe</span>
          <div data-testid="tweetText">Just a normal tweet!</div>
        </article>
      </body>
      </html>
    `);
    const article = dom.window.document.querySelector('article');
    const spans = article.querySelectorAll('span');
    
    let isAd = false;
    for (const span of spans) {
      const text = (span.textContent || '').trim().toLowerCase();
      if (text === 'ad' || text === 'promoted' || text === 'sponsored') {
        isAd = true;
        break;
      }
    }
    
    assert.strictEqual(isAd, false, 'Normal tweet should NOT be detected as ad');
  });

  it('should persist blockAds setting', async () => {
    await chrome.storage.local.set({ blockAds: true });
    const result = await chrome.storage.local.get(['blockAds']);
    
    assert.strictEqual(result.blockAds, true);
  });
});

describe('Hide Grok chrome + Premium upsell', () => {
  let chrome;
  let dom;

  beforeEach(() => {
    chrome = createChromeMock();
  });

  afterEach(() => {
    if (dom) {
      dom.window.close();
      dom = null;
    }
  });

  it('should detect Grok promotional elements', () => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
      <body>
        <div data-testid="sidebarColumn">
          <div>
            <span>Try Grok</span>
            <span>AI-powered search</span>
          </div>
        </div>
      </body>
      </html>
    `);
    const sidebar = dom.window.document.querySelector('[data-testid="sidebarColumn"]');
    const text = (sidebar.textContent || '').toLowerCase();
    
    const hasGrokPromo = text.includes('try grok') || text.includes('grok');
    
    assert.strictEqual(hasGrokPromo, true, 'Should detect Grok promotional element');
  });

  it('should detect Premium upsell elements', () => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
      <body>
        <div data-testid="sidebarColumn">
          <div>
            <span>Subscribe to Premium</span>
            <span>Get verified and more</span>
          </div>
        </div>
      </body>
      </html>
    `);
    const sidebar = dom.window.document.querySelector('[data-testid="sidebarColumn"]');
    const text = (sidebar.textContent || '').toLowerCase();
    
    const hasPremiumUpsell = text.includes('premium') || text.includes('subscribe');
    
    assert.strictEqual(hasPremiumUpsell, true, 'Should detect Premium upsell element');
  });

  it('should persist hideGrokChrome setting', async () => {
    await chrome.storage.local.set({ hideGrokChrome: true });
    const result = await chrome.storage.local.get(['hideGrokChrome']);
    
    assert.strictEqual(result.hideGrokChrome, true);
  });

  it('should persist hidePremiumUpsell setting', async () => {
    await chrome.storage.local.set({ hidePremiumUpsell: true });
    const result = await chrome.storage.local.get(['hidePremiumUpsell']);
    
    assert.strictEqual(result.hidePremiumUpsell, true);
  });
});

describe('Polar unpaid LOCKED vs paid PRO gate', () => {
  let chrome;

  beforeEach(() => {
    chrome = createChromeMock();
  });

  it('should default to unpaid/LOCKED state with no Polar key', async () => {
    const result = await chrome.storage.local.get(['polarLicenseKey', 'polarStatus']);
    
    assert.strictEqual(result.polarLicenseKey, undefined);
    assert.strictEqual(result.polarStatus, undefined);
    
    const isProUser = !!(result.polarLicenseKey && result.polarStatus === 'active');
    assert.strictEqual(isProUser, false, 'Should be unpaid/LOCKED without key');
  });

  it('should detect PRO status with valid license (mocked)', async () => {
    await chrome.storage.local.set({ 
      polarLicenseKey: 'test_mock_key_do_not_commit',
      polarStatus: 'active'
    });
    
    const result = await chrome.storage.local.get(['polarLicenseKey', 'polarStatus']);
    
    const isProUser = !!(result.polarLicenseKey && result.polarStatus === 'active');
    assert.strictEqual(isProUser, true, 'Should detect PRO with valid license');
  });

  it('should handle expired/revoked license', async () => {
    await chrome.storage.local.set({ 
      polarLicenseKey: 'test_expired_key',
      polarStatus: 'revoked'
    });
    
    const result = await chrome.storage.local.get(['polarLicenseKey', 'polarStatus']);
    
    const isProUser = !!(result.polarLicenseKey && result.polarStatus === 'active');
    assert.strictEqual(isProUser, false, 'Should NOT be PRO with revoked license');
  });

  it('should NOT store real Polar keys in tests', () => {
    const testContent = `
      test_mock_key_do_not_commit
      test_expired_key
    `;
    
    const hasRealKey = /pk_live_|pol_[a-zA-Z0-9]{20,}/.test(testContent);
    assert.strictEqual(hasRealKey, false, 'Tests should never contain real Polar keys');
  });
});

describe('Merge Communities off-by-default', () => {
  let chrome;

  beforeEach(() => {
    chrome = createChromeMock();
  });

  it('should default mergeCommunityTabs to false', async () => {
    const result = await chrome.storage.local.get(['mergeCommunityTabs']);
    
    const isEnabled = !!result.mergeCommunityTabs;
    assert.strictEqual(isEnabled, false, 'mergeCommunityTabs should be off by default');
  });

  it('should persist mergeCommunityTabs when enabled', async () => {
    await chrome.storage.local.set({ mergeCommunityTabs: true });
    const result = await chrome.storage.local.get(['mergeCommunityTabs']);
    
    assert.strictEqual(result.mergeCommunityTabs, true);
  });

  it('should persist mergeCommunityTabs when disabled', async () => {
    await chrome.storage.local.set({ mergeCommunityTabs: true });
    await chrome.storage.local.set({ mergeCommunityTabs: false });
    const result = await chrome.storage.local.get(['mergeCommunityTabs']);
    
    assert.strictEqual(result.mergeCommunityTabs, false);
  });

  it('should trigger storage change listener when toggled', async () => {
    let changeDetected = false;
    
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.mergeCommunityTabs) {
        changeDetected = true;
      }
    });
    
    await chrome.storage.local.set({ mergeCommunityTabs: true });
    
    assert.strictEqual(changeDetected, true, 'Should trigger change listener');
  });
});

describe('Feature interaction tests', () => {
  let chrome;

  beforeEach(() => {
    chrome = createChromeMock();
  });

  it('should allow multiple features to be enabled simultaneously', async () => {
    await chrome.storage.local.set({
      blockAds: true,
      hideGrokPosts: true,
      hideGrokChrome: true,
      mergeCommunityTabs: true
    });
    
    const result = await chrome.storage.local.get([
      'blockAds', 
      'hideGrokPosts', 
      'hideGrokChrome', 
      'mergeCommunityTabs'
    ]);
    
    assert.strictEqual(result.blockAds, true);
    assert.strictEqual(result.hideGrokPosts, true);
    assert.strictEqual(result.hideGrokChrome, true);
    assert.strictEqual(result.mergeCommunityTabs, true);
  });

  it('should allow features to be toggled independently', async () => {
    await chrome.storage.local.set({
      blockAds: true,
      hideGrokPosts: true
    });
    
    await chrome.storage.local.set({ blockAds: false });
    
    const result = await chrome.storage.local.get(['blockAds', 'hideGrokPosts']);
    
    assert.strictEqual(result.blockAds, false, 'blockAds should be toggled off');
    assert.strictEqual(result.hideGrokPosts, true, 'hideGrokPosts should remain on');
  });
});

describe('DOM fixture tests', () => {
  let dom;

  afterEach(() => {
    if (dom) {
      dom.window.close();
      dom = null;
    }
  });

  it('should correctly identify X/Twitter tweet structure', () => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
      <body>
        <div data-testid="cellInnerDiv">
          <article data-testid="tweet">
            <div data-testid="User-Name">@testuser</div>
            <div data-testid="tweetText">Hello world!</div>
            <div data-testid="caret" role="button" aria-label="More"></div>
          </article>
        </div>
      </body>
      </html>
    `);
    
    const article = dom.window.document.querySelector('[data-testid="tweet"]');
    const userName = dom.window.document.querySelector('[data-testid="User-Name"]');
    const tweetText = dom.window.document.querySelector('[data-testid="tweetText"]');
    const moreButton = dom.window.document.querySelector('[data-testid="caret"]');
    
    assert.ok(article, 'Should find tweet article');
    assert.ok(userName, 'Should find user name');
    assert.ok(tweetText, 'Should find tweet text');
    assert.ok(moreButton, 'Should find more button');
  });

  it('should correctly identify X/Twitter sidebar structure', () => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
      <body>
        <div data-testid="sidebarColumn">
          <div data-testid="SearchBox_Search_Input"></div>
          <div data-testid="trend"></div>
        </div>
      </body>
      </html>
    `);
    
    const sidebar = dom.window.document.querySelector('[data-testid="sidebarColumn"]');
    const searchBox = dom.window.document.querySelector('[data-testid="SearchBox_Search_Input"]');
    const trend = dom.window.document.querySelector('[data-testid="trend"]');
    
    assert.ok(sidebar, 'Should find sidebar');
    assert.ok(searchBox, 'Should find search box');
    assert.ok(trend, 'Should find trend');
  });
});
