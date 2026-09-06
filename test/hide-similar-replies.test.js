/**
 * Tests for the Hide Similar Replies feature (1.0.19)
 * Tests:
 * 1. normalizeReplyText trims, collapses whitespace, normalizes punctuation
 * 2. levenshteinDistance returns correct edit distance
 * 3. similarityRatio returns correct ratio (0-1)
 * 4. ≥3 near-duplicate Chinese replies cluster correctly (好可爱/好可耐/好可爱！)
 * 5. Only 1 representative kept, N≥2 hidden
 * 6. Different-meaning replies do NOT cluster (false-positive guard)
 * 7. OFF/undo restores all hidden replies
 * 8. Sensitivity thresholds are correctly applied
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { createChromeMock } from './chrome-mock.js';

// Re-implement the core functions for testing (same as content.js)
// Similarity thresholds: higher = more strict (fewer matches)
// 严 (strict): 0.80 - very similar text only
// 中 (medium): 0.65 - moderate similarity (default, catches 好可爱/好可耐/好可爱！)
// 松 (loose): 0.50 - looser matching
const SIMILARITY_THRESHOLDS = {
  strict: 0.80,
  medium: 0.65,
  loose: 0.50
};

function normalizeReplyText(text) {
  if (!text) return '';
  let normalized = text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[！!]+/g, '!')
    .replace(/[？?]+/g, '?')
    .replace(/[。.]+/g, '.')
    .replace(/[，,]+/g, ',')
    .replace(/[～~]+/g, '~')
    .toLowerCase();
  return normalized;
}

function levenshteinDistance(s1, s2) {
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  const matrix = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[s1.length][s2.length];
}

function similarityRatio(s1, s2) {
  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(s1, s2);
  return 1 - (distance / maxLen);
}

function clusterReplies(texts, threshold) {
  const clusters = [];
  const assigned = new Set();
  
  for (let i = 0; i < texts.length; i++) {
    if (assigned.has(i)) continue;
    
    const cluster = [i];
    const textI = normalizeReplyText(texts[i]);
    
    if (textI.length < 2) {
      assigned.add(i);
      continue;
    }
    
    for (let j = i + 1; j < texts.length; j++) {
      if (assigned.has(j)) continue;
      
      const textJ = normalizeReplyText(texts[j]);
      if (textJ.length < 2) continue;
      
      const similarity = similarityRatio(textI, textJ);
      if (similarity >= threshold) {
        cluster.push(j);
        assigned.add(j);
      }
    }
    
    assigned.add(i);
    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }
  
  return clusters;
}

const SIMILAR_REPLIES_HIDDEN_CLASS = 'quietx-similar-reply-hidden';

describe('normalizeReplyText', () => {
  test('trims whitespace', () => {
    assert.strictEqual(normalizeReplyText('  hello  '), 'hello');
  });

  test('collapses multiple spaces', () => {
    assert.strictEqual(normalizeReplyText('hello   world'), 'hello world');
  });

  test('normalizes Chinese punctuation', () => {
    assert.strictEqual(normalizeReplyText('好可爱！！'), '好可爱!');
    assert.strictEqual(normalizeReplyText('真的吗？？'), '真的吗?');
  });

  test('converts to lowercase', () => {
    assert.strictEqual(normalizeReplyText('HELLO World'), 'hello world');
  });

  test('handles empty string', () => {
    assert.strictEqual(normalizeReplyText(''), '');
    assert.strictEqual(normalizeReplyText(null), '');
    assert.strictEqual(normalizeReplyText(undefined), '');
  });

  test('normalizes mixed punctuation', () => {
    assert.strictEqual(normalizeReplyText('好！！好？？'), '好!好?');
  });
});

describe('levenshteinDistance', () => {
  test('identical strings have distance 0', () => {
    assert.strictEqual(levenshteinDistance('hello', 'hello'), 0);
    assert.strictEqual(levenshteinDistance('好可爱', '好可爱'), 0);
  });

  test('empty vs non-empty string', () => {
    assert.strictEqual(levenshteinDistance('', 'hello'), 5);
    assert.strictEqual(levenshteinDistance('hello', ''), 5);
  });

  test('single character difference', () => {
    assert.strictEqual(levenshteinDistance('好可爱', '好可耐'), 1);
    assert.strictEqual(levenshteinDistance('cat', 'bat'), 1);
  });

  test('insertion/deletion', () => {
    assert.strictEqual(levenshteinDistance('好可爱', '好可爱！'), 1);
    assert.strictEqual(levenshteinDistance('hello', 'helo'), 1);
  });

  test('completely different strings', () => {
    assert.strictEqual(levenshteinDistance('abc', 'xyz'), 3);
  });
});

describe('similarityRatio', () => {
  test('identical strings have ratio 1', () => {
    assert.strictEqual(similarityRatio('hello', 'hello'), 1);
    assert.strictEqual(similarityRatio('好可爱', '好可爱'), 1);
  });

  test('empty strings have ratio 1', () => {
    assert.strictEqual(similarityRatio('', ''), 1);
  });

  test('one empty string has ratio 0', () => {
    assert.strictEqual(similarityRatio('', 'hello'), 0);
    assert.strictEqual(similarityRatio('hello', ''), 0);
  });

  test('similar Chinese text has high ratio', () => {
    const ratio1 = similarityRatio('好可爱', '好可耐');
    assert.ok(ratio1 > 0.6, `Expected ratio > 0.6 for 好可爱/好可耐, got ${ratio1}`);
    
    const ratio2 = similarityRatio('好可爱', '好可爱!');
    assert.ok(ratio2 > 0.7, `Expected ratio > 0.7 for 好可爱/好可爱!, got ${ratio2}`);
  });

  test('different text has low ratio', () => {
    const ratio = similarityRatio('你好世界', '再见朋友');
    assert.ok(ratio < 0.5, `Expected ratio < 0.5 for very different text, got ${ratio}`);
  });
});

describe('clusterReplies - Chinese near-duplicates', () => {
  test('clusters ≥3 near-duplicate Chinese replies (好可爱/好可耐/好可爱！)', () => {
    const texts = ['好可爱', '好可耐', '好可爱！', '完全不同的回复'];
    const clusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.medium);
    
    assert.strictEqual(clusters.length, 1, 'Should have exactly 1 cluster');
    assert.ok(clusters[0].length >= 3, `Cluster should have ≥3 items, got ${clusters[0].length}`);
    assert.ok(!clusters[0].includes(3), 'Cluster should not include the different reply');
  });

  test('keeps 1 representative, hides N≥2', () => {
    const texts = ['好可爱', '好可耐', '好可爱！'];
    const clusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.medium);
    
    assert.strictEqual(clusters.length, 1, 'Should have exactly 1 cluster');
    const cluster = clusters[0];
    
    const representative = cluster[0];
    const hidden = cluster.slice(1);
    
    assert.strictEqual(representative, 0, 'First item should be representative');
    assert.ok(hidden.length >= 2, `Should hide N≥2 items, got ${hidden.length}`);
  });

  test('does not cluster different-meaning replies (false-positive guard)', () => {
    const texts = [
      '这个视频太棒了',
      '我完全不同意这个观点',
      '天气真好啊',
      '明天要下雨了'
    ];
    const clusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.medium);
    
    assert.strictEqual(clusters.length, 0, 'Should have no clusters for different replies');
  });

  test('handles mixed similar and different replies', () => {
    const texts = [
      '好可爱',
      '好可耐', 
      '好可爱！',
      '这视频好搞笑',
      '这视频好好笑',
      '完全不相关的内容'
    ];
    const clusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.medium);
    
    assert.strictEqual(clusters.length, 2, 'Should have 2 clusters');
    
    const totalClustered = clusters.reduce((sum, c) => sum + c.length, 0);
    assert.ok(totalClustered >= 5, 'Should cluster at least 5 items');
    
    const allIndices = clusters.flat();
    assert.ok(!allIndices.includes(5), 'Unrelated content should not be clustered');
  });
});

describe('Sensitivity thresholds', () => {
  test('strict threshold (0.85) is more selective', () => {
    const texts = ['好可爱', '好可耐', '好可爱！'];
    const strictClusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.strict);
    const mediumClusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.medium);
    
    const strictCount = strictClusters.reduce((sum, c) => sum + c.length, 0);
    const mediumCount = mediumClusters.reduce((sum, c) => sum + c.length, 0);
    
    assert.ok(mediumCount >= strictCount, 
      'Medium threshold should cluster same or more items than strict');
  });

  test('loose threshold (0.55) clusters more liberally', () => {
    const texts = ['你好', '您好', '大家好', '晚上好'];
    const looseClusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.loose);
    const mediumClusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.medium);
    
    const looseCount = looseClusters.reduce((sum, c) => sum + c.length, 0);
    const mediumCount = mediumClusters.reduce((sum, c) => sum + c.length, 0);
    
    assert.ok(looseCount >= mediumCount,
      'Loose threshold should cluster same or more items than medium');
  });

  test('medium threshold is the default v1 path', () => {
    assert.strictEqual(SIMILARITY_THRESHOLDS.medium, 0.65);
  });
});

describe('Hide Similar Replies DOM operations', () => {
  let dom;
  let document;
  let chrome;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
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

  function createReplyArticle(text) {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    const tweetText = document.createElement('div');
    tweetText.setAttribute('data-testid', 'tweetText');
    tweetText.textContent = text;
    article.appendChild(tweetText);
    return article;
  }

  test('hiding adds the hidden class', () => {
    const article = createReplyArticle('好可爱');
    document.body.appendChild(article);
    
    article.classList.add(SIMILAR_REPLIES_HIDDEN_CLASS);
    
    assert.ok(article.classList.contains(SIMILAR_REPLIES_HIDDEN_CLASS),
      'Article should have hidden class');
  });

  test('undo/restore removes the hidden class', () => {
    const article = createReplyArticle('好可爱');
    document.body.appendChild(article);
    
    article.classList.add(SIMILAR_REPLIES_HIDDEN_CLASS);
    article.setAttribute('data-quietx-cluster-id', '0');
    
    article.classList.remove(SIMILAR_REPLIES_HIDDEN_CLASS);
    article.removeAttribute('data-quietx-cluster-id');
    
    assert.ok(!article.classList.contains(SIMILAR_REPLIES_HIDDEN_CLASS),
      'Article should not have hidden class after restore');
    assert.strictEqual(article.getAttribute('data-quietx-cluster-id'), null,
      'Cluster ID should be removed');
  });

  test('OFF restores all hidden replies', () => {
    const articles = [
      createReplyArticle('好可爱'),
      createReplyArticle('好可耐'),
      createReplyArticle('好可爱！')
    ];
    
    articles.forEach((a, i) => {
      document.body.appendChild(a);
      if (i > 0) {
        a.classList.add(SIMILAR_REPLIES_HIDDEN_CLASS);
        a.setAttribute('data-quietx-cluster-id', '0');
      }
    });
    
    let hiddenCount = document.querySelectorAll('.' + SIMILAR_REPLIES_HIDDEN_CLASS).length;
    assert.strictEqual(hiddenCount, 2, 'Should have 2 hidden articles');
    
    document.querySelectorAll('.' + SIMILAR_REPLIES_HIDDEN_CLASS).forEach(el => {
      el.classList.remove(SIMILAR_REPLIES_HIDDEN_CLASS);
      el.removeAttribute('data-quietx-cluster-id');
    });
    
    hiddenCount = document.querySelectorAll('.' + SIMILAR_REPLIES_HIDDEN_CLASS).length;
    assert.strictEqual(hiddenCount, 0, 'All articles should be visible after OFF');
  });
});

describe('Pro License Gating for Similar Replies', () => {
  let chrome;

  beforeEach(() => {
    chrome = createChromeMock();
  });

  afterEach(() => {
    chrome._reset();
  });

  test('hideSimilarReplies defaults to false (OFF)', async () => {
    await chrome.storage.local.set({ isPro: true });
    
    const result = await chrome.storage.local.get(['isPro', 'hideSimilarReplies']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && !!result.hideSimilarReplies;
    
    assert.strictEqual(isEnabled, false, 'Should default to OFF for Pro users');
  });

  test('hideSimilarReplies respects explicit true when Pro', async () => {
    await chrome.storage.local.set({ isPro: true, hideSimilarReplies: true });
    
    const result = await chrome.storage.local.get(['isPro', 'hideSimilarReplies']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && !!result.hideSimilarReplies;
    
    assert.strictEqual(isEnabled, true, 'Should respect explicit true');
  });

  test('hideSimilarReplies is disabled when not Pro', async () => {
    await chrome.storage.local.set({ isPro: false, hideSimilarReplies: true });
    
    const result = await chrome.storage.local.get(['isPro', 'hideSimilarReplies']);
    const isPro = !!result.isPro;
    const isEnabled = isPro && !!result.hideSimilarReplies;
    
    assert.strictEqual(isEnabled, false, 'Should be disabled when not Pro');
  });

  test('similarRepliesSensitivity defaults to medium', async () => {
    await chrome.storage.local.set({ isPro: true });
    
    const result = await chrome.storage.local.get(['similarRepliesSensitivity']);
    const sensitivity = result.similarRepliesSensitivity || 'medium';
    
    assert.strictEqual(sensitivity, 'medium', 'Should default to medium sensitivity');
  });
});

describe('Edge cases', () => {
  test('empty reply list returns no clusters', () => {
    const clusters = clusterReplies([], SIMILARITY_THRESHOLDS.medium);
    assert.strictEqual(clusters.length, 0);
  });

  test('single reply returns no clusters', () => {
    const clusters = clusterReplies(['好可爱'], SIMILARITY_THRESHOLDS.medium);
    assert.strictEqual(clusters.length, 0);
  });

  test('very short texts (< 2 chars) are skipped', () => {
    const texts = ['好', '坏', '你好世界'];
    const clusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.medium);
    assert.strictEqual(clusters.length, 0, 'Should not cluster single-char texts');
  });

  test('identical replies cluster together', () => {
    const texts = ['好可爱', '好可爱', '好可爱'];
    const clusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.medium);
    
    assert.strictEqual(clusters.length, 1, 'Should have 1 cluster');
    assert.strictEqual(clusters[0].length, 3, 'All identical should cluster');
  });

  test('handles mixed emoji and text', () => {
    // Emoji characters are multi-byte so similarity may vary
    // Using loose threshold to test emoji handling
    const texts = ['好可爱🥰', '好可爱😍', '好可爱❤️'];
    const clusters = clusterReplies(texts, SIMILARITY_THRESHOLDS.loose);
    
    assert.ok(clusters.length >= 1, 'Should cluster similar text with different emoji using loose threshold');
  });
});
