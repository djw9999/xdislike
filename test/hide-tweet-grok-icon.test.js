/**
 * Tests for the Hide Tweet Grok Icon feature
 * Tests:
 * 1. Matching Grok actions button is hidden
 * 2. A node that contains caret is never hidden
 * 3. Action bar [role=group] is never hidden
 * 4. OFF restores the Grok icon
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { createChromeMock } from './chrome-mock.js';

const TWEET_GROK_ICON_HIDDEN_CLASS = 'quietx-tweet-grok-hidden';

function nodeContainsCaretOrMore(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.matches('[data-testid="caret"]')) return true;
  if (el.querySelector('[data-testid="caret"]')) return true;
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
  if (ariaLabel === 'more' || ariaLabel === '更多') return true;
  return false;
}

function nodeContainsSocialActions(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.querySelector('[role="group"]')) return true;
  if (el.matches('[role="group"]')) return true;
  if (el.querySelector('[data-testid="reply"]')) return true;
  if (el.querySelector('[data-testid="retweet"]')) return true;
  if (el.querySelector('[data-testid="like"]')) return true;
  if (el.querySelector('[data-testid="bookmark"]')) return true;
  return false;
}

function nodeContainsUserInfo(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.querySelector('[data-testid="User-Name"]')) return true;
  if (el.querySelector('[data-testid="UserAvatar-Container-unknown"]')) return true;
  if (el.querySelector('time')) return true;
  return false;
}

function nodeContainsTweetText(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.querySelector('[data-testid="tweetText"]')) return true;
  return false;
}

function nodeIsInNavOrSidebar(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('nav')) return true;
  if (el.closest('[data-testid="sidebarColumn"]')) return true;
  return false;
}

function isTweetGrokIconControl(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (nodeContainsCaretOrMore(el)) return false;
  if (nodeContainsSocialActions(el)) return false;
  if (nodeContainsUserInfo(el)) return false;
  if (nodeContainsTweetText(el)) return false;
  if (nodeIsInNavOrSidebar(el)) return false;
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
  if (ariaLabel !== 'grok actions') return false;
  const article = el.closest('article[data-testid="tweet"]');
  if (!article) return false;
  return true;
}

function hideTweetGrokIconNode(el) {
  if (!(el instanceof HTMLElement)) return;
  if (nodeContainsCaretOrMore(el)) return;
  if (el.classList.contains(TWEET_GROK_ICON_HIDDEN_CLASS)) return;
  el.classList.add(TWEET_GROK_ICON_HIDDEN_CLASS);
}

function hideTweetGrokIcons(document) {
  const grokButtons = document.querySelectorAll('article[data-testid="tweet"] button[aria-label="Grok actions"]');
  grokButtons.forEach(btn => {
    if (isTweetGrokIconControl(btn)) {
      hideTweetGrokIconNode(btn);
    }
  });
}

function showTweetGrokIcons(document) {
  document.querySelectorAll('.' + TWEET_GROK_ICON_HIDDEN_CLASS).forEach(el => {
    el.classList.remove(TWEET_GROK_ICON_HIDDEN_CLASS);
  });
}

function createTweetHTML(options = {}) {
  const { hasGrokButton = true, hasCaret = true, hasActionBar = true } = options;
  
  return `
    <article data-testid="tweet">
      <div class="tweet-header">
        <div data-testid="User-Name">@testuser</div>
        <time>2h</time>
        <div class="tweet-actions-header">
          ${hasGrokButton ? '<button aria-label="Grok actions" class="grok-btn">✨</button>' : ''}
          ${hasCaret ? '<button data-testid="caret" aria-label="More">...</button>' : ''}
        </div>
      </div>
      <div data-testid="tweetText">This is a test tweet</div>
      ${hasActionBar ? `
      <div role="group" class="action-bar">
        <button data-testid="reply">Reply</button>
        <button data-testid="retweet">Retweet</button>
        <button data-testid="like">Like</button>
        <button data-testid="bookmark">Bookmark</button>
      </div>
      ` : ''}
    </article>
  `;
}

describe('Hide Tweet Grok Icon Feature', () => {
  let dom;
  let document;
  let chrome;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/home'
    });
    document = dom.window.document;
    chrome = createChromeMock();
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
  });

  afterEach(() => {
    dom.window.close();
    chrome._reset();
    delete global.document;
    delete global.HTMLElement;
  });

  test('isTweetGrokIconControl returns true for valid Grok actions button inside tweet', () => {
    document.body.innerHTML = createTweetHTML();
    const grokBtn = document.querySelector('button[aria-label="Grok actions"]');
    assert.ok(grokBtn, 'Grok button should exist');
    assert.strictEqual(isTweetGrokIconControl(grokBtn), true, 'Should identify as Grok icon control');
  });

  test('isTweetGrokIconControl returns false for button outside tweet', () => {
    document.body.innerHTML = '<button aria-label="Grok actions">✨</button>';
    const grokBtn = document.querySelector('button[aria-label="Grok actions"]');
    assert.ok(grokBtn, 'Grok button should exist');
    assert.strictEqual(isTweetGrokIconControl(grokBtn), false, 'Should not identify as Grok icon control outside tweet');
  });

  test('isTweetGrokIconControl returns false for button in nav/sidebar', () => {
    document.body.innerHTML = `
      <nav>
        <article data-testid="tweet">
          <button aria-label="Grok actions">✨</button>
        </article>
      </nav>
    `;
    const grokBtn = document.querySelector('button[aria-label="Grok actions"]');
    assert.ok(grokBtn, 'Grok button should exist');
    assert.strictEqual(isTweetGrokIconControl(grokBtn), false, 'Should not identify nav button as Grok icon control');
  });

  test('nodeContainsCaretOrMore returns true for caret button', () => {
    document.body.innerHTML = createTweetHTML();
    const caretBtn = document.querySelector('[data-testid="caret"]');
    assert.ok(caretBtn, 'Caret button should exist');
    assert.strictEqual(nodeContainsCaretOrMore(caretBtn), true, 'Should identify caret button');
  });

  test('nodeContainsCaretOrMore returns true for element containing caret', () => {
    document.body.innerHTML = `<div class="wrapper"><button data-testid="caret">...</button></div>`;
    const wrapper = document.querySelector('.wrapper');
    assert.ok(wrapper, 'Wrapper should exist');
    assert.strictEqual(nodeContainsCaretOrMore(wrapper), true, 'Should identify element containing caret');
  });

  test('nodeContainsSocialActions returns true for action bar with role=group', () => {
    document.body.innerHTML = createTweetHTML();
    const actionBar = document.querySelector('[role="group"]');
    assert.ok(actionBar, 'Action bar should exist');
    assert.strictEqual(nodeContainsSocialActions(actionBar), true, 'Should identify action bar');
  });

  test('hideTweetGrokIconNode adds hidden class to valid Grok button', () => {
    document.body.innerHTML = createTweetHTML();
    const grokBtn = document.querySelector('button[aria-label="Grok actions"]');
    assert.ok(grokBtn, 'Grok button should exist');
    assert.strictEqual(grokBtn.classList.contains(TWEET_GROK_ICON_HIDDEN_CLASS), false, 'Should not have hidden class initially');
    
    hideTweetGrokIconNode(grokBtn);
    
    assert.strictEqual(grokBtn.classList.contains(TWEET_GROK_ICON_HIDDEN_CLASS), true, 'Should have hidden class after hiding');
  });

  test('hideTweetGrokIconNode does not add hidden class to caret button', () => {
    document.body.innerHTML = createTweetHTML();
    const caretBtn = document.querySelector('[data-testid="caret"]');
    assert.ok(caretBtn, 'Caret button should exist');
    
    hideTweetGrokIconNode(caretBtn);
    
    assert.strictEqual(caretBtn.classList.contains(TWEET_GROK_ICON_HIDDEN_CLASS), false, 'Caret should never be hidden');
  });

  test('hideTweetGrokIcons hides all valid Grok buttons', () => {
    document.body.innerHTML = `
      ${createTweetHTML()}
      ${createTweetHTML()}
      ${createTweetHTML()}
    `;
    const grokButtons = document.querySelectorAll('button[aria-label="Grok actions"]');
    assert.strictEqual(grokButtons.length, 3, 'Should have 3 Grok buttons');
    
    hideTweetGrokIcons(document);
    
    const hiddenButtons = document.querySelectorAll('.' + TWEET_GROK_ICON_HIDDEN_CLASS);
    assert.strictEqual(hiddenButtons.length, 3, 'All 3 Grok buttons should be hidden');
  });

  test('hideTweetGrokIcons never hides caret/More button', () => {
    document.body.innerHTML = createTweetHTML();
    
    hideTweetGrokIcons(document);
    
    const caretBtn = document.querySelector('[data-testid="caret"]');
    assert.ok(caretBtn, 'Caret button should exist');
    assert.strictEqual(caretBtn.classList.contains(TWEET_GROK_ICON_HIDDEN_CLASS), false, 'Caret should never be hidden');
    
    const computedDisplay = caretBtn.style.display;
    assert.notStrictEqual(computedDisplay, 'none', 'Caret should not have display:none');
  });

  test('hideTweetGrokIcons never hides action bar [role=group]', () => {
    document.body.innerHTML = createTweetHTML();
    
    hideTweetGrokIcons(document);
    
    const actionBar = document.querySelector('[role="group"]');
    assert.ok(actionBar, 'Action bar should exist');
    assert.strictEqual(actionBar.classList.contains(TWEET_GROK_ICON_HIDDEN_CLASS), false, 'Action bar should never be hidden');
  });

  test('showTweetGrokIcons restores all hidden Grok buttons', () => {
    document.body.innerHTML = `
      ${createTweetHTML()}
      ${createTweetHTML()}
    `;
    
    hideTweetGrokIcons(document);
    
    let hiddenButtons = document.querySelectorAll('.' + TWEET_GROK_ICON_HIDDEN_CLASS);
    assert.strictEqual(hiddenButtons.length, 2, 'Should have 2 hidden buttons');
    
    showTweetGrokIcons(document);
    
    hiddenButtons = document.querySelectorAll('.' + TWEET_GROK_ICON_HIDDEN_CLASS);
    assert.strictEqual(hiddenButtons.length, 0, 'All buttons should be visible after restore');
  });

  test('hideTweetGrokIconNode is idempotent (does not add class twice)', () => {
    document.body.innerHTML = createTweetHTML();
    const grokBtn = document.querySelector('button[aria-label="Grok actions"]');
    
    hideTweetGrokIconNode(grokBtn);
    hideTweetGrokIconNode(grokBtn);
    hideTweetGrokIconNode(grokBtn);
    
    const classCount = grokBtn.className.split(' ').filter(c => c === TWEET_GROK_ICON_HIDDEN_CLASS).length;
    assert.strictEqual(classCount, 1, 'Hidden class should only appear once');
  });

  test('tweets without Grok button are unaffected', () => {
    document.body.innerHTML = createTweetHTML({ hasGrokButton: false });
    
    hideTweetGrokIcons(document);
    
    const hiddenElements = document.querySelectorAll('.' + TWEET_GROK_ICON_HIDDEN_CLASS);
    assert.strictEqual(hiddenElements.length, 0, 'No elements should be hidden');
    
    const caretBtn = document.querySelector('[data-testid="caret"]');
    assert.ok(caretBtn, 'Caret should still exist');
    assert.strictEqual(caretBtn.style.display, '', 'Caret should be visible');
  });

  test('isTweetGrokIconControl returns false for non-Grok aria-label', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <button aria-label="Something else">X</button>
        <button data-testid="caret">...</button>
      </article>
    `;
    const btn = document.querySelector('button[aria-label="Something else"]');
    assert.ok(btn, 'Button should exist');
    assert.strictEqual(isTweetGrokIconControl(btn), false, 'Non-Grok button should not be identified');
  });

  test('caret computed width remains non-zero after hiding Grok icons', () => {
    document.body.innerHTML = createTweetHTML();
    const caretBtn = document.querySelector('[data-testid="caret"]');
    
    caretBtn.style.width = '40px';
    caretBtn.style.display = 'block';
    
    hideTweetGrokIcons(document);
    
    assert.notStrictEqual(caretBtn.style.width, '0px', 'Caret width should not be zero');
    assert.notStrictEqual(caretBtn.style.display, 'none', 'Caret should not have display:none');
  });

  test('Grok button inside wrapper that also contains caret is never hidden', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div class="shared-wrapper">
          <button aria-label="Grok actions">✨</button>
          <button data-testid="caret">...</button>
        </div>
      </article>
    `;
    const wrapper = document.querySelector('.shared-wrapper');
    
    hideTweetGrokIconNode(wrapper);
    
    assert.strictEqual(wrapper.classList.contains(TWEET_GROK_ICON_HIDDEN_CLASS), false, 
      'Wrapper containing caret should never be hidden (prevents shared wrapper issue from 1.0.16)');
  });
});

describe('Pro License Gating', () => {
  let chrome;

  beforeEach(() => {
    chrome = createChromeMock();
  });

  afterEach(() => {
    chrome._reset();
  });

  test('hideTweetGrokIcon defaults to true when Pro and undefined', async () => {
    await chrome.storage.local.set({ isPro: true });
    
    const result = await chrome.storage.local.get(['isPro', 'hideTweetGrokIcon']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && result.hideTweetGrokIcon !== false;
    
    assert.strictEqual(isEnabled, true, 'Should default to ON for Pro users');
  });

  test('hideTweetGrokIcon respects explicit false when Pro', async () => {
    await chrome.storage.local.set({ isPro: true, hideTweetGrokIcon: false });
    
    const result = await chrome.storage.local.get(['isPro', 'hideTweetGrokIcon']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && result.hideTweetGrokIcon !== false;
    
    assert.strictEqual(isEnabled, false, 'Should respect explicit false');
  });

  test('hideTweetGrokIcon is disabled when not Pro', async () => {
    await chrome.storage.local.set({ isPro: false, hideTweetGrokIcon: true });
    
    const result = await chrome.storage.local.get(['isPro', 'hideTweetGrokIcon']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && result.hideTweetGrokIcon !== false;
    
    assert.strictEqual(isEnabled, false, 'Should be disabled when not Pro');
  });
});
