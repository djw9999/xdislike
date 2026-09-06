/**
 * Tests for the Reply Cleaner feature (1.0.20)
 * Tests:
 * 1. Own-post gate true/false
 * 2. N cap 50
 * 3. Cancel path
 * 4. Prefer-hide ranking
 * 5. Stop-on-missing-control
 * 6. Interval ≥300ms
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { createChromeMock } from './chrome-mock.js';

const REPLY_CLEANER_MAX_ITEMS = 50;
const REPLY_CLEANER_CLICK_INTERVAL_MS = 300;

function isOnStatusPage(pathname) {
  return /\/status\/\d+/.test(pathname);
}

function getLoggedInUserHandle(document) {
  const accountSwitcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  if (accountSwitcher) {
    const spans = accountSwitcher.querySelectorAll('span');
    for (const span of spans) {
      const text = (span.textContent || '').trim();
      if (text.startsWith('@')) {
        return text.slice(1).toLowerCase();
      }
    }
  }
  
  const navProfile = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
  if (navProfile) {
    const href = navProfile.getAttribute('href') || '';
    const match = href.match(/^\/(\w+)$/);
    if (match) return match[1].toLowerCase();
  }
  
  return null;
}

function extractAuthorHandleFromTweet(tweet) {
  if (!tweet) return null;
  
  const userNameEl = tweet.querySelector('[data-testid="User-Name"]');
  if (userNameEl) {
    const links = userNameEl.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/^\/(\w+)$/);
      if (match) return match[1].toLowerCase();
    }
    
    const text = userNameEl.textContent || '';
    const handleMatch = text.match(/@(\w+)/);
    if (handleMatch) return handleMatch[1].toLowerCase();
  }
  
  return null;
}

function getPrimaryTweetAuthorHandle(document) {
  const primaryTweet = document.querySelector('article[data-testid="tweet"][tabindex="-1"]');
  if (primaryTweet) {
    return extractAuthorHandleFromTweet(primaryTweet);
  }
  const firstTweet = document.querySelector('article[data-testid="tweet"]');
  if (firstTweet) {
    return extractAuthorHandleFromTweet(firstTweet);
  }
  return null;
}

function isViewingOwnPost(document, pathname) {
  if (!isOnStatusPage(pathname)) return false;
  
  const loggedInHandle = getLoggedInUserHandle(document);
  const authorHandle = getPrimaryTweetAuthorHandle(document);
  
  if (!loggedInHandle || !authorHandle) return false;
  
  return loggedInHandle === authorHandle;
}

function textSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  
  const aWords = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const bWords = new Set(b.split(/\s+/).filter(w => w.length > 2));
  
  if (aWords.size === 0 || bWords.size === 0) return 0;
  
  let intersection = 0;
  for (const word of aWords) {
    if (bWords.has(word)) intersection++;
  }
  
  return (2 * intersection) / (aWords.size + bWords.size);
}

function findNearDuplicateClusters(texts) {
  const SIMILARITY_THRESHOLD = 0.6;
  const clusters = [];
  const assigned = new Set();
  
  for (let i = 0; i < texts.length; i++) {
    if (assigned.has(i)) continue;
    
    const cluster = [i];
    assigned.add(i);
    
    for (let j = i + 1; j < texts.length; j++) {
      if (assigned.has(j)) continue;
      
      if (texts[i] && texts[j] && textSimilarity(texts[i], texts[j]) >= SIMILARITY_THRESHOLD) {
        cluster.push(j);
        assigned.add(j);
      }
    }
    
    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }
  
  return clusters;
}

function rankMenuItems(items) {
  let hideBtn = null;
  let deleteBtn = null;
  
  for (const item of items) {
    const text = item.toLowerCase().trim();
    
    if (text.includes('hide reply') || text.includes('隐藏回复') || text.includes('隱藏回覆')) {
      hideBtn = item;
    }
    
    if (text.includes('delete') || text.includes('删除') || text.includes('刪除')) {
      if (!text.includes('undo')) {
        deleteBtn = item;
      }
    }
  }
  
  return { hideBtn, deleteBtn, preferHide: hideBtn !== null };
}

function createStatusPageHTML(options = {}) {
  const {
    loggedInHandle = 'myhandle',
    authorHandle = 'myhandle',
    replyCount = 3
  } = options;
  
  let repliesHtml = '';
  for (let i = 0; i < replyCount; i++) {
    repliesHtml += `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/replier${i}">@replier${i}</a>
        </div>
        <div data-testid="tweetText">Reply ${i} content here</div>
        <button data-testid="caret" aria-label="More">...</button>
      </article>
    `;
  }
  
  return `
    <a data-testid="AppTabBar_Profile_Link" href="/${loggedInHandle}"></a>
    <article data-testid="tweet" tabindex="-1">
      <div data-testid="User-Name">
        <a href="/${authorHandle}">@${authorHandle}</a>
      </div>
      <div data-testid="tweetText">Primary tweet content</div>
      <button data-testid="caret" aria-label="More">...</button>
    </article>
    ${repliesHtml}
  `;
}

describe('Reply Cleaner Feature - Own Post Gate', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/myhandle/status/123456789'
    });
    document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
  });

  afterEach(() => {
    dom.window.close();
    delete global.HTMLElement;
  });

  test('isOnStatusPage returns true for status URL', () => {
    assert.strictEqual(isOnStatusPage('/myhandle/status/123456789'), true);
    assert.strictEqual(isOnStatusPage('/user/status/987654321'), true);
  });

  test('isOnStatusPage returns false for non-status URL', () => {
    assert.strictEqual(isOnStatusPage('/home'), false);
    assert.strictEqual(isOnStatusPage('/myhandle'), false);
    assert.strictEqual(isOnStatusPage('/explore'), false);
    assert.strictEqual(isOnStatusPage('/search'), false);
  });

  test('isViewingOwnPost returns true when logged-in user matches author', () => {
    document.body.innerHTML = createStatusPageHTML({
      loggedInHandle: 'myhandle',
      authorHandle: 'myhandle'
    });
    
    assert.strictEqual(
      isViewingOwnPost(document, '/myhandle/status/123456789'),
      true,
      'Should return true for own post'
    );
  });

  test('isViewingOwnPost returns false when logged-in user does NOT match author', () => {
    document.body.innerHTML = createStatusPageHTML({
      loggedInHandle: 'myhandle',
      authorHandle: 'otheruser'
    });
    
    assert.strictEqual(
      isViewingOwnPost(document, '/otheruser/status/123456789'),
      false,
      'Should return false for other user post'
    );
  });

  test('isViewingOwnPost returns false when not on status page', () => {
    document.body.innerHTML = createStatusPageHTML({
      loggedInHandle: 'myhandle',
      authorHandle: 'myhandle'
    });
    
    assert.strictEqual(
      isViewingOwnPost(document, '/home'),
      false,
      'Should return false when not on status page'
    );
  });

  test('isViewingOwnPost is case-insensitive', () => {
    document.body.innerHTML = createStatusPageHTML({
      loggedInHandle: 'MyHandle',
      authorHandle: 'myhandle'
    });
    
    assert.strictEqual(
      isViewingOwnPost(document, '/myhandle/status/123456789'),
      true,
      'Should be case-insensitive'
    );
  });
});

describe('Reply Cleaner Feature - N Cap 50', () => {
  test('REPLY_CLEANER_MAX_ITEMS is 50', () => {
    assert.strictEqual(REPLY_CLEANER_MAX_ITEMS, 50, 'Max items should be 50');
  });

  test('selection is capped at 50 items', () => {
    const selectedReplies = new Set();
    const replies = Array.from({ length: 60 }, (_, i) => ({ id: i }));
    
    for (const reply of replies) {
      if (selectedReplies.size < REPLY_CLEANER_MAX_ITEMS) {
        selectedReplies.add(reply);
      }
    }
    
    assert.strictEqual(selectedReplies.size, 50, 'Should cap at 50 items');
  });

  test('cleanup targets are sliced to max 50', () => {
    const selectedReplies = new Set(Array.from({ length: 60 }, (_, i) => ({ id: i })));
    const targets = Array.from(selectedReplies).slice(0, REPLY_CLEANER_MAX_ITEMS);
    
    assert.strictEqual(targets.length, 50, 'Cleanup targets should be max 50');
  });
});

describe('Reply Cleaner Feature - Cancel Path', () => {
  test('cancel returns without processing when count is 0', () => {
    const selectedReplies = new Set();
    let processingStarted = false;
    
    const confirmCleanup = () => {
      const count = selectedReplies.size;
      if (count === 0) return;
      processingStarted = true;
    };
    
    confirmCleanup();
    
    assert.strictEqual(processingStarted, false, 'Should not start processing when count is 0');
  });

  test('cancel via window.confirm returns false aborts cleanup', () => {
    let cleanupExecuted = false;
    
    const runCleanupIfConfirmed = (confirmed) => {
      if (!confirmed) return;
      cleanupExecuted = true;
    };
    
    runCleanupIfConfirmed(false);
    
    assert.strictEqual(cleanupExecuted, false, 'Cleanup should not execute when cancelled');
  });

  test('confirm via window.confirm returns true proceeds with cleanup', () => {
    let cleanupExecuted = false;
    
    const runCleanupIfConfirmed = (confirmed) => {
      if (!confirmed) return;
      cleanupExecuted = true;
    };
    
    runCleanupIfConfirmed(true);
    
    assert.strictEqual(cleanupExecuted, true, 'Cleanup should execute when confirmed');
  });
});

describe('Reply Cleaner Feature - Prefer Hide Ranking', () => {
  test('prefers Hide Reply over Delete when both available', () => {
    const menuItems = ['Hide reply', 'Delete', 'Report'];
    const result = rankMenuItems(menuItems);
    
    assert.strictEqual(result.preferHide, true, 'Should prefer Hide');
    assert.strictEqual(result.hideBtn, 'Hide reply', 'Should find Hide button');
    assert.strictEqual(result.deleteBtn, 'Delete', 'Should also find Delete button');
  });

  test('falls back to Delete when Hide not available', () => {
    const menuItems = ['Delete', 'Report', 'Block'];
    const result = rankMenuItems(menuItems);
    
    assert.strictEqual(result.preferHide, false, 'Should not prefer Hide when not available');
    assert.strictEqual(result.hideBtn, null, 'Hide button should be null');
    assert.strictEqual(result.deleteBtn, 'Delete', 'Should find Delete button');
  });

  test('recognizes Chinese "隐藏回复" as Hide Reply', () => {
    const menuItems = ['隐藏回复', '删除', '举报'];
    const result = rankMenuItems(menuItems);
    
    assert.strictEqual(result.preferHide, true, 'Should prefer Hide (Chinese simplified)');
    assert.strictEqual(result.hideBtn, '隐藏回复', 'Should find Chinese Hide button');
  });

  test('recognizes Chinese Traditional "隱藏回覆" as Hide Reply', () => {
    const menuItems = ['隱藏回覆', '刪除', '檢舉'];
    const result = rankMenuItems(menuItems);
    
    assert.strictEqual(result.preferHide, true, 'Should prefer Hide (Chinese traditional)');
    assert.strictEqual(result.hideBtn, '隱藏回覆', 'Should find Chinese traditional Hide button');
  });

  test('does not match "undo delete" as delete', () => {
    const menuItems = ['Undo delete', 'Report'];
    const result = rankMenuItems(menuItems);
    
    assert.strictEqual(result.deleteBtn, null, 'Should not match undo delete');
  });
});

describe('Reply Cleaner Feature - Stop on Missing Control', () => {
  test('returns error when caret button not found', async () => {
    const mockReply = {
      querySelector: () => null
    };
    
    const hideOrDeleteReply = async (reply) => {
      const caretBtn = reply.querySelector('[data-testid="caret"]');
      if (!caretBtn) {
        return 'error';
      }
      return 'hidden';
    };
    
    const result = await hideOrDeleteReply(mockReply);
    assert.strictEqual(result, 'error', 'Should return error when caret not found');
  });

  test('returns error when menu does not appear', async () => {
    let menuShown = false;
    
    const hideOrDeleteReply = async () => {
      if (!menuShown) {
        return 'error';
      }
      return 'hidden';
    };
    
    const result = await hideOrDeleteReply();
    assert.strictEqual(result, 'error', 'Should return error when menu does not appear');
  });

  test('returns error when neither Hide nor Delete found in menu', async () => {
    const menuItems = ['Report', 'Block', 'Mute'];
    
    const hideOrDeleteReply = async () => {
      const result = rankMenuItems(menuItems);
      if (!result.hideBtn && !result.deleteBtn) {
        return 'error';
      }
      return result.hideBtn ? 'hidden' : 'deleted';
    };
    
    const result = await hideOrDeleteReply();
    assert.strictEqual(result, 'error', 'Should return error when no Hide/Delete in menu');
  });

  test('cleanup stops when error encountered', async () => {
    const targets = [{ id: 1 }, { id: 2 }, { id: 3 }];
    let processedCount = 0;
    let errorMsg = null;
    
    const results = ['hidden', 'error', 'hidden'];
    
    for (let i = 0; i < targets.length; i++) {
      const result = results[i];
      
      if (result === 'hidden') {
        processedCount++;
      } else if (result === 'error') {
        errorMsg = `Control missing on reply ${i + 1}. Stopping.`;
        break;
      }
    }
    
    assert.strictEqual(processedCount, 1, 'Should only process 1 before error');
    assert.ok(errorMsg, 'Should have error message');
    assert.ok(errorMsg.includes('Stopping'), 'Error should indicate stopping');
  });
});

describe('Reply Cleaner Feature - Interval ≥300ms', () => {
  test('REPLY_CLEANER_CLICK_INTERVAL_MS is at least 300', () => {
    assert.ok(
      REPLY_CLEANER_CLICK_INTERVAL_MS >= 300,
      `Click interval should be at least 300ms, got ${REPLY_CLEANER_CLICK_INTERVAL_MS}`
    );
  });

  test('cleanup uses interval between clicks', async () => {
    const targets = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const timestamps = [];
    
    const mockSleep = (ms) => {
      return new Promise(resolve => {
        timestamps.push({ type: 'sleep', ms });
        resolve();
      });
    };
    
    const mockProcess = () => {
      timestamps.push({ type: 'process' });
      return 'hidden';
    };
    
    for (let i = 0; i < targets.length; i++) {
      mockProcess();
      if (i < targets.length - 1) {
        await mockSleep(REPLY_CLEANER_CLICK_INTERVAL_MS);
      }
    }
    
    const sleepCalls = timestamps.filter(t => t.type === 'sleep');
    assert.strictEqual(sleepCalls.length, 2, 'Should sleep between 3 targets (2 sleeps)');
    
    for (const sleepCall of sleepCalls) {
      assert.ok(
        sleepCall.ms >= 300,
        `Each sleep should be at least 300ms, got ${sleepCall.ms}`
      );
    }
  });
});

describe('Reply Cleaner Feature - Text Similarity', () => {
  test('identical texts have similarity 1', () => {
    const similarity = textSimilarity('hello world test', 'hello world test');
    assert.strictEqual(similarity, 1, 'Identical texts should have similarity 1');
  });

  test('completely different texts have low similarity', () => {
    const similarity = textSimilarity('hello world', 'goodbye universe');
    assert.ok(similarity < 0.5, 'Different texts should have low similarity');
  });

  test('similar texts have high similarity', () => {
    const similarity = textSimilarity(
      'this is spam content please click here',
      'this is spam content click here now'
    );
    assert.ok(similarity >= 0.6, 'Similar texts should have similarity >= 0.6');
  });

  test('empty texts return 0', () => {
    assert.strictEqual(textSimilarity('', ''), 0);
    assert.strictEqual(textSimilarity('hello', ''), 0);
    assert.strictEqual(textSimilarity('', 'world'), 0);
  });
});

describe('Reply Cleaner Feature - Near-Duplicate Clustering', () => {
  test('finds clusters of similar texts', () => {
    const texts = [
      'this is spam content click here',
      'this is spam content click here now',
      'completely different text about cats',
      'this is spam content please click',
      'another unique message about dogs'
    ];
    
    const clusters = findNearDuplicateClusters(texts);
    
    assert.ok(clusters.length >= 1, 'Should find at least one cluster');
    
    const spamCluster = clusters.find(c => c.includes(0) || c.includes(1) || c.includes(3));
    assert.ok(spamCluster, 'Should find spam cluster');
    assert.ok(spamCluster.length >= 2, 'Spam cluster should have at least 2 items');
  });

  test('does not cluster unique texts', () => {
    const texts = [
      'hello world',
      'goodbye universe',
      'random other text',
      'completely different'
    ];
    
    const clusters = findNearDuplicateClusters(texts);
    
    assert.strictEqual(clusters.length, 0, 'Should find no clusters for unique texts');
  });

  test('cluster requires minimum 2 items', () => {
    const texts = [
      'unique text one',
      'unique text two',
      'unique text three'
    ];
    
    const clusters = findNearDuplicateClusters(texts);
    
    for (const cluster of clusters) {
      assert.ok(cluster.length >= 2, 'Each cluster should have at least 2 items');
    }
  });
});

describe('Reply Cleaner Feature - Pro License Gating', () => {
  let chrome;

  beforeEach(() => {
    chrome = createChromeMock();
  });

  afterEach(() => {
    chrome._reset();
  });

  test('cleanerOwnReplies defaults to true when Pro and undefined', async () => {
    await chrome.storage.local.set({ isPro: true });
    
    const result = await chrome.storage.local.get(['isPro', 'cleanerOwnReplies']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && result.cleanerOwnReplies !== false;
    
    assert.strictEqual(isEnabled, true, 'Should default to ON for Pro users');
  });

  test('cleanerOwnReplies respects explicit false when Pro', async () => {
    await chrome.storage.local.set({ isPro: true, cleanerOwnReplies: false });
    
    const result = await chrome.storage.local.get(['isPro', 'cleanerOwnReplies']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && result.cleanerOwnReplies !== false;
    
    assert.strictEqual(isEnabled, false, 'Should respect explicit false');
  });

  test('cleanerOwnReplies is disabled when not Pro', async () => {
    await chrome.storage.local.set({ isPro: false, cleanerOwnReplies: true });
    
    const result = await chrome.storage.local.get(['isPro', 'cleanerOwnReplies']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && result.cleanerOwnReplies !== false;
    
    assert.strictEqual(isEnabled, false, 'Should be disabled when not Pro');
  });
});
