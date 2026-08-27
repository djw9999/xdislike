/**
 * Hide @grok posts tests - covering real failures from 2026-08-26 and 2026-08-27
 * 
 * Failure scenarios:
 * 1. Early FAIL: detector hid nothing
 * 2. Later FAIL: streamed tweets stayed visible 30-60s
 * 3. Maya: include 'Replying to @grok', not only body @mentions
 * 
 * Success criteria:
 * - Tweet cell whose text/socialContext is 'Replying to @grok' MUST be classified as grok post immediately
 * - Tweet with @grok in body text MUST be classified as grok post immediately
 * - Tweet with @grok social context MUST be classified as grok post immediately
 * - Normal tweet without @grok must NOT be classified as grok post
 * - Classification must be immediate (no timer)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { createChromeMock } from './chrome-mock.js';
import {
  isGrokPost,
  getTweetText,
  getSocialContext,
  isReplyingToGrok,
  containsGrokMention,
  classifyTweetCell,
  hideGrokPost,
  showGrokPost,
  setHideGrokEnabled,
  processGrokPosts,
  loadHideGrokSetting,
  saveHideGrokSetting,
  resetGrokState,
} from '../lib/hide-grok.js';

function createTweetWithBodyMention(mentionText = '@grok') {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <body>
      <article data-testid="tweet">
        <div data-testid="tweetText">This is a reply to ${mentionText} about AI</div>
      </article>
    </body>
    </html>
  `);
  return dom;
}

function createTweetReplyingToGrok() {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <body>
      <article data-testid="tweet">
        <div data-testid="socialContext">
          <span>Replying to @grok</span>
        </div>
        <div data-testid="tweetText">Here's my question about AI</div>
      </article>
    </body>
    </html>
  `);
  return dom;
}

function createTweetWithGrokSocialContext() {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <body>
      <article data-testid="tweet">
        <div data-testid="socialContext">
          <span>@grok and 2 others liked</span>
        </div>
        <div data-testid="tweetText">Some normal tweet content</div>
      </article>
    </body>
    </html>
  `);
  return dom;
}

function createNormalTweet() {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <body>
      <article data-testid="tweet">
        <div data-testid="User-Name">@someuser</div>
        <div data-testid="tweetText">This is just a normal tweet about technology</div>
      </article>
    </body>
    </html>
  `);
  return dom;
}

function createTweetWithReplyingToOther() {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <body>
      <article data-testid="tweet">
        <div data-testid="socialContext">
          <span>Replying to @elonmusk</span>
        </div>
        <div data-testid="tweetText">Great point!</div>
      </article>
    </body>
    </html>
  `);
  return dom;
}

function createMultipleTweetsDOM() {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <body>
      <div data-testid="cellInnerDiv">
        <article data-testid="tweet" id="tweet1">
          <div data-testid="tweetText">Normal tweet 1</div>
        </article>
      </div>
      <div data-testid="cellInnerDiv">
        <article data-testid="tweet" id="tweet2">
          <div data-testid="socialContext">Replying to @grok</div>
          <div data-testid="tweetText">Question for Grok</div>
        </article>
      </div>
      <div data-testid="cellInnerDiv">
        <article data-testid="tweet" id="tweet3">
          <div data-testid="tweetText">Hey @grok what do you think?</div>
        </article>
      </div>
      <div data-testid="cellInnerDiv">
        <article data-testid="tweet" id="tweet4">
          <div data-testid="tweetText">Normal tweet 2</div>
        </article>
      </div>
    </body>
    </html>
  `);
  return dom;
}

describe('Hide @grok posts', () => {
  let chrome;
  let dom;

  beforeEach(() => {
    chrome = createChromeMock();
    resetGrokState();
  });

  afterEach(() => {
    if (dom) {
      dom.window.close();
      dom = null;
    }
  });

  describe('Failure Case 1: Early FAIL - detector hid nothing', () => {
    it('should detect @grok in tweet body text immediately', () => {
      dom = createTweetWithBodyMention('@grok');
      const article = dom.window.document.querySelector('article');
      
      const startTime = performance.now();
      const result = isGrokPost(article);
      const endTime = performance.now();
      
      assert.strictEqual(result, true, 'Should detect @grok in body');
      assert.ok(endTime - startTime < 10, 'Detection should be immediate (< 10ms)');
    });

    it('should detect Replying to @grok in social context immediately', () => {
      dom = createTweetReplyingToGrok();
      const article = dom.window.document.querySelector('article');
      
      const startTime = performance.now();
      const result = isGrokPost(article);
      const endTime = performance.now();
      
      assert.strictEqual(result, true, 'Should detect Replying to @grok');
      assert.ok(endTime - startTime < 10, 'Detection should be immediate (< 10ms)');
    });

    it('should detect @grok in social context (likes/retweets) immediately', () => {
      dom = createTweetWithGrokSocialContext();
      const article = dom.window.document.querySelector('article');
      
      const startTime = performance.now();
      const result = isGrokPost(article);
      const endTime = performance.now();
      
      assert.strictEqual(result, true, 'Should detect @grok in social context');
      assert.ok(endTime - startTime < 10, 'Detection should be immediate (< 10ms)');
    });

    it('should NOT classify normal tweet as grok post', () => {
      dom = createNormalTweet();
      const article = dom.window.document.querySelector('article');
      
      const result = isGrokPost(article);
      
      assert.strictEqual(result, false, 'Should NOT detect grok in normal tweet');
    });

    it('should NOT classify reply to other users as grok post', () => {
      dom = createTweetWithReplyingToOther();
      const article = dom.window.document.querySelector('article');
      
      const result = isGrokPost(article);
      
      assert.strictEqual(result, false, 'Should NOT detect grok when replying to @elonmusk');
    });
  });

  describe('Failure Case 2: Streamed tweets stayed visible 30-60s', () => {
    it('should process all tweets in feed immediately', () => {
      dom = createMultipleTweetsDOM();
      const document = dom.window.document;
      
      setHideGrokEnabled(true);
      
      const startTime = performance.now();
      const { processed, hidden } = processGrokPosts(document);
      const endTime = performance.now();
      
      assert.strictEqual(processed, 4, 'Should process all 4 tweets');
      assert.strictEqual(hidden, 2, 'Should hide 2 grok tweets');
      assert.ok(endTime - startTime < 50, 'Processing should be fast (< 50ms)');
    });

    it('should hide grok tweets by setting display:none', () => {
      dom = createMultipleTweetsDOM();
      const document = dom.window.document;
      
      setHideGrokEnabled(true);
      processGrokPosts(document);
      
      const tweet2Cell = document.querySelector('#tweet2').closest('[data-testid="cellInnerDiv"]');
      const tweet3Cell = document.querySelector('#tweet3').closest('[data-testid="cellInnerDiv"]');
      
      assert.strictEqual(tweet2Cell.style.display, 'none', 'Tweet 2 cell should be hidden');
      assert.strictEqual(tweet3Cell.style.display, 'none', 'Tweet 3 cell should be hidden');
    });

    it('should not hide normal tweets', () => {
      dom = createMultipleTweetsDOM();
      const document = dom.window.document;
      
      setHideGrokEnabled(true);
      processGrokPosts(document);
      
      const tweet1Cell = document.querySelector('#tweet1').closest('[data-testid="cellInnerDiv"]');
      const tweet4Cell = document.querySelector('#tweet4').closest('[data-testid="cellInnerDiv"]');
      
      assert.notStrictEqual(tweet1Cell.style.display, 'none', 'Tweet 1 should NOT be hidden');
      assert.notStrictEqual(tweet4Cell.style.display, 'none', 'Tweet 4 should NOT be hidden');
    });
  });

  describe('Maya fix: Replying to @grok detection', () => {
    it('should classify Replying to @grok tweet as grok post', () => {
      dom = createTweetReplyingToGrok();
      const article = dom.window.document.querySelector('article');
      
      const result = classifyTweetCell(article);
      
      assert.strictEqual(result.isGrok, true);
      assert.ok(['social_context', 'replying_to'].includes(result.reason), 
        `Reason should indicate reply context, got: ${result.reason}`);
    });

    it('should detect various Replying to @grok formats', () => {
      const formats = [
        'Replying to @grok',
        'replying to @grok',
        'REPLYING TO @grok',
        'Replying to @Grok',
      ];
      
      for (const format of formats) {
        const localDom = new JSDOM(`
          <!DOCTYPE html>
          <html>
          <body>
            <article data-testid="tweet">
              <div data-testid="socialContext"><span>${format}</span></div>
              <div data-testid="tweetText">Question</div>
            </article>
          </body>
          </html>
        `);
        
        const article = localDom.window.document.querySelector('article');
        const result = isGrokPost(article);
        
        assert.strictEqual(result, true, `Should detect: "${format}"`);
        localDom.window.close();
      }
    });
  });

  describe('Text extraction', () => {
    it('should extract tweet text correctly', () => {
      dom = createTweetWithBodyMention('@grok');
      const article = dom.window.document.querySelector('article');
      
      const text = getTweetText(article);
      
      assert.ok(text.includes('@grok'), 'Should extract @grok from tweet text');
    });

    it('should extract social context correctly', () => {
      dom = createTweetReplyingToGrok();
      const article = dom.window.document.querySelector('article');
      
      const context = getSocialContext(article);
      
      assert.ok(context.includes('replying to @grok'), 
        `Should extract replying context, got: "${context}"`);
    });
  });

  describe('Mention detection', () => {
    it('should detect @grok mention', () => {
      assert.strictEqual(containsGrokMention('@grok'), true);
      assert.strictEqual(containsGrokMention('Hey @grok'), true);
      assert.strictEqual(containsGrokMention('HELLO @GROK'), true);
      assert.strictEqual(containsGrokMention('@Grok is great'), true);
    });

    it('should not detect non-grok mentions', () => {
      assert.strictEqual(containsGrokMention('@elonmusk'), false);
      assert.strictEqual(containsGrokMention('no mentions here'), false);
      assert.strictEqual(containsGrokMention('@grokking'), true); // Contains @grok
      assert.strictEqual(containsGrokMention('email@grok.com'), true); // Contains @grok
    });
  });

  describe('Classification reasons', () => {
    it('should report body_mention for @grok in body', () => {
      dom = createTweetWithBodyMention('@grok');
      const article = dom.window.document.querySelector('article');
      
      const result = classifyTweetCell(article);
      
      assert.strictEqual(result.isGrok, true);
      assert.strictEqual(result.reason, 'body_mention');
    });

    it('should report social_context for @grok in social context', () => {
      dom = createTweetWithGrokSocialContext();
      const article = dom.window.document.querySelector('article');
      
      const result = classifyTweetCell(article);
      
      assert.strictEqual(result.isGrok, true);
      assert.strictEqual(result.reason, 'social_context');
    });

    it('should report null reason for normal tweet', () => {
      dom = createNormalTweet();
      const article = dom.window.document.querySelector('article');
      
      const result = classifyTweetCell(article);
      
      assert.strictEqual(result.isGrok, false);
      assert.strictEqual(result.reason, null);
    });
  });

  describe('Hide/Show operations', () => {
    it('should hide grok post by setting display:none', () => {
      dom = createTweetWithBodyMention('@grok');
      const article = dom.window.document.querySelector('article');
      
      const result = hideGrokPost(article);
      
      assert.strictEqual(result, true);
      assert.strictEqual(article.style.display, 'none');
      assert.strictEqual(article.dataset.quietxGrokHidden, '1');
    });

    it('should not double-hide already hidden post', () => {
      dom = createTweetWithBodyMention('@grok');
      const article = dom.window.document.querySelector('article');
      
      hideGrokPost(article);
      const result = hideGrokPost(article);
      
      assert.strictEqual(result, false, 'Should return false for already hidden');
    });

    it('should show hidden grok post', () => {
      dom = createTweetWithBodyMention('@grok');
      const article = dom.window.document.querySelector('article');
      
      hideGrokPost(article);
      const result = showGrokPost(article);
      
      assert.strictEqual(result, true);
      assert.strictEqual(article.style.display, '');
      assert.strictEqual(article.dataset.quietxGrokHidden, undefined);
    });
  });

  describe('Storage integration', () => {
    it('should load hide grok setting from storage', async () => {
      await chrome.storage.local.set({ hideGrokPosts: true });
      
      const enabled = await loadHideGrokSetting(chrome);
      
      assert.strictEqual(enabled, true);
    });

    it('should save hide grok setting to storage', async () => {
      await saveHideGrokSetting(chrome, true);
      
      const result = await chrome.storage.local.get(['hideGrokPosts']);
      
      assert.strictEqual(result.hideGrokPosts, true);
    });

    it('should default to false when setting not present', async () => {
      const enabled = await loadHideGrokSetting(chrome);
      
      assert.strictEqual(enabled, false);
    });
  });

  describe('Edge cases', () => {
    it('should handle null element', () => {
      const result = isGrokPost(null);
      assert.strictEqual(result, false);
    });

    it('should handle element without tweet text', () => {
      dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <article data-testid="tweet">
            <div>Some random content</div>
          </article>
        </body>
        </html>
      `);
      const article = dom.window.document.querySelector('article');
      
      const result = isGrokPost(article);
      
      assert.strictEqual(result, false);
    });

    it('should handle empty tweet text', () => {
      dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText"></div>
          </article>
        </body>
        </html>
      `);
      const article = dom.window.document.querySelector('article');
      
      const result = isGrokPost(article);
      
      assert.strictEqual(result, false);
    });

    it('should handle mixed case @GROK', () => {
      dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">Hey @GROK what do you think?</div>
          </article>
        </body>
        </html>
      `);
      const article = dom.window.document.querySelector('article');
      
      const result = isGrokPost(article);
      
      assert.strictEqual(result, true);
    });
  });
});
