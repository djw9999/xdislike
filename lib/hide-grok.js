/**
 * Hide @grok posts feature
 * 
 * Detects tweets that:
 * - Have @grok in the tweet body text
 * - Have "Replying to @grok" in the social context
 * - Have @grok mentioned in the social context header
 * 
 * Classification must be immediate (no timer), using DOM inspection.
 */

const GROK_HANDLE = '@grok';
const GROK_HANDLE_LOWER = '@grok';
const REPLYING_TO_GROK_PATTERNS = [
  'replying to @grok',
  '回复 @grok',
  '@grok',
];

function isElement(obj) {
  return obj && typeof obj === 'object' && typeof obj.querySelector === 'function';
}

export function isGrokPost(element) {
  if (!isElement(element)) return false;
  
  const tweetText = getTweetText(element);
  if (containsGrokMention(tweetText)) {
    return true;
  }
  
  const socialContext = getSocialContext(element);
  if (containsGrokMention(socialContext)) {
    return true;
  }
  
  if (isReplyingToGrok(element)) {
    return true;
  }
  
  return false;
}

export function getTweetText(element) {
  if (!isElement(element)) return '';
  
  const tweetTextEl = element.querySelector('[data-testid="tweetText"]');
  if (tweetTextEl) {
    return (tweetTextEl.textContent || '').toLowerCase();
  }
  
  return '';
}

export function getSocialContext(element) {
  if (!isElement(element)) return '';
  
  const socialContextEl = element.querySelector('[data-testid="socialContext"]');
  if (socialContextEl) {
    return (socialContextEl.textContent || '').toLowerCase();
  }
  
  const contextSpans = element.querySelectorAll('span');
  for (const span of contextSpans) {
    const text = (span.textContent || '').toLowerCase();
    if (text.includes('replying to') || text.includes('回复')) {
      return text;
    }
  }
  
  return '';
}

export function isReplyingToGrok(element) {
  if (!isElement(element)) return false;
  
  const socialContext = getSocialContext(element);
  const lower = socialContext.toLowerCase();
  
  for (const pattern of REPLYING_TO_GROK_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  
  const replyLinks = element.querySelectorAll('a[href*="/@grok"], a[href*="/grok"]');
  for (const link of replyLinks) {
    const parent = link.closest('[data-testid="socialContext"]') || 
                   link.closest('span');
    if (parent) {
      const parentText = (parent.textContent || '').toLowerCase();
      if (parentText.includes('replying to') || parentText.includes('回复')) {
        return true;
      }
    }
  }
  
  return false;
}

export function containsGrokMention(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower.includes(GROK_HANDLE_LOWER);
}

export function classifyTweetCell(element) {
  if (!isElement(element)) {
    return { isGrok: false, reason: null };
  }
  
  const tweetText = getTweetText(element);
  if (containsGrokMention(tweetText)) {
    return { isGrok: true, reason: 'body_mention' };
  }
  
  const socialContext = getSocialContext(element);
  if (containsGrokMention(socialContext)) {
    return { isGrok: true, reason: 'social_context' };
  }
  
  if (isReplyingToGrok(element)) {
    return { isGrok: true, reason: 'replying_to' };
  }
  
  return { isGrok: false, reason: null };
}

const STORAGE_KEY_HIDE_GROK = 'hideGrokPosts';
let hideGrokEnabled = false;
let grokObserver = null;
let processedPosts = new WeakSet();

export function getHideGrokEnabled() {
  return hideGrokEnabled;
}

export function setHideGrokEnabled(enabled) {
  hideGrokEnabled = enabled;
}

export async function loadHideGrokSetting(chrome) {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_HIDE_GROK], (result) => {
      hideGrokEnabled = !!result[STORAGE_KEY_HIDE_GROK];
      resolve(hideGrokEnabled);
    });
  });
}

export async function saveHideGrokSetting(chrome, enabled) {
  hideGrokEnabled = enabled;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_HIDE_GROK]: enabled }, resolve);
  });
}

export function hideGrokPost(element) {
  if (!isElement(element)) return false;
  if (element.dataset.quietxGrokHidden === '1') return false;
  
  element.dataset.quietxGrokHidden = '1';
  element.style.display = 'none';
  return true;
}

export function showGrokPost(element) {
  if (!isElement(element)) return false;
  if (element.dataset.quietxGrokHidden !== '1') return false;
  
  delete element.dataset.quietxGrokHidden;
  element.style.display = '';
  return true;
}

export function processGrokPosts(document) {
  if (!hideGrokEnabled) return { processed: 0, hidden: 0 };
  
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  let processed = 0;
  let hidden = 0;
  
  for (const article of articles) {
    if (processedPosts.has(article)) continue;
    processedPosts.add(article);
    processed++;
    
    if (isGrokPost(article)) {
      const cell = article.closest('[data-testid="cellInnerDiv"]') || article;
      if (hideGrokPost(cell)) {
        hidden++;
      }
    }
  }
  
  return { processed, hidden };
}

export function setupGrokObserver(document, chrome) {
  if (grokObserver) return grokObserver;
  
  grokObserver = new MutationObserver(() => {
    processGrokPosts(document);
  });
  
  grokObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  processGrokPosts(document);
  
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY_HIDE_GROK]) {
      hideGrokEnabled = !!changes[STORAGE_KEY_HIDE_GROK].newValue;
      if (hideGrokEnabled) {
        processGrokPosts(document);
      } else {
        const hiddenPosts = document.querySelectorAll('[data-quietx-grok-hidden="1"]');
        for (const post of hiddenPosts) {
          showGrokPost(post);
        }
      }
    }
  });
  
  return grokObserver;
}

export function disconnectGrokObserver() {
  if (grokObserver) {
    grokObserver.disconnect();
    grokObserver = null;
  }
}

export async function initHideGrok(document, chrome) {
  await loadHideGrokSetting(chrome);
  if (hideGrokEnabled) {
    setupGrokObserver(document, chrome);
  }
}

export function resetGrokState() {
  hideGrokEnabled = false;
  disconnectGrokObserver();
  processedPosts = new WeakSet();
}
