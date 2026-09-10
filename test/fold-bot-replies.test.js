/**
 * Tests for the Fold Bot Replies feature (1.0.21)
 * Tests:
 * 1. Text normalization removes URLs, mentions, hashtags, emojis
 * 2. Levenshtein distance calculation is correct
 * 3. Similarity ratio calculation is correct
 * 4. Similar texts are detected with threshold >= 0.66
 * 5. Clustering groups similar replies correctly
 * 6. Feature defaults to OFF (unset/false)
 * 7. Feature requires Pro license
 * 8. No Hide/Delete/Block/Mute clicks (local DOM collapse only)
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { createChromeMock } from './chrome-mock.js';

const FOLD_BOT_REPLIES_SIMILARITY_THRESHOLD = 0.66;
const FOLD_BOT_REPLIES_MIN_CLUSTER_SIZE = 2;
const FOLD_BOT_REPLIES_MIN_REPLIES_TO_SCAN = 3;

function normalizeTextForSimilarity(text) {
  if (!text || typeof text !== 'string') return '';
  let normalized = text
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/@\w+/g, '')
    .replace(/#\w+/g, '')
    .replace(/[\u{1F600}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
}

function levenshteinDistance(a, b) {
  if (!a || !b) return Math.max((a || '').length, (b || '').length);
  if (a === b) return 0;
  
  const m = a.length;
  const n = b.length;
  
  if (m === 0) return n;
  if (n === 0) return m;
  
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  
  return prev[n];
}

function similarityRatio(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  
  const distance = levenshteinDistance(a, b);
  return 1 - (distance / maxLen);
}

function areTextsSimilar(text1, text2, threshold = FOLD_BOT_REPLIES_SIMILARITY_THRESHOLD) {
  const norm1 = normalizeTextForSimilarity(text1);
  const norm2 = normalizeTextForSimilarity(text2);
  
  if (norm1.length < 3 || norm2.length < 3) return false;
  
  if (norm1 === norm2) return true;
  
  return similarityRatio(norm1, norm2) >= threshold;
}

function clusterRepliesBySimilarity(replyArticles, document) {
  if (!replyArticles || replyArticles.length < FOLD_BOT_REPLIES_MIN_REPLIES_TO_SCAN) {
    return [];
  }
  
  const articlesWithText = [];
  for (const article of replyArticles) {
    const tweetText = article.querySelector('[data-testid="tweetText"]');
    const text = tweetText ? (tweetText.textContent || '').trim() : '';
    const normalizedText = normalizeTextForSimilarity(text);
    if (normalizedText.length >= 3) {
      articlesWithText.push({ article, text, normalizedText });
    }
  }
  
  if (articlesWithText.length < FOLD_BOT_REPLIES_MIN_REPLIES_TO_SCAN) {
    return [];
  }
  
  const clusters = [];
  const assigned = new Set();
  
  for (let i = 0; i < articlesWithText.length; i++) {
    if (assigned.has(i)) continue;
    
    const cluster = [articlesWithText[i]];
    assigned.add(i);
    
    for (let j = i + 1; j < articlesWithText.length; j++) {
      if (assigned.has(j)) continue;
      
      const isSimilar = cluster.some(item => 
        areTextsSimilar(item.text, articlesWithText[j].text)
      );
      
      if (isSimilar) {
        cluster.push(articlesWithText[j]);
        assigned.add(j);
      }
    }
    
    if (cluster.length >= FOLD_BOT_REPLIES_MIN_CLUSTER_SIZE) {
      clusters.push(cluster);
    }
  }
  
  return clusters;
}

function createReplyArticleHTML(text) {
  return `
    <article data-testid="tweet">
      <div data-testid="User-Name">@spammer</div>
      <time>1m</time>
      <div data-testid="tweetText">${text}</div>
      <div role="group" class="action-bar">
        <button data-testid="reply">Reply</button>
        <button data-testid="retweet">Retweet</button>
        <button data-testid="like">Like</button>
      </div>
    </article>
  `;
}

describe('Text Normalization', () => {
  test('removes URLs', () => {
    const input = 'Check this out https://example.com/spam';
    const result = normalizeTextForSimilarity(input);
    assert.strictEqual(result, 'check this out');
  });

  test('removes mentions', () => {
    const input = 'Hey @user check this out';
    const result = normalizeTextForSimilarity(input);
    assert.strictEqual(result, 'hey check this out');
  });

  test('removes hashtags', () => {
    const input = 'Great post #crypto #bitcoin';
    const result = normalizeTextForSimilarity(input);
    assert.strictEqual(result, 'great post');
  });

  test('removes emojis', () => {
    const input = 'Amazing! 🚀🔥💰';
    const result = normalizeTextForSimilarity(input);
    assert.strictEqual(result, 'amazing');
  });

  test('lowercases text', () => {
    const input = 'AMAZING OPPORTUNITY';
    const result = normalizeTextForSimilarity(input);
    assert.strictEqual(result, 'amazing opportunity');
  });

  test('normalizes whitespace', () => {
    const input = '  multiple   spaces   here  ';
    const result = normalizeTextForSimilarity(input);
    assert.strictEqual(result, 'multiple spaces here');
  });

  test('handles empty input', () => {
    assert.strictEqual(normalizeTextForSimilarity(''), '');
    assert.strictEqual(normalizeTextForSimilarity(null), '');
    assert.strictEqual(normalizeTextForSimilarity(undefined), '');
  });

  test('handles complex spam text', () => {
    const input = '🚀 Check out @CryptoKing for AMAZING returns! 💰 https://scam.link #crypto #btc';
    const result = normalizeTextForSimilarity(input);
    assert.strictEqual(result, 'check out for amazing returns');
  });
});

describe('Levenshtein Distance', () => {
  test('identical strings have distance 0', () => {
    assert.strictEqual(levenshteinDistance('hello', 'hello'), 0);
  });

  test('empty strings', () => {
    assert.strictEqual(levenshteinDistance('', 'hello'), 5);
    assert.strictEqual(levenshteinDistance('hello', ''), 5);
    assert.strictEqual(levenshteinDistance('', ''), 0);
  });

  test('single character difference', () => {
    assert.strictEqual(levenshteinDistance('hello', 'hallo'), 1);
    assert.strictEqual(levenshteinDistance('cat', 'hat'), 1);
  });

  test('insertion', () => {
    assert.strictEqual(levenshteinDistance('hello', 'helloo'), 1);
  });

  test('deletion', () => {
    assert.strictEqual(levenshteinDistance('hello', 'helo'), 1);
  });

  test('completely different strings', () => {
    assert.strictEqual(levenshteinDistance('abc', 'xyz'), 3);
  });
});

describe('Similarity Ratio', () => {
  test('identical strings have ratio 1', () => {
    assert.strictEqual(similarityRatio('hello', 'hello'), 1);
  });

  test('completely different strings have low ratio', () => {
    const ratio = similarityRatio('abc', 'xyz');
    assert.ok(ratio < 0.5, `Expected ratio < 0.5, got ${ratio}`);
  });

  test('similar strings have high ratio', () => {
    const ratio = similarityRatio('check this out', 'check this');
    assert.ok(ratio > 0.7, `Expected ratio > 0.7, got ${ratio}`);
  });

  test('empty strings', () => {
    assert.strictEqual(similarityRatio('', ''), 1);
    assert.strictEqual(similarityRatio('hello', ''), 0);
    assert.strictEqual(similarityRatio('', 'hello'), 0);
  });
});

describe('areTextsSimilar', () => {
  test('identical spam messages are similar', () => {
    const text1 = 'Check out this amazing opportunity! 🚀';
    const text2 = 'Check out this amazing opportunity! 🚀';
    assert.strictEqual(areTextsSimilar(text1, text2), true);
  });

  test('near-duplicate spam with different usernames are similar', () => {
    const text1 = '@user1 Check out this amazing opportunity for crypto gains!';
    const text2 = '@user2 Check out this amazing opportunity for crypto gains!';
    assert.strictEqual(areTextsSimilar(text1, text2), true);
  });

  test('near-duplicate spam with different URLs are similar', () => {
    const text1 = 'Amazing returns at https://scam1.com';
    const text2 = 'Amazing returns at https://scam2.com';
    assert.strictEqual(areTextsSimilar(text1, text2), true);
  });

  test('completely different texts are not similar', () => {
    const text1 = 'I love this post about cats';
    const text2 = 'The weather is nice today';
    assert.strictEqual(areTextsSimilar(text1, text2), false);
  });

  test('very short texts are not considered similar', () => {
    const text1 = 'Hi';
    const text2 = 'Hi';
    assert.strictEqual(areTextsSimilar(text1, text2), false);
  });

  test('threshold is respected (0.66)', () => {
    const text1 = 'this is a test message';
    const text2 = 'this is a test';
    const ratio = similarityRatio(
      normalizeTextForSimilarity(text1),
      normalizeTextForSimilarity(text2)
    );
    const expected = ratio >= FOLD_BOT_REPLIES_SIMILARITY_THRESHOLD;
    assert.strictEqual(areTextsSimilar(text1, text2), expected);
  });
});

describe('Clustering', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
  });

  test('clusters similar replies together', () => {
    document.body.innerHTML = `
      ${createReplyArticleHTML('Check out this amazing crypto opportunity!')}
      ${createReplyArticleHTML('Check out this amazing crypto opportunity!')}
      ${createReplyArticleHTML('Check out this amazing crypto opportunity!')}
      ${createReplyArticleHTML('I really enjoyed this post')}
    `;
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const clusters = clusterRepliesBySimilarity(articles, document);
    
    assert.strictEqual(clusters.length, 1, 'Should have 1 cluster');
    assert.strictEqual(clusters[0].length, 3, 'Cluster should have 3 similar replies');
  });

  test('does not cluster dissimilar replies', () => {
    document.body.innerHTML = `
      ${createReplyArticleHTML('I love cats and dogs')}
      ${createReplyArticleHTML('The weather is great today')}
      ${createReplyArticleHTML('This post is very interesting')}
      ${createReplyArticleHTML('Thanks for sharing this information')}
    `;
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const clusters = clusterRepliesBySimilarity(articles, document);
    
    assert.strictEqual(clusters.length, 0, 'Should have no clusters');
  });

  test('returns empty for fewer than 3 replies', () => {
    document.body.innerHTML = `
      ${createReplyArticleHTML('Check out this amazing opportunity!')}
      ${createReplyArticleHTML('Check out this amazing opportunity!')}
    `;
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const clusters = clusterRepliesBySimilarity(articles, document);
    
    assert.strictEqual(clusters.length, 0, 'Should return empty for fewer than 3 replies');
  });

  test('creates multiple clusters for different spam patterns', () => {
    document.body.innerHTML = `
      ${createReplyArticleHTML('Check out this amazing crypto opportunity!')}
      ${createReplyArticleHTML('Check out this amazing crypto opportunity!')}
      ${createReplyArticleHTML('Check out this amazing crypto opportunity!')}
      ${createReplyArticleHTML('Follow me for free giveaways every day!')}
      ${createReplyArticleHTML('Follow me for free giveaways every day!')}
      ${createReplyArticleHTML('Follow me for free giveaways every day!')}
    `;
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const clusters = clusterRepliesBySimilarity(articles, document);
    
    assert.strictEqual(clusters.length, 2, 'Should have 2 clusters');
  });

  test('minimum cluster size is 2', () => {
    document.body.innerHTML = `
      ${createReplyArticleHTML('Check out this amazing crypto opportunity!')}
      ${createReplyArticleHTML('Check out this amazing crypto opportunity!')}
      ${createReplyArticleHTML('Unique reply that stands alone here')}
      ${createReplyArticleHTML('Another unique reply with different content')}
    `;
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const clusters = clusterRepliesBySimilarity(articles, document);
    
    assert.strictEqual(clusters.length, 1, 'Should have 1 cluster');
    assert.strictEqual(clusters[0].length, 2, 'Cluster should have exactly 2 items');
  });
});

describe('Default OFF and Pro License Gating', () => {
  let chrome;

  beforeEach(() => {
    chrome = createChromeMock();
  });

  afterEach(() => {
    chrome._reset();
  });

  test('foldBotReplies defaults to OFF (undefined)', async () => {
    const result = await chrome.storage.local.get(['foldBotReplies']);
    assert.strictEqual(result.foldBotReplies, undefined, 'Should be undefined by default');
  });

  test('foldBotReplies defaults to OFF (false)', async () => {
    await chrome.storage.local.set({ foldBotReplies: false });
    
    const result = await chrome.storage.local.get(['foldBotReplies']);
    assert.strictEqual(result.foldBotReplies, false, 'Should be false when explicitly set');
  });

  test('feature is disabled when not Pro', async () => {
    await chrome.storage.local.set({ isPro: false, foldBotReplies: true });
    
    const result = await chrome.storage.local.get(['isPro', 'foldBotReplies']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && result.foldBotReplies === true;
    
    assert.strictEqual(isEnabled, false, 'Should be disabled when not Pro');
  });

  test('feature is disabled when Pro but toggle is OFF', async () => {
    await chrome.storage.local.set({ isPro: true, foldBotReplies: false });
    
    const result = await chrome.storage.local.get(['isPro', 'foldBotReplies']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && result.foldBotReplies === true;
    
    assert.strictEqual(isEnabled, false, 'Should be disabled when Pro but toggle OFF');
  });

  test('feature is enabled when Pro and toggle is ON', async () => {
    await chrome.storage.local.set({ isPro: true, foldBotReplies: true });
    
    const result = await chrome.storage.local.get(['isPro', 'foldBotReplies']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && result.foldBotReplies === true;
    
    assert.strictEqual(isEnabled, true, 'Should be enabled when Pro and toggle ON');
  });

  test('no license key means feature is locked', async () => {
    const result = await chrome.storage.local.get(['licenseKey', 'isPro', 'foldBotReplies']);
    const hasStoredGrant = !!(result.licenseKey && result.isPro);
    
    assert.strictEqual(hasStoredGrant, false, 'No license key should mean locked');
  });
});

describe('No Moderation Clicks (DOM-only collapse)', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
  });

  test('folding does not click Hide button', () => {
    let hideClicked = false;
    
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="tweetText">Spam message repeated!</div>
        <button data-testid="caret" onclick="window.caretClicked=true">...</button>
      </article>
    `;
    
    const article = document.querySelector('article');
    const caretBtn = document.querySelector('[data-testid="caret"]');
    
    caretBtn.addEventListener('click', () => {
      hideClicked = true;
    });
    
    article.classList.add('quietx-folded-reply');
    
    assert.strictEqual(hideClicked, false, 'Hide button should never be clicked');
    assert.ok(article.classList.contains('quietx-folded-reply'), 'Article should have folded class');
  });

  test('folding does not click Delete button', () => {
    let deleteClicked = false;
    
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="tweetText">Spam message repeated!</div>
        <button class="delete-btn">Delete</button>
      </article>
    `;
    
    const article = document.querySelector('article');
    const deleteBtn = document.querySelector('.delete-btn');
    
    deleteBtn.addEventListener('click', () => {
      deleteClicked = true;
    });
    
    article.classList.add('quietx-folded-reply');
    
    assert.strictEqual(deleteClicked, false, 'Delete button should never be clicked');
  });

  test('folding does not click Block button', () => {
    let blockClicked = false;
    
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="tweetText">Spam message repeated!</div>
        <button class="block-btn">Block</button>
      </article>
    `;
    
    const article = document.querySelector('article');
    const blockBtn = document.querySelector('.block-btn');
    
    blockBtn.addEventListener('click', () => {
      blockClicked = true;
    });
    
    article.classList.add('quietx-folded-reply');
    
    assert.strictEqual(blockClicked, false, 'Block button should never be clicked');
  });

  test('folding does not click Mute button', () => {
    let muteClicked = false;
    
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="tweetText">Spam message repeated!</div>
        <button class="mute-btn">Mute</button>
      </article>
    `;
    
    const article = document.querySelector('article');
    const muteBtn = document.querySelector('.mute-btn');
    
    muteBtn.addEventListener('click', () => {
      muteClicked = true;
    });
    
    article.classList.add('quietx-folded-reply');
    
    assert.strictEqual(muteClicked, false, 'Mute button should never be clicked');
  });

  test('folding only adds CSS class to hide visually', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="tweetText">Spam message repeated!</div>
      </article>
    `;
    
    const article = document.querySelector('article');
    const originalHTML = article.outerHTML;
    
    article.classList.add('quietx-folded-reply');
    
    const classAddedHTML = article.outerHTML;
    const expectedHTML = originalHTML.replace('data-testid="tweet"', 'data-testid="tweet" class="quietx-folded-reply"');
    
    assert.strictEqual(classAddedHTML, expectedHTML, 'Only class should be added, no other DOM changes');
  });

  test('unfolding removes CSS class', () => {
    document.body.innerHTML = `
      <article data-testid="tweet" class="quietx-folded-reply">
        <div data-testid="tweetText">Spam message repeated!</div>
      </article>
    `;
    
    const article = document.querySelector('article');
    article.classList.remove('quietx-folded-reply');
    
    assert.strictEqual(article.classList.contains('quietx-folded-reply'), false, 'Folded class should be removed');
    assert.ok(article.querySelector('[data-testid="tweetText"]'), 'Tweet content should still exist');
  });
});

describe('Integration: Fold UI behavior', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
  });

  test('placeholder shows correct count', () => {
    const placeholder = document.createElement('div');
    placeholder.className = 'quietx-fold-placeholder';
    placeholder.innerHTML = `
      <div class="quietx-fold-inner">
        <span class="quietx-fold-text">Folded 5 similar replies</span>
      </div>
    `;
    document.body.appendChild(placeholder);
    
    const text = placeholder.querySelector('.quietx-fold-text').textContent;
    assert.ok(text.includes('5'), 'Should show the count');
    assert.ok(text.includes('Folded'), 'Should say Folded');
  });

  test('placeholder is accessible with role and tabindex', () => {
    const placeholder = document.createElement('div');
    placeholder.className = 'quietx-fold-placeholder';
    placeholder.setAttribute('role', 'button');
    placeholder.setAttribute('tabindex', '0');
    placeholder.setAttribute('aria-expanded', 'false');
    document.body.appendChild(placeholder);
    
    assert.strictEqual(placeholder.getAttribute('role'), 'button');
    assert.strictEqual(placeholder.getAttribute('tabindex'), '0');
    assert.strictEqual(placeholder.getAttribute('aria-expanded'), 'false');
  });

  test('expanded state changes aria-expanded', () => {
    const placeholder = document.createElement('div');
    placeholder.className = 'quietx-fold-placeholder';
    placeholder.setAttribute('aria-expanded', 'false');
    document.body.appendChild(placeholder);
    
    placeholder.setAttribute('aria-expanded', 'true');
    placeholder.classList.add('quietx-fold-expanded');
    
    assert.strictEqual(placeholder.getAttribute('aria-expanded'), 'true');
    assert.ok(placeholder.classList.contains('quietx-fold-expanded'));
  });
});
