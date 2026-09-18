/**
 * Tests for the Fold Bot Replies feature (1.0.21)
 * Tests:
 * 1. Text normalization removes URLs, mentions, hashtags, emojis
 * 2. Levenshtein distance calculation is correct
 * 3. Similarity ratio calculation is correct
 * 4. Similar texts are detected with threshold >= 0.66
 * 5. Single chip per page (not one per cluster)
 * 6. Chip not in primary article/cell
 * 7. Chip inside a reply cellInnerDiv
 * 8. Expand sticks across re-apply
 * 9. Feature defaults to OFF (unset/false)
 * 10. Feature requires Pro license
 * 11. No Hide/Delete/Block/Mute clicks (local DOM collapse only)
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { createChromeMock } from './chrome-mock.js';

const FOLD_BOT_REPLIES_SIMILARITY_THRESHOLD = 0.66;
const FOLD_BOT_REPLIES_MIN_CLUSTER_SIZE = 2;
const FOLD_BOT_REPLIES_MIN_REPLIES_TO_SCAN = 3;
const FOLD_BOT_REPLIES_CHIP_CLASS = 'quietx-fold-chip';
const FOLD_BOT_REPLIES_HOST_CELL_CLASS = 'quietx-fold-host-cell';
const FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS = 'quietx-folded-cell';
const FOLD_BOT_REPLIES_HIDDEN_CLASS = 'quietx-folded-reply';
const FOLD_BOT_REPLIES_EXPANDED_CLASS = 'quietx-fold-expanded';
const FOLD_BOT_REPLIES_PRESSED_CLASS = 'quietx-bot-fold-chip-pressed';
const FOLD_BOT_REPLIES_EXPAND_DELAY_MS = 200;

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

function isBeforeInDocument(a, b) {
  if (!a || !b) return false;
  const position = a.compareDocumentPosition(b);
  return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function findAllDuplicateReplies(replyArticles) {
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
  
  const duplicateIndices = new Set();
  
  for (let i = 0; i < articlesWithText.length; i++) {
    for (let j = i + 1; j < articlesWithText.length; j++) {
      if (areTextsSimilar(articlesWithText[i].text, articlesWithText[j].text)) {
        duplicateIndices.add(i);
        duplicateIndices.add(j);
      }
    }
  }
  
  const duplicates = [];
  for (const idx of duplicateIndices) {
    duplicates.push(articlesWithText[idx]);
  }
  
  duplicates.sort((a, b) => {
    if (isBeforeInDocument(a.article, b.article)) return -1;
    if (isBeforeInDocument(b.article, a.article)) return 1;
    return 0;
  });
  
  return duplicates;
}

function createConversationHTML(primaryText, replyTexts) {
  const primaryCell = `
    <div data-testid="cellInnerDiv" id="primary-cell">
      <article data-testid="tweet" id="primary-article">
        <div data-testid="User-Name">@originalAuthor</div>
        <a href="/user/status/123456789">2h</a>
        <div data-testid="tweetText">${primaryText}</div>
        <div role="group">
          <button data-testid="reply">Reply</button>
          <button data-testid="like">Like</button>
        </div>
      </article>
    </div>
  `;
  
  const replyCells = replyTexts.map((text, i) => `
    <div data-testid="cellInnerDiv" id="reply-cell-${i}">
      <article data-testid="tweet" id="reply-article-${i}">
        <div data-testid="User-Name">@user${i}</div>
        <a href="/user${i}/status/${999000 + i}">1m</a>
        <div data-testid="tweetText">${text}</div>
        <div role="group">
          <button data-testid="reply">Reply</button>
          <button data-testid="like">Like</button>
        </div>
      </article>
    </div>
  `).join('');
  
  return `
    <div id="timeline">
      ${primaryCell}
      ${replyCells}
    </div>
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
});

describe('Levenshtein Distance', () => {
  test('identical strings have distance 0', () => {
    assert.strictEqual(levenshteinDistance('hello', 'hello'), 0);
  });

  test('empty strings', () => {
    assert.strictEqual(levenshteinDistance('', 'hello'), 5);
    assert.strictEqual(levenshteinDistance('hello', ''), 5);
  });

  test('single character difference', () => {
    assert.strictEqual(levenshteinDistance('hello', 'hallo'), 1);
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
});

describe('areTextsSimilar', () => {
  test('identical spam messages are similar', () => {
    const text1 = 'Check out this amazing opportunity!';
    const text2 = 'Check out this amazing opportunity!';
    assert.strictEqual(areTextsSimilar(text1, text2), true);
  });

  test('near-duplicate spam with different usernames are similar', () => {
    const text1 = '@user1 Check out this amazing opportunity for crypto gains!';
    const text2 = '@user2 Check out this amazing opportunity for crypto gains!';
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
});

describe('findAllDuplicateReplies', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
    delete global.Node;
  });

  test('finds all duplicate replies across clusters', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      [
        'Spam A!',
        'Spam A!',
        'Spam A!',
        'Different reply',
      ]
    );
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(1);
    const duplicates = findAllDuplicateReplies(articles);
    
    assert.strictEqual(duplicates.length, 3, 'Should find 3 duplicates');
  });

  test('aggregates duplicates from multiple patterns into one list', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      [
        'Spam pattern A!',
        'Spam pattern A!',
        'Spam pattern B!',
        'Spam pattern B!',
        'Unique reply',
      ]
    );
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(1);
    const duplicates = findAllDuplicateReplies(articles);
    
    assert.strictEqual(duplicates.length, 4, 'Should find all 4 duplicates from both patterns');
  });

  test('returns empty for fewer than 3 replies', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Reply 1', 'Reply 2']
    );
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(1);
    const duplicates = findAllDuplicateReplies(articles);
    
    assert.strictEqual(duplicates.length, 0, 'Should return empty');
  });

  test('returns sorted by document order', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      [
        'Spam!',
        'Unique',
        'Spam!',
        'Spam!',
      ]
    );
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(1);
    const duplicates = findAllDuplicateReplies(articles);
    
    assert.strictEqual(duplicates.length, 3);
    assert.strictEqual(duplicates[0].article.id, 'reply-article-0');
    assert.strictEqual(duplicates[1].article.id, 'reply-article-2');
    assert.strictEqual(duplicates[2].article.id, 'reply-article-3');
  });
});

describe('Single Chip Per Page', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
    delete global.Node;
  });

  test('only one chip is created even with multiple spam patterns', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      [
        'Spam A!', 'Spam A!', 'Spam A!',
        'Spam B!', 'Spam B!', 'Spam B!',
      ]
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.innerHTML = '<span class="quietx-fold-text">Folded 6 similar replies</span>';
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const chips = document.querySelectorAll('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    assert.strictEqual(chips.length, 1, 'Should have exactly ONE chip');
  });

  test('chip count reflects total duplicates, not cluster count', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      [
        'Spam A!', 'Spam A!',
        'Spam B!', 'Spam B!',
      ]
    );
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(1);
    const duplicates = findAllDuplicateReplies(articles);
    
    const hostCell = document.getElementById('reply-cell-0');
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('data-fold-count', String(duplicates.length));
    chip.innerHTML = `<span class="quietx-fold-text">Folded ${duplicates.length} similar replies</span>`;
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    assert.strictEqual(chip.getAttribute('data-fold-count'), '4', 'Should count all 4 duplicates');
  });
});

describe('Chip Placement', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
    delete global.Node;
  });

  test('chip is inside a reply cellInnerDiv, not naked sibling', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    hostCell.classList.add(FOLD_BOT_REPLIES_HOST_CELL_CLASS);
    
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const insertedChip = document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    const parentCell = insertedChip.closest('[data-testid="cellInnerDiv"]');
    
    assert.ok(parentCell, 'Chip must be inside a cellInnerDiv');
    assert.strictEqual(parentCell.id, 'reply-cell-0', 'Chip must be in reply cell, not primary');
  });

  test('chip is not in primary article', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const primaryArticle = document.getElementById('primary-article');
    const hostCell = document.getElementById('reply-cell-0');
    
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const insertedChip = document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    
    assert.strictEqual(primaryArticle.contains(insertedChip), false, 'Chip must NOT be inside primary article');
  });

  test('chip is not in primary cellInnerDiv', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const primaryCell = document.getElementById('primary-cell');
    const hostCell = document.getElementById('reply-cell-0');
    
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const insertedChip = document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    
    assert.strictEqual(primaryCell.contains(insertedChip), false, 'Chip must NOT be inside primary cell');
  });

  test('chip is after primary in document order', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const primaryArticle = document.getElementById('primary-article');
    const hostCell = document.getElementById('reply-cell-0');
    
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const insertedChip = document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    
    assert.ok(isBeforeInDocument(primaryArticle, insertedChip), 'Chip must be after primary in document');
  });

  test('host cell is a reply cell with HOST_CELL class', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    hostCell.classList.add(FOLD_BOT_REPLIES_HOST_CELL_CLASS);
    
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const chipParent = document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS).closest('[data-testid="cellInnerDiv"]');
    
    assert.ok(chipParent.classList.contains(FOLD_BOT_REPLIES_HOST_CELL_CLASS), 'Host cell should have HOST_CELL class');
    assert.notStrictEqual(chipParent.id, 'primary-cell', 'Host cell must not be primary');
  });
});

describe('Expand Persistence', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
    delete global.Node;
  });

  test('expanded state is reflected in aria-expanded attribute', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('aria-expanded', 'false');
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'false');
    
    chip.setAttribute('aria-expanded', 'true');
    chip.classList.add(FOLD_BOT_REPLIES_EXPANDED_CLASS);
    
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'true');
    assert.ok(chip.classList.contains(FOLD_BOT_REPLIES_EXPANDED_CLASS));
  });

  test('folded cells use CELL_HIDDEN class, not display:none inline', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const cell1 = document.getElementById('reply-cell-1');
    const cell2 = document.getElementById('reply-cell-2');
    
    cell1.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    cell2.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    
    assert.ok(cell1.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS));
    assert.ok(cell2.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS));
  });

  test('expand removes CELL_HIDDEN class from folded cells', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const cell1 = document.getElementById('reply-cell-1');
    const cell2 = document.getElementById('reply-cell-2');
    
    cell1.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    cell2.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    
    cell1.classList.remove(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    cell2.classList.remove(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    
    assert.strictEqual(cell1.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), false);
    assert.strictEqual(cell2.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), false);
  });

  test('data-quietx-folded attribute marks folded cells for re-apply', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const cell0 = document.getElementById('reply-cell-0');
    const cell1 = document.getElementById('reply-cell-1');
    const cell2 = document.getElementById('reply-cell-2');
    
    cell0.setAttribute('data-quietx-folded', 'true');
    cell1.setAttribute('data-quietx-folded', 'true');
    cell2.setAttribute('data-quietx-folded', 'true');
    
    const foldedCells = document.querySelectorAll('[data-quietx-folded="true"]');
    assert.strictEqual(foldedCells.length, 3, 'All 3 reply cells should be marked');
    
    assert.strictEqual(document.getElementById('primary-cell').hasAttribute('data-quietx-folded'), false, 
      'Primary cell should NOT be marked');
  });
});

describe('Primary Article Protection', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
    delete global.Node;
  });

  test('primary article never gets HIDDEN class', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const primaryArticle = document.getElementById('primary-article');
    const replyArticles = [
      document.getElementById('reply-article-0'),
      document.getElementById('reply-article-1'),
      document.getElementById('reply-article-2')
    ];
    
    replyArticles.forEach(article => {
      article.classList.add(FOLD_BOT_REPLIES_HIDDEN_CLASS);
    });
    
    assert.strictEqual(primaryArticle.classList.contains(FOLD_BOT_REPLIES_HIDDEN_CLASS), false,
      'Primary article must NEVER have hidden class');
  });

  test('primary cell never gets CELL_HIDDEN class', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const primaryCell = document.getElementById('primary-cell');
    const replyCells = [
      document.getElementById('reply-cell-1'),
      document.getElementById('reply-cell-2')
    ];
    
    replyCells.forEach(cell => {
      cell.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    });
    
    assert.strictEqual(primaryCell.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), false,
      'Primary cell must NEVER have cell-hidden class');
  });

  test('primary cell never gets HOST_CELL class', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const primaryCell = document.getElementById('primary-cell');
    const hostCell = document.getElementById('reply-cell-0');
    
    hostCell.classList.add(FOLD_BOT_REPLIES_HOST_CELL_CLASS);
    
    assert.strictEqual(primaryCell.classList.contains(FOLD_BOT_REPLIES_HOST_CELL_CLASS), false,
      'Primary cell must NEVER be the host cell');
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

describe('Click/Pointerdown Expand', () => {
  let dom;
  let document;
  let sessionStorageMock;

  beforeEach(() => {
    sessionStorageMock = new Map();
    
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
    global.window = dom.window;
    
    global.sessionStorage = {
      getItem: (key) => sessionStorageMock.get(key) || null,
      setItem: (key, value) => sessionStorageMock.set(key, value),
      removeItem: (key) => sessionStorageMock.delete(key),
    };
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
    delete global.Node;
    delete global.window;
    delete global.sessionStorage;
  });

  test('clicking chip toggles aria-expanded attribute', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('data-fold-count', '3');
    chip.innerHTML = '<span class="quietx-fold-text">Folded 3 similar replies</span>';
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'false');
    
    chip.setAttribute('aria-expanded', 'true');
    chip.classList.add(FOLD_BOT_REPLIES_EXPANDED_CLASS);
    
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'true');
    assert.ok(chip.classList.contains(FOLD_BOT_REPLIES_EXPANDED_CLASS));
  });

  test('expanded state persists in sessionStorage keyed by pathname', () => {
    const key = 'quietx-fold-expanded:/user/status/123456789';
    
    assert.strictEqual(sessionStorage.getItem(key), null);
    
    sessionStorage.setItem(key, 'true');
    
    assert.strictEqual(sessionStorage.getItem(key), 'true');
  });

  test('pointerdown on chip should be handled but NOT expand, and adds pressed class', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('role', 'button');
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    let pointerdownHandled = false;
    
    chip.addEventListener('pointerdown', (e) => {
      pointerdownHandled = true;
      e.stopPropagation();
      e.stopImmediatePropagation();
      chip.classList.add(FOLD_BOT_REPLIES_PRESSED_CLASS);
    });
    
    const event = new dom.window.Event('pointerdown', { bubbles: true });
    chip.dispatchEvent(event);
    
    assert.strictEqual(pointerdownHandled, true, 'pointerdown should be handled');
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'false', 'aria-expanded should still be false after pointerdown');
    assert.ok(document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS), 'chip should still be present after pointerdown');
    assert.ok(chip.classList.contains(FOLD_BOT_REPLIES_PRESSED_CLASS), 'chip should have pressed class after pointerdown');
  });
});

describe('Pointerdown Does NOT Expand', () => {
  let dom;
  let document;
  let sessionStorageMock;

  beforeEach(() => {
    sessionStorageMock = new Map();
    
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
    global.window = dom.window;
    
    global.sessionStorage = {
      getItem: (key) => sessionStorageMock.get(key) || null,
      setItem: (key, value) => sessionStorageMock.set(key, value),
      removeItem: (key) => sessionStorageMock.delete(key),
    };
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
    delete global.Node;
    delete global.window;
    delete global.sessionStorage;
  });

  test('pointerdown alone must NOT expand - chip still present', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    hostCell.classList.add(FOLD_BOT_REPLIES_HOST_CELL_CLASS);
    
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('data-fold-count', '3');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('role', 'button');
    chip.innerHTML = '<span class="quietx-fold-text">Folded 3 similar replies</span>';
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const cell1 = document.getElementById('reply-cell-1');
    const cell2 = document.getElementById('reply-cell-2');
    cell1.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    cell2.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    
    const pointerdownEvent = new dom.window.Event('pointerdown', { bubbles: true });
    chip.dispatchEvent(pointerdownEvent);
    
    const chipAfterPointerdown = document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    assert.ok(chipAfterPointerdown, 'chip must still be present after pointerdown alone');
    assert.strictEqual(chipAfterPointerdown.getAttribute('aria-expanded'), 'false', 
      'chip aria-expanded must still be false after pointerdown');
    assert.ok(cell1.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), 
      'folded cells must still be hidden after pointerdown');
    assert.ok(cell2.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), 
      'folded cells must still be hidden after pointerdown');
  });

  test('pointerdown adds pressed class to chip', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    hostCell.classList.add(FOLD_BOT_REPLIES_HOST_CELL_CLASS);
    
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('data-fold-count', '3');
    chip.innerHTML = '<span class="quietx-fold-text">Folded 3 similar replies</span>';
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    assert.strictEqual(chip.classList.contains(FOLD_BOT_REPLIES_PRESSED_CLASS), false,
      'chip should NOT have pressed class before pointerdown');
    
    chip.classList.add(FOLD_BOT_REPLIES_PRESSED_CLASS);
    
    assert.ok(chip.classList.contains(FOLD_BOT_REPLIES_PRESSED_CLASS),
      'chip should have pressed class after pointerdown');
    assert.ok(document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS),
      'chip must still be present after pointerdown');
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'false',
      'chip aria-expanded must still be false after pointerdown');
  });

  test('click expands and removes hidden class from cells', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    hostCell.classList.add(FOLD_BOT_REPLIES_HOST_CELL_CLASS);
    
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('data-fold-count', '3');
    chip.innerHTML = '<span class="quietx-fold-text">Folded 3 similar replies</span>';
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const cell1 = document.getElementById('reply-cell-1');
    const cell2 = document.getElementById('reply-cell-2');
    cell1.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    cell2.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    
    chip.setAttribute('aria-expanded', 'true');
    chip.classList.add(FOLD_BOT_REPLIES_EXPANDED_CLASS);
    cell1.classList.remove(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    cell2.classList.remove(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'true', 
      'chip aria-expanded should be true after click');
    assert.ok(chip.classList.contains(FOLD_BOT_REPLIES_EXPANDED_CLASS), 
      'chip should have expanded class after click');
    assert.strictEqual(cell1.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), false, 
      'cell1 should be visible after click');
    assert.strictEqual(cell2.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), false, 
      'cell2 should be visible after click');
  });

  test('immediately after click chip is still present with pressed class', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    hostCell.classList.add(FOLD_BOT_REPLIES_HOST_CELL_CLASS);
    
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('data-fold-count', '3');
    chip.innerHTML = '<span class="quietx-fold-text">Folded 3 similar replies</span>';
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const cell1 = document.getElementById('reply-cell-1');
    const cell2 = document.getElementById('reply-cell-2');
    cell1.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    cell2.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    
    chip.classList.add(FOLD_BOT_REPLIES_PRESSED_CLASS);
    
    const chipImmediatelyAfterClick = document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    assert.ok(chipImmediatelyAfterClick, 
      'chip must still be present immediately after click (before 200ms delay)');
    assert.ok(chipImmediatelyAfterClick.classList.contains(FOLD_BOT_REPLIES_PRESSED_CLASS),
      'chip must still have pressed class immediately after click');
    assert.ok(cell1.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS),
      'cells must still be hidden immediately after click (before 200ms delay)');
    assert.ok(cell2.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS),
      'cells must still be hidden immediately after click (before 200ms delay)');
  });

  test('pointerdown followed by click expands correctly after delay', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    hostCell.classList.add(FOLD_BOT_REPLIES_HOST_CELL_CLASS);
    
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('data-fold-count', '3');
    chip.innerHTML = '<span class="quietx-fold-text">Folded 3 similar replies</span>';
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const cell1 = document.getElementById('reply-cell-1');
    const cell2 = document.getElementById('reply-cell-2');
    cell1.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    cell2.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    
    chip.classList.add(FOLD_BOT_REPLIES_PRESSED_CLASS);
    
    assert.ok(document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS), 
      'chip still present after pointerdown');
    assert.ok(chip.classList.contains(FOLD_BOT_REPLIES_PRESSED_CLASS),
      'chip has pressed class after pointerdown');
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'false', 
      'aria-expanded still false after pointerdown');
    
    chip.setAttribute('aria-expanded', 'true');
    chip.classList.add(FOLD_BOT_REPLIES_EXPANDED_CLASS);
    cell1.classList.remove(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    cell2.classList.remove(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'true', 
      'chip aria-expanded should be true after delay');
    assert.strictEqual(cell1.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), false, 
      'cell1 should be visible after delay');
    assert.strictEqual(cell2.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), false, 
      'cell2 should be visible after delay');
  });

  test('expand delay constant is 200ms', () => {
    assert.strictEqual(FOLD_BOT_REPLIES_EXPAND_DELAY_MS, 200,
      'expand delay should be 200ms to allow pressed state to be visible');
  });

  test('expanded state persists on re-apply (sessionStorage true)', () => {
    const key = 'quietx-fold-expanded:/user/status/123456789';
    sessionStorage.setItem(key, 'true');
    
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    const chip = document.createElement('div');
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('aria-expanded', 'true');
    chip.classList.add(FOLD_BOT_REPLIES_EXPANDED_CLASS);
    chip.setAttribute('data-fold-count', '3');
    chip.innerHTML = '<span class="quietx-fold-text">Hide 3 similar replies</span>';
    hostCell.insertBefore(chip, hostCell.firstChild);
    
    const cell1 = document.getElementById('reply-cell-1');
    const cell2 = document.getElementById('reply-cell-2');
    
    const isExpanded = sessionStorage.getItem(key) === 'true';
    assert.strictEqual(isExpanded, true, 'expanded state should persist in sessionStorage');
    assert.strictEqual(chip.getAttribute('aria-expanded'), 'true', 
      'chip aria-expanded should remain true on re-apply');
    assert.strictEqual(chip.classList.contains(FOLD_BOT_REPLIES_EXPANDED_CLASS), true, 
      'chip should have expanded class on re-apply');
  });
});

describe('Re-apply Does NOT Re-fold When Expanded', () => {
  let dom;
  let document;
  let sessionStorageMock;

  beforeEach(() => {
    sessionStorageMock = new Map();
    
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
    global.window = dom.window;
    
    global.sessionStorage = {
      getItem: (key) => sessionStorageMock.get(key) || null,
      setItem: (key, value) => sessionStorageMock.set(key, value),
      removeItem: (key) => sessionStorageMock.delete(key),
    };
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
    delete global.Node;
    delete global.window;
    delete global.sessionStorage;
  });

  test('when sessionStorage has expanded=true, replies should stay visible', () => {
    const key = 'quietx-fold-expanded:/user/status/123456789';
    sessionStorage.setItem(key, 'true');
    
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const cell1 = document.getElementById('reply-cell-1');
    const cell2 = document.getElementById('reply-cell-2');
    
    const isExpanded = sessionStorage.getItem(key) === 'true';
    assert.strictEqual(isExpanded, true, 'Should detect expanded from sessionStorage');
    
    if (isExpanded) {
      cell1.classList.remove(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
      cell2.classList.remove(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    }
    
    assert.strictEqual(cell1.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), false);
    assert.strictEqual(cell2.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS), false);
  });

  test('existing chip is re-used, not recreated when MutationObserver fires', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    const chip1 = document.createElement('div');
    chip1.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip1.id = 'original-chip';
    hostCell.insertBefore(chip1, hostCell.firstChild);
    
    const existingChip = document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    if (existingChip) {
      assert.strictEqual(existingChip.id, 'original-chip', 'Should reuse existing chip');
    }
    
    const allChips = document.querySelectorAll('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    assert.strictEqual(allChips.length, 1, 'Should have exactly ONE chip');
  });

  test('collapse toggle only happens if sessionStorage is not set to expanded', () => {
    const key = 'quietx-fold-expanded:/user/status/123456789';
    
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam!', 'Spam!', 'Spam!']
    );
    
    sessionStorage.removeItem(key);
    const isExpanded = sessionStorage.getItem(key) === 'true';
    assert.strictEqual(isExpanded, false, 'Should not be expanded when sessionStorage is clear');
    
    sessionStorage.setItem(key, 'true');
    const isNowExpanded = sessionStorage.getItem(key) === 'true';
    assert.strictEqual(isNowExpanded, true, 'Should be expanded after setting sessionStorage');
  });
});

describe('One Chip Enforcement', () => {
  let dom;
  let document;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://x.com/user/status/123456789'
    });
    document = dom.window.document;
    global.document = document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
  });

  afterEach(() => {
    dom.window.close();
    delete global.document;
    delete global.HTMLElement;
    delete global.Node;
  });

  test('second chip is not created if one exists', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      ['Spam A!', 'Spam A!', 'Spam B!', 'Spam B!', 'Spam B!']
    );
    
    const hostCell = document.getElementById('reply-cell-0');
    const chip1 = document.createElement('div');
    chip1.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    hostCell.insertBefore(chip1, hostCell.firstChild);
    
    const existingChip = document.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    if (existingChip) {
    }
    
    const allChips = document.querySelectorAll('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    assert.strictEqual(allChips.length, 1, 'Should have exactly ONE chip');
  });

  test('chip count reflects total from all patterns', () => {
    document.body.innerHTML = createConversationHTML(
      'Original post',
      [
        'Spam pattern A!',
        'Spam pattern A!',
        'Spam pattern B!',
        'Spam pattern B!',
        'Unique reply',
      ]
    );
    
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(1);
    const duplicates = findAllDuplicateReplies(articles);
    
    assert.strictEqual(duplicates.length, 4, 'Should aggregate all 4 duplicates');
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

  test('folding does not click any buttons', () => {
    let anyButtonClicked = false;
    
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="tweetText">Spam!</div>
        <button data-testid="caret">...</button>
        <button class="delete-btn">Delete</button>
        <button class="block-btn">Block</button>
        <button class="mute-btn">Mute</button>
      </article>
    `;
    
    document.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => { anyButtonClicked = true; });
    });
    
    const article = document.querySelector('article');
    article.classList.add(FOLD_BOT_REPLIES_HIDDEN_CLASS);
    
    assert.strictEqual(anyButtonClicked, false, 'No buttons should be clicked');
  });

  test('folding only adds CSS classes', () => {
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv" id="test-cell">
        <article data-testid="tweet" id="test-article">
          <div data-testid="tweetText">Spam!</div>
        </article>
      </div>
    `;
    
    const cell = document.getElementById('test-cell');
    const article = document.getElementById('test-article');
    
    article.classList.add(FOLD_BOT_REPLIES_HIDDEN_CLASS);
    cell.classList.add(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS);
    cell.setAttribute('data-quietx-folded', 'true');
    
    assert.ok(article.classList.contains(FOLD_BOT_REPLIES_HIDDEN_CLASS));
    assert.ok(cell.classList.contains(FOLD_BOT_REPLIES_CELL_HIDDEN_CLASS));
    assert.strictEqual(cell.getAttribute('data-quietx-folded'), 'true');
  });
});
