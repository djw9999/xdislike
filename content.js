// Create and inject the recycle bin
function createRecycleBin() {
  const bin = document.createElement("div");
  bin.id = "x-dislike-bin";
  bin.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18"/>
      <path d="M8 6V4.75A1.75 1.75 0 0 1 9.75 3h4.5A1.75 1.75 0 0 1 16 4.75V6"/>
      <path d="M18.25 6l-.9 13.05A2.1 2.1 0 0 1 15.25 21h-6.5a2.1 2.1 0 0 1-2.1-1.95L5.75 6"/>
      <path d="M10 10.5v6"/>
      <path d="M14 10.5v6"/>
    </svg>
  `;
  document.body.appendChild(bin);

  makeBinDraggable(bin);
  setupDropZone(bin);
}

// Make the bin itself draggable within the viewport
function makeBinDraggable(bin) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let nextLeft = 0;
  let nextTop = 0;
  let frame = 0;

  bin.addEventListener("pointerdown", dragStart);
  bin.addEventListener("mousedown", dragStart);
  document.addEventListener("pointerup", dragEnd);
  document.addEventListener("pointercancel", dragEnd);
  document.addEventListener("mouseup", dragEnd);
  document.addEventListener("pointermove", drag);
  document.addEventListener("mousemove", drag);
  window.addEventListener("blur", dragEnd);

  function dragStart(e) {
    if (isDragging) return;
    if (!(e.target === bin || bin.contains(e.target))) return;
    if (e.button !== undefined && e.button !== 0) return;

    const rect = bin.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    nextLeft = startLeft;
    nextTop = startTop;
    bin.style.right = "auto";
    bin.style.bottom = "auto";
    bin.style.left = `${startLeft}px`;
    bin.style.top = `${startTop}px`;
    bin.classList.add("is-dragging");
    isDragging = true;
    if (e.pointerId !== undefined) {
      try {
        bin.setPointerCapture?.(e.pointerId);
      } catch {}
    }
    e.preventDefault();
  }

  function dragEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    bin.classList.remove("is-dragging");
    if (e?.pointerId !== undefined) {
      try {
        bin.releasePointerCapture?.(e.pointerId);
      } catch {}
    }
  }

  function drag(e) {
    if (!isDragging) return;
    e.preventDefault();
    const rect = bin.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    nextLeft = clamp(startLeft + e.clientX - startX, 8, maxLeft);
    nextTop = clamp(startTop + e.clientY - startY, 8, maxTop);

    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        bin.style.left = `${nextLeft}px`;
        bin.style.top = `${nextTop}px`;
      });
    }
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Setup the bin as a drop zone
function setupDropZone(bin) {
  bin.addEventListener("dragover", (e) => {
    e.preventDefault(); // Necessary to allow dropping
    bin.classList.add("drag-over");
  });

  bin.addEventListener("dragleave", () => {
    bin.classList.remove("drag-over");
  });

  bin.addEventListener("drop", (e) => {
    e.preventDefault();
    bin.classList.remove("drag-over");

    const draggedId = e.dataTransfer.getData("text/plain");
    const draggedElement = document.querySelector(
      `[data-x-dislike-id="${draggedId}"]`
    );

    if (draggedElement) {
      dislikePost(draggedElement);
    }
  });
}

// Identify and make posts draggable
function initializePosts() {
  // Generic selector for articles. Can be refined for specific sites.
  const selectors = [
    "article",
    '[role="article"]',
    ".post",
    ".feed-item",
    'article[data-testid="tweet"]', // Twitter/X specific
  ];

  // Helper to find posts
  const findPosts = () => {
    let posts = [];
    selectors.forEach((selector) => {
      posts = [...posts, ...document.querySelectorAll(selector)];
    });
    return posts;
  };

  const posts = findPosts();

  posts.forEach((post, index) => {
    // Ad Blocking Check (Dynamic)
    if (isHideGrokPostsEnabled && (isGrokTimelinePost(post) || isGrokMentionText(post.innerText))) {
      const cell = post.closest('[data-testid="cellInnerDiv"]') || post;
      cell.classList.add("quietx-grok-post-hidden");
      cell.style.setProperty("display", "none", "important");
      return;
    }
    if (isAdBlockingEnabled && isAd(post)) {
      post.style.display = "none";
      // Mark it so we don't process it further if hidden?
      // Actually we might want to keep processing just in case we toggle it back.
      // But for now, just hiding it is enough.
      return; 
    } else {
        // If it was hidden but we disabled blocking, or it's not an ad anymore (unlikely)
        // We typically don't need to unhide proactively unless we want instant toggle effect.
        // Let's handle the instant toggle in the storage listener.
         if (post.style.display === "none" && isAd(post)) {  
             // Only restore if we are sure it was hidden by US. 
             // But actually, "display: none" might be used by Twitter too? Unlikely for main posts.
             // We'll leave unhiding logic to the toggle listener for safety.
         }
    }

    // Record tweet history only when it actually enters viewport (user "saw" it)
    if (post.matches && post.matches('article[data-testid="tweet"]')) {
      observeTweetForHistory(post);
    }

    if (post.hasAttribute("data-x-dislike-ready")) return;

    // Assign a unique ID if not present
    const uniqueId = `post-${Date.now()}-${index}`;
    post.setAttribute("data-x-dislike-id", uniqueId);
    post.setAttribute("data-x-dislike-ready", "true");
    // Initially set draggable to false, we will enable it dynamically
    // post.setAttribute('draggable', 'true'); // DISABLED DEFAULT
    post.classList.add("x-dislike-draggable");

    // SMART DRAG HANDLER:
    // Only enable dragging when the mouse is down on a "safe" area (not text, not inputs)
    post.addEventListener("mousedown", (e) => {
      // List of tags where we should NOT drag if clicked
      const noDragTags = [
        "P",
        "SPAN",
        "A",
        "INPUT",
        "TEXTAREA",
        "BUTTON",
        "IMG",
        "VIDEO",
      ];

      const targetTag = e.target.tagName;
      const isContentText = e.target.closest(
        '[lang], [dir="auto"], .css-901oao'
      ); // Twitter specific text containers often have these

      // If clicking on text or interactive elements, we want to SELECT, not DRAG
      // Twitter uses a lot of divs, so we check for text selection or interactive roles
      const selection = window.getSelection();
      const isTextSelected = selection.toString().length > 0;

      // Heuristic: If it's a link, button, or obviously text content, don't drag.
      // But we need to be careful not to block dragging the whole card from the background.

      // Better approach: Enable draggable ONLY if we are fairly sure it's a container
      // OR explicitly DISABLE it if it's text.

      // Let's toggle it:
      // If the cursor is 'text', it's text.
      const style = window.getComputedStyle(e.target);
      // Disable drag in cleanup focus mode so clicks work reliably.
      if (
        isFocusCleanupMode ||
        style.cursor === "text" ||
        noDragTags.includes(targetTag) ||
        e.target.closest("a") ||
        e.target.closest("button")
      ) {
        post.setAttribute("draggable", "false");
      } else {
        post.setAttribute("draggable", "true");
      }
    });

    // Re-enable draggable on mouseup so visual cues might return (optional)
    post.addEventListener("mouseup", () => {
      // post.setAttribute('draggable', 'true'); // Optional: reset, but leaving it false is safer until next mousedown
    });

    post.addEventListener("dragstart", (e) => {
      // Double check: if user is selecting text, preventing default here might be too late
      // but if draggable was false, this event wouldn't fire.

      e.dataTransfer.setData("text/plain", uniqueId);
      e.dataTransfer.effectAllowed = "move";
      post.classList.add("x-dislike-dragging");
    });

    post.addEventListener("dragend", () => {
      post.classList.remove("x-dislike-dragging");
    });

    // Cleanup-mode click handler
    post.addEventListener(
      "click",
      (e) => {
        if (!isFocusCleanupMode) return;

        console.log("Cleanup click detected on:", post);

        // Prevent default navigation if we are properly aiming at the card
        e.preventDefault();
        e.stopPropagation();

        shatterPost(post);
      },
      true
    ); // Capture phase to stop other listeners
  });
}

// Global Help to identify Ads
// Global Help to identify Ads
function isAd(element) {
  // User requested: judge by disclosure text only.
  // Goal: avoid missing ads (missing -> hide attempt -> Retry).
  // We keep one safety: ignore matches inside the tweet body text area.

  const isAdLabel = (t) => {
    if (!t) return false;
    const s = String(t).replace(/\s+/g, " ").trim().toLowerCase();
    return (
      s === "ad" ||
      s === "promoted" ||
      s === "sponsored" ||
      s === "广告" ||
      s === "推广" ||
      s === "赞助" ||
      s === "プロモーション" ||
      s === "広告"
    );
  };

  const isInBodyText = (node) => {
    if (!(node instanceof Element)) return false;
    // Only treat the actual tweet body as "content". Avoid broad selectors like [dir="auto"]
    // because the "Ad" badge itself often lives under dir/lang wrappers.
    return !!node.closest('[data-testid="tweetText"]');
  };

  // Fast path: exact Ad/Promoted label is typically a small span somewhere in the header.
  const spansInElement = element.querySelectorAll("span");
  for (let i = 0; i < spansInElement.length; i++) {
    const span = spansInElement[i];
    if (!(span instanceof HTMLElement)) continue;
    if (isInBodyText(span)) continue;
    const text = (span.innerText || "").trim();
    if (!text || text.length > 20) continue;
    if (isAdLabel(text)) return true;
  }

  // Fallback: also check closest cell container (some layouts render label outside the article)
  const cell = element.closest('[data-testid="cellInnerDiv"]');
  if (cell) {
    const spans = cell.querySelectorAll("span");
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      if (!(span instanceof HTMLElement)) continue;
      if (isInBodyText(span)) continue;
      const text = (span.innerText || "").trim();
      if (!text || text.length > 20) continue;
      if (isAdLabel(text)) return true;
    }
  }

  return false;
}


// ---- Grok/Premium chrome hiding ----
const GROK_CHROME_HIDDEN_CLASS = 'quietx-grok-hidden';

function isInsideTweet(el) {
  if (!el) return false;
  return !!el.closest('article[data-testid="tweet"]');
}

function hideGrokChrome() {
  if (!isHideGrokChromeEnabled) return;

  const navLinks = document.querySelectorAll('nav a[href*="/i/grok"], nav a[aria-label*="Grok"], nav a[aria-label*="grok"]');
  navLinks.forEach(el => {
    const navItem = el.closest('[role="listitem"]') || (el.closest('div[data-testid]') && el.closest('div[data-testid]').parentElement) || el;
    if (navItem && !navItem.classList.contains(GROK_CHROME_HIDDEN_CLASS)) {
      navItem.classList.add(GROK_CHROME_HIDDEN_CLASS);
    }
  });

  document.querySelectorAll('nav [role="link"]').forEach(link => {
    const text = (link.textContent || '').toLowerCase();
    if (text.includes('grok') && !text.includes('@grok')) {
      const navItem = link.closest('[role="listitem"]') || link;
      if (!navItem.classList.contains(GROK_CHROME_HIDDEN_CLASS)) {
        navItem.classList.add(GROK_CHROME_HIDDEN_CLASS);
      }
    }
  });

  const sidebarColumn = document.querySelector('[data-testid="sidebarColumn"]');
  if (sidebarColumn) {
    sidebarColumn.querySelectorAll('[aria-label*="Grok"], [aria-label*="Premium"], [aria-label*="Subscribe"]').forEach(el => {
      const section = el.closest('aside') || el.closest('section') || el.closest('[data-testid]');
      if (section && !isInsideTweet(section) && !section.classList.contains(GROK_CHROME_HIDDEN_CLASS)) {
        section.classList.add(GROK_CHROME_HIDDEN_CLASS);
      }
    });

    sidebarColumn.querySelectorAll('a[href*="/i/grok"], a[href*="/i/premium"], a[href*="premium_sign_up"], a[href*="/i/verified"]').forEach(link => {
      const promoBox = link.closest('aside') || link.closest('section') || link.closest('[data-testid="sidebarColumn"] > div > div');
      if (promoBox && !isInsideTweet(promoBox) && !promoBox.classList.contains(GROK_CHROME_HIDDEN_CLASS)) {
        promoBox.classList.add(GROK_CHROME_HIDDEN_CLASS);
      }
    });
  }

  document.querySelectorAll('[role="dialog"], [aria-modal="true"]').forEach(modal => {
    const text = (modal.textContent || '').toLowerCase();
    const hasGrokPromo = text.includes('grok') && !text.includes('@grok');
    const hasPremiumPromo = (
      text.includes('premium') ||
      text.includes('subscribe') ||
      text.includes('upgrade') ||
      text.includes('verified')
    ) && (
      text.includes('unlock') ||
      text.includes('get premium') ||
      text.includes('subscribe to') ||
      text.includes('try premium')
    );
    if ((hasGrokPromo || hasPremiumPromo) && !modal.classList.contains(GROK_CHROME_HIDDEN_CLASS)) {
      modal.classList.add(GROK_CHROME_HIDDEN_CLASS);
    }
  });

  document.querySelectorAll('[data-testid*="grok"], [aria-label*="Grok"]').forEach(el => {
    if (isInsideTweet(el)) return;
    if (el.closest('[data-testid="tweetTextarea_0"]')) return;
    if (el.closest('[data-testid="toolBar"]')) return;
    if (!el.classList.contains(GROK_CHROME_HIDDEN_CLASS)) {
      el.classList.add(GROK_CHROME_HIDDEN_CLASS);
    }
  });

  document.querySelectorAll('[data-testid="GrokDrawer"], [aria-label="Grok drawer"]').forEach(el => {
    if (!el.classList.contains(GROK_CHROME_HIDDEN_CLASS)) {
      el.classList.add(GROK_CHROME_HIDDEN_CLASS);
    }
  });
}


function stripGrokNoise(text) {
  return String(text || '')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\s+/g, ' ');
}

function isGrokHandleHref(href) {
  if (!href) return false;
  try {
    const raw = stripGrokNoise(href).trim();
    const path = raw.split('?')[0].split('#')[0].replace(/\/$/, '');
    const tail = path.replace(/^https?:\/\/(www\.)?(x|twitter)\.com/i, '');
    const last = (tail.split('/').filter(Boolean).pop() || '').toLowerCase();
    return last === 'grok';
  } catch (e) {
    return false;
  }
}

function isGrokMentionText(text) {
  if (!text) return false;
  return /(^|[^A-Za-z0-9_])@grok([^A-Za-z0-9_]|$)/i.test(stripGrokNoise(text));
}

function grokScanRoot(element) {
  if (!element || !element.closest) return null;
  if (element.closest('[data-testid="tweetTextarea_0"]')) return null;
  const cell = element.closest('[data-testid="cellInnerDiv"]');
  if (cell) return cell;
  const article = element.closest('article[data-testid="tweet"]') || (element.matches && element.matches('article[data-testid="tweet"]') ? element : null);
  return article || element;
}

function isGrokTimelinePost(element) {
  try {
    const root = grokScanRoot(element);
    if (!root) return false;

    const links = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
    for (let i = 0; i < links.length; i++) {
      if (isGrokHandleHref(links[i].getAttribute('href'))) return true;
    }

    if (root.querySelector && root.querySelector('[data-testid="UserAvatar-Container-grok"]')) return true;

    const social = root.querySelector ? root.querySelector('[data-testid="socialContext"]') : null;
    if (social && isGrokMentionText(social.innerText)) return true;

    const userName = root.querySelector ? root.querySelector('[data-testid="User-Name"]') : null;
    if (userName && isGrokMentionText(userName.innerText)) return true;

    const blob = (root.innerText || '') + '\n' + (root.textContent || '');
    if (isGrokMentionText(blob)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

function hideGrokTimelinePosts() {
  if (!isHideGrokPostsEnabled) return;
  const nodes = document.querySelectorAll('article[data-testid="tweet"], [data-testid="cellInnerDiv"]');
  nodes.forEach((node) => {
    const cell = node.closest('[data-testid="cellInnerDiv"]') || node;
    const blob = (node.innerText || '') + '\n' + (node.textContent || '');
    if (!isGrokTimelinePost(node) && !isGrokMentionText(blob)) return;
    cell.classList.add('quietx-grok-post-hidden');
    cell.style.setProperty('display', 'none', 'important');
  });
}

function showGrokTimelinePosts() {
  document.querySelectorAll('.quietx-grok-post-hidden').forEach((el) => {
    el.classList.remove('quietx-grok-post-hidden');
    if (el.style.display === 'none') el.style.removeProperty('display');
  });
}

function showGrokChrome() {
  document.querySelectorAll('.' + GROK_CHROME_HIDDEN_CLASS).forEach(el => {
    el.classList.remove(GROK_CHROME_HIDDEN_CLASS);
  });
}


// ---- Discover more / More from this author (conversation upsell) ----
// Fail closed on tweets: never hide article[data-testid="tweet"] itself.
// Hide the cellInnerDiv wrapper when it is a heading/upsell cell, not a reply.
const DISCOVER_MORE_HIDDEN_CLASS = 'quietx-discover-more-hidden';

function stripDiscoverNoise(text) {
  return String(text || '').replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
}

function isShowMoreOrExploreText(text) {
  const t = stripDiscoverNoise(text).replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/^show more( replies)?\b/i.test(t)) return true;
  if (/^show more replies\b/i.test(t)) return true;
  if (/^explore$/i.test(t)) return true;
  return false;
}

function isDiscoverMoreHeadingText(text) {
  const raw = stripDiscoverNoise(text);
  if (!raw) return false;
  if (isShowMoreOrExploreText(raw)) return false;
  if (/^\s*Discover more\b/im.test(raw)) return true;
  if (/More from this author/i.test(raw)) return true;
  if (/More from @/i.test(raw)) return true;
  if (/Sourced from across (X|Twitter)/i.test(raw)) return true;
  // v8 had no Chinese headings; Maya still names 来自 X 各处 as the same block.
  if (/发现更多/.test(raw)) return true;
  if (/来自这位作者/.test(raw)) return true;
  if (/来自此作者/.test(raw)) return true;
  if (/来自 X 各处/.test(raw)) return true;
  if (/来自 Twitter 各处/.test(raw)) return true;
  return false;
}

function cellHasDiscoverMoreHeading(cell) {
  try {
    if (!cell || !cell.querySelectorAll) return false;
    const nodes = cell.querySelectorAll('[role="heading"], h1, h2, h3, span');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.closest && el.closest('article[data-testid="tweet"]')) continue;
      if (el.closest && el.closest('nav')) continue;
      const trimmed = stripDiscoverNoise(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!trimmed || trimmed.length > 80) continue;
      if (isShowMoreOrExploreText(trimmed)) continue;
      if (/^Discover more\b/i.test(trimmed)) return true;
      if (/^More from this author$/i.test(trimmed)) return true;
      if (/^More from @/i.test(trimmed)) return true;
      if (/Sourced from across (X|Twitter)/i.test(trimmed)) return true;
      if (/^发现更多/.test(trimmed)) return true;
      if (/来自这位作者/.test(trimmed)) return true;
      if (/来自此作者/.test(trimmed)) return true;
      if (/来自 X 各处/.test(trimmed)) return true;
      if (/来自 Twitter 各处/.test(trimmed)) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function isDiscoverMoreCell(cell) {
  try {
    if (!cell || !cell.querySelector) return false;
    if (cell.closest && cell.closest('nav')) return false;
    if (cell.closest && cell.closest('[data-testid="sidebarColumn"]')) return false;
    if (cell.closest && cell.closest('[data-testid="tweetTextarea_0"]')) return false;
    if (cell.closest && cell.closest('[data-testid="toolBar"]')) return false;
    if (cell.matches && cell.matches('article[data-testid="tweet"]')) return false;

    const tweet = cell.querySelector('article[data-testid="tweet"]');
    const headingHit = cellHasDiscoverMoreHeading(cell);
    const blob = stripDiscoverNoise((cell.innerText || '') + '\n' + (cell.textContent || ''));
    const blobHit = (
      /^\s*Discover more\b/im.test(blob) ||
      /More from this author/i.test(blob) ||
      /More from @/i.test(blob) ||
      /Sourced from across (X|Twitter)/i.test(blob) ||
      /发现更多/.test(blob) ||
      /来自这位作者/.test(blob) ||
      /来自此作者/.test(blob) ||
      /来自 X 各处/.test(blob) ||
      /来自 Twitter 各处/.test(blob)
    );

    if (!headingHit && !blobHit) return false;

    if (tweet) {
      // Combined header/upsell cell only. Standalone reply tweets stay.
      return headingHit;
    }
    return headingHit || blobHit;
  } catch (e) {
    return false;
  }
}

function isConversationStatusPage(pathname) {
  try {
    let path = '';
    if (pathname != null) {
      path = String(pathname);
    } else {
      const loc = (typeof window !== 'undefined' && window.location)
        || (typeof location !== 'undefined' && location)
        || null;
      path = String((loc && loc.pathname) || '');
    }
    // Status permalink. Fullscreen media is /{user}/status/{id}/photo/{n} (CP #900).
    // Treat /photo/N as conversation so the continuation block is in-scope.
    if (/\/status\/\d+/.test(path)) return true;
    if (/\/photo\/\d+/.test(path)) return true;
    return false;
  } catch (e) {
    return false;
  }
}

function hideDiscoverMoreCell(cell) {
  if (!cell || !cell.classList) return;
  cell.classList.add(DISCOVER_MORE_HIDDEN_CLASS);
  cell.style.setProperty('display', 'none', 'important');
}

function hideDiscoverMoreModules() {
  if (!isHideDiscoverMoreEnabled) return;
  if (!isConversationStatusPage()) return;
  try {
    const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    if (!cells || !cells.length) return;
    let hidingTrail = false;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (isDiscoverMoreCell(cell)) {
        hideDiscoverMoreCell(cell);
        hidingTrail = true;
        continue;
      }
      if (hidingTrail) {
        hideDiscoverMoreCell(cell);
      }
    }
  } catch (e) {}
}

function showDiscoverMoreModules() {
  try {
    document.querySelectorAll('.' + DISCOVER_MORE_HIDDEN_CLASS).forEach((el) => {
      el.classList.remove(DISCOVER_MORE_HIDDEN_CLASS);
      if (el.style.display === 'none') el.style.removeProperty('display');
    });
  } catch (e) {}
}

// ---- Tweet history (loaded-in-feed) ----
const QUIETX_HISTORY_STORAGE_KEY = "historyTweets";
const QUIETX_HISTORY_MAX_ITEMS = 80;
const QUIETX_HISTORY_PANEL_ID = "quietx-history-panel";
const QUIETX_HISTORY_HANDLE_ID = "quietx-history-handle";
const QUIETX_HISTORY_LIST_ID = "quietx-history-list";
const QUIETX_HISTORY_HANDLE_POSITION_KEY = "historyHandlePosition";

let quietxHistoryEnabled = false;
let quietxHistoryLoaded = false;
let quietxHistoryItems = [];
let quietxHistoryById = new Map();
let quietxHistorySaveTimer = null;
let quietxHistoryRenderScheduled = false;
let quietxHistoryIntersectionObserver = null;

function initTweetHistory() {
  if (quietxHistoryEnabled) return;
  quietxHistoryEnabled = true;

  ensureHistoryPanel();
  ensureHistoryIntersectionObserver();
  loadHistoryFromStorage((items) => {
    quietxHistoryLoaded = true;
    // Merge: keep any items recorded before storage load completes.
    const merged = sanitizeHistoryItems([...quietxHistoryItems, ...items]);
    setHistoryItems(merged);
  });
}

function ensureHistoryIntersectionObserver() {
  if (quietxHistoryIntersectionObserver) return;

  quietxHistoryIntersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.intersectionRatio < 0.35) continue;
        const el = entry.target;
        if (!(el instanceof HTMLElement)) continue;
        recordTweetSeen(el);
        quietxHistoryIntersectionObserver?.unobserve(el);
      }
    },
    {
      root: null,
      threshold: [0.35],
    }
  );
}

function loadHistoryFromStorage(cb) {
  chrome.storage.local.get([QUIETX_HISTORY_STORAGE_KEY], (result) => {
    const raw = result && result[QUIETX_HISTORY_STORAGE_KEY];
    const items = Array.isArray(raw) ? raw : [];
    cb(sanitizeHistoryItems(items));
  });
}

function sanitizeHistoryItems(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" ? item.id : "";
    const url = typeof item.url === "string" ? item.url : "";
    if (!id || !url) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      url,
      author: typeof item.author === "string" ? item.author : "",
      text: typeof item.text === "string" ? item.text : "",
      thumb: typeof item.thumb === "string" ? item.thumb : "",
      seenAt: typeof item.seenAt === "number" ? item.seenAt : Date.now(),
    });
    if (out.length >= QUIETX_HISTORY_MAX_ITEMS) break;
  }
  return out;
}

function setHistoryItems(items) {
  quietxHistoryItems = items;
  quietxHistoryById = new Map(items.map((x) => [x.id, x]));
  scheduleHistorySave();
  scheduleHistoryRender();
}

function scheduleHistorySave() {
  if (!quietxHistoryEnabled) return;
  if (quietxHistorySaveTimer) window.clearTimeout(quietxHistorySaveTimer);
  quietxHistorySaveTimer = window.setTimeout(() => {
    chrome.storage.local.set(
      { [QUIETX_HISTORY_STORAGE_KEY]: quietxHistoryItems.slice(0, QUIETX_HISTORY_MAX_ITEMS) },
      () => {}
    );
  }, 1200);
}

function scheduleHistoryRender() {
  if (quietxHistoryRenderScheduled) return;
  quietxHistoryRenderScheduled = true;
  requestAnimationFrame(() => {
    quietxHistoryRenderScheduled = false;
    renderHistoryList();
  });
}

function recordTweetSeen(article) {
  if (!quietxHistoryEnabled) return;
  if (!(article instanceof HTMLElement)) return;
  if (article.getAttribute("data-quietx-history-recorded") === "1") return;
  article.setAttribute("data-quietx-history-recorded", "1");

  // Skip ads in history list to reduce noise
  try {
    if (isAd(article)) return;
  } catch {}

  const info = extractTweetInfo(article);
  if (!info) return;

  // Tag article so we can jump back later
  article.setAttribute("data-quietx-history-id", info.id);

  upsertHistoryItem(info);
}

function observeTweetForHistory(article) {
  if (!quietxHistoryEnabled) return;
  if (!(article instanceof HTMLElement)) return;
  if (article.getAttribute("data-quietx-history-observed") === "1") return;
  if (article.getAttribute("data-quietx-history-recorded") === "1") return;
  article.setAttribute("data-quietx-history-observed", "1");
  ensureHistoryIntersectionObserver();
  quietxHistoryIntersectionObserver?.observe(article);
}

function upsertHistoryItem(item) {
  const existing = quietxHistoryById.get(item.id);
  const merged = {
    ...existing,
    ...item,
    seenAt: Date.now(),
  };

  // Move to front
  quietxHistoryItems = quietxHistoryItems.filter((x) => x.id !== item.id);
  quietxHistoryItems.unshift(merged);
  if (quietxHistoryItems.length > QUIETX_HISTORY_MAX_ITEMS) {
    quietxHistoryItems.length = QUIETX_HISTORY_MAX_ITEMS;
  }
  quietxHistoryById.set(item.id, merged);

  scheduleHistorySave();
  scheduleHistoryRender();
}

function extractTweetInfo(article) {
  if (!(article instanceof HTMLElement)) return null;

  const statusLink = Array.from(article.querySelectorAll('a[href*="/status/"]')).find((a) => {
    if (!(a instanceof HTMLAnchorElement)) return false;
    return /\/status\/\d+/.test(a.getAttribute("href") || "");
  });
  if (!statusLink) return null;

  const href = statusLink.getAttribute("href") || "";
  const m = href.match(/\/status\/(\d+)/);
  if (!m) return null;
  const id = m[1];

  let pathname = "";
  try {
    const u = new URL(href, window.location.origin);
    pathname = u.pathname;
  } catch {
    pathname = href.split("?")[0] || "";
  }
  const url = `https://x.com${pathname}`;

  const userName = article.querySelector('[data-testid="User-Name"]');
  let author = "";
  if (userName) {
    const t = (userName.textContent || "").trim();
    const handle = t.match(/@\w+/)?.[0] || "";
    author = handle || t.split("\n").map((x) => x.trim()).filter(Boolean)[0] || "";
  }

  const tweetText = article.querySelector('[data-testid="tweetText"]');
  const text = (tweetText ? tweetText.textContent : article.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

  let thumb = "";
  const video = article.querySelector("video[poster]");
  if (video instanceof HTMLVideoElement && video.poster) {
    thumb = video.poster;
  }
  if (!thumb) {
    const img = Array.from(article.querySelectorAll("img")).find((im) => {
      if (!(im instanceof HTMLImageElement)) return false;
      const src = im.currentSrc || im.src || "";
      if (!src) return false;
      if (!src.includes("twimg.com")) return false;
      if (src.includes("profile_images")) return false;
      if (src.includes("emoji")) return false;
      // Prefer media images
      if (src.includes("/media/")) return true;
      return false;
    });
    if (img instanceof HTMLImageElement) thumb = img.currentSrc || img.src || "";
  }

  return {
    id,
    url,
    author,
    text,
    thumb,
    seenAt: Date.now(),
  };
}

function ensureHistoryPanel() {
  if (document.getElementById(QUIETX_HISTORY_PANEL_ID)) return;

  const handle = document.createElement("button");
  handle.id = QUIETX_HISTORY_HANDLE_ID;
  handle.type = "button";
  handle.setAttribute("aria-label", "Tweet history");
  handle.title = "Tweet history";
  handle.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12a8 8 0 1 0 2.35-5.65"/>
      <path d="M4 5.25v4h4"/>
      <path d="M12 7.75v4.7l3 1.8"/>
    </svg>
    <span class="quietx-history-sr">History</span>
  `;
  handle.addEventListener("click", () => {
    if (handle.dataset.quietxSuppressClick === "1") {
      delete handle.dataset.quietxSuppressClick;
      return;
    }
    const panel = document.getElementById(QUIETX_HISTORY_PANEL_ID);
    if (panel) panel.classList.toggle("quietx-open");
  });

  const panel = document.createElement("div");
  panel.id = QUIETX_HISTORY_PANEL_ID;
  panel.className = "quietx-history-panel";
  panel.innerHTML = `
    <div class="quietx-history-header">
      <div class="quietx-history-title">History</div>
      <button type="button" class="quietx-history-close" aria-label="Close">×</button>
    </div>
    <div class="quietx-history-body">
      <div id="${QUIETX_HISTORY_LIST_ID}" class="quietx-history-list"></div>
    </div>
  `;

  panel.querySelector(".quietx-history-close")?.addEventListener("click", () => {
    panel.classList.remove("quietx-open");
  });

  document.documentElement.appendChild(handle);
  document.documentElement.appendChild(panel);
  makeHistoryHandleDraggable(handle);
}

function makeHistoryHandleDraggable(handle) {
  let isDragging = false;
  let didMove = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let nextLeft = 0;
  let nextTop = 0;
  let frame = 0;

  const applyPosition = (left, top) => {
    const rect = handle.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    const safeLeft = clamp(left, 8, maxLeft);
    const safeTop = clamp(top, 8, maxTop);
    handle.style.right = "auto";
    handle.style.bottom = "auto";
    handle.style.left = `${safeLeft}px`;
    handle.style.top = `${safeTop}px`;
    nextLeft = safeLeft;
    nextTop = safeTop;
  };

  chrome.storage.local.get([QUIETX_HISTORY_HANDLE_POSITION_KEY], (result) => {
    const pos = result && result[QUIETX_HISTORY_HANDLE_POSITION_KEY];
    if (
      pos &&
      typeof pos.left === "number" &&
      typeof pos.top === "number"
    ) {
      applyPosition(pos.left, pos.top);
    }
  });

  const startDrag = (e) => {
    if (isDragging) return;
    if (e.button !== undefined && e.button !== 0) return;

    const rect = handle.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    nextLeft = startLeft;
    nextTop = startTop;
    didMove = false;
    isDragging = true;
    handle.classList.add("quietx-dragging");
    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {}
  };

  const moveDrag = (e) => {
    if (!isDragging) return;
    e.preventDefault();

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) didMove = true;

    const rect = handle.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    nextLeft = clamp(startLeft + dx, 8, maxLeft);
    nextTop = clamp(startTop + dy, 8, maxTop);

    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        handle.style.right = "auto";
        handle.style.bottom = "auto";
        handle.style.left = `${nextLeft}px`;
        handle.style.top = `${nextTop}px`;
      });
    }
  };

  const endDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    handle.classList.remove("quietx-dragging");
    if (e?.pointerId !== undefined) {
      try {
        handle.releasePointerCapture?.(e.pointerId);
      } catch {}
    }

    if (didMove) {
      handle.dataset.quietxSuppressClick = "1";
      chrome.storage.local.set(
        {
          [QUIETX_HISTORY_HANDLE_POSITION_KEY]: {
            left: Math.round(nextLeft),
            top: Math.round(nextTop),
          },
        },
        () => {}
      );
      setTimeout(() => {
        if (handle.dataset.quietxSuppressClick === "1") {
          delete handle.dataset.quietxSuppressClick;
        }
      }, 150);
    }
  };

  const cancelDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    handle.classList.remove("quietx-dragging");
    if (e?.pointerId !== undefined) {
      try {
        handle.releasePointerCapture?.(e.pointerId);
      } catch {}
    }
  };

  handle.addEventListener("pointerdown", startDrag);
  handle.addEventListener("mousedown", startDrag);
  handle.addEventListener("pointermove", moveDrag);
  document.addEventListener("mousemove", moveDrag);
  document.addEventListener("pointermove", moveDrag);
  handle.addEventListener("pointerup", endDrag);
  document.addEventListener("mouseup", endDrag);
  document.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", cancelDrag);
  document.addEventListener("pointercancel", cancelDrag);
  window.addEventListener("blur", cancelDrag);

  window.addEventListener(
    "resize",
    () => {
      const rect = handle.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
    },
    { passive: true }
  );
}

function renderHistoryList() {
  const list = document.getElementById(QUIETX_HISTORY_LIST_ID);
  if (!(list instanceof HTMLElement)) return;

  const items = quietxHistoryItems.slice(0, QUIETX_HISTORY_MAX_ITEMS);
  list.innerHTML = "";

  for (const item of items) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "quietx-history-item";
    row.dataset.id = item.id;

    const thumbHtml = item.thumb
      ? `<div class="quietx-history-thumb" style="background-image:url('${escapeHtmlAttr(item.thumb)}')"></div>`
      : `<div class="quietx-history-thumb quietx-history-thumb-empty"></div>`;

    row.innerHTML = `
      ${thumbHtml}
      <div class="quietx-history-meta">
        <div class="quietx-history-author">${escapeHtml(item.author || "Tweet")}</div>
        <div class="quietx-history-text">${escapeHtml(item.text || "")}</div>
      </div>
    `;

    row.addEventListener("click", () => jumpToHistoryItem(item));
    list.appendChild(row);
  }
}

function jumpToHistoryItem(item) {
  // Open the original tweet detail in a new tab (always).
  window.open(item.url, "_blank", "noopener,noreferrer");
}

function findArticleByStatusId(id) {
  const link = document.querySelector(`a[href*="/status/${CSS.escape(id)}"]`);
  if (!link) return null;
  const article = link.closest('article[data-testid="tweet"]') || link.closest("article");
  return article instanceof HTMLElement ? article : null;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttr(str) {
  // Same as escapeHtml, but keep it extra safe for inline style url('...')
  return escapeHtml(str).replaceAll(")", "%29").replaceAll("(", "%28");
}

// Global state for feed-cleanup focus mode.
let isFocusCleanupMode = false;
let clearedPostCount = 0;
let isAdBlockingEnabled = false; // State for ad blocking
let isHideGrokChromeEnabled = false; // State for Grok/Premium chrome hiding
let isHideGrokPostsEnabled = false; // State for @grok posts / Grok replies
let isHideDiscoverMoreEnabled = false; // State for Discover more / More from this author
let isHideMediaPreviewEnabled = false; // State for Home timeline image/video previews
let isHideViewsEnabled = false; // State for tweet view counts
let isHideTrendsEnabled = false; // State for right-rail Trends / What's happening
let isHideTweetGrokIconEnabled = false; // State for tweet-level Grok / Ask Grok icon
let isCleanerOwnRepliesEnabled = false; // Polar: own-post reply Cleaner (default ON when Pro)
let isFoldBotRepliesEnabled = false; // Polar: reader-side fold bot replies (default OFF)
let ownRepliesCleanerRunning = false;
let ownRepliesCleanerScheduled = false;
let ownRepliesCleanerScheduleTimer = null;
let ownRepliesCleanerLastError = '';
let ownRepliesAutoSelectFingerprint = '';
let ownRepliesPanelCollapsed = false;
let ownRepliesPanelDragBound = false;
let ownRepliesCleanerHooks = {
  sleep: null, // optional (ms) => Promise for tests
  click: null  // optional (el) => void for tests
};
let isPinFollowingEnabled = false; // State for pin following
let pinFollowingDegraded = false; // Track if we've already logged degradation

// Toggle focus cleanup mode.
document.addEventListener("keydown", (e) => {
  // Alt+S (or Option+S) to toggle
  if (e.altKey && e.code === "KeyS") {
    toggleFocusCleanupMode();
  }
  // ESC to exit
  if (e.code === "Escape" && isFocusCleanupMode) {
    toggleFocusCleanupMode(false);
  }
});

function toggleFocusCleanupMode(forceState) {
  if (typeof forceState !== "undefined") {
    isFocusCleanupMode = forceState;
  } else {
    isFocusCleanupMode = !isFocusCleanupMode;
  }

  if (isFocusCleanupMode) {
    document.body.classList.add("focus-cleanup-mode");
    showCleanupHUD();
    console.log("Mode: Focus cleanup");
  } else {
    document.body.classList.remove("focus-cleanup-mode");
    hideCleanupHUD();
    clearTargets();
    console.log("Mode: Normal");
  }

  return isFocusCleanupMode;
}

// HUD overlay
function showCleanupHUD() {
  let hud = document.getElementById("cleanup-hud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "cleanup-hud";
    document.body.appendChild(hud);
  }

  updateHUDContent();
  hud.style.display = "flex";
}

function updateHUDContent() {
  const hud = document.getElementById("cleanup-hud");
  if (!hud) return;

  // Flavor text based on count
  let flavor = "Clean up the feed.";
  if (clearedPostCount > 5) flavor = "Feed getting lighter...";
  if (clearedPostCount > 10) flavor = "Timeline calmer now.";
  if (clearedPostCount > 20) flavor = "Less noise. More signal.";

  hud.innerHTML = `
        <div class="hud-title">FEED CLEANUP ACTIVE [ESC]</div>
        <div class="hud-counter">POSTS CLEARED: ${clearedPostCount}</div>
        <div class="hud-flavor">${flavor}</div>
    `;
}

function hideCleanupHUD() {
  const hud = document.getElementById("cleanup-hud");
  if (hud) hud.style.display = "none";
}

// JS-Based Target Acquisition
document.addEventListener("mouseover", (e) => {
  if (!isFocusCleanupMode) return;

  // Find closest draggable post
  const target = e.target.closest(".x-dislike-draggable");

  if (target) {
    // Clear previous targets

    // Clear previous targets
    clearTargets();
    target.classList.add("x-dislike-target");
  }
});

function clearTargets() {
  const targets = document.querySelectorAll(".x-dislike-target");
  targets.forEach((t) => t.classList.remove("x-dislike-target"));
}

// Helper for temporary toast messages
function showToast(x, y, message) {
  let toast = document.createElement("div");
  toast.className = "x-dislike-toast";
  toast.innerText = message;

  // Position
  toast.style.position = "fixed";
  toast.style.left = x + "px";
  toast.style.top = y + "px";
  toast.style.transform = "translate(-50%, -50%)";
  toast.style.background = "rgba(0, 0, 0, 0.8)";
  toast.style.color = "#fff";
  toast.style.padding = "8px 16px";
  toast.style.borderRadius = "20px";
  toast.style.fontSize = "14px";
  toast.style.zIndex = "11000";
  toast.style.pointerEvents = "none";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translate(-50%, -50%) translateY(-10px)";
  });

  // Remove after delay
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translate(-50%, -50%) translateY(-20px)";
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// Shatter Animation and Dislike Trigger
async function shatterPost(element) {
  // Ads are "protected" on X — removing them can trigger Retry/Refresh.
  // So we block instant cleanup on ads.
  if (isAd(element)) {
    const rect = element.getBoundingClientRect();
    showToast(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      "⚠️ Ad protected (avoids Retry)"
    );
    return;
  }

  if (element.hasAttribute("data-shattered")) return;
  element.setAttribute("data-shattered", "true");
  const originalElementStyle = {
    opacity: element.style.opacity,
    pointerEvents: element.style.pointerEvents,
    transform: element.style.transform,
    transition: element.style.transition,
  };

  const rect = element.getBoundingClientRect();
  const pieces = [];

  // Clone the element node to get visual representation
  // We will create dynamic shards
  const createShard = (clipPath, moveX, moveY, rotation) => {
    const clone = element.cloneNode(true);
    clone.classList.remove("x-dislike-draggable");
    clone.classList.add("shatter-piece");

    let bg = getComputedStyle(element).backgroundColor;
    if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      bg = bodyBg === "rgb(0, 0, 0)" ? "rgb(22, 24, 28)" : "#ffffff";
    }

    clone.style.background = bg;
    clone.style.position = "fixed";
    clone.style.left = rect.left + "px";
    clone.style.top = rect.top + "px";
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";
    clone.style.margin = "0";
    clone.style.opacity = "1";
    clone.style.pointerEvents = "none";
    clone.style.zIndex = "10000";
    clone.style.clipPath = clipPath;
    clone.style.transition =
      "transform 620ms cubic-bezier(0.16, 1, 0.3, 1), opacity 520ms ease-out, filter 620ms ease-out";
    clone.style.transform = "translate3d(0, 0, 0) rotate(0deg) scale(1)";
    clone.style.willChange = "transform, opacity, filter";
    clone.style.backfaceVisibility = "hidden";

    document.body.appendChild(clone);

    // Trigger animation next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clone.style.transform = `translate3d(${moveX}px, ${moveY}px, 0) rotate(${rotation}deg) scale(0.98)`;
        clone.style.opacity = "0";
        clone.style.filter = "blur(2px) saturate(1.35)";
      });
    });

    return clone;
  };

  // Dynamic Voronoi-ish split (simplified to 6 random polygons)
  // Actually, simplest 'shatter' looking split is radial.
  // Let's use a set of pre-defined "messy" polygons for better visual "crunch"

  // Center
  pieces.push(
    createShard("polygon(30% 30%, 70% 30%, 70% 70%, 30% 70%)", 0, 0, 15)
  );

  // Top Left
  pieces.push(
    createShard("polygon(0 0, 30% 30%, 30% 70%, 0 100%)", -50, -50, -10)
  );
  // Top
  pieces.push(createShard("polygon(0 0, 100% 0, 70% 30%, 30% 30%)", 0, -80, 5));
  // Top Right
  pieces.push(
    createShard("polygon(100% 0, 100% 100%, 70% 70%, 70% 30%)", 50, -50, 10)
  );
  // Bottom Right
  pieces.push(
    createShard("polygon(70% 70%, 100% 100%, 0 100%, 30% 70%)", 50, 50, -5)
  );

  // 1a. Create Flash Effect (Make it stronger)
  const createFlash = () => {
    const flash = document.createElement("div");
    flash.classList.add("shatter-flash");
    flash.style.left = rect.left - 20 + "px";
    flash.style.top = rect.top - 20 + "px";
    flash.style.width = rect.width + 40 + "px";
    flash.style.height = rect.height + 40 + "px";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 300);
  };
  createFlash();

  // 1b. Create Shockwave (New "Cool" Effect)
  const createShockwave = () => {
    const wave = document.createElement("div");
    wave.classList.add("shockwave-ring");
    // Center it
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const size = Math.max(rect.width, rect.height) * 1.5;

    wave.style.width = size + "px";
    wave.style.height = size + "px";
    wave.style.left = centerX - size / 2 + "px";
    wave.style.top = centerY - size / 2 + "px";

    document.body.appendChild(wave);
    setTimeout(() => wave.remove(), 600);
  };
  createShockwave();

  // 1c. Create Debris Particles (More, Varied)
  const createDebris = () => {
    const particleCount = 30; // Increased
    for (let i = 0; i < particleCount; i++) {
      const p = document.createElement("div");
      p.classList.add("debris-particle");

      // Random position within the rect
      const x = rect.left + Math.random() * rect.width;
      const y = rect.top + Math.random() * rect.height;

      p.style.left = x + "px";
      p.style.top = y + "px";

      // Size variation
      const size = 2 + Math.random() * 6;
      p.style.width = size + "px";
      p.style.height = size + "px";

      // Color variation (White, Cyan, Purple for logic)
      const colors = ["#ffffff", "#a8d1ff", "#e0b0ff"];
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.boxShadow = `0 0 ${size}px ${p.style.background}`;

      // Physics for animation
      // dx/dy: random direction outwards
      const angle = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 200;
      const dx = Math.cos(angle) * dist + "px";
      const dy = Math.sin(angle) * dist + "px";

      p.style.setProperty("--dx", dx);
      p.style.setProperty("--dy", dy);
      p.style.setProperty("--dr", Math.random() * 360 + "deg");

      // Randomize duration slightly
      const dur = 0.4 + Math.random() * 0.4;
      p.style.animation = `debris-fly ${dur}s ease-out forwards`;

      document.body.appendChild(p);
      pieces.push(p);
    }
  };
  createDebris();

  // 2. Hide original NOW
  element.style.transition =
    "opacity 180ms ease-out, transform 220ms cubic-bezier(0.16, 1, 0.3, 1)";
  element.style.transform = "scale(0.992)";
  element.style.opacity = "0";
  element.style.pointerEvents = "none";

  // 3. Create Aftermath Glow (Zen moment)
  const createZenGlow = () => {
    const glow = document.createElement("div");
    glow.style.position = "fixed";
    glow.style.left = rect.left + rect.width / 2 - 50 + "px";
    glow.style.top = rect.top + rect.height / 2 - 50 + "px";
    glow.style.width = "100px";
    glow.style.height = "100px";
    glow.style.background =
      "radial-gradient(circle, rgba(200, 240, 255, 0.4) 0%, rgba(200, 240, 255, 0) 70%)";
    glow.style.borderRadius = "50%";
    glow.style.zIndex = "9999";
    glow.style.pointerEvents = "none";
    glow.style.animation = "zen-fade 1.5s ease-out forwards";
    document.body.appendChild(glow);
    setTimeout(() => glow.remove(), 1500);

  };

  // Trigger Dislike Logic
  const success = await dislikePost(element, true);

  if (success) {
    await new Promise((r) => setTimeout(r, 500));

    element.style.opacity = originalElementStyle.opacity || "1";
    element.style.transform = originalElementStyle.transform;
    element.style.transition = originalElementStyle.transition;
    element.removeAttribute("data-shattered");
    element.style.pointerEvents = originalElementStyle.pointerEvents || "auto";

    pieces.forEach((p) => p.remove());
  } else {
    // Fallback: If it failed to trigger native dislike, WE hide it.
    element.style.transition =
      "opacity 360ms ease-out, transform 420ms cubic-bezier(0.16, 1, 0.3, 1)";
    element.style.transform = "scale(0.985) translate3d(0, -4px, 0)";
    element.style.opacity = "0";
    setTimeout(() => {
      element.remove();
      createZenGlow(); // Show glow after removal
    }, 500);
    pieces.forEach((p) => setTimeout(() => p.remove(), 1000));
  }
}

// Helper to wait for Twitter to swap the content
function waitForFeedback(element) {
  return new Promise((resolve) => {
    // Keywords for Undo/Thanks in English and Chinese
    // Also check for "Retry" / "Refresh" which happens on Ads sometimes
    const isFeedbackVisible = () => {
      const text = element.innerText;
      // Success keywords
      const success =
        text.includes("Undo") ||
        text.includes("撤销") ||
        text.includes("Thanks") ||
        text.includes("谢谢") ||
        text.includes("tuned") ||
        text.includes("调整");

      // Failure/Protection keywords
      const error =
        text.includes("Retry") ||
        text.includes("重试") ||
        text.includes("Refresh") ||
        text.includes("刷新") ||
        text.includes("wrong") ||
        text.includes("错误");

      return success || error ? (success ? "success" : "error") : false;
    };

    // Immediate check
    let status = isFeedbackVisible();
    if (status) {
      resolve(status);
      return;
    }

    // Observer to watch for changes
    const observer = new MutationObserver(() => {
      status = isFeedbackVisible();
      if (status) {
        observer.disconnect();
        resolve(status);
      }
    });

    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Timeout fallback
    setTimeout(() => {
      observer.disconnect();
      resolve("timeout"); // Treat timeout as safe to show (or remove)?
    }, 2000);
  });
}

function createCustomCursor() {
  // CSS handles the crosshair, but we could add a floating div here if needed.
}

// Action to perform when a post is dropped or shot
async function dislikePost(element, isShatter = false) {
  // OPTIMISTIC REWARD:
  // If it's an instant cleanup, increment immediately so the HUD stays responsive.
  if (isShatter) {
    clearedPostCount++;
    updateHUDContent();
  }

  // Check if it's a tweet and try to trigger the "Not interested" flow
  // (Existing dislikePost implementation...)

  // Speed optimization: if isShatter, skip the slower native flow and remove visually.
  // So we skip the slow API interaction and just perform the visual removal below.
  if (!isShatter && element.matches('article[data-testid="tweet"]')) {
    const success = await handleTwitterDislike(element);
    if (success) {
      // Wait for result
      const feedbackStatus = await waitForFeedback(element);

      // If it was a clean success (Undo/Thanks), show it
      if (feedbackStatus === "success") {
        element.style.opacity = "1";
        return true;
      }

      // If detection failed or ad protection kicked in
      console.log("X Dislike: Feedback check failed or protection detected.");
    }
  }

  // Fallback / Visual feedback for generic posts or if Twitter flow fails
  console.log("X Dislike: Falling back to local removal");

  if (!isShatter) {
    element.style.transition =
      "opacity 320ms ease-out, transform 420ms cubic-bezier(0.16, 1, 0.3, 1), filter 360ms ease-out";
    element.style.transform = "translate3d(0, -8px, 0) scale(0.94) rotate(3deg)";
    element.style.filter = "blur(3px)";
    element.style.opacity = "0";
  } else {
    element.style.opacity = "0";
  }

  setTimeout(() => {
    element.remove();
  }, 500);

  return false;
}

// Twitter specific logic
// Twitter specific logic
async function handleTwitterDislike(tweetElement) {
  try {
    // 1. Find the "More" button (caret)
    const moreButton = tweetElement.querySelector(
      '[data-testid="caret"], [aria-label="More"], [aria-label="更多"], [aria-haspopup="menu"]'
    );
    if (!moreButton) {
      console.warn("X Dislike: More button not found on tweet", tweetElement);
      return false;
    }

    // Scroll into view if needed to ensure click works
    moreButton.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "instant",
    });
    moreButton.click();

    // 2. Wait for the menu to appear (Wait loop with increased patience)
    let menuItems = [];
    for (let i = 0; i < 15; i++) {
      // Try for 1.5 seconds
      await new Promise((r) => setTimeout(r, 100));
      menuItems = document.querySelectorAll('[role="menuitem"]');
      if (menuItems.length > 0) break;
    }

    if (menuItems.length === 0) {
      console.warn("X Dislike: Menu did not appear after click");
      return false;
    }

    // 3. Find "Not interested" menu item
    let targetBtn = null;
    const menuTexts = [...menuItems].map((i) =>
      (i.innerText || i.textContent).trim()
    );
    console.log("X Dislike: Menu Items scan:", menuTexts);

    // Strategy: Check logic
    const isNotInterested = (text) => {
      if (!text) return false;
      // Normalize text: remove extra spaces and newlines
      const clean = text.replace(/\s+/g, " ").trim().toLowerCase();

      return (
        clean.includes("not interested in this post") || // Exact match requested by user
        clean.includes("not interested") ||
        clean.includes("不感兴趣") ||
        clean.includes("see less often") ||
        clean.includes("减少") ||
        clean.includes("mute") ||
        clean.includes("block") ||
        clean.includes("屏蔽")
      );
    };

    // Find best match
    for (const item of menuItems) {
      const text = item.innerText || item.textContent;
      if (isNotInterested(text)) {
        targetBtn = item;
        // Prefer "Not Interested" over "Mute" if both exist (rare)
        if (
          text.toLowerCase().includes("not interested") ||
          text.includes("不感兴趣")
        )
          break;
      }
    }

    if (targetBtn) {
      targetBtn.click();
      console.log('X Dislike: Clicked "Not interested"');
      return true;
    } else {
      console.log(
        "X Dislike: Target option not found. Menu items:",
        [...menuItems].map((i) => i.innerText)
      );
      // Attempt to close menu by clicking the more button again or body
      moreButton.click();
      return false;
    }
  } catch (e) {
    console.error("Error in Twitter dislike flow:", e);
    return false;
  }
}

// ---- Pin Following feature ----
// Full document load of /home (performance navigation type "navigate" or
// "reload") may pin Following once, and only while For you is the sole
// selected tab. SPA returns (tweet back, community, in-app nav via
// pushState/replaceState/popstate) never click tabs. Any selected tab
// other than sole For you is hands-off. After Following is selected,
// stop the initial retry immediately. Click at most once for the cold
// pin; a few tab-wait attempts then stop. Never yank a For you the
// user just clicked.
//
// Real X: after F5, Following can land then X flips back to For you at
// ~8s. For ~12s after a full /home load, if For you becomes the sole
// selected tab WITHOUT a user click on that tab, click Following once
// more then stop. A click on the For you tab sets userChoseForYou and
// never re-pins. SPA history never clicks. Max one extra click.
let pinRetryTimer = null;
let flipWatchTimer = null;
let coldPinDone = false;
let pinClickIssued = false;
let extraPinIssued = false;
let fullLoadHandled = false;
let spaHooksInstalled = false;
let fullLoadHooksInstalled = false;
let userChoseForYou = false;
let spaLocked = false;
let sawFollowingSelected = false;
let flipWatchTicks = 0;
const PIN_MAX_ATTEMPTS = 5;
const PIN_FLIP_WATCH_MS = 12000;
const PIN_FLIP_WATCH_INTERVAL_MS = 200;
const PIN_FLIP_WATCH_TICKS = PIN_FLIP_WATCH_MS / PIN_FLIP_WATCH_INTERVAL_MS;

function isOnHomePage() {
  const path = window.location.pathname;
  return path === '/home' || path === '/' || path === '';
}

function getDocumentNavigationType() {
  try {
    const perf = window.performance;
    if (perf && typeof perf.getEntriesByType === 'function') {
      const nav = perf.getEntriesByType('navigation')[0];
      if (nav && typeof nav.type === 'string' && nav.type) return nav.type;
    }
  } catch (e) {}
  try {
    const n = window.performance && window.performance.navigation;
    if (n && typeof n.type === 'number') {
      if (n.type === 1) return 'reload';
      if (n.type === 2) return 'back_forward';
      if (n.type === 0) return 'navigate';
    }
  } catch (e) {}
  return '';
}

function isFullDocumentNavigation() {
  const type = getDocumentNavigationType();
  return type === 'navigate' || type === 'reload';
}

function hasColdPinned() {
  if (coldPinDone) return true;
  try {
    if (window.sessionStorage.getItem('quietxDidColdPin') === '1') return true;
  } catch (e) {}
  return false;
}

function markColdPinned() {
  coldPinDone = true;
  try {
    window.sessionStorage.setItem('quietxDidColdPin', '1');
  } catch (e) {}
  try {
    if (chrome.storage && chrome.storage.session) {
      chrome.storage.session.set({ quietxDidColdPin: true });
    }
  } catch (e) {}
}

function clearColdPinned() {
  coldPinDone = false;
  pinClickIssued = false;
  extraPinIssued = false;
  userChoseForYou = false;
  spaLocked = false;
  sawFollowingSelected = false;
  try {
    window.sessionStorage.removeItem('quietxDidColdPin');
  } catch (e) {}
  try {
    if (chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove('quietxDidColdPin');
    }
  } catch (e) {}
}

function findTimelineTabs() {
  const tablists = document.querySelectorAll('[role="tablist"]');
  for (const tablist of tablists) {
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    if (tabs.length < 2) continue;
    const firstLabel = getTabLabel(tabs[0]);
    const secondLabel = getTabLabel(tabs[1]);
    if (isForYouLabel(firstLabel) && isFollowingLabel(secondLabel)) {
      return { forYouTab: tabs[0], followingTab: tabs[1], tablist };
    }
    if (isFollowingLabel(firstLabel) && isForYouLabel(secondLabel)) {
      return { forYouTab: tabs[1], followingTab: tabs[0], tablist };
    }
  }
  return null;
}

function isTabSelected(tab) {
  if (!(tab instanceof HTMLElement)) return false;
  return tab.getAttribute('aria-selected') === 'true';
}

function isOnlyForYouSelected(tabs) {
  if (!tabs || !tabs.tablist) return false;
  const selected = Array.from(tabs.tablist.querySelectorAll('[role="tab"]')).filter(isTabSelected);
  return selected.length === 1 && selected[0] === tabs.forYouTab;
}

function stopPinRetry() {
  if (pinRetryTimer) {
    clearInterval(pinRetryTimer);
    pinRetryTimer = null;
  }
}

function stopFlipWatch() {
  if (flipWatchTimer) {
    clearInterval(flipWatchTimer);
    flipWatchTimer = null;
  }
}

function onTimelineTabClickCapture(e) {
  if (!e || !e.target) return;
  let node = e.target;
  if (typeof node.closest === 'function') {
    node = node.closest('[role="tab"]');
  }
  if (!node) return;
  const tabs = findTimelineTabs();
  if (!tabs) return;
  if (node === tabs.forYouTab || (tabs.forYouTab && tabs.forYouTab.contains(node))) {
    userChoseForYou = true;
    markColdPinned();
    stopPinRetry();
    stopFlipWatch();
  }
}

function ensureForYouClickGuard() {
  if (document && typeof document.addEventListener === 'function') {
    document.addEventListener('click', onTimelineTabClickCapture, true);
    document.addEventListener('pointerdown', onTimelineTabClickCapture, true);
  }
}
ensureForYouClickGuard();

function tryPinFollowing() {
  if (!isPinFollowingEnabled) return false;
  if (!isOnHomePage()) return false;
  if (spaLocked || userChoseForYou) {
    markColdPinned();
    stopPinRetry();
    return false;
  }
  if (hasColdPinned()) return false;

  const tabs = findTimelineTabs();
  if (!tabs) {
    if (!pinFollowingDegraded) {
      console.log("Better X: Pin Following degraded - tabs not found");
      pinFollowingDegraded = true;
    }
    return false;
  }

  if (isTabSelected(tabs.followingTab)) {
    sawFollowingSelected = true;
    markColdPinned();
    stopPinRetry();
    return true;
  }

  if (!isOnlyForYouSelected(tabs)) {
    markColdPinned();
    stopPinRetry();
    return false;
  }

  if (pinClickIssued) {
    markColdPinned();
    stopPinRetry();
    return false;
  }

  tabs.followingTab.click();
  pinClickIssued = true;
  markColdPinned();
  stopPinRetry();
  console.log("Better X: Clicked Following tab (cold start)");
  if (isTabSelected(tabs.followingTab)) sawFollowingSelected = true;
  return isTabSelected(tabs.followingTab);
}

function startPinFollowingOnEntry() {
  stopPinRetry();
  if (!isPinFollowingEnabled) return;
  if (!isOnHomePage()) return;
  if (spaLocked || userChoseForYou || hasColdPinned()) return;

  let attempts = 0;

  const tick = () => {
    attempts++;
    if (!isPinFollowingEnabled || !isOnHomePage() || hasColdPinned() || spaLocked || userChoseForYou) {
      stopPinRetry();
      return;
    }
    const pinned = tryPinFollowing();
    if (pinned || hasColdPinned()) {
      stopPinRetry();
      if (pinned) {
        markColdPinned();
        console.log("Better X: Following pinned after", attempts, "attempts");
      }
      return;
    }
    if (attempts >= PIN_MAX_ATTEMPTS) {
      stopPinRetry();
      markColdPinned();
    }
  };

  tick();
  if (!hasColdPinned() && !pinRetryTimer) {
    pinRetryTimer = setInterval(tick, 200);
  }
}

function maybeRepinAfterForYouFlip() {
  if (spaLocked || userChoseForYou || extraPinIssued) {
    stopFlipWatch();
    return;
  }
  if (!isPinFollowingEnabled || !isOnHomePage()) return;
  const tabs = findTimelineTabs();
  if (!tabs) return;
  if (isTabSelected(tabs.followingTab)) {
    sawFollowingSelected = true;
    return;
  }
  if (!sawFollowingSelected) return;
  if (!isOnlyForYouSelected(tabs)) return;
  tabs.followingTab.click();
  extraPinIssued = true;
  pinClickIssued = true;
  markColdPinned();
  stopFlipWatch();
  console.log("Better X: Re-pinned Following after For you auto-flip");
}

function startFlipWatch() {
  stopFlipWatch();
  if (!isPinFollowingEnabled || !isOnHomePage()) return;
  if (userChoseForYou || spaLocked) return;
  extraPinIssued = false;
  flipWatchTicks = 0;
  flipWatchTimer = setInterval(() => {
    flipWatchTicks++;
    maybeRepinAfterForYouFlip();
    if (flipWatchTicks >= PIN_FLIP_WATCH_TICKS) stopFlipWatch();
  }, PIN_FLIP_WATCH_INTERVAL_MS);
}

function onSpaHistoryChange() {
  spaLocked = true;
  markColdPinned();
  stopPinRetry();
  stopFlipWatch();
}

function onHomeDocumentShow() {
  if (!isPinFollowingEnabled) return;
  if (!isOnHomePage()) return;
  if (!isFullDocumentNavigation()) return;
  if (fullLoadHandled) return;
  fullLoadHandled = true;
  clearColdPinned();
  startPinFollowingOnEntry();
  startFlipWatch();
}

function setupFullLoadListeners() {
  if (fullLoadHooksInstalled) return;
  fullLoadHooksInstalled = true;
  window.addEventListener('pageshow', onHomeDocumentShow);
  window.addEventListener('load', onHomeDocumentShow);
}

function setupNavigationListener() {
  if (spaHooksInstalled) return;
  spaHooksInstalled = true;
  let currentPath = window.location.pathname;

  const checkNavigation = () => {
    const newPath = window.location.pathname;
    if (newPath === currentPath) return;
    currentPath = newPath;
    onSpaHistoryChange();
  };

  const observer = new MutationObserver(checkNavigation);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', () => {
    onSpaHistoryChange();
    setTimeout(checkNavigation, 50);
  });
  ['pushState', 'replaceState'].forEach((method) => {
    const orig = history[method];
    history[method] = function () {
      const ret = orig.apply(this, arguments);
      onSpaHistoryChange();
      setTimeout(checkNavigation, 0);
      return ret;
    };
  });
}

function initPinFollowing() {
  chrome.storage.local.get(['pinFollowing'], (r) => {
    isPinFollowingEnabled = r.pinFollowing !== false;
    setupNavigationListener();
    setupFullLoadListeners();
    if (!isPinFollowingEnabled) return;
    console.log("Better X: Pin Following Enabled");

    if (!isOnHomePage()) {
      markColdPinned();
      return;
    }
    if (isFullDocumentNavigation()) {
      onHomeDocumentShow();
      return;
    }
    try {
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(['quietxDidColdPin'], (s) => {
          if (s && s.quietxDidColdPin) markColdPinned();
        });
      }
    } catch (e) {}
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pinFollowing !== undefined) {
      isPinFollowingEnabled = !!changes.pinFollowing.newValue;
      console.log("Better X: Pin Following switched to:", isPinFollowingEnabled);
      pinFollowingDegraded = false;
      stopPinRetry();
      stopFlipWatch();
      if (isPinFollowingEnabled && isOnHomePage() && isFullDocumentNavigation() && !hasColdPinned()) {
        startPinFollowingOnEntry();
      }
    }
  });
}

// Initialize
let quietxStarted = false;

let quietxLicenseWaiter = false;


const MEDIA_PREVIEW_HIDDEN_CLASS = 'quietx-media-preview-hidden';

function isTweetChromeContainer(node, article) {
  if (!node || node === article) return true;
  if (!node.querySelector) return false;
  if (node.querySelector('[data-testid="tweetText"]')) return true;
  if (node.querySelector('[data-testid="User-Name"]')) return true;
  if (node.querySelector('[data-testid="reply"]') ||
      node.querySelector('[data-testid="retweet"]') ||
      node.querySelector('[data-testid="like"]')) return true;
  return false;
}

function mediaPreviewBlock(el) {
  if (!el || !el.closest) return el;
  const article = el.closest('article[data-testid="tweet"]');
  if (!article || !(article instanceof HTMLElement)) return el;
  let node = el;
  let last = el;
  while (node && node.parentElement && node.parentElement !== article) {
    const parent = node.parentElement;
    if (isTweetChromeContainer(parent, article)) break;
    last = parent;
    node = parent;
  }
  return last;
}

function hideMediaPreviewNode(el) {
  if (!el || !el.classList) return;
  el.classList.add(MEDIA_PREVIEW_HIDDEN_CLASS);
  el.style.setProperty('display', 'none', 'important');
  el.style.setProperty('height', '0', 'important');
  el.style.setProperty('min-height', '0', 'important');
  el.style.setProperty('max-height', '0', 'important');
  el.style.setProperty('padding', '0', 'important');
  el.style.setProperty('margin', '0', 'important');
  el.style.setProperty('overflow', 'hidden', 'important');
  el.style.setProperty('border', '0', 'important');
}

function hideHomeMediaPreviews() {
  if (!isHideMediaPreviewEnabled || !isOnHomePage()) {
    showHomeMediaPreviews();
    return;
  }
  try {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      if (!(article instanceof HTMLElement)) continue;
      const media = article.querySelectorAll(
        '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="previewInterstitial"]'
      );
      for (let j = 0; j < media.length; j++) {
        const el = media[j];
        if (!el || !el.classList) continue;
        if (el.closest && el.closest('[data-testid="Tweet-User-Avatar"]')) continue;
        hideMediaPreviewNode(mediaPreviewBlock(el));
      }
    }
  } catch (e) {}
}

function showHomeMediaPreviews() {
  try {
    document.querySelectorAll('.' + MEDIA_PREVIEW_HIDDEN_CLASS).forEach((el) => {
      el.classList.remove(MEDIA_PREVIEW_HIDDEN_CLASS);
      if (!el.style) return;
      el.style.removeProperty('display');
      el.style.removeProperty('height');
      el.style.removeProperty('min-height');
      el.style.removeProperty('max-height');
      el.style.removeProperty('padding');
      el.style.removeProperty('margin');
      el.style.removeProperty('overflow');
      el.style.removeProperty('border');
    });
  } catch (e) {}
}


const VIEWS_HIDDEN_CLASS = 'quietx-views-hidden';

function isViewsHref(href) {
  return /\/analytics(\?|$|\/)/.test(String(href || ''));
}

const SOCIAL_ACTION_SELECTOR = '[data-testid="reply"], [data-testid="retweet"], [data-testid="like"]';

function containsSocialActions(el) {
  if (!el) return false;
  try {
    if (typeof el.matches === 'function' && el.matches(SOCIAL_ACTION_SELECTOR)) return true;
    if (typeof el.querySelector === 'function' && el.querySelector(SOCIAL_ACTION_SELECTOR)) return true;
  } catch (e) {}
  return false;
}

function isViewsLabel(text) {
  const t = String(text || '');
  if (!t) return false;
  if (/view quotes/i.test(t)) return false;
  // Composite action-bar labels list several metrics; never treat as views-only.
  if (/\breplies?\b|\breposts?\b|\blikes?\b|\bbookmarks?\b/i.test(t)) return false;
  if (/回复|转帖|转发|喜欢/.test(t)) return false;
  if (/\b\d[\d,.]*[kmb]?\s*views?\b/i.test(t)) return true;
  if (/\bviews?\b.*analytics/i.test(t)) return true;
  if (/次查看/.test(t)) return true;
  if (/浏览量/.test(t)) return true;
  return false;
}

function isViewsControl(el) {
  if (!el || !el.getAttribute) return false;
  // Fail closed: a node that contains reply/rt/like is never a views-only control.
  if (containsSocialActions(el)) return false;
  if (el.closest && el.closest('[data-testid="Tweet-User-Avatar"]')) return false;
  if (isViewsHref(el.getAttribute('href'))) return true;
  if (isViewsLabel(el.getAttribute('aria-label'))) return true;
  return false;
}

function viewsBlock(el, article) {
  if (!el) return null;
  if (containsSocialActions(el)) return null;
  if (!article) return el;
  let node = el;
  let last = el;
  while (node && node.parentElement && node.parentElement !== article) {
    const parent = node.parentElement;
    if (containsSocialActions(parent)) break;
    last = parent;
    node = parent;
  }
  if (containsSocialActions(last)) return null;
  return last;
}

function hideViewsNode(el) {
  if (!el || !el.classList) return;
  // Fail closed: never hide the action bar or any node that contains social actions.
  if (containsSocialActions(el)) return;
  el.classList.add(VIEWS_HIDDEN_CLASS);
  el.style.setProperty('display', 'none', 'important');
}

function hideTweetViews() {
  if (!isHideViewsEnabled) {
    showTweetViews();
    return;
  }
  try {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      if (!(article instanceof HTMLElement)) continue;
      const nodes = article.querySelectorAll('a[href*="/analytics"], [aria-label]');
      for (let j = 0; j < nodes.length; j++) {
        const el = nodes[j];
        if (!isViewsControl(el)) continue;
        hideViewsNode(viewsBlock(el, article));
      }
    }
  } catch (e) {}
}

function showTweetViews() {
  try {
    document.querySelectorAll('.' + VIEWS_HIDDEN_CLASS).forEach((el) => {
      el.classList.remove(VIEWS_HIDDEN_CLASS);
      if (el.style && el.style.display === 'none') el.style.removeProperty('display');
    });
  } catch (e) {}
}


const TWEET_GROK_ICON_HIDDEN_CLASS = 'quietx-tweet-grok-hidden';

function isTweetGrokIconNavOrSidebar(el) {
  if (!el || !el.closest) return false;
  try {
    if (el.closest('nav')) return true;
    if (el.closest('[data-testid="sidebarColumn"]')) return true;
  } catch (e) {}
  return false;
}

function isTweetGrokIconLabel(text) {
  const t = String(text || '');
  if (!t) return false;
  // Composite action-bar labels list several metrics; never treat as grok-icon-only.
  if (/\breplies?\b|\breposts?\b|\blikes?\b|\bbookmarks?\b/i.test(t)) return false;
  if (/回复|转帖|转发|喜欢/.test(t)) return false;
  if (/grok/i.test(t)) return true;
  return false;
}

function isTweetGrokIconHref(href) {
  const s = String(href || '');
  if (!s) return false;
  const path = s.split('?')[0].split('#')[0];
  if (/\/i\/grok(\/|$)/i.test(path)) return true;
  if (/\/grok(\/|$)/i.test(path)) return true;
  return false;
}

// Real X: Grok lives in the tweet HEADER (left of …), not the action bar.
// Never hide caret / More / timestamp / username / social actions / the whole header.
const TWEET_GROK_CARET_MORE_SELECTOR =
  '[data-testid="caret"], [aria-label="More"], [aria-label="更多"]';
const TWEET_GROK_UNSAFE_HIDE_SELECTOR =
  TWEET_GROK_CARET_MORE_SELECTOR + ', [data-testid="User-Name"], time, [datetime]';

function containsTweetGrokUnsafeToHide(el) {
  if (!el) return false;
  try {
    if (typeof el.matches === 'function' && el.matches(TWEET_GROK_UNSAFE_HIDE_SELECTOR)) return true;
    if (typeof el.querySelector === 'function' && el.querySelector(TWEET_GROK_UNSAFE_HIDE_SELECTOR)) return true;
  } catch (e) {}
  return false;
}

// Self or descendant is caret / More. Never hide that node.
function nodeContainsCaretOrMore(el) {
  if (!el) return false;
  try {
    if (typeof el.matches === 'function' && el.matches(TWEET_GROK_CARET_MORE_SELECTOR)) return true;
    if (typeof el.querySelector === 'function' && el.querySelector(TWEET_GROK_CARET_MORE_SELECTOR)) return true;
  } catch (e) {}
  return false;
}

function isTweetGrokIconControl(el) {
  if (!el || !el.getAttribute) return false;
  // Fail closed: a node that contains reply/rt/like is never a grok-icon-only control.
  if (containsSocialActions(el)) return false;
  // Fail closed: never treat caret / More (self or descendant) as a grok control.
  if (nodeContainsCaretOrMore(el)) return false;
  // Fail closed: never hide caret / More / timestamp / username.
  if (containsTweetGrokUnsafeToHide(el)) return false;
  // Fail closed: never hide the tweet action [role=group].
  try {
    if (el.getAttribute('role') === 'group') return false;
    if (typeof el.matches === 'function' && el.matches('[role="group"]')) return false;
  } catch (e) {}
  if (isTweetGrokIconNavOrSidebar(el)) return false;
  try {
    if (!el.closest || !el.closest('article[data-testid="tweet"]')) return false;
    if (el.closest('[data-testid="Tweet-User-Avatar"]')) return false;
    if (el.closest('[data-testid="tweetText"]')) return false;
    if (el.closest('[data-testid="User-Name"]')) return false;
    if (el.closest('[data-testid="socialContext"]')) return false;
    if (el.closest('[data-testid="UserAvatar-Container-grok"]')) return false;
    if (el.closest('[data-testid="caret"]')) return false;
    if (el.closest('[aria-label="More"], [aria-label="更多"]')) return false;
    if (el.closest('time, [datetime]')) return false;
  } catch (e) {
    return false;
  }
  if (isTweetGrokIconLabel(el.getAttribute('aria-label'))) return true;
  if (isTweetGrokIconLabel(el.getAttribute('title'))) return true;
  if (isTweetGrokIconLabel(el.getAttribute('data-testid'))) return true;
  if (isTweetGrokIconHref(el.getAttribute('href'))) return true;
  return false;
}

// Unused leftover: parent climb hid a shared sparkle+… wrapper (caret width 0).
// Keep exported for tests; hideTweetGrokIcons must NOT call this.
function tweetGrokIconBlock(el, article) {
  if (!el) return null;
  if (containsSocialActions(el)) return null;
  if (containsTweetGrokUnsafeToHide(el)) return null;
  try {
    if (el.getAttribute && el.getAttribute('role') === 'group') return null;
    if (typeof el.matches === 'function' && el.matches('[role="group"]')) return null;
  } catch (e) {
    return null;
  }
  if (!article) return el;
  let node = el;
  let last = el;
  while (node && node.parentElement && node.parentElement !== article) {
    const parent = node.parentElement;
    try {
      if (parent.getAttribute && parent.getAttribute('role') === 'group') break;
      if (typeof parent.matches === 'function' && parent.matches('[role="group"]')) break;
    } catch (e) {}
    if (containsSocialActions(parent)) break;
    if (containsTweetGrokUnsafeToHide(parent)) break;
    if (isTweetGrokIconNavOrSidebar(parent)) break;
    last = parent;
    node = parent;
  }
  if (containsSocialActions(last) || containsTweetGrokUnsafeToHide(last)) return el;
  return last;
}

function hideTweetGrokIconNode(el) {
  if (!el || !el.classList) return;
  // Fail closed: never hide a node that is caret/More or whose querySelector finds caret/More.
  if (nodeContainsCaretOrMore(el)) return;
  // Fail closed: never hide the action bar or any node that contains social actions.
  if (containsSocialActions(el)) return;
  // Fail closed: never hide caret / More / timestamp / username.
  if (containsTweetGrokUnsafeToHide(el)) return;
  if (el.getAttribute && el.getAttribute('role') === 'group') return;
  if (isTweetGrokIconNavOrSidebar(el)) return;
  el.classList.add(TWEET_GROK_ICON_HIDDEN_CLASS);
  el.style.setProperty('display', 'none', 'important');
}

function hideTweetGrokIcons() {
  if (!isHideTweetGrokIconEnabled) {
    showTweetGrokIcons();
    return;
  }
  try {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      if (!(article instanceof HTMLElement)) continue;
      const nodes = article.querySelectorAll('a[href], [aria-label], [title], [data-testid], button');
      for (let j = 0; j < nodes.length; j++) {
        const el = nodes[j];
        if (!isTweetGrokIconControl(el)) continue;
        // Do not climb. Hide only the matched Grok control itself.
        // tweetGrokIconBlock used to hide a shared wrapper of sparkle + … (caret width 0).
        hideTweetGrokIconNode(el);
      }
    }
  } catch (e) {}
}

function showTweetGrokIcons() {
  try {
    document.querySelectorAll('.' + TWEET_GROK_ICON_HIDDEN_CLASS).forEach((el) => {
      el.classList.remove(TWEET_GROK_ICON_HIDDEN_CLASS);
      if (el.style && el.style.display === 'none') el.style.removeProperty('display');
    });
  } catch (e) {}
}


const TRENDS_HIDDEN_CLASS = 'quietx-trends-hidden';

function trendsHeadingText(el) {
  if (!el) return '';
  return stripDiscoverNoise(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
}

function isTrendsHeadingText(text) {
  const raw = stripDiscoverNoise(text).replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  if (raw.length > 80) return false;
  if (/^who to follow$/i.test(raw)) return false;
  if (/^推荐关注$/.test(raw)) return false;
  if (/^认识这些人$/.test(raw)) return false;
  if (/^follow some topics$/i.test(raw)) return false;
  if (/^search$/i.test(raw)) return false;
  if (/^search x$/i.test(raw)) return false;
  if (/^搜索$/.test(raw)) return false;
  if (/^what['’′]?s happening$/i.test(raw)) return true;
  if (/^trends$/i.test(raw)) return true;
  if (/^trending$/i.test(raw)) return true;
  if (/^正在发生$/.test(raw)) return true;
  if (/^趋势$/.test(raw)) return true;
  if (/^热门话题$/.test(raw)) return true;
  return false;
}

function isWhoToFollowSidebarHeadingText(text) {
  const raw = stripDiscoverNoise(text).replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  if (/^who to follow$/i.test(raw)) return true;
  if (/^推荐关注$/.test(raw)) return true;
  if (/^认识这些人$/.test(raw)) return true;
  return false;
}

function isSidebarSearchNode(el) {
  if (!el) return false;
  try {
    if (el.getAttribute) {
      const id = el.getAttribute('data-testid');
      if (id === 'SearchBox_Search_Input' || id === 'SearchTimeline') return true;
    }
    if (typeof el.matches === 'function') {
      if (el.matches('[data-testid="SearchBox_Search_Input"], [data-testid="SearchTimeline"], input[data-testid="SearchBox_Search_Input"]')) {
        return true;
      }
    }
    if (typeof el.querySelector === 'function') {
      if (el.querySelector('[data-testid="SearchBox_Search_Input"], [data-testid="SearchTimeline"]')) return true;
    }
  } catch (e) {}
  return false;
}

function isSidebarColumnNode(el) {
  if (!el || !el.getAttribute) return false;
  return el.getAttribute('data-testid') === 'sidebarColumn';
}

function trendsModuleHasForbiddenChrome(el, trendsHeading) {
  if (!el) return false;
  try {
    if (isSidebarColumnNode(el)) return true;
    if (isSidebarSearchNode(el)) return true;
    if (el.querySelector) {
      const navs = el.querySelectorAll('nav');
      for (let n = 0; n < navs.length; n++) {
        const nav = navs[n];
        if (trendsHeading && trendsHeading.closest && trendsHeading.closest('nav') === nav) continue;
        return true;
      }
    }
    const headings = el.querySelectorAll ? el.querySelectorAll('[role="heading"], h1, h2, h3') : [];
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      if (trendsHeading && (h === trendsHeading || (trendsHeading.contains && trendsHeading.contains(h)))) continue;
      const t = trendsHeadingText(h);
      if (!t) continue;
      if (isTrendsHeadingText(t)) continue;
      if (/^show more$/i.test(t) || /^显示更多$/.test(t) || /^查看更多$/.test(t)) continue;
      if (isWhoToFollowSidebarHeadingText(t)) return true;
      // Another sidebar module heading (Premium, Grok, footer, etc.)
      return true;
    }
  } catch (e) {
    return true;
  }
  return false;
}

function trendsModuleFromHeading(heading) {
  if (!heading || !heading.closest) return null;
  const sidebar = heading.closest('[data-testid="sidebarColumn"]');
  if (!sidebar) return null;
  // Walk up to the largest card that is still not sidebarColumn / Search / Who to follow.
  // Prefer the card wrapper over an inner <section> so the rounded rail box collapses
  // instead of leaving a gray hole.
  let node = heading;
  let last = heading;
  while (node && node.parentElement && node.parentElement !== sidebar) {
    const parent = node.parentElement;
    if (!parent || isSidebarColumnNode(parent) || parent === sidebar) break;
    if (trendsModuleHasForbiddenChrome(parent, heading)) break;
    last = parent;
    node = parent;
  }
  if (!last || last === sidebar || isSidebarColumnNode(last)) return null;
  return last;
}

function isTrendsModule(node) {
  try {
    if (!node || !node.querySelector) return false;
    if (isSidebarColumnNode(node)) return false;
    const sidebar = node.closest ? node.closest('[data-testid="sidebarColumn"]') : null;
    if (!sidebar) return false;
    if (node === sidebar) return false;
    if (node.closest && node.closest('nav') && !(sidebar.contains && sidebar.contains(node))) return false;
    if (node.matches && node.matches('article[data-testid="tweet"]')) return false;
    if (node.closest && node.closest('article[data-testid="tweet"]')) return false;
    if (isSidebarSearchNode(node) && !(node.querySelector && node.querySelector('[role="heading"]'))) return false;

    let foundHeading = null;
    const maybe = [];
    if (node.matches && (node.matches('[role="heading"]') || /^H[1-3]$/.test(node.tagName))) maybe.push(node);
    const headings = node.querySelectorAll('[role="heading"], h1, h2, h3');
    for (let i = 0; i < headings.length; i++) maybe.push(headings[i]);
    for (let i = 0; i < maybe.length; i++) {
      if (isTrendsHeadingText(trendsHeadingText(maybe[i]))) {
        foundHeading = maybe[i];
        break;
      }
    }
    if (!foundHeading) return false;
    if (trendsModuleHasForbiddenChrome(node, foundHeading)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function hideTrendsNode(el) {
  if (!el || !el.classList) return;
  if (isSidebarColumnNode(el)) return;
  if (el.closest && el.closest('article[data-testid="tweet"]')) return;
  if (isSidebarSearchNode(el) && !(el.querySelector && el.querySelector('[role="heading"]'))) return;
  el.classList.add(TRENDS_HIDDEN_CLASS);
  el.style.setProperty('display', 'none', 'important');
  el.style.setProperty('height', '0', 'important');
  el.style.setProperty('min-height', '0', 'important');
  el.style.setProperty('max-height', '0', 'important');
  el.style.setProperty('overflow', 'hidden', 'important');
  el.style.setProperty('margin', '0', 'important');
  el.style.setProperty('padding', '0', 'important');
  el.style.setProperty('border', '0', 'important');
}

function hideTrendsModules() {
  if (!isHideTrendsEnabled) {
    showTrendsModules();
    return;
  }
  try {
    const sidebars = document.querySelectorAll('[data-testid="sidebarColumn"]');
    for (let s = 0; s < sidebars.length; s++) {
      const sidebar = sidebars[s];
      if (!(sidebar instanceof HTMLElement)) continue;
      const headings = sidebar.querySelectorAll('[role="heading"], h1, h2, h3, span');
      for (let i = 0; i < headings.length; i++) {
        const h = headings[i];
        const label = trendsHeadingText(h);
        if (!label || label.length > 80) continue;
        if (!isTrendsHeadingText(label)) continue;
        if (h.closest && h.closest('article[data-testid="tweet"]')) continue;
        if (h.closest && h.closest('nav') && h.closest('nav') !== sidebar && !sidebar.contains(h.closest('nav'))) continue;
        const mod = trendsModuleFromHeading(h);
        if (!mod || mod === sidebar || isSidebarColumnNode(mod)) continue;
        if (!isTrendsModule(mod)) continue;
        hideTrendsNode(mod);
      }
    }
  } catch (e) {}
}

function showTrendsModules() {
  try {
    document.querySelectorAll('.' + TRENDS_HIDDEN_CLASS).forEach((el) => {
      el.classList.remove(TRENDS_HIDDEN_CLASS);
      if (!el.style) return;
      el.style.removeProperty('display');
      el.style.removeProperty('height');
      el.style.removeProperty('min-height');
      el.style.removeProperty('max-height');
      el.style.removeProperty('overflow');
      el.style.removeProperty('margin');
      el.style.removeProperty('padding');
      el.style.removeProperty('border');
    });
  } catch (e) {}
}

function applyGrokHides() {
  if (isHideGrokChromeEnabled) hideGrokChrome();
  if (isHideGrokPostsEnabled) hideGrokTimelinePosts();
  if (isHideDiscoverMoreEnabled) hideDiscoverMoreModules();
  hideHomeMediaPreviews();
  hideTweetViews();
  hideTrendsModules();
  hideTweetGrokIcons();
}

function init() {
  chrome.storage.local.get(
    ["isPro", "mergeCommunityTabs", "lastCommunityTabLabel", "blockAds", "hideGrokChrome", "hideGrokPosts", "hideDiscoverMore", "hideMediaPreview", "hideViews", "hideTrends", "hideTweetGrokIcon", "cleanerOwnReplies", "foldBotReplies"],
    (result) => {
      if (!result.isPro) {
        console.log("Better X: No active license. Please activate in the extension popup.");
        if (!quietxLicenseWaiter) {
          quietxLicenseWaiter = true;
          chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.isPro && changes.isPro.newValue && !quietxStarted) {
              init();
            }
          });
        }
        return;
      }
      if (quietxStarted) return;
      quietxStarted = true;

      isAdBlockingEnabled = result.blockAds !== false;
      isHideGrokChromeEnabled = result.hideGrokChrome !== false;
      isHideGrokPostsEnabled = result.hideGrokPosts !== false;
      isHideDiscoverMoreEnabled = result.hideDiscoverMore !== false;
      isHideMediaPreviewEnabled = result.hideMediaPreview === true;
      isHideViewsEnabled = result.hideViews !== false;
      isHideTrendsEnabled = result.hideTrends !== false;
      isHideTweetGrokIconEnabled = result.hideTweetGrokIcon !== false;
      isCleanerOwnRepliesEnabled = result.cleanerOwnReplies !== false;
      isFoldBotRepliesEnabled = result.foldBotReplies === true;

      console.log("Better X: License active. Initializing...");
      initTweetHistory();
      createRecycleBin();
      initializePosts();
      initPinFollowing();
      applyGrokHides();
      initOwnRepliesCleaner();
      initFoldBotReplies();

      let grokHideScheduled = false;
      const scheduleGrokHides = () => {
        if (grokHideScheduled) return;
        grokHideScheduled = true;
        requestAnimationFrame(() => {
          grokHideScheduled = false;
          applyGrokHides();
        });
      };
      try {
        const grokObserver = new MutationObserver(scheduleGrokHides);
        grokObserver.observe(document.documentElement || document.body, {
          childList: true,
          subtree: true,
          characterData: true
        });
      } catch (e) {}
      window.addEventListener('scroll', scheduleGrokHides, { passive: true, capture: true });

      // Watch for storage changes (Dynamic Toggle)
      chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local') return;
          if (changes.blockAds) {
              isAdBlockingEnabled = !!changes.blockAds.newValue;
              console.log("Better X: Ad Blocking switched to:", isAdBlockingEnabled);
              if (isAdBlockingEnabled) {
                   initializePosts();
              } else {
                 const hiddenAds = document.querySelectorAll('article[style*="display: none"]');
                 hiddenAds.forEach(el => {
                     if (isAd(el)) el.style.display = "";
                 });
              }
          }
          if (changes.hideGrokChrome || changes.hideGrokPosts || changes.hideDiscoverMore || changes.hideMediaPreview || changes.hideViews || changes.hideTrends || changes.hideTweetGrokIcon || changes.cleanerOwnReplies || changes.foldBotReplies || changes.isPro) {
              chrome.storage.local.get(['isPro', 'hideGrokChrome', 'hideGrokPosts', 'hideDiscoverMore', 'hideMediaPreview', 'hideViews', 'hideTrends', 'hideTweetGrokIcon', 'cleanerOwnReplies', 'foldBotReplies'], (r) => {
                  const wasChrome = isHideGrokChromeEnabled;
                  isHideGrokChromeEnabled = !!r.isPro && r.hideGrokChrome !== false;
                  if (isHideGrokChromeEnabled && !wasChrome) {
                      hideGrokChrome();
                  } else if (!isHideGrokChromeEnabled && wasChrome) {
                      showGrokChrome();
                  }
                  const wasPosts = isHideGrokPostsEnabled;
                  isHideGrokPostsEnabled = !!r.isPro && r.hideGrokPosts !== false;
                  console.log("Better X: Hide Grok posts switched to:", isHideGrokPostsEnabled);
                  if (isHideGrokPostsEnabled && !wasPosts) {
                      hideGrokTimelinePosts();
                  } else if (!isHideGrokPostsEnabled && wasPosts) {
                      showGrokTimelinePosts();
                  }
                  const wasDiscover = isHideDiscoverMoreEnabled;
                  isHideDiscoverMoreEnabled = !!r.isPro && r.hideDiscoverMore !== false;
                  console.log("Better X: Hide Discover more switched to:", isHideDiscoverMoreEnabled);
                  if (isHideDiscoverMoreEnabled && !wasDiscover) {
                      hideDiscoverMoreModules();
                  } else if (!isHideDiscoverMoreEnabled && wasDiscover) {
                      showDiscoverMoreModules();
                  }
                  const wasMedia = isHideMediaPreviewEnabled;
                  isHideMediaPreviewEnabled = !!r.isPro && r.hideMediaPreview === true;
                  console.log("Better X: Hide media preview switched to:", isHideMediaPreviewEnabled);
                  if (isHideMediaPreviewEnabled && !wasMedia) {
                      hideHomeMediaPreviews();
                  } else if (!isHideMediaPreviewEnabled && wasMedia) {
                      showHomeMediaPreviews();
                  }
                  const wasViews = isHideViewsEnabled;
                  isHideViewsEnabled = !!r.isPro && r.hideViews !== false;
                  console.log("Better X: Hide views switched to:", isHideViewsEnabled);
                  if (isHideViewsEnabled && !wasViews) {
                      hideTweetViews();
                  } else if (!isHideViewsEnabled && wasViews) {
                      showTweetViews();
                  }
                  const wasTrends = isHideTrendsEnabled;
                  isHideTrendsEnabled = !!r.isPro && r.hideTrends !== false;
                  console.log("Better X: Hide trends switched to:", isHideTrendsEnabled);
                  if (isHideTrendsEnabled && !wasTrends) {
                      hideTrendsModules();
                  } else if (!isHideTrendsEnabled && wasTrends) {
                      showTrendsModules();
                  }
                  const wasTweetGrokIcon = isHideTweetGrokIconEnabled;
                  isHideTweetGrokIconEnabled = !!r.isPro && r.hideTweetGrokIcon !== false;
                  console.log("Better X: Hide tweet Grok icon switched to:", isHideTweetGrokIconEnabled);
                  if (isHideTweetGrokIconEnabled && !wasTweetGrokIcon) {
                      hideTweetGrokIcons();
                  } else if (!isHideTweetGrokIconEnabled && wasTweetGrokIcon) {
                      showTweetGrokIcons();
                  }
                  const wasOwnCleaner = isCleanerOwnRepliesEnabled;
                  isCleanerOwnRepliesEnabled = !!r.isPro && r.cleanerOwnReplies !== false;
                  console.log("Better X: Own replies Cleaner switched to:", isCleanerOwnRepliesEnabled);
                  if (wasOwnCleaner !== isCleanerOwnRepliesEnabled) {
                      scheduleOwnRepliesCleanerUI();
                  }
                  const wasFoldBot = isFoldBotRepliesEnabled;
                  isFoldBotRepliesEnabled = !!r.isPro && r.foldBotReplies === true;
                  console.log("Better X: Fold bot replies switched to:", isFoldBotRepliesEnabled);
                  if (wasFoldBot !== isFoldBotRepliesEnabled) {
                      if (!isFoldBotRepliesEnabled) restoreFoldBotReplies();
                      else scheduleFoldBotReplies();
                  }
              });
          }
      });

      // Watch for new posts (infinite scroll) and new Grok chrome
      setInterval(() => {
          initializePosts();
          applyGrokHides();
      }, 400);

      lastCommunityTabLabel =
        typeof result.lastCommunityTabLabel === "string"
          ? result.lastCommunityTabLabel
          : null;
      setupCommunityTabMergeFeature(!!result.mergeCommunityTabs);
    }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// ---- Communities tab merge (optional) ----
const COMMUNITY_MERGE_SETTING_KEY = "mergeCommunityTabs";
const COMMUNITY_MERGE_LAST_LABEL_KEY = "lastCommunityTabLabel";
const COMMUNITY_MERGE_TABLIST_MARK = "quietxCommunityMerged";
const COMMUNITY_MERGE_TAB_MARK = "quietxCommunityPrimary";
const COMMUNITY_MERGE_HIDDEN_MARK = "quietxCommunityHidden";
const COMMUNITY_MERGE_ORIGINAL_LABEL = "quietxOriginalLabel";
const COMMUNITY_MERGE_TABLIST_ORIG_JUSTIFY = "quietxOrigJustifyContent";
const COMMUNITY_MERGE_TABLIST_ORIG_GAP = "quietxOrigGap";
const COMMUNITY_MERGE_TABLIST_ORIG_DISPLAY = "quietxOrigDisplay";
const COMMUNITY_MERGE_TABLIST_ORIG_WIDTH = "quietxOrigWidth";
const COMMUNITY_MERGE_TABLIST_ORIG_FLEX = "quietxOrigFlex";
const COMMUNITY_MERGE_TAB_ORIG_FLEX = "quietxOrigFlex";
const COMMUNITY_MERGE_TAB_ORIG_MARGIN_LEFT = "quietxOrigMarginLeft";
const COMMUNITY_MERGE_TAB_ORIG_MARGIN_INLINE_START =
  "quietxOrigMarginInlineStart";
const COMMUNITY_MERGE_ITEM_HIDDEN_MARK = "quietxCommunityItemHidden";
const COMMUNITY_MERGE_ITEM_ORIG_DISPLAY = "quietxOrigItemDisplay";
const COMMUNITY_MERGE_ITEM_ORIG_FLEX = "quietxOrigItemFlex";
const COMMUNITY_MERGE_ITEM_ORIG_MARGIN_LEFT = "quietxOrigItemMarginLeft";
const COMMUNITY_MERGE_ITEM_ORIG_MARGIN_INLINE_START =
  "quietxOrigItemMarginInlineStart";
const COMMUNITY_MERGE_ITEM_ORIG_ORDER = "quietxOrigItemOrder";

let communityMergeObserver = null;
let communityMergeMenuEl = null;
let communityMergeMenuHideTimer = null;
let communityMergeStorageListenerInstalled = false;
let lastCommunityTabLabel = null;
let communityMergeEnabled = false;

function setupCommunityTabMergeFeature(enabled) {
  ensureCommunityMergeStyles();

  if (!communityMergeStorageListenerInstalled) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (!changes[COMMUNITY_MERGE_SETTING_KEY]) return;
      const next = !!changes[COMMUNITY_MERGE_SETTING_KEY].newValue;
      if (next) enableCommunityTabMerge();
      else disableCommunityTabMerge();
    });
    communityMergeStorageListenerInstalled = true;
  }

  if (enabled) enableCommunityTabMerge();
  else disableCommunityTabMerge();
}

function enableCommunityTabMerge() {
  communityMergeEnabled = true;
  ensureCommunityMergeStyles();
  applyCommunityMergeEverywhere();

  if (communityMergeObserver) return;
  communityMergeObserver = new MutationObserver(() => {
    applyCommunityMergeEverywhere();
  });
  communityMergeObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function disableCommunityTabMerge() {
  communityMergeEnabled = false;
  if (communityMergeObserver) {
    communityMergeObserver.disconnect();
    communityMergeObserver = null;
  }
  removeCommunityMergeMenu();

  document
    .querySelectorAll(`[data-${COMMUNITY_MERGE_TABLIST_MARK}="1"]`)
    .forEach((tablist) => {
      if (tablist instanceof HTMLElement) {
        // Restore tablist layout tweaks
        const origJustify = tablist.getAttribute(
          `data-${COMMUNITY_MERGE_TABLIST_ORIG_JUSTIFY}`
        );
        const origGap = tablist.getAttribute(
          `data-${COMMUNITY_MERGE_TABLIST_ORIG_GAP}`
        );
        const origDisplay = tablist.getAttribute(
          `data-${COMMUNITY_MERGE_TABLIST_ORIG_DISPLAY}`
        );
        const origWidth = tablist.getAttribute(
          `data-${COMMUNITY_MERGE_TABLIST_ORIG_WIDTH}`
        );
        const origFlex = tablist.getAttribute(
          `data-${COMMUNITY_MERGE_TABLIST_ORIG_FLEX}`
        );
        if (origJustify !== null) tablist.style.justifyContent = origJustify;
        if (origGap !== null) tablist.style.gap = origGap;
        if (origDisplay !== null) tablist.style.display = origDisplay;
        if (origWidth !== null) tablist.style.width = origWidth;
        if (origFlex !== null) tablist.style.flex = origFlex;
        tablist.removeAttribute(`data-${COMMUNITY_MERGE_TABLIST_ORIG_JUSTIFY}`);
        tablist.removeAttribute(`data-${COMMUNITY_MERGE_TABLIST_ORIG_GAP}`);
        tablist.removeAttribute(`data-${COMMUNITY_MERGE_TABLIST_ORIG_DISPLAY}`);
        tablist.removeAttribute(`data-${COMMUNITY_MERGE_TABLIST_ORIG_WIDTH}`);
        tablist.removeAttribute(`data-${COMMUNITY_MERGE_TABLIST_ORIG_FLEX}`);
      }
      tablist.removeAttribute(`data-${COMMUNITY_MERGE_TABLIST_MARK}`);
    });

  document
    .querySelectorAll(`[data-${COMMUNITY_MERGE_HIDDEN_MARK}="1"]`)
    .forEach((tab) => {
      tab.style.display = "";
      tab.removeAttribute(`data-${COMMUNITY_MERGE_HIDDEN_MARK}`);
    });

  // Restore per-item (tablist direct child) tweaks
  document
    .querySelectorAll(`[data-${COMMUNITY_MERGE_ITEM_HIDDEN_MARK}="1"]`)
    .forEach((item) => {
      if (!(item instanceof HTMLElement)) return;
      item.style.display = "";
      item.removeAttribute(`data-${COMMUNITY_MERGE_ITEM_HIDDEN_MARK}`);
    });
  document
    .querySelectorAll(
      `[data-${COMMUNITY_MERGE_ITEM_ORIG_DISPLAY}], [data-${COMMUNITY_MERGE_ITEM_ORIG_FLEX}], [data-${COMMUNITY_MERGE_ITEM_ORIG_MARGIN_LEFT}], [data-${COMMUNITY_MERGE_ITEM_ORIG_MARGIN_INLINE_START}], [data-${COMMUNITY_MERGE_ITEM_ORIG_ORDER}]`
    )
    .forEach((item) => {
      if (!(item instanceof HTMLElement)) return;
      const od = item.getAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_DISPLAY}`);
      const of = item.getAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_FLEX}`);
      const oml = item.getAttribute(
        `data-${COMMUNITY_MERGE_ITEM_ORIG_MARGIN_LEFT}`
      );
      const omis = item.getAttribute(
        `data-${COMMUNITY_MERGE_ITEM_ORIG_MARGIN_INLINE_START}`
      );
      const oo = item.getAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_ORDER}`);
      if (od !== null) item.style.display = od;
      if (of !== null) item.style.flex = of;
      if (oml !== null) item.style.marginLeft = oml;
      if (omis !== null) item.style.marginInlineStart = omis;
      if (oo !== null) item.style.order = oo;
      item.removeAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_DISPLAY}`);
      item.removeAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_FLEX}`);
      item.removeAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_MARGIN_LEFT}`);
      item.removeAttribute(
        `data-${COMMUNITY_MERGE_ITEM_ORIG_MARGIN_INLINE_START}`
      );
      item.removeAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_ORDER}`);
    });

  // Restore per-tab flex tweaks
  document
    .querySelectorAll(`[data-${COMMUNITY_MERGE_TAB_ORIG_FLEX}]`)
    .forEach((tab) => {
      if (!(tab instanceof HTMLElement)) return;
      const orig = tab.getAttribute(`data-${COMMUNITY_MERGE_TAB_ORIG_FLEX}`);
      if (orig !== null) tab.style.flex = orig;
      tab.removeAttribute(`data-${COMMUNITY_MERGE_TAB_ORIG_FLEX}`);
    });

  // Restore per-tab margin tweaks (fixes "pushed to the right" behavior)
  document
    .querySelectorAll(
      `[data-${COMMUNITY_MERGE_TAB_ORIG_MARGIN_LEFT}], [data-${COMMUNITY_MERGE_TAB_ORIG_MARGIN_INLINE_START}]`
    )
    .forEach((tab) => {
      if (!(tab instanceof HTMLElement)) return;
      const ml = tab.getAttribute(
        `data-${COMMUNITY_MERGE_TAB_ORIG_MARGIN_LEFT}`
      );
      const mis = tab.getAttribute(
        `data-${COMMUNITY_MERGE_TAB_ORIG_MARGIN_INLINE_START}`
      );
      if (ml !== null) tab.style.marginLeft = ml;
      if (mis !== null) tab.style.marginInlineStart = mis;
      tab.removeAttribute(`data-${COMMUNITY_MERGE_TAB_ORIG_MARGIN_LEFT}`);
      tab.removeAttribute(
        `data-${COMMUNITY_MERGE_TAB_ORIG_MARGIN_INLINE_START}`
      );
    });

  document
    .querySelectorAll(`[data-${COMMUNITY_MERGE_TAB_MARK}="1"]`)
    .forEach((tab) => {
      const original = tab.getAttribute(
        `data-${COMMUNITY_MERGE_ORIGINAL_LABEL}`
      );
      if (original) setTabLabel(tab, original);
      tab.removeAttribute(`data-${COMMUNITY_MERGE_TAB_MARK}`);
      tab.removeAttribute(`data-${COMMUNITY_MERGE_ORIGINAL_LABEL}`);
    });
}

function ensureCommunityMergeStyles() {
  if (document.getElementById("quietx-community-merge-style")) return;
  const style = document.createElement("style");
  style.id = "quietx-community-merge-style";
  style.textContent = `
    .quietx-community-menu {
      position: fixed;
      min-width: 180px;
      background: rgba(0,0,0,0.92);
      color: white;
      border-radius: 10px;
      padding: 6px;
      z-index: 9999999;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    }
    .quietx-community-menu button {
      width: 100%;
      text-align: left;
      background: transparent;
      color: inherit;
      border: none;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
    }
    .quietx-community-menu button:hover {
      background: rgba(255,255,255,0.12);
    }
  `;
  document.documentElement.appendChild(style);
}

function applyCommunityMergeEverywhere() {
  // Find likely X tablists
  const tablists = document.querySelectorAll('[role="tablist"]');
  tablists.forEach((tablist) => applyCommunityMergeToTablist(tablist));
}

function applyCommunityMergeToTablist(tablist) {
  if (!(tablist instanceof HTMLElement)) return;

  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]')).filter(
    (t) => t instanceof HTMLElement
  );
  if (tabs.length < 3) return;

  // Primary target: main timeline tabs on X: "For you" + "Following" + optional groups after.
  let groupTabs = null;
  if (isMainTimelineTablist(tabs)) {
    groupTabs = tabs.slice(2);
  } else {
    // Fallback: older "Communities" tab + groups
    const communityIndex = tabs.findIndex((t) =>
      isCommunityLabel(getTabLabel(t))
    );
    if (communityIndex < 0) return;
    groupTabs = tabs.slice(communityIndex);
  }

  if (groupTabs.length < 2) return; // nothing to merge

  // Cleanup any previous implementation that renamed a "primary" tab.
  groupTabs.forEach((t) => {
    if (!(t instanceof HTMLElement)) return;
    if (t.getAttribute(`data-${COMMUNITY_MERGE_TAB_MARK}`) === "1") {
      const original = t.getAttribute(`data-${COMMUNITY_MERGE_ORIGINAL_LABEL}`);
      if (original) setTabLabel(t, original);
      t.removeAttribute(`data-${COMMUNITY_MERGE_TAB_MARK}`);
      t.removeAttribute(`data-${COMMUNITY_MERGE_ORIGINAL_LABEL}`);
    }
  });

  // Mark tablist merged (used for restore)
  tablist.setAttribute(`data-${COMMUNITY_MERGE_TABLIST_MARK}`, "1");
  // Prevent huge spacing when tabs are hidden (X often uses space-between + width:100%).
  if (!tablist.hasAttribute(`data-${COMMUNITY_MERGE_TABLIST_ORIG_JUSTIFY}`)) {
    tablist.setAttribute(
      `data-${COMMUNITY_MERGE_TABLIST_ORIG_JUSTIFY}`,
      tablist.style.justifyContent ?? ""
    );
  }
  if (!tablist.hasAttribute(`data-${COMMUNITY_MERGE_TABLIST_ORIG_GAP}`)) {
    tablist.setAttribute(
      `data-${COMMUNITY_MERGE_TABLIST_ORIG_GAP}`,
      tablist.style.gap ?? ""
    );
  }
  if (!tablist.hasAttribute(`data-${COMMUNITY_MERGE_TABLIST_ORIG_DISPLAY}`)) {
    tablist.setAttribute(
      `data-${COMMUNITY_MERGE_TABLIST_ORIG_DISPLAY}`,
      tablist.style.display ?? ""
    );
  }
  if (!tablist.hasAttribute(`data-${COMMUNITY_MERGE_TABLIST_ORIG_WIDTH}`)) {
    tablist.setAttribute(
      `data-${COMMUNITY_MERGE_TABLIST_ORIG_WIDTH}`,
      tablist.style.width ?? ""
    );
  }
  if (!tablist.hasAttribute(`data-${COMMUNITY_MERGE_TABLIST_ORIG_FLEX}`)) {
    tablist.setAttribute(
      `data-${COMMUNITY_MERGE_TABLIST_ORIG_FLEX}`,
      tablist.style.flex ?? ""
    );
  }
  tablist.style.display = "inline-flex";
  tablist.style.width = "fit-content";
  tablist.style.flex = "0 0 auto";
  tablist.style.justifyContent = "flex-start";
  tablist.style.gap = "16px";

  // Keep the CURRENTLY SELECTED group tab visible (so its built-in filter dropdown keeps working),
  // and hide all other group tabs. The visible tab's label stays as the current selection.
  let selected = findSelectedTab(groupTabs);
  if (!(selected instanceof HTMLElement)) {
    // When user is on "For you"/"Following", no group tab is selected.
    // Still merge: keep last-used group visible (or the first).
    selected =
      (lastCommunityTabLabel
        ? groupTabs.find((t) => getTabLabel(t) === lastCommunityTabLabel)
        : null) || groupTabs[0];
  }
  if (!(selected instanceof HTMLElement)) return;

  // Ensure For you / Following + selected group sit together with consistent spacing.
  const forYouTab = tabs[0];
  const followingTab = tabs[1];
  const forYouItem = getTablistItem(tablist, forYouTab) || forYouTab;
  const followingItem = getTablistItem(tablist, followingTab) || followingTab;
  const selectedItem = getTablistItem(tablist, selected) || selected;

  forceItemOrderAndLayout(forYouItem, 0);
  forceItemOrderAndLayout(followingItem, 1);
  forceItemOrderAndLayout(selectedItem, 2);

  groupTabs.forEach((t) => {
    if (!(t instanceof HTMLElement)) return;
    if (t === selected) {
      // Ensure visible
      if (t.getAttribute(`data-${COMMUNITY_MERGE_HIDDEN_MARK}`) === "1") {
        t.style.display = "";
        t.removeAttribute(`data-${COMMUNITY_MERGE_HIDDEN_MARK}`);
      }
      if (!t.hasAttribute(`data-${COMMUNITY_MERGE_TAB_ORIG_FLEX}`)) {
        t.setAttribute(
          `data-${COMMUNITY_MERGE_TAB_ORIG_FLEX}`,
          t.style.flex ?? ""
        );
      }
      t.style.flex = "0 0 auto";

      // X sometimes pushes the first group tab to the right via margin-left:auto.
      // Force it to stick right after "Following".
      if (!t.hasAttribute(`data-${COMMUNITY_MERGE_TAB_ORIG_MARGIN_LEFT}`)) {
        t.setAttribute(
          `data-${COMMUNITY_MERGE_TAB_ORIG_MARGIN_LEFT}`,
          t.style.marginLeft ?? ""
        );
      }
      if (
        !t.hasAttribute(`data-${COMMUNITY_MERGE_TAB_ORIG_MARGIN_INLINE_START}`)
      ) {
        t.setAttribute(
          `data-${COMMUNITY_MERGE_TAB_ORIG_MARGIN_INLINE_START}`,
          t.style.marginInlineStart ?? ""
        );
      }
      t.style.marginLeft = "0px";
      t.style.marginInlineStart = "0px";

      bindCommunityMenuHandlers(t, groupTabs, tablist);
    } else {
      if (t.getAttribute(`data-${COMMUNITY_MERGE_HIDDEN_MARK}`) === "1") return;
      t.setAttribute(`data-${COMMUNITY_MERGE_HIDDEN_MARK}`, "1");
      t.style.display = "none";
      if (!t.hasAttribute(`data-${COMMUNITY_MERGE_TAB_ORIG_FLEX}`)) {
        t.setAttribute(
          `data-${COMMUNITY_MERGE_TAB_ORIG_FLEX}`,
          t.style.flex ?? ""
        );
      }
      t.style.flex = "0 0 auto";

      // Hide the whole tablist item too (fixes varying gaps caused by wrapper margins / space-between push).
      const item = getTablistItem(tablist, t);
      if (item && item instanceof HTMLElement) {
        if (
          item.getAttribute(`data-${COMMUNITY_MERGE_ITEM_HIDDEN_MARK}`) !== "1"
        ) {
          item.setAttribute(`data-${COMMUNITY_MERGE_ITEM_HIDDEN_MARK}`, "1");
          item.style.display = "none";
        }
      }
    }
  });

  // Ensure selected item's wrapper isn't hidden.
  if (selectedItem instanceof HTMLElement) {
    selectedItem.style.display = "";
    selectedItem.removeAttribute(`data-${COMMUNITY_MERGE_ITEM_HIDDEN_MARK}`);
  }
}

function isCommunityLabel(label) {
  if (!label) return false;
  const s = label.trim().toLowerCase();
  // English + common zh
  return (
    s === "communities" ||
    s === "community" ||
    s.includes("communities") ||
    s === "社群" ||
    s === "社区" ||
    s.includes("社区") ||
    s.includes("社群")
  );
}

function isForYouLabel(label) {
  if (!label) return false;
  const s = label.trim().toLowerCase();
  return (
    s === "for you" ||
    s === "for-you" ||
    s === "为你推荐" ||
    s === "为你" ||
    s.includes("for you") ||
    s.includes("为你")
  );
}

function isFollowingLabel(label) {
  if (!label) return false;
  const s = label.trim().toLowerCase();
  return (
    s === "following" ||
    s === "正在关注" ||
    s === "关注" ||
    s.includes("following") ||
    s.includes("关注")
  );
}

function isMainTimelineTablist(tabs) {
  if (!tabs || tabs.length < 3) return false;
  const first = getTabLabel(tabs[0]);
  const second = getTabLabel(tabs[1]);
  return isForYouLabel(first) && isFollowingLabel(second);
}

function getTabLabel(tab) {
  if (!(tab instanceof HTMLElement)) return "";
  // Prefer aria-label if present
  const aria = tab.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  // Otherwise, text content
  return (tab.textContent || "").trim();
}

function setTabLabel(tab, newLabel) {
  if (!(tab instanceof HTMLElement)) return;

  // Always set aria-label for accessibility + as a fallback label source.
  tab.setAttribute("aria-label", newLabel);

  // Replace the first non-empty text node we can find (more robust for dynamic relabeling).
  const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const raw = node.nodeValue || "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    node.nodeValue = raw.replace(trimmed, newLabel);
    break;
  }
}

function findSelectedTab(tabs) {
  if (!tabs || tabs.length === 0) return null;
  // X usually uses aria-selected; tabindex 0 is also a strong signal.
  const aria = tabs.find((t) => t.getAttribute("aria-selected") === "true");
  if (aria) return aria;
  const tabIndex0 = tabs.find((t) => t.tabIndex === 0);
  if (tabIndex0) return tabIndex0;
  // Last fallback: data attributes used by some UI libs.
  const headless = tabs.find((t) =>
    (t.getAttribute("data-headlessui-state") || "").includes("selected")
  );
  return headless || null;
}

function bindCommunityMenuHandlers(visibleTab, groupTabs, tablist) {
  if (!(visibleTab instanceof HTMLElement)) return;
  if (visibleTab.dataset.quietxCommunityMenuBound === "1") return;
  visibleTab.dataset.quietxCommunityMenuBound = "1";

  // Hover opens the group switcher menu (minimal effort). Moving away hides it.
  visibleTab.addEventListener(
    "mouseenter",
    () => showCommunityMenu(visibleTab, groupTabs, tablist),
    { passive: true }
  );
  visibleTab.addEventListener("mouseleave", scheduleHideCommunityMenu, {
    passive: true,
  });

  // Do NOT block normal click: user expects clicking the tab to switch into that community feed.
  // Optional: right-click toggles the group switcher without switching.
  visibleTab.addEventListener(
    "contextmenu",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCommunityMenu(visibleTab, groupTabs, tablist);
    },
    true
  );
}

function getTablistItem(tablist, tab) {
  if (!(tablist instanceof HTMLElement) || !(tab instanceof HTMLElement))
    return null;
  let node = tab;
  while (node && node.parentElement) {
    if (node.parentElement === tablist) return node;
    node = node.parentElement;
  }
  return null;
}

function forceItemOrderAndLayout(item, order) {
  if (!(item instanceof HTMLElement)) return;

  if (!item.hasAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_DISPLAY}`)) {
    item.setAttribute(
      `data-${COMMUNITY_MERGE_ITEM_ORIG_DISPLAY}`,
      item.style.display ?? ""
    );
  }
  if (!item.hasAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_FLEX}`)) {
    item.setAttribute(
      `data-${COMMUNITY_MERGE_ITEM_ORIG_FLEX}`,
      item.style.flex ?? ""
    );
  }
  if (!item.hasAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_MARGIN_LEFT}`)) {
    item.setAttribute(
      `data-${COMMUNITY_MERGE_ITEM_ORIG_MARGIN_LEFT}`,
      item.style.marginLeft ?? ""
    );
  }
  if (
    !item.hasAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_MARGIN_INLINE_START}`)
  ) {
    item.setAttribute(
      `data-${COMMUNITY_MERGE_ITEM_ORIG_MARGIN_INLINE_START}`,
      item.style.marginInlineStart ?? ""
    );
  }
  if (!item.hasAttribute(`data-${COMMUNITY_MERGE_ITEM_ORIG_ORDER}`)) {
    item.setAttribute(
      `data-${COMMUNITY_MERGE_ITEM_ORIG_ORDER}`,
      item.style.order ?? ""
    );
  }

  item.style.display = "";
  item.style.flex = "0 0 auto";
  item.style.marginLeft = "0px";
  item.style.marginInlineStart = "0px";
  item.style.order = String(order);
}

function isProbablyFilterControlClick(e, tab) {
  const target = e.target;
  if (!(target instanceof Element)) return false;
  const childButton = target.closest(
    'button,[role="button"],[aria-haspopup],[aria-expanded]'
  );
  if (!childButton) return false;
  // If the click hits a nested interactive element inside the tab, assume it's the filter/caret.
  return tab.contains(childButton) && childButton !== tab;
}

function toggleCommunityMenu(anchorTab, groupTabs, tablist) {
  if (!isCommunityMergeActive(tablist)) return;
  if (
    communityMergeMenuEl &&
    communityMergeMenuEl.dataset.anchorId === getAnchorId(anchorTab)
  ) {
    removeCommunityMergeMenu();
    return;
  }
  showCommunityMenu(anchorTab, groupTabs, tablist);
}

function showCommunityMenu(anchorTab, groupTabs, tablist) {
  if (!isCommunityMergeActive(tablist)) return;
  clearHideCommunityMenuTimer();
  ensureCommunityMergeStyles();

  removeCommunityMergeMenu();

  const menu = document.createElement("div");
  menu.className = "quietx-community-menu";
  menu.dataset.anchorId = getAnchorId(anchorTab);
  menu.addEventListener("mouseenter", clearHideCommunityMenuTimer, {
    passive: true,
  });
  menu.addEventListener("mouseleave", scheduleHideCommunityMenu, {
    passive: true,
  });

  // Build options: primary + hidden tabs
  groupTabs.forEach((tab) => {
    if (!(tab instanceof HTMLElement)) return;
    const label = getTabLabel(tab);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label || "Item";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // If user clicks the currently visible tab, just close the menu.
      if (tab === anchorTab) {
        removeCommunityMergeMenu();
        return;
      }

      if (label) {
        lastCommunityTabLabel = label;
        chrome.storage.local.set(
          { [COMMUNITY_MERGE_LAST_LABEL_KEY]: label },
          () => {}
        );
      }

      // Some UIs ignore clicks on display:none elements; temporarily show, click, and let our observer re-hide.
      const wasHidden =
        tab.getAttribute(`data-${COMMUNITY_MERGE_HIDDEN_MARK}`) === "1";
      if (wasHidden) {
        tab.style.display = "";
        tab.removeAttribute(`data-${COMMUNITY_MERGE_HIDDEN_MARK}`);
      }
      tab.click();

      // Re-apply soon to ensure only the newly selected tab remains visible.
      setTimeout(() => {
        applyCommunityMergeToTablist(tablist);
      }, 0);
      removeCommunityMergeMenu();
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  communityMergeMenuEl = menu;

  positionMenuUnderAnchor(menu, anchorTab);
  window.addEventListener("scroll", onCommunityMenuReposition, true);
  window.addEventListener("resize", onCommunityMenuReposition, true);
}

function onCommunityMenuReposition() {
  if (!communityMergeMenuEl) return;
  const anchorId = communityMergeMenuEl.dataset.anchorId;
  if (!anchorId) return;
  const anchor = document.querySelector(
    `[data-quietx-anchor-id="${CSS.escape(anchorId)}"]`
  );
  if (!(anchor instanceof HTMLElement)) return;
  positionMenuUnderAnchor(communityMergeMenuEl, anchor);
}

function positionMenuUnderAnchor(menu, anchorTab) {
  const r = anchorTab.getBoundingClientRect();
  const top = Math.min(window.innerHeight - 10, Math.max(10, r.bottom + 6));
  const left = Math.min(window.innerWidth - 10, Math.max(10, r.left));
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

function scheduleHideCommunityMenu() {
  clearHideCommunityMenuTimer();
  communityMergeMenuHideTimer = window.setTimeout(() => {
    removeCommunityMergeMenu();
  }, 220);
}

function clearHideCommunityMenuTimer() {
  if (communityMergeMenuHideTimer) {
    window.clearTimeout(communityMergeMenuHideTimer);
    communityMergeMenuHideTimer = null;
  }
}

function removeCommunityMergeMenu() {
  clearHideCommunityMenuTimer();
  if (communityMergeMenuEl) {
    communityMergeMenuEl.remove();
    communityMergeMenuEl = null;
  }
  window.removeEventListener("scroll", onCommunityMenuReposition, true);
  window.removeEventListener("resize", onCommunityMenuReposition, true);
}

function isCommunityMergeActive(tablist) {
  if (!communityMergeEnabled) return false;
  if (!(tablist instanceof HTMLElement)) return false;
  return tablist.getAttribute(`data-${COMMUNITY_MERGE_TABLIST_MARK}`) === "1";
}

function getAnchorId(el) {
  if (!(el instanceof HTMLElement)) return "";
  if (!el.dataset.quietxAnchorId) {
    el.dataset.quietxAnchorId = `qx-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
  }
  return el.dataset.quietxAnchorId;
}

// ---- Own-post reply Cleaner (status pages only; UI clicks; max 50) ----
// Narrow mouth: own posts only; confirm N; prefer Hide reply, else Delete reply; ≥300ms.
// Hard ban: never open/click Delete on root/main status. Reply Delete may confirm X's "Delete post?" sheet.
const OWN_REPLIES_CLEANER_MAX = 50;
const OWN_REPLIES_CLEANER_INTERVAL_MS = 300;
const OWN_REPLIES_MENU_WAIT_MS = 1400;
const OWN_REPLIES_MENU_POLL_MS = 100;
const OWN_REPLIES_GATE_LABEL = 'Own posts only';
const OWN_REPLIES_MISSING_HIDE_MSG = 'Can\'t find Hide reply or Delete reply. Stopped — nothing deleted.';
const OWN_REPLIES_PANEL_ID = 'quietx-own-replies-cleaner';
const OWN_REPLIES_CONFIRM_ID = 'quietx-own-replies-confirm';
const OWN_REPLIES_CHECK_CLASS = 'quietx-own-reply-check';
const OWN_REPLIES_SELECTED_ATTR = 'data-quietx-own-reply-selected';
const OWN_REPLIES_NEAR_DUP_ATTR = 'data-quietx-own-reply-neardup';
const OWN_REPLIES_UI_DEBOUNCE_MS = 250;
const OWN_REPLIES_PANEL_LEFT_KEY = 'cleanerPanelLeft';
const OWN_REPLIES_PANEL_TOP_KEY = 'cleanerPanelTop';
const OWN_REPLIES_PANEL_COLLAPSED_KEY = 'cleanerPanelCollapsed';

const OWN_REPLIES_NEAR_DUP_THRESHOLDS = {
  medium: { minRatio: 0.66, shortMaxDist: 1, shortMaxLen: 4 }
};

function normalizeOwnReplyText(raw) {
  let s = raw == null ? '' : String(raw);
  s = s.replace(/\u00a0/g, ' ');
  s = s.replace(/[\u3000]/g, ' ');
  s = s.replace(/[！!]/g, '!');
  s = s.replace(/[？?]/g, '?');
  s = s.replace(/[。．]/g, '.');
  s = s.replace(/[，,]/g, ',');
  s = s.replace(/[；;]/g, ';');
  s = s.replace(/[：:]/g, ':');
  s = s.replace(/[、]/g, ',');
  s = s.replace(/[“”「」『』"'‘’]/g, '"');
  s = s.replace(/[（(]/g, '(');
  s = s.replace(/[）)]/g, ')');
  s = s.replace(/[【\[]/g, '[');
  s = s.replace(/[】\]]/g, ']');
  s = s.replace(/[…⋯]+/g, '...');
  s = s.replace(/[~～]+/g, '~');
  s = s.replace(/^[\s!.?,;:~…。！？，、；：~]+/, '');
  s = s.replace(/[\s!.?,;:~…。！？，、；：~]+$/, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function ownRepliesLevenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (n > m) return ownRepliesLevenshtein(b, a);
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i < m + 1; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

function areOwnRepliesNearDuplicate(aRaw, bRaw) {
  const a = normalizeOwnReplyText(aRaw);
  const b = normalizeOwnReplyText(bRaw);
  if (!a || !b) return false;
  if (a === b) return true;
  const thr = OWN_REPLIES_NEAR_DUP_THRESHOLDS.medium;
  const dist = ownRepliesLevenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  const ratio = (maxLen - dist) / maxLen;
  if (ratio >= thr.minRatio) return true;
  if (maxLen <= thr.shortMaxLen && dist <= thr.shortMaxDist) return true;
  return dist <= Math.max(1, Math.floor(maxLen * 0.34));
}

function clusterNearDuplicateReplies(items) {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(i, j) {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ai = items[i];
      const bj = items[j];
      const aText = ai && (ai.norm || ai.text || ai);
      const bText = bj && (bj.norm || bj.text || bj);
      if (areOwnRepliesNearDuplicate(aText, bText)) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(items[i]);
  }
  return Array.from(groups.values()).filter((g) => g.length >= 2);
}

function normalizeHandle(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  s = s.replace(/^@+/, '');
  s = s.split(/[\/\s?#"']/)[0] || '';
  s = s.replace(/[^\w]/g, '');
  return s.toLowerCase();
}

function extractHandleFromUserNameRoot(root) {
  if (!root) return '';
  try {
    const links = root.querySelectorAll ? root.querySelectorAll('a[href^="/"]') : [];
    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute('href') || '';
      if (/^\/(?:i\/|search|home|explore|settings|messages|compose|notifications)/i.test(href)) continue;
      if (/\/status\//i.test(href)) continue;
      const m = href.match(/^\/([A-Za-z0-9_]+)\/?$/);
      if (m) return normalizeHandle(m[1]);
    }
    const t = (root.innerText || root.textContent || '').trim();
    const hm = t.match(/@([A-Za-z0-9_]+)/);
    if (hm) return normalizeHandle(hm[1]);
  } catch (e) {}
  return '';
}

function getArticleAuthorHandle(article) {
  if (!article) return '';
  try {
    const userName = article.querySelector('[data-testid="User-Name"]');
    const fromUser = extractHandleFromUserNameRoot(userName);
    if (fromUser) return fromUser;
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9_]+)\/status\/\d+/);
      if (m) return normalizeHandle(m[1]);
    }
  } catch (e) {}
  return '';
}

function getViewerHandleFromDom(doc) {
  const d = doc || document;
  try {
    const profile = d.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (profile) {
      const href = profile.getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9_]+)\/?$/);
      if (m) return normalizeHandle(m[1]);
      const aria = profile.getAttribute('aria-label') || '';
      const am = aria.match(/@([A-Za-z0-9_]+)/) || aria.match(/([A-Za-z0-9_]+)/);
      if (am) return normalizeHandle(am[1]);
    }
    const switcher = d.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (switcher) {
      const aria = switcher.getAttribute('aria-label') || '';
      const am = aria.match(/@([A-Za-z0-9_]+)/);
      if (am) return normalizeHandle(am[1]);
      const t = (switcher.innerText || switcher.textContent || '');
      const tm = t.match(/@([A-Za-z0-9_]+)/);
      if (tm) return normalizeHandle(tm[1]);
    }
    const accountLink = d.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] a[href^="/"], header a[href^="/"][aria-label*="@"]');
    if (accountLink) {
      const href = accountLink.getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9_]+)\/?$/);
      if (m) return normalizeHandle(m[1]);
    }
  } catch (e) {}
  return '';
}

function getStatusIdFromPathname(pathname) {
  try {
    let path = '';
    if (pathname != null) path = String(pathname);
    else {
      const loc = (typeof window !== 'undefined' && window.location)
        || (typeof location !== 'undefined' && location)
        || null;
      path = String((loc && loc.pathname) || '');
    }
    const m = path.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

function articleStatusId(article) {
  if (!article) return null;
  try {
    const time = article.querySelector('a[href*="/status/"] time');
    if (time) {
      const a = time.closest('a[href*="/status/"]');
      const href = a ? (a.getAttribute('href') || '') : '';
      const m = href.match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute('href') || '';
      if (/\/status\/\d+\/(?:photo|video|analytics)/.test(href)) continue;
      const m = href.match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
  } catch (e) {}
  return null;
}

function getPrimaryStatusArticle(doc) {
  const d = doc || document;
  if (!isConversationStatusPage()) return null;
  const pageStatusId = getStatusIdFromPathname();
  const articles = Array.from(d.querySelectorAll('article[data-testid="tweet"]'));
  if (!articles.length) return null;
  if (!pageStatusId) return articles[0];
  for (let i = 0; i < articles.length; i++) {
    if (articleStatusId(articles[i]) === pageStatusId) return articles[i];
  }
  return articles[0];
}

function getPrimaryStatusAuthorHandle(doc) {
  const primary = getPrimaryStatusArticle(doc);
  return getArticleAuthorHandle(primary);
}

function isOwnPostCleanerGate(doc) {
  if (!isConversationStatusPage()) {
    return { ok: false, reason: 'not_status', message: OWN_REPLIES_GATE_LABEL };
  }
  const viewer = getViewerHandleFromDom(doc);
  const author = getPrimaryStatusAuthorHandle(doc);
  if (!viewer || !author) {
    return { ok: false, reason: 'uncertain', message: OWN_REPLIES_GATE_LABEL, viewer, author };
  }
  if (viewer !== author) {
    return { ok: false, reason: 'not_own', message: OWN_REPLIES_GATE_LABEL, viewer, author };
  }
  return { ok: true, reason: 'own', message: '', viewer, author };
}

function extractOwnReplyTweetText(article) {
  if (!article) return '';
  try {
    const el = article.querySelector('[data-testid="tweetText"]');
    if (!el) return '';
    return (el.innerText || el.textContent || '').trim();
  } catch (e) {
    return '';
  }
}

function getOwnStatusReplyArticles(doc) {
  const d = doc || document;
  if (!isConversationStatusPage()) return [];
  const pageStatusId = getStatusIdFromPathname();
  const primary = getPrimaryStatusArticle(d);
  const articles = Array.from(d.querySelectorAll('article[data-testid="tweet"]'));
  const replies = [];
  for (let i = 0; i < articles.length; i++) {
    const art = articles[i];
    if (!(art instanceof HTMLElement)) continue;
    if (primary && art === primary) continue;
    if (pageStatusId && articleStatusId(art) === pageStatusId) continue;
    const text = extractOwnReplyTweetText(art);
    const norm = normalizeOwnReplyText(text);
    replies.push({ article: art, text, norm });
  }
  return replies;
}

function capOwnRepliesSelection(items, maxN) {
  const max = typeof maxN === 'number' ? maxN : OWN_REPLIES_CLEANER_MAX;
  const list = Array.isArray(items) ? items : [];
  return list.slice(0, Math.max(0, max));
}

function isHideReplyMenuText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return false;
  if (t === 'hide reply' || t === 'hide') return true;
  if (t.includes('hide reply')) return true;
  if (t.includes('隐藏回复')) return true;
  if (t.includes('隱藏回覆')) return true;
  if (t.includes('返信を非表示') || t.includes('返信を隠す')) return true;
  return false;
}

function isBannedDeletePostLabel(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return false;
  // Hard-ban: never click Delete post / 删除帖子 (or confirm copy) on cleaner path
  if (t.includes('delete post')) return true;
  if (t.includes('删除帖子') || t.includes('刪除帖子') || t.includes('刪除貼文')) return true;
  if (t.includes('delete this post')) return true;
  return false;
}

function isDeleteMenuText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return false;
  if (isBannedDeletePostLabel(t)) return true;
  if (t === 'delete' || t === 'delete reply') return true;
  if (t.includes('delete reply')) return true;
  if (t === '删除' || t === '刪除' || t.includes('删除') || t.includes('刪除')) return true;
  if (t.includes('削除')) return true;
  return false;
}

function menuItemLabel(el) {
  if (!el) return '';
  return (
    el.getAttribute('aria-label') ||
    el.innerText ||
    el.textContent ||
    ''
  ).replace(/\s+/g, ' ').trim();
}

function dialogDeleteConfirmText(dialog) {
  if (!dialog) return '';
  return String(
    dialog.innerText ||
    dialog.textContent ||
    dialog.getAttribute('aria-label') ||
    ''
  ).replace(/\s+/g, ' ').trim().toLowerCase();
}

function isDeletePostConfirmText(txt) {
  const t = String(txt || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return false;
  if (isBannedDeletePostLabel(t)) return true;
  if (/(delete post|delete this post|删除帖子|刪除帖子|刪除貼文)/i.test(t)) return true;
  return false;
}

function isReplyDeleteConfirmText(txt, opts) {
  const options = opts || {};
  const t = String(txt || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return false;
  const allowPostWording = !!(options.allowPostWording || options.fromReplyArticle);
  // Soften only for reply-article Delete path: X often titles the sheet "Delete post?"
  if (isDeletePostConfirmText(t)) return allowPostWording;
  // Reply-level confirm copy: Delete / Delete reply / 删除
  if (/(delete reply|删除回复|刪除回覆|返信を削除)/i.test(t)) return true;
  if (/(^|\b)(delete|删除|刪除|削除)(\b|$)/i.test(t)) return true;
  return false;
}

function findDeleteConfirmDialogRoot(el) {
  if (!el || !el.closest) return null;
  try {
    return (
      el.closest(
        '[role="alertdialog"], [data-testid="confirmationSheetDialog"], [data-testid="confirmationSheetConfirm"], [data-testid="confirmationSheetCancel"]'
      ) || el.closest('[role="dialog"]')
    );
  } catch (e) {
    return null;
  }
}

function isInsideDeleteConfirmDialog(el) {
  // Hard-ban detector: only Delete POST confirm sheets (never reply delete confirms)
  if (!el) return false;
  try {
    const dialog = findDeleteConfirmDialogRoot(el);
    if (!dialog) return false;
    return isDeletePostConfirmText(dialogDeleteConfirmText(dialog));
  } catch (e) {
    return false;
  }
}

function isInsideReplyDeleteConfirmDialog(el) {
  if (!el) return false;
  try {
    const dialog = findDeleteConfirmDialogRoot(el);
    if (!dialog) return false;
    return isReplyDeleteConfirmText(dialogDeleteConfirmText(dialog));
  } catch (e) {
    return false;
  }
}

function findReplyDeleteConfirmControl(scope, opts) {
  const options = opts || {};
  const allowPostWording = !!(options.allowPostWording || options.fromReplyArticle);
  const root = scope || document;
  if (!root || !root.querySelectorAll) return null;
  const dialogs = Array.from(
    root.querySelectorAll(
      '[role="alertdialog"], [data-testid="confirmationSheetDialog"], [role="dialog"]'
    )
  );
  for (let i = 0; i < dialogs.length; i++) {
    const dialog = dialogs[i];
    const txt = dialogDeleteConfirmText(dialog);
    if (!isReplyDeleteConfirmText(txt, { allowPostWording: allowPostWording, fromReplyArticle: allowPostWording })) {
      continue;
    }
    const confirm =
      dialog.querySelector('[data-testid="confirmationSheetConfirm"]') ||
      dialog.querySelector('button[data-testid="confirmationSheetConfirm"]');
    if (confirm) {
      const cLabel = menuItemLabel(confirm);
      // confirmationSheetConfirm is OK even when sheet title is "Delete post?" (reply-context only)
      if (!cLabel || !isBannedDeletePostLabel(cLabel) || allowPostWording) {
        // Still never return a control whose own label is exactly a banned Delete-post menu label
        // unless it is the sheet confirm button (testid) under reply-context allow.
        const testId = (confirm.getAttribute && confirm.getAttribute('data-testid')) || '';
        if (testId === 'confirmationSheetConfirm') return confirm;
        if (!isBannedDeletePostLabel(cLabel)) return confirm;
      }
    }
    const buttons = dialog.querySelectorAll('button, [role="button"]');
    for (let j = 0; j < buttons.length; j++) {
      const btn = buttons[j];
      const label = menuItemLabel(btn);
      if (!label) continue;
      const low = label.toLowerCase();
      if (/cancel|取消|nevermind|not now/i.test(low)) continue;
      const testId = (btn.getAttribute && btn.getAttribute('data-testid')) || '';
      if (testId === 'confirmationSheetCancel') continue;
      // Do not globally allow clicking a "Delete post" *menu* label; sheet confirm "Delete" is fine.
      if (isBannedDeletePostLabel(label) && testId !== 'confirmationSheetConfirm') continue;
      if (
        testId === 'confirmationSheetConfirm' ||
        isDeleteMenuText(label) ||
        /^delete$/i.test(label) ||
        label === '删除' ||
        label === '刪除'
      ) {
        return btn;
      }
    }
  }
  return null;
}

function findOpenDeleteConfirmDialog(scope) {
  const root = scope || document;
  if (!root || !root.querySelectorAll) return null;
  // Prefer X confirmation sheets; avoid QuietX overlay [role=dialog] false-positives
  const preferred = Array.from(
    root.querySelectorAll('[role="alertdialog"], [data-testid="confirmationSheetDialog"]')
  );
  const fallback = Array.from(root.querySelectorAll('[role="dialog"]')).filter((d) => {
    const id = (d.getAttribute && d.getAttribute('id')) || '';
    const testId = (d.getAttribute && d.getAttribute('data-testid')) || '';
    if (id === OWN_REPLIES_CONFIRM_ID) return false;
    if (testId === 'confirmationSheetDialog') return false; // already in preferred
    return true;
  });
  const dialogs = preferred.concat(fallback);
  for (let i = 0; i < dialogs.length; i++) {
    const dialog = dialogs[i];
    const txt = dialogDeleteConfirmText(dialog);
    if (
      isDeletePostConfirmText(txt) ||
      isReplyDeleteConfirmText(txt) ||
      isReplyDeleteConfirmText(txt, { allowPostWording: true })
    ) {
      return dialog;
    }
  }
  return null;
}

function findConfirmationSheetCancelControl(scope) {
  const root = scope || document;
  if (!root || !root.querySelectorAll) return null;
  const dialog = findOpenDeleteConfirmDialog(root);
  if (!dialog) return null;
  const byTestId =
    dialog.querySelector('[data-testid="confirmationSheetCancel"]') ||
    dialog.querySelector('button[data-testid="confirmationSheetCancel"]');
  if (byTestId) return byTestId;
  const buttons = dialog.querySelectorAll('button, [role="button"]');
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const label = menuItemLabel(btn);
    const low = String(label || '').toLowerCase();
    if (/^(cancel|取消|nevermind|not now)$/i.test(low) || /cancel|取消/i.test(low)) {
      const testId = (btn.getAttribute && btn.getAttribute('data-testid')) || '';
      if (testId === 'confirmationSheetConfirm') continue;
      return btn;
    }
  }
  return null;
}

function cancelOpenDeleteConfirmDialog(scope) {
  const cancelBtn = findConfirmationSheetCancelControl(scope);
  if (!cancelBtn) return false;
  return ownRepliesClick(cancelBtn, { allowCancelInDeleteConfirm: true });
}

function getOpenMenuRoots(scope) {
  const root = scope || document;
  if (root && root.getAttribute) {
    const role = root.getAttribute('role') || '';
    const testId = root.getAttribute('data-testid') || '';
    if (role === 'menu' || testId === 'Dropdown') return [root];
  }
  if (!root || !root.querySelectorAll) return [];
  return Array.from(root.querySelectorAll('[role="menu"], [data-testid="Dropdown"]'));
}

function isMenuItemRole(el) {
  if (!el || !el.getAttribute) return false;
  const role = el.getAttribute('role') || '';
  return role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio';
}

function clickableMenuTarget(el, root) {
  if (!el) return null;
  let cur = el;
  while (cur && cur !== root) {
    if (isMenuItemRole(cur)) return cur;
    const role = (cur.getAttribute && cur.getAttribute('role')) || '';
    if (role === 'button') return cur;
    const tag = cur.tagName || '';
    if (tag === 'BUTTON' || tag === 'A') return cur;
    if (cur.getAttribute) {
      const tab = cur.getAttribute('tabindex');
      if (tab === '0' || tab === '-1') return cur;
    }
    cur = cur.parentElement;
  }
  return el;
}

function findMenuItems(scope) {
  // Scoped to open [role="menu"] / Dropdown only — never page-wide button scrape
  const roots = getOpenMenuRoots(scope);
  const items = [];
  const seen = new Set();
  const add = (el) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    items.push(el);
  };
  const underCollected = (el) => {
    for (let j = 0; j < items.length; j++) {
      if (items[j].contains(el)) return true;
    }
    return false;
  };

  for (let r = 0; r < roots.length; r++) {
    const root = roots[r];
    if (!root || !root.querySelectorAll) continue;

    // ARIA menu items — X may use checkbox/radio variants too
    const roleNodes = root.querySelectorAll(
      '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
    );
    for (let i = 0; i < roleNodes.length; i++) add(roleNodes[i]);

    // Labeled clickable rows inside this menu/Dropdown only
    const clickable = root.querySelectorAll(
      'button, a, [role="button"], [tabindex="0"], [tabindex="-1"], [aria-label]'
    );
    for (let i = 0; i < clickable.length; i++) {
      const el = clickable[i];
      if (seen.has(el) || el === root) continue;
      if (el.closest && el.closest('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')) {
        continue;
      }
      if (underCollected(el)) continue;
      const label = menuItemLabel(el);
      if (!label || label.length < 2 || label.length > 96) continue;
      const elRole = el.getAttribute('role') || '';
      const elTestId = el.getAttribute('data-testid') || '';
      if (elRole === 'menu' || elTestId === 'Dropdown') continue;
      add(el);
    }

    // Short text-labeled rows when X omits menuitem roles (still menu-scoped)
    const textNodes = root.querySelectorAll('div, span, li');
    for (let i = 0; i < textNodes.length; i++) {
      const el = textNodes[i];
      if (seen.has(el) || el === root) continue;
      if (el.closest && el.closest('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')) {
        continue;
      }
      if (underCollected(el)) continue;
      const label = menuItemLabel(el);
      if (!label || label.length < 2 || label.length > 64) continue;
      if (el.children && el.children.length > 8) continue;
      add(clickableMenuTarget(el, root) || el);
    }
  }
  return items;
}

function findHideReplyControl(scope) {
  const items = findMenuItems(scope);
  const roots = getOpenMenuRoots(scope);
  for (let i = 0; i < items.length; i++) {
    const label = menuItemLabel(items[i]);
    if (isBannedDeletePostLabel(label) || isDeleteMenuText(label)) continue;
    if (!isHideReplyMenuText(label)) continue;
    let root = roots[0] || null;
    for (let r = 0; r < roots.length; r++) {
      if (roots[r] && roots[r].contains && roots[r].contains(items[i])) {
        root = roots[r];
        break;
      }
    }
    return clickableMenuTarget(items[i], root) || items[i];
  }
  return null;
}

function findDeleteControl(scope) {
  // Reply-level Delete / Delete reply / 删除 only — never Delete post.
  const items = findMenuItems(scope);
  for (let i = 0; i < items.length; i++) {
    const label = menuItemLabel(items[i]);
    if (isBannedDeletePostLabel(label)) continue;
    if (isDeleteMenuText(label)) return items[i];
  }
  return null;
}

function preferHideOverDelete(scope) {
  // Prefer Hide reply when present; else allow reply-level Delete / 删除.
  // Hard ban: Delete post / 删除帖子 never preferred.
  const hide = findHideReplyControl(scope);
  if (hide) return { action: 'hide', control: hide };
  const del = findDeleteControl(scope);
  if (del) {
    const label = menuItemLabel(del);
    if (!isBannedDeletePostLabel(label) && isDeleteMenuText(label)) {
      return { action: 'delete', control: del };
    }
  }
  return null;
}

function findCaretButton(article) {
  if (!article) return null;
  const caret = article.querySelector('[data-testid="caret"]');
  if (caret) return caret;
  const more = article.querySelector('[aria-label="More"], [aria-label="更多"], [aria-haspopup="menu"]');
  return more || null;
}

function ownRepliesSleep(ms) {
  if (typeof ownRepliesCleanerHooks.sleep === 'function') {
    return Promise.resolve(ownRepliesCleanerHooks.sleep(ms));
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ownRepliesClick(el, opts) {
  if (!el) return false;
  const options = opts || {};
  const label = menuItemLabel(el);
  const testId = (el.getAttribute && el.getAttribute('data-testid')) || '';
  const isCancelControl =
    testId === 'confirmationSheetCancel' ||
    options.allowCancelInDeleteConfirm ||
    /^(cancel|取消|nevermind|not now)$/i.test(String(label || '').trim());
  // Hard-ban: never click a control labeled Delete post / 删除帖子 (menu item)
  if (isBannedDeletePostLabel(label) && testId !== 'confirmationSheetConfirm') {
    return false;
  }
  // Default: refuse clicks inside post-confirm sheets. Exceptions:
  // - Cancel (safe dismiss)
  // - reply-context confirm (allowReplyDeleteConfirm) for X's "Delete post?" after reply Delete
  if (isInsideDeleteConfirmDialog(el) && !isCancelControl && !options.allowReplyDeleteConfirm) {
    return false;
  }
  if (typeof ownRepliesCleanerHooks.click === 'function') {
    ownRepliesCleanerHooks.click(el);
    return true;
  }
  try {
    el.click();
    return true;
  } catch (e) {
    return false;
  }
}

function buildOwnRepliesConfirmMessage(n) {
  return `Clean ${n} similar replies? Hide reply when available, else Delete reply — never delete the post.`;
}

function showOwnRepliesConfirmDialog(n, opts) {
  const options = opts || {};
  const existing = document.getElementById(OWN_REPLIES_CONFIRM_ID);
  if (existing) existing.remove();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = OWN_REPLIES_CONFIRM_ID;
    overlay.className = 'quietx-own-replies-confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const box = document.createElement('div');
    box.className = 'quietx-own-replies-confirm';
    const msg = document.createElement('div');
    msg.className = 'quietx-own-replies-confirm-msg';
    msg.textContent = buildOwnRepliesConfirmMessage(n);
    msg.setAttribute('data-count', String(n));

    const actions = document.createElement('div');
    actions.className = 'quietx-own-replies-confirm-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'quietx-own-replies-btn quietx-own-replies-btn-cancel';
    cancelBtn.textContent = 'Cancel';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'quietx-own-replies-btn quietx-own-replies-btn-confirm';
    confirmBtn.textContent = 'Confirm';

    const finish = (value) => {
      try { overlay.remove(); } catch (e) {}
      resolve(value);
    };
    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    box.appendChild(msg);
    box.appendChild(actions);
    overlay.appendChild(box);
    (options.parent || document.body).appendChild(overlay);
  });
}

async function waitForHideReplyControl(scope, opts) {
  // Poll until Hide reply or reply-level Delete appears (X Dropdown can paint late)
  const options = opts || {};
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : OWN_REPLIES_MENU_WAIT_MS;
  const pollMs = typeof options.pollMs === 'number' ? options.pollMs : OWN_REPLIES_MENU_POLL_MS;
  let waited = 0;
  while (true) {
    const preferred = preferHideOverDelete(scope);
    if (preferred && preferred.control) return preferred.control;
    if (waited >= timeoutMs) return null;
    const step = Math.min(pollMs, Math.max(1, timeoutMs - waited));
    await ownRepliesSleep(step);
    waited += step;
  }
}

async function hideOrDeleteOneOwnReply(article, opts) {
  const options = opts || {};
  const openMenu = options.openMenu !== false;
  // Default: only the open menu/dropdown — never whole-document button scrape
  const scope = options.menuScope || document;
  const menuWaitMs = typeof options.menuWaitMs === 'number' ? options.menuWaitMs : OWN_REPLIES_MENU_WAIT_MS;
  const confirmWaitMs = typeof options.confirmWaitMs === 'number' ? options.confirmWaitMs : 600;
  const confirmPollMs = typeof options.confirmPollMs === 'number' ? options.confirmPollMs : OWN_REPLIES_MENU_POLL_MS;

  // Hard ban: never operate Delete on the root/main status article
  try {
    const primary = getPrimaryStatusArticle(document);
    if (primary && article && article === primary) {
      cancelOpenDeleteConfirmDialog(document);
      return {
        ok: false,
        error: 'banned_delete',
        message: OWN_REPLIES_MISSING_HIDE_MSG
      };
    }
  } catch (e) {}

  if (openMenu) {
    const caret = findCaretButton(article);
    if (!caret) {
      return { ok: false, error: 'missing_caret', message: 'Can\'t find More menu button. Stopped.' };
    }
    ownRepliesClick(caret);
    // Poll until Hide or Delete reply appears (X Dropdown can paint after caret) or timeout
    await waitForHideReplyControl(scope, {
      timeoutMs: menuWaitMs,
      pollMs: typeof options.menuPollMs === 'number' ? options.menuPollMs : OWN_REPLIES_MENU_POLL_MS
    });
  }

  const preferred = preferHideOverDelete(scope);
  if (!preferred || !preferred.control) {
    return {
      ok: false,
      error: 'missing_hide',
      message: OWN_REPLIES_MISSING_HIDE_MSG
    };
  }
  const label = menuItemLabel(preferred.control);
  if (
    isBannedDeletePostLabel(label) ||
    isInsideDeleteConfirmDialog(preferred.control) ||
    (preferred.action !== 'hide' && preferred.action !== 'delete')
  ) {
    cancelOpenDeleteConfirmDialog(document);
    return {
      ok: false,
      error: 'banned_delete',
      message: OWN_REPLIES_MISSING_HIDE_MSG
    };
  }
  if (preferred.action === 'delete' && isBannedDeletePostLabel(label)) {
    cancelOpenDeleteConfirmDialog(document);
    return {
      ok: false,
      error: 'banned_delete',
      message: OWN_REPLIES_MISSING_HIDE_MSG
    };
  }
  const clicked = ownRepliesClick(preferred.control);
  if (clicked === false) {
    cancelOpenDeleteConfirmDialog(document);
    return {
      ok: false,
      error: 'banned_delete',
      message: OWN_REPLIES_MISSING_HIDE_MSG
    };
  }
  if (preferred.action === 'hide') {
    return { ok: true, action: 'hide' };
  }

  // After Delete from a *reply* article: X may show "Delete post?" — allow confirm only in this reply context.
  const replyConfirmOpts = { allowPostWording: true, fromReplyArticle: true };
  let waited = 0;
  while (waited < confirmWaitMs) {
    const confirmBtn = findReplyDeleteConfirmControl(document, replyConfirmOpts);
    if (confirmBtn) {
      const cLabel = menuItemLabel(confirmBtn);
      const cTestId = (confirmBtn.getAttribute && confirmBtn.getAttribute('data-testid')) || '';
      // Refuse if control itself is a banned Delete-post *menu* label (not sheet confirm)
      if (isBannedDeletePostLabel(cLabel) && cTestId !== 'confirmationSheetConfirm') {
        cancelOpenDeleteConfirmDialog(document);
        return {
          ok: false,
          error: 'banned_delete',
          message: OWN_REPLIES_MISSING_HIDE_MSG
        };
      }
      const confirmed = ownRepliesClick(confirmBtn, { allowReplyDeleteConfirm: true });
      if (confirmed === false) {
        cancelOpenDeleteConfirmDialog(document);
        return {
          ok: false,
          error: 'banned_delete',
          message: OWN_REPLIES_MISSING_HIDE_MSG
        };
      }
      return { ok: true, action: 'delete' };
    }
    const step = Math.min(confirmPollMs, Math.max(1, confirmWaitMs - waited));
    await ownRepliesSleep(step);
    waited += step;
  }

  // Never report success while a delete confirm dialog is still open unconfirmed
  const stillOpen = findOpenDeleteConfirmDialog(document);
  if (stillOpen) {
    cancelOpenDeleteConfirmDialog(document);
    return {
      ok: false,
      error: 'confirm_timeout',
      message: OWN_REPLIES_MISSING_HIDE_MSG
    };
  }
  // Some X builds delete the reply with no confirm sheet
  return { ok: true, action: 'delete' };
}

async function runOwnRepliesCleaner(articles, opts) {
  const options = opts || {};
  const intervalMs = typeof options.intervalMs === 'number' ? options.intervalMs : OWN_REPLIES_CLEANER_INTERVAL_MS;
  const capped = capOwnRepliesSelection(articles, options.maxN || OWN_REPLIES_CLEANER_MAX);
  const results = [];
  ownRepliesCleanerLastError = '';

  if (!capped.length) {
    return { ok: true, done: 0, results, stopped: false, error: '' };
  }

  ownRepliesCleanerRunning = true;
  try {
    for (let i = 0; i < capped.length; i++) {
      const item = capped[i];
      const article = item && item.article ? item.article : item;
      const one = await hideOrDeleteOneOwnReply(article, options);
      results.push(one);
      if (!one.ok) {
        ownRepliesCleanerLastError = one.message || one.error || 'stopped';
        return {
          ok: false,
          done: results.filter((r) => r.ok).length,
          results,
          stopped: true,
          error: ownRepliesCleanerLastError
        };
      }
      if (i < capped.length - 1) {
        await ownRepliesSleep(intervalMs);
      }
    }
    return { ok: true, done: results.length, results, stopped: false, error: '' };
  } finally {
    ownRepliesCleanerRunning = false;
  }
}

function ensureOwnReplyCheckbox(article) {
  if (!article || !article.querySelector) return null;
  let label = article.querySelector('.' + OWN_REPLIES_CHECK_CLASS);
  if (label) return label.querySelector('input') || label;
  label = document.createElement('label');
  label.className = OWN_REPLIES_CHECK_CLASS;
  label.setAttribute('title', 'Select to clean');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('aria-label', 'Select this reply');
  input.addEventListener('change', () => {
    if (input.checked) article.setAttribute(OWN_REPLIES_SELECTED_ATTR, '1');
    else article.removeAttribute(OWN_REPLIES_SELECTED_ATTR);
    updateOwnRepliesPanelCounts();
  });
  label.appendChild(input);
  try {
    article.style.position = article.style.position || 'relative';
    article.insertBefore(label, article.firstChild);
  } catch (e) {
    article.appendChild(label);
  }
  return input;
}

function clearOwnReplyCheckboxes(doc) {
  const d = doc || document;
  d.querySelectorAll('.' + OWN_REPLIES_CHECK_CLASS).forEach((el) => {
    try { el.remove(); } catch (e) {}
  });
  d.querySelectorAll('[' + OWN_REPLIES_SELECTED_ATTR + ']').forEach((el) => {
    el.removeAttribute(OWN_REPLIES_SELECTED_ATTR);
  });
  d.querySelectorAll('[' + OWN_REPLIES_NEAR_DUP_ATTR + ']').forEach((el) => {
    el.removeAttribute(OWN_REPLIES_NEAR_DUP_ATTR);
  });
}

function selectNearDuplicateOwnReplies() {
  const replies = getOwnStatusReplyArticles();
  const clusters = clusterNearDuplicateReplies(replies);
  const selected = [];
  for (let c = 0; c < clusters.length; c++) {
    const group = clusters[c];
    for (let i = 0; i < group.length; i++) {
      const art = group[i].article;
      if (!art) continue;
      art.setAttribute(OWN_REPLIES_NEAR_DUP_ATTR, '1');
      const input = ensureOwnReplyCheckbox(art);
      if (input && 'checked' in input) {
        input.checked = true;
        art.setAttribute(OWN_REPLIES_SELECTED_ATTR, '1');
      }
      selected.push(group[i]);
    }
  }
  updateOwnRepliesPanelCounts();
  return selected;
}

function ownRepliesFingerprint(replies) {
  const list = Array.isArray(replies) ? replies : [];
  const ids = [];
  for (let i = 0; i < list.length; i++) {
    const art = list[i] && list[i].article;
    const sid = art ? (articleStatusId(art) || '') : '';
    ids.push(sid || ('i' + i));
  }
  ids.sort();
  return String(list.length) + ':' + ids.join(',');
}

function maybeAutoSelectNearDuplicateOwnReplies(replies) {
  // Unused (investor override Alex 2026-09-06): no auto-select on open / growth.
  // Kept for API stability; Select similar calls selectNearDuplicateOwnReplies directly.
  const list = Array.isArray(replies) ? replies : getOwnStatusReplyArticles();
  ownRepliesAutoSelectFingerprint = ownRepliesFingerprint(list);
  return [];
}

function getSelectedOwnReplyArticles() {
  const replies = getOwnStatusReplyArticles();
  return replies.filter((r) => r.article && r.article.getAttribute(OWN_REPLIES_SELECTED_ATTR) === '1');
}

function updateOwnRepliesPanelCounts() {
  const panel = document.getElementById(OWN_REPLIES_PANEL_ID);
  if (!panel) return;
  const countEl = panel.querySelector('[data-own-replies-count]');
  const selected = getSelectedOwnReplyArticles();
  const n = Math.min(selected.length, OWN_REPLIES_CLEANER_MAX);
  if (countEl) countEl.textContent = String(n);
  const runBtn = panel.querySelector('[data-own-replies-run]');
  if (runBtn) {
    const gated = panel.classList.contains('is-disabled');
    runBtn.disabled = gated || n < 1 || ownRepliesCleanerRunning;
  }
  const selectBtn = panel.querySelector('[data-own-replies-select]');
  if (selectBtn) {
    selectBtn.disabled = panel.classList.contains('is-disabled') || ownRepliesCleanerRunning;
  }
}

function persistOwnRepliesPanelLayout() {
  const panel = document.getElementById(OWN_REPLIES_PANEL_ID);
  if (!panel) return;
  const left = parseInt(panel.style.left, 10);
  const top = parseInt(panel.style.top, 10);
  const payload = {};
  if (Number.isFinite(left)) payload[OWN_REPLIES_PANEL_LEFT_KEY] = left;
  if (Number.isFinite(top)) payload[OWN_REPLIES_PANEL_TOP_KEY] = top;
  payload[OWN_REPLIES_PANEL_COLLAPSED_KEY] = !!ownRepliesPanelCollapsed;
  try {
    chrome.storage.local.set(payload, () => {});
  } catch (e) {}
}

function applyOwnRepliesPanelCollapsed(panel, collapsed) {
  if (!panel) return;
  ownRepliesPanelCollapsed = !!collapsed;
  panel.classList.toggle('is-collapsed', ownRepliesPanelCollapsed);
  const toggle = panel.querySelector('[data-own-replies-collapse]');
  if (toggle) {
    toggle.textContent = ownRepliesPanelCollapsed ? '▢' : '×';
    toggle.setAttribute('aria-label', ownRepliesPanelCollapsed ? 'Expand cleaner' : 'Close panel');
    toggle.title = ownRepliesPanelCollapsed ? 'Expand' : 'Minimize';
  }
  const chip = panel.querySelector('[data-own-replies-chip]');
  if (chip) chip.hidden = !ownRepliesPanelCollapsed;
}

function bindOwnRepliesPanelDrag(panel) {
  if (!panel || ownRepliesPanelDragBound) return;
  const handles = Array.from(panel.querySelectorAll('[data-own-replies-drag]'));
  if (!handles.length) return;
  ownRepliesPanelDragBound = true;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  let isDragging = false;
  let didMove = false;
  let activeHandle = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let nextLeft = 0;
  let nextTop = 0;
  let frame = 0;

  const applyPos = (left, top) => {
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    nextLeft = clamp(left, 8, maxLeft);
    nextTop = clamp(top, 8, maxTop);
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = nextLeft + 'px';
    panel.style.top = nextTop + 'px';
  };

  try {
    chrome.storage.local.get(
      [OWN_REPLIES_PANEL_LEFT_KEY, OWN_REPLIES_PANEL_TOP_KEY, OWN_REPLIES_PANEL_COLLAPSED_KEY],
      (result) => {
        const left = result && result[OWN_REPLIES_PANEL_LEFT_KEY];
        const top = result && result[OWN_REPLIES_PANEL_TOP_KEY];
        if (typeof left === 'number' && typeof top === 'number') {
          applyPos(left, top);
        }
        if (result && typeof result[OWN_REPLIES_PANEL_COLLAPSED_KEY] === 'boolean') {
          applyOwnRepliesPanelCollapsed(panel, result[OWN_REPLIES_PANEL_COLLAPSED_KEY]);
        }
      }
    );
  } catch (e) {}

  const startDrag = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('[data-own-replies-collapse]')) return;
    const handle = e.currentTarget;
    activeHandle = handle;
    const rect = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    nextLeft = startLeft;
    nextTop = startTop;
    didMove = false;
    isDragging = true;
    panel.classList.add('is-dragging');
    try { handle.setPointerCapture?.(e.pointerId); } catch (err) {}
  };

  const moveDrag = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) didMove = true;
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    nextLeft = clamp(startLeft + dx, 8, maxLeft);
    nextTop = clamp(startTop + dy, 8, maxTop);
    // Apply immediately so collapsed-chip drag persists even if rAF is delayed.
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = nextLeft + 'px';
    panel.style.top = nextTop + 'px';
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = nextLeft + 'px';
        panel.style.top = nextTop + 'px';
      });
    }
  };

  const endDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    panel.classList.remove('is-dragging');
    const handle = activeHandle;
    activeHandle = null;
    if (handle && e && e.pointerId !== undefined) {
      try { handle.releasePointerCapture?.(e.pointerId); } catch (err) {}
    }
    if (didMove) {
      // Ensure final coords are written before persist (same keys as expanded drag).
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = nextLeft + 'px';
      panel.style.top = nextTop + 'px';
      persistOwnRepliesPanelLayout();
      panel.dataset.quietxSuppressClick = '1';
      setTimeout(() => {
        if (panel.dataset.quietxSuppressClick === '1') delete panel.dataset.quietxSuppressClick;
      }, 150);
    }
  };

  handles.forEach((handle) => {
    handle.addEventListener('pointerdown', startDrag);
    handle.addEventListener('pointermove', moveDrag);
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  });
}

function ensureOwnRepliesCleanerPanelShell() {
  let panel = document.getElementById(OWN_REPLIES_PANEL_ID);
  if (panel && panel.getAttribute('data-shell') === '1') return panel;

  if (!panel) {
    panel = document.createElement('div');
    panel.id = OWN_REPLIES_PANEL_ID;
    panel.className = 'quietx-own-replies-cleaner';
    document.body.appendChild(panel);
  } else {
    panel.innerHTML = '';
    panel.className = 'quietx-own-replies-cleaner';
  }
  panel.setAttribute('data-shell', '1');
  ownRepliesPanelDragBound = false;

  const header = document.createElement('div');
  header.className = 'quietx-own-replies-header';
  header.setAttribute('data-own-replies-drag', '1');

  const title = document.createElement('div');
  title.className = 'quietx-own-replies-title';
  title.textContent = 'Clean similar replies';

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'quietx-own-replies-collapse';
  collapseBtn.setAttribute('data-own-replies-collapse', '1');
  collapseBtn.textContent = '×';
  collapseBtn.setAttribute('aria-label', 'Close panel');
  collapseBtn.title = 'Minimize';
  collapseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (panel.dataset.quietxSuppressClick === '1') return;
    applyOwnRepliesPanelCollapsed(panel, !ownRepliesPanelCollapsed);
    persistOwnRepliesPanelLayout();
  });

  header.appendChild(title);
  header.appendChild(collapseBtn);

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'quietx-own-replies-chip';
  chip.setAttribute('data-own-replies-chip', '1');
  chip.setAttribute('data-own-replies-drag', '1');
  chip.textContent = 'Cleaner';
  chip.hidden = true;
  chip.setAttribute('aria-label', 'Expand cleaner');
  chip.title = 'Drag to move · click to expand';
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (panel.dataset.quietxSuppressClick === '1') return;
    applyOwnRepliesPanelCollapsed(panel, false);
    persistOwnRepliesPanelLayout();
  });

  const body = document.createElement('div');
  body.className = 'quietx-own-replies-body';
  body.setAttribute('data-own-replies-body', '1');

  const gate = document.createElement('div');
  gate.className = 'quietx-own-replies-gate';
  gate.setAttribute('data-own-replies-gate', '1');
  gate.hidden = true;

  const meta = document.createElement('div');
  meta.className = 'quietx-own-replies-meta';
  meta.setAttribute('data-own-replies-meta', '1');
  meta.innerHTML = '<span data-own-replies-count>0</span> selected · max ' + OWN_REPLIES_CLEANER_MAX;

  const actions = document.createElement('div');
  actions.className = 'quietx-own-replies-actions';

  const clusterBtn = document.createElement('button');
  clusterBtn.type = 'button';
  clusterBtn.className = 'quietx-own-replies-btn quietx-own-replies-btn-secondary';
  clusterBtn.textContent = 'Select similar';
  clusterBtn.setAttribute('data-own-replies-select', '1');
  clusterBtn.addEventListener('click', () => {
    selectNearDuplicateOwnReplies();
  });

  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'quietx-own-replies-btn quietx-own-replies-btn-primary';
  runBtn.textContent = 'Clean similar replies';
  runBtn.setAttribute('data-own-replies-run', '1');
  runBtn.disabled = true;
  runBtn.addEventListener('click', () => {
    void startOwnRepliesCleanerFromUI();
  });

  const err = document.createElement('div');
  err.className = 'quietx-own-replies-error';
  err.setAttribute('data-own-replies-error', '1');

  actions.appendChild(clusterBtn);
  actions.appendChild(runBtn);
  body.appendChild(gate);
  body.appendChild(meta);
  body.appendChild(actions);
  body.appendChild(err);

  panel.appendChild(header);
  panel.appendChild(chip);
  panel.appendChild(body);

  bindOwnRepliesPanelDrag(panel);
  applyOwnRepliesPanelCollapsed(panel, ownRepliesPanelCollapsed);
  return panel;
}

function updateOwnRepliesPanelError(text) {
  const panel = document.getElementById(OWN_REPLIES_PANEL_ID);
  if (!panel) return;
  const err = panel.querySelector('[data-own-replies-error]');
  if (err) err.textContent = text || '';
}

function removeOwnRepliesCleanerPanel() {
  const panel = document.getElementById(OWN_REPLIES_PANEL_ID);
  if (panel) {
    try { panel.remove(); } catch (e) {}
  }
  ownRepliesPanelDragBound = false;
  ownRepliesAutoSelectFingerprint = '';
  clearOwnReplyCheckboxes();
  const confirm = document.getElementById(OWN_REPLIES_CONFIRM_ID);
  if (confirm) {
    try { confirm.remove(); } catch (e) {}
  }
}

function renderOwnRepliesCleanerUI() {
  if (!isCleanerOwnRepliesEnabled) {
    removeOwnRepliesCleanerPanel();
    return { shown: false, reason: 'disabled' };
  }
  if (!isConversationStatusPage()) {
    removeOwnRepliesCleanerPanel();
    return { shown: false, reason: 'not_status' };
  }

  const gate = isOwnPostCleanerGate();
  const panel = ensureOwnRepliesCleanerPanelShell();
  const gateEl = panel.querySelector('[data-own-replies-gate]');
  const metaEl = panel.querySelector('[data-own-replies-meta]');
  const selectBtn = panel.querySelector('[data-own-replies-select]');
  const runBtn = panel.querySelector('[data-own-replies-run]');

  if (!gate.ok) {
    panel.classList.add('is-disabled');
    if (gateEl) {
      gateEl.hidden = false;
      gateEl.textContent = gate.message || OWN_REPLIES_GATE_LABEL;
      gateEl.setAttribute('data-gate-reason', gate.reason || 'blocked');
    }
    if (metaEl) metaEl.hidden = true;
    if (selectBtn) selectBtn.disabled = true;
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.title = OWN_REPLIES_GATE_LABEL;
    }
    clearOwnReplyCheckboxes();
    ownRepliesAutoSelectFingerprint = '';
    updateOwnRepliesPanelError(ownRepliesCleanerLastError);
    return { shown: true, enabled: false, reason: gate.reason };
  }

  panel.classList.remove('is-disabled');
  if (gateEl) {
    gateEl.hidden = true;
    gateEl.textContent = '';
    gateEl.removeAttribute('data-gate-reason');
  }
  if (metaEl) metaEl.hidden = false;
  if (runBtn) runBtn.removeAttribute('title');

  const replies = getOwnStatusReplyArticles();
  replies.forEach((r) => ensureOwnReplyCheckbox(r.article));
  // Investor override (Alex): do NOT auto-select on open — user clicks Select similar or checkboxes.

  updateOwnRepliesPanelError(ownRepliesCleanerLastError);
  updateOwnRepliesPanelCounts();
  return { shown: true, enabled: true, reason: 'own', replyCount: replies.length };
}

function refreshOwnRepliesCleanerLight() {
  // Scroll path: never rebuild panel; only sync checkboxes / counts when enabled.
  // Investor override (Alex): do NOT auto-select on reply growth.
  if (!isCleanerOwnRepliesEnabled) return;
  if (!isConversationStatusPage()) return;
  const panel = document.getElementById(OWN_REPLIES_PANEL_ID);
  if (!panel || panel.classList.contains('is-disabled')) {
    updateOwnRepliesPanelCounts();
    return;
  }
  const replies = getOwnStatusReplyArticles();
  replies.forEach((r) => ensureOwnReplyCheckbox(r.article));
  ownRepliesAutoSelectFingerprint = ownRepliesFingerprint(replies);
  updateOwnRepliesPanelCounts();
}

async function startOwnRepliesCleanerFromUI() {
  if (ownRepliesCleanerRunning) return { ok: false, error: 'busy' };
  const gate = isOwnPostCleanerGate();
  if (!gate.ok) {
    renderOwnRepliesCleanerUI();
    return { ok: false, error: gate.reason };
  }
  let selected = getSelectedOwnReplyArticles();
  selected = capOwnRepliesSelection(selected, OWN_REPLIES_CLEANER_MAX);
  const n = selected.length;
  if (n < 1) return { ok: false, error: 'none_selected' };

  const confirmed = await showOwnRepliesConfirmDialog(n);
  if (!confirmed) {
    return { ok: true, cancelled: true, done: 0 };
  }

  const result = await runOwnRepliesCleaner(selected, {
    intervalMs: OWN_REPLIES_CLEANER_INTERVAL_MS,
    maxN: OWN_REPLIES_CLEANER_MAX
  });
  updateOwnRepliesPanelError(result.error || (result.ok ? ('Processed ' + result.done) : ''));
  updateOwnRepliesPanelCounts();
  return result;
}

function scheduleOwnRepliesCleanerUI() {
  // Debounce ≥250ms: reset timer on each schedule so mutation storms collapse.
  if (ownRepliesCleanerScheduleTimer) {
    try { clearTimeout(ownRepliesCleanerScheduleTimer); } catch (e) {}
  }
  ownRepliesCleanerScheduled = true;
  const delay = Math.max(250, OWN_REPLIES_UI_DEBOUNCE_MS || 0);
  ownRepliesCleanerScheduleTimer = setTimeout(() => {
    ownRepliesCleanerScheduled = false;
    ownRepliesCleanerScheduleTimer = null;
    try {
      renderOwnRepliesCleanerUI();
    } catch (e) {}
  }, delay);
}

function initOwnRepliesCleaner() {
  scheduleOwnRepliesCleanerUI();
  try {
    const obs = new MutationObserver(() => scheduleOwnRepliesCleanerUI());
    obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
  } catch (e) {}
  window.addEventListener('popstate', scheduleOwnRepliesCleanerUI);
  // Scroll: counts/checkboxes only — never full panel rebuild.
  window.addEventListener('scroll', refreshOwnRepliesCleanerLight, { passive: true, capture: true });
}




// ---- Reader-side fold suspected bot replies (local DOM only; never Hide/Delete/Block/Mute) ----
// Mechanism: ONE chip per status page, parked INSIDE the topmost folded reply cellInnerDiv
// (never insert a naked sibling into X's timeline — that paints over the main post).
const FOLD_BOT_REPLIES_HIDDEN_CLASS = 'quietx-bot-fold-hidden';
const FOLD_BOT_REPLIES_CHIP_CLASS = 'quietx-bot-fold-chip';
const FOLD_BOT_REPLIES_CHIP_WRAP_CLASS = 'quietx-bot-fold-chip-wrap';
const FOLD_BOT_REPLIES_PRESSED_CLASS = 'quietx-bot-fold-chip-pressed';
const FOLD_BOT_REPLIES_ATTR = 'data-quietx-bot-fold';
const FOLD_BOT_REPLIES_EXPANDED_ATTR = 'data-quietx-bot-fold-expanded';
const FOLD_BOT_REPLIES_KEY_ATTR = 'data-quietx-bot-fold-key';
const FOLD_BOT_REPLIES_HOST_ATTR = 'data-quietx-bot-fold-host';
const FOLD_BOT_REPLIES_UI_DEBOUNCE_MS = 250;
const FOLD_BOT_REPLIES_PAGE_KEY = 'page';
const FOLD_BOT_PRESS_HOLD_MS = 500;

let foldBotRepliesScheduled = false;
let foldBotRepliesScheduleTimer = null;
let foldBotRepliesExpanded = false;
let foldBotRepliesLastPath = '';
let foldBotRepliesClickBound = false;
let foldBotExpandTimer = null;

function foldBotMarkPressed(chip) {
  if (!chip || !chip.classList) return;
  try { chip.classList.add(FOLD_BOT_REPLIES_PRESSED_CLASS); } catch (e) {}
}

function foldBotScheduleExpand(chip) {
  foldBotMarkPressed(chip);
  if (foldBotExpandTimer) {
    try { clearTimeout(foldBotExpandTimer); } catch (e) {}
  }
  // Keep the pressed chip on screen after pointerup so :active/pressed can paint
  // before restore removes it. pointerdown must not expand.
  foldBotExpandTimer = setTimeout(() => {
    foldBotExpandTimer = null;
    expandFoldBotReplies(document);
  }, FOLD_BOT_PRESS_HOLD_MS);
}

function foldBotExpandedStorageKey(pathname) {
  let path = pathname;
  if (path == null) {
    try {
      path = String((window.location && window.location.pathname) || '');
    } catch (e) {
      path = '';
    }
  }
  return 'quietx-fold-bot-expanded:' + String(path || '');
}

function foldBotReadExpandedFlag() {
  try {
    const key = foldBotExpandedStorageKey();
    if (!key) return false;
    return sessionStorage.getItem(key) === '1';
  } catch (e) {
    return !!foldBotRepliesExpanded;
  }
}

function foldBotWriteExpandedFlag(on) {
  foldBotRepliesExpanded = !!on;
  try {
    const key = foldBotExpandedStorageKey();
    if (!key) return;
    if (on) sessionStorage.setItem(key, '1');
    else sessionStorage.removeItem(key);
  } catch (e) {}
}

function getFoldBotReplyTarget(article) {
  if (!article || !(article instanceof HTMLElement)) return null;
  try {
    const cell = article.closest('[data-testid="cellInnerDiv"]');
    if (cell instanceof HTMLElement) return cell;
  } catch (e) {}
  return null; // never use bare <article> — parks UI in tweet header
}

function foldBotPrimaryCell(doc) {
  const primary = getPrimaryStatusArticle(doc);
  if (!primary) return null;
  return getFoldBotReplyTarget(primary);
}

function foldBotComposerCell(doc) {
  const d = doc || document;
  try {
    const ta = d.querySelector('[data-testid="tweetTextarea_0"]');
    if (!ta) return null;
    const cell = ta.closest('[data-testid="cellInnerDiv"]');
    return cell instanceof HTMLElement ? cell : null;
  } catch (e) {
    return null;
  }
}

function foldBotNodeIsInPrimary(node, primaryCell, primaryArticle) {
  if (!node) return true;
  try {
    if (primaryArticle && (node === primaryArticle || primaryArticle.contains(node))) return true;
    if (primaryCell && (node === primaryCell || primaryCell.contains(node))) return true;
  } catch (e) {}
  return false;
}

function foldBotIsAfterFence(node, fence) {
  if (!node || !fence) return !!node;
  try {
    const pos = fence.compareDocumentPosition(node);
    return !!(pos & Node.DOCUMENT_POSITION_FOLLOWING);
  } catch (e) {
    return false;
  }
}

function foldBotSortCellsDocumentOrder(cells) {
  return cells.slice().sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

function restoreFoldBotReplies(doc) {
  const d = doc || document;
  try {
    const hosts = d.querySelectorAll('[' + FOLD_BOT_REPLIES_HOST_ATTR + ']');
    for (let i = 0; i < hosts.length; i++) {
      hosts[i].removeAttribute(FOLD_BOT_REPLIES_HOST_ATTR);
    }
    const chips = d.querySelectorAll('.' + FOLD_BOT_REPLIES_CHIP_WRAP_CLASS + ', .' + FOLD_BOT_REPLIES_CHIP_CLASS + ', [data-testid="quietx-bot-fold-chip"]');
    for (let i = 0; i < chips.length; i++) {
      const el = chips[i];
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    const folded = d.querySelectorAll('.' + FOLD_BOT_REPLIES_HIDDEN_CLASS + ', [' + FOLD_BOT_REPLIES_ATTR + ']');
    for (let i = 0; i < folded.length; i++) {
      const el = folded[i];
      el.classList.remove(FOLD_BOT_REPLIES_HIDDEN_CLASS);
      el.removeAttribute(FOLD_BOT_REPLIES_ATTR);
      el.removeAttribute(FOLD_BOT_REPLIES_EXPANDED_ATTR);
      el.removeAttribute(FOLD_BOT_REPLIES_KEY_ATTR);
      try {
        if (el.style) {
          el.style.removeProperty('display');
          el.style.removeProperty('visibility');
          el.style.removeProperty('height');
          el.style.removeProperty('max-height');
          el.style.removeProperty('overflow');
        }
      } catch (e) {}
      if (el.getAttribute && el.getAttribute('data-quietx-bot-fold-art-hide') === '1') {
        el.removeAttribute('data-quietx-bot-fold-art-hide');
      }
    }
    d.querySelectorAll('[data-quietx-bot-fold-art-hide="1"]').forEach((el) => {
      try {
        if (el.style) el.style.removeProperty('display');
        el.removeAttribute('data-quietx-bot-fold-art-hide');
        el.classList.remove(FOLD_BOT_REPLIES_HIDDEN_CLASS);
      } catch (e) {}
    });
  } catch (e) {}
}

function expandFoldBotReplies(doc) {
  foldBotWriteExpandedFlag(true);
  restoreFoldBotReplies(doc);
  // Suppress immediate re-fold from MutationObserver noise after click
  try {
    if (foldBotRepliesScheduleTimer) {
      clearTimeout(foldBotRepliesScheduleTimer);
      foldBotRepliesScheduleTimer = null;
    }
    foldBotRepliesScheduled = false;
  } catch (e) {}
}

function foldBotCollectClusterCells(doc) {
  const d = doc || document;
  const primaryArticle = getPrimaryStatusArticle(d);
  const primaryCell = foldBotPrimaryCell(d);
  const composerCell = foldBotComposerCell(d);
  const fence = composerCell || primaryCell || primaryArticle;
  const pageId = getStatusIdFromPathname();

  const replies = getOwnStatusReplyArticles(d);
  const clusters = clusterNearDuplicateReplies(replies);
  const cellSet = [];
  const seen = new Set();

  for (let c = 0; c < clusters.length; c++) {
    const group = clusters[c];
    if (!group || group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      const art = group[i] && group[i].article;
      if (!art) continue;
      if (primaryArticle && art === primaryArticle) continue;
      if (pageId && articleStatusId(art) === pageId) continue;
      if (foldBotNodeIsInPrimary(art, primaryCell, primaryArticle)) continue;
      const cell = getFoldBotReplyTarget(art);
      if (!cell) continue;
      if (foldBotNodeIsInPrimary(cell, primaryCell, primaryArticle)) continue;
      if (composerCell && (cell === composerCell || composerCell.contains(cell))) continue;
      if (!foldBotIsAfterFence(cell, fence)) continue;
      if (seen.has(cell)) continue;
      seen.add(cell);
      cellSet.push(cell);
    }
  }
  return foldBotSortCellsDocumentOrder(cellSet);
}

function foldBotEnsureChipInHost(hostCell, count) {
  if (!hostCell) return null;
  let wrap = hostCell.querySelector('.' + FOLD_BOT_REPLIES_CHIP_WRAP_CLASS);
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = FOLD_BOT_REPLIES_CHIP_WRAP_CLASS;
    wrap.setAttribute(FOLD_BOT_REPLIES_KEY_ATTR, FOLD_BOT_REPLIES_PAGE_KEY);
    wrap.setAttribute('data-testid', 'quietx-bot-fold-chip');
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = FOLD_BOT_REPLIES_CHIP_CLASS;
    chip.setAttribute('aria-label', 'Folded ' + count + ' similar replies — click to expand');
    chip.textContent = 'Folded ' + count;
    const stopBubble = (ev) => {
      try { ev.stopPropagation(); ev.stopImmediatePropagation(); } catch (e) {}
    };
    const onDown = (ev) => {
      stopBubble(ev);
      // no preventDefault — Chrome :active needs default activation
      foldBotMarkPressed(chip);
    };
    const onActivate = (ev) => {
      try { ev.preventDefault(); } catch (e) {}
      stopBubble(ev);
      foldBotScheduleExpand(chip);
    };
    // pointerdown: bubble-stop + pressed class only. expand after pointerup/click.
    chip.addEventListener('pointerdown', onDown, true);
    chip.addEventListener('pointerup', onActivate, true);
    chip.addEventListener('click', onActivate, true);
    wrap.appendChild(chip);
    // Prefer before first article in cell; else prepend
    const art = hostCell.querySelector('article[data-testid="tweet"]');
    if (art && art.parentNode === hostCell) hostCell.insertBefore(wrap, art);
    else if (art && art.parentNode) art.parentNode.insertBefore(wrap, art);
    else hostCell.insertBefore(wrap, hostCell.firstChild);
  }
  const btn = wrap.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
  if (btn) {
    btn.textContent = 'Folded ' + count;
    btn.setAttribute('aria-label', 'Folded ' + count + ' similar replies — click to expand');
  }
  hostCell.setAttribute(FOLD_BOT_REPLIES_HOST_ATTR, '1');
  return wrap;
}

function applyFoldBotReplies(doc) {
  const d = doc || document;
  if (!isFoldBotRepliesEnabled) {
    restoreFoldBotReplies(d);
    foldBotWriteExpandedFlag(false);
    return { ok: false, reason: 'disabled', folded: 0 };
  }
  if (!isConversationStatusPage()) {
    restoreFoldBotReplies(d);
    foldBotWriteExpandedFlag(false);
    foldBotRepliesLastPath = '';
    return { ok: false, reason: 'not_status', folded: 0 };
  }

  let path = '';
  try {
    const loc = (typeof window !== 'undefined' && window.location) || null;
    path = String((loc && loc.pathname) || '');
  } catch (e) {}
  if (path && path !== foldBotRepliesLastPath) {
    foldBotRepliesLastPath = path;
    foldBotWriteExpandedFlag(false);
    restoreFoldBotReplies(d);
  }

  // Prefer durable session flag (survives observer churn / soft reloads of state)
  if (foldBotReadExpandedFlag()) {
    foldBotRepliesExpanded = true;
    restoreFoldBotReplies(d);
    return { ok: true, reason: 'expanded', folded: 0 };
  }

  const cells = foldBotCollectClusterCells(d);
  // Remove any stray chips not inside a valid host (fixes prior sibling-injection overlays)
  try {
    const primaryCell = foldBotPrimaryCell(d);
    const primaryArticle = getPrimaryStatusArticle(d);
    const wraps = d.querySelectorAll('.' + FOLD_BOT_REPLIES_CHIP_WRAP_CLASS);
    for (let i = 0; i < wraps.length; i++) {
      const w = wraps[i];
      const host = w.closest('[' + FOLD_BOT_REPLIES_HOST_ATTR + '="1"]');
      if (host && cells.indexOf(host) === 0) continue;
      if (foldBotNodeIsInPrimary(w, primaryCell, primaryArticle)) {
        try { if (w.parentNode) w.parentNode.removeChild(w); } catch (e) {}
        continue;
      }
      // orphan / wrong place
      if (!host || cells.indexOf(host) !== 0) {
        try { if (w.parentNode) w.parentNode.removeChild(w); } catch (e) {}
      }
    }
  } catch (e) {}

  if (cells.length < 2) {
    restoreFoldBotReplies(d);
    return { ok: true, reason: 'no_cluster', folded: 0 };
  }

  const host = cells[0];
  const primaryCell = foldBotPrimaryCell(d);
  const primaryArticle = getPrimaryStatusArticle(d);
  if (foldBotNodeIsInPrimary(host, primaryCell, primaryArticle)) {
    restoreFoldBotReplies(d);
    return { ok: false, reason: 'host_is_primary', folded: 0 };
  }

  foldBotEnsureChipInHost(host, cells.length);

  // Hard enforce ONE chip on the page
  try {
    const wraps = d.querySelectorAll('.' + FOLD_BOT_REPLIES_CHIP_WRAP_CLASS);
    for (let i = 0; i < wraps.length; i++) {
      const w = wraps[i];
      if (host.contains(w)) continue;
      try { if (w.parentNode) w.parentNode.removeChild(w); } catch (e) {}
    }
    host.querySelectorAll('.' + FOLD_BOT_REPLIES_CHIP_WRAP_CLASS).forEach((w, idx) => {
      if (idx === 0) return;
      try { if (w.parentNode) w.parentNode.removeChild(w); } catch (e) {}
    });
  } catch (e) {}


  // Hide article(s) inside host; keep cell + chip visible
  try {
    const arts = host.querySelectorAll('article[data-testid="tweet"]');
    for (let i = 0; i < arts.length; i++) {
      const a = arts[i];
      if (foldBotNodeIsInPrimary(a, primaryCell, primaryArticle)) continue;
      a.style.setProperty('display', 'none', 'important');
      a.setAttribute('data-quietx-bot-fold-art-hide', '1');
      a.setAttribute(FOLD_BOT_REPLIES_ATTR, '1');
    }
  } catch (e) {}

  // Hide other cluster cells entirely
  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i];
    if (foldBotNodeIsInPrimary(cell, primaryCell, primaryArticle)) continue;
    cell.classList.add(FOLD_BOT_REPLIES_HIDDEN_CLASS);
    cell.setAttribute(FOLD_BOT_REPLIES_ATTR, '1');
    cell.setAttribute(FOLD_BOT_REPLIES_KEY_ATTR, FOLD_BOT_REPLIES_PAGE_KEY);
  }

  // Final guard: no chip inside primary
  try {
    if (primaryCell) {
      primaryCell.querySelectorAll('.' + FOLD_BOT_REPLIES_CHIP_WRAP_CLASS).forEach((w) => {
        try { if (w.parentNode) w.parentNode.removeChild(w); } catch (e) {}
      });
    }
    if (primaryArticle) {
      primaryArticle.querySelectorAll('.' + FOLD_BOT_REPLIES_CHIP_WRAP_CLASS).forEach((w) => {
        try { if (w.parentNode) w.parentNode.removeChild(w); } catch (e) {}
      });
    }
  } catch (e) {}

  return { ok: true, reason: 'applied', folded: 1, count: cells.length, replies: getOwnStatusReplyArticles(d).length };
}

function scheduleFoldBotReplies() {
  if (foldBotRepliesScheduled) return;
  foldBotRepliesScheduled = true;
  if (foldBotRepliesScheduleTimer) {
    try { clearTimeout(foldBotRepliesScheduleTimer); } catch (e) {}
  }
  foldBotRepliesScheduleTimer = setTimeout(() => {
    foldBotRepliesScheduled = false;
    foldBotRepliesScheduleTimer = null;
    applyFoldBotReplies();
  }, FOLD_BOT_REPLIES_UI_DEBOUNCE_MS);
}

function foldBotEventHitsChip(ev) {
  try {
    if (ev && typeof ev.composedPath === 'function') {
      const path = ev.composedPath();
      for (let i = 0; i < path.length; i++) {
        const el = path[i];
        if (!el || !el.classList) continue;
        if (el.classList.contains(FOLD_BOT_REPLIES_CHIP_CLASS)) return el;
        if (el.classList.contains(FOLD_BOT_REPLIES_CHIP_WRAP_CLASS)) {
          const btn = el.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
          return btn || el;
        }
      }
    }
  } catch (e) {}
  try {
    const t = ev && ev.target;
    if (!t || !t.closest) return null;
    const btn = t.closest('.' + FOLD_BOT_REPLIES_CHIP_CLASS);
    if (btn) return btn;
    const wrap = t.closest('.' + FOLD_BOT_REPLIES_CHIP_WRAP_CLASS);
    if (wrap) return wrap.querySelector('.' + FOLD_BOT_REPLIES_CHIP_CLASS) || wrap;
  } catch (e) {}
  return null;
}

function bindFoldBotRepliesClick() {
  if (foldBotRepliesClickBound) return;
  foldBotRepliesClickBound = true;
  const onChipPointerDown = (ev) => {
    const chip = foldBotEventHitsChip(ev);
    if (!chip) return;
    try { ev.stopPropagation(); } catch (e) {}
    try { ev.stopImmediatePropagation(); } catch (e) {}
    foldBotMarkPressed(chip);
  };
  const onChipActivate = (ev) => {
    const chip = foldBotEventHitsChip(ev);
    if (!chip) return;
    try { ev.preventDefault(); } catch (e) {}
    try { ev.stopPropagation(); } catch (e) {}
    try { ev.stopImmediatePropagation(); } catch (e) {}
    foldBotScheduleExpand(chip);
  };
  // pointerdown: bubble-stop only (no preventDefault). pointerup/click: delayed expand
  window.addEventListener('pointerdown', onChipPointerDown, true);
  document.addEventListener('pointerdown', onChipPointerDown, true);
  window.addEventListener('pointerup', onChipActivate, true);
  document.addEventListener('pointerup', onChipActivate, true);
  window.addEventListener('click', onChipActivate, true);
  document.addEventListener('click', onChipActivate, true);
}

function initFoldBotReplies() {
  bindFoldBotRepliesClick();
  scheduleFoldBotReplies();
  try {
    const obs = new MutationObserver(() => scheduleFoldBotReplies());
    obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
  } catch (e) {}
  window.addEventListener('popstate', scheduleFoldBotReplies);
  window.addEventListener('scroll', scheduleFoldBotReplies, { passive: true, capture: true });
}


// Popup bridge for local cleanup mode. This intentionally stays DOM-only:
// no X API templates, tokens, request sniffing, or batch account actions.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content received message:', request);
  if (request.action === 'TOGGLE_CLEANER_MODE') {
    const enabled = toggleFocusCleanupMode();
    sendResponse({status: 'ok', enabled});
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    tryPinFollowing,
    startPinFollowingOnEntry,
    hasColdPinned,
    markColdPinned,
    clearColdPinned,
    isOnlyForYouSelected,
    stopPinRetry,
    initPinFollowing,
    findTimelineTabs,
    isOnHomePage,
    isTabSelected,
    getDocumentNavigationType,
    isFullDocumentNavigation,
    onHomeDocumentShow,
    onSpaHistoryChange,
    onTimelineTabClickCapture,
    maybeRepinAfterForYouFlip,
    startFlipWatch,
    stopFlipWatch,
    setupNavigationListener,
    setupFullLoadListeners,
    PIN_MAX_ATTEMPTS,
    PIN_FLIP_WATCH_MS,
    isGrokTimelinePost,
    isGrokMentionText,
    isGrokHandleHref,
    hideGrokTimelinePosts,
    hideGrokChrome,
    showGrokChrome,
    showGrokTimelinePosts,
    isAd,
    GROK_CHROME_HIDDEN_CLASS,
    DISCOVER_MORE_HIDDEN_CLASS,
    stripDiscoverNoise,
    isShowMoreOrExploreText,
    isDiscoverMoreHeadingText,
    cellHasDiscoverMoreHeading,
    isDiscoverMoreCell,
    isConversationStatusPage,
    hideDiscoverMoreCell,
    hideDiscoverMoreModules,
    showDiscoverMoreModules,
    hideHomeMediaPreviews,
    showHomeMediaPreviews,
    mediaPreviewBlock,
    hideTweetViews,
    showTweetViews,
    isViewsControl,
    isViewsLabel,
    containsSocialActions,
    VIEWS_HIDDEN_CLASS,
    MEDIA_PREVIEW_HIDDEN_CLASS,
    TRENDS_HIDDEN_CLASS,
    isTrendsHeadingText,
    isTrendsModule,
    hideTrendsModules,
    showTrendsModules,
    isTweetGrokIconControl,
    tweetGrokIconBlock,
    containsTweetGrokUnsafeToHide,
    nodeContainsCaretOrMore,
    hideTweetGrokIconNode,
    hideTweetGrokIcons,
    showTweetGrokIcons,
    TWEET_GROK_ICON_HIDDEN_CLASS,
    get isPinFollowingEnabled() { return isPinFollowingEnabled; },
    set isPinFollowingEnabled(v) { isPinFollowingEnabled = !!v; },
    get isHideGrokPostsEnabled() { return isHideGrokPostsEnabled; },
    set isHideGrokPostsEnabled(v) { isHideGrokPostsEnabled = !!v; },
    get isHideDiscoverMoreEnabled() { return isHideDiscoverMoreEnabled; },
    set isHideDiscoverMoreEnabled(v) { isHideDiscoverMoreEnabled = !!v; },
    get isHideMediaPreviewEnabled() { return isHideMediaPreviewEnabled; },
    set isHideMediaPreviewEnabled(v) { isHideMediaPreviewEnabled = !!v; },
    get isHideViewsEnabled() { return isHideViewsEnabled; },
    set isHideViewsEnabled(v) { isHideViewsEnabled = !!v; },
    get isHideTrendsEnabled() { return isHideTrendsEnabled; },
    set isHideTrendsEnabled(v) { isHideTrendsEnabled = !!v; },
    get isHideTweetGrokIconEnabled() { return isHideTweetGrokIconEnabled; },
    set isHideTweetGrokIconEnabled(v) { isHideTweetGrokIconEnabled = !!v; },
    get isHideGrokChromeEnabled() { return isHideGrokChromeEnabled; },
    set isHideGrokChromeEnabled(v) { isHideGrokChromeEnabled = !!v; },
    get isAdBlockingEnabled() { return isAdBlockingEnabled; },
    set isAdBlockingEnabled(v) { isAdBlockingEnabled = !!v; },
    get pinFollowingDegraded() { return pinFollowingDegraded; },
    set pinFollowingDegraded(v) { pinFollowingDegraded = !!v; },
    get userChoseForYou() { return userChoseForYou; },
    set userChoseForYou(v) { userChoseForYou = !!v; },
    get extraPinIssued() { return extraPinIssued; },
    get spaLocked() { return spaLocked; },
    OWN_REPLIES_CLEANER_MAX,
    OWN_REPLIES_CLEANER_INTERVAL_MS,
    OWN_REPLIES_MENU_WAIT_MS,
    OWN_REPLIES_MENU_POLL_MS,
    OWN_REPLIES_GATE_LABEL,
    normalizeOwnReplyText,
    areOwnRepliesNearDuplicate,
    clusterNearDuplicateReplies,
    normalizeHandle,
    getViewerHandleFromDom,
    getArticleAuthorHandle,
    getPrimaryStatusAuthorHandle,
    isOwnPostCleanerGate,
    getOwnStatusReplyArticles,
    capOwnRepliesSelection,
    isHideReplyMenuText,
    isDeleteMenuText,
    isBannedDeletePostLabel,
    isInsideDeleteConfirmDialog,
    isInsideReplyDeleteConfirmDialog,
    isReplyDeleteConfirmText,
    isDeletePostConfirmText,
    findReplyDeleteConfirmControl,
    findOpenDeleteConfirmDialog,
    findConfirmationSheetCancelControl,
    cancelOpenDeleteConfirmDialog,
    getOpenMenuRoots,
    findMenuItems,
    findHideReplyControl,
    findDeleteControl,
    preferHideOverDelete,
    waitForHideReplyControl,
    OWN_REPLIES_MISSING_HIDE_MSG,
    findCaretButton,
    ownRepliesClick,
    buildOwnRepliesConfirmMessage,
    showOwnRepliesConfirmDialog,
    hideOrDeleteOneOwnReply,
    runOwnRepliesCleaner,
    selectNearDuplicateOwnReplies,
    maybeAutoSelectNearDuplicateOwnReplies,
    ownRepliesFingerprint,
    ensureOwnRepliesCleanerPanelShell,
    refreshOwnRepliesCleanerLight,
    renderOwnRepliesCleanerUI,
    startOwnRepliesCleanerFromUI,
    scheduleOwnRepliesCleanerUI,
    initOwnRepliesCleaner,
    OWN_REPLIES_UI_DEBOUNCE_MS,
    OWN_REPLIES_PANEL_LEFT_KEY,
    OWN_REPLIES_PANEL_TOP_KEY,
    OWN_REPLIES_PANEL_COLLAPSED_KEY,
    get isCleanerOwnRepliesEnabled() { return isCleanerOwnRepliesEnabled; },
    set isCleanerOwnRepliesEnabled(v) { isCleanerOwnRepliesEnabled = !!v; },
    get isFoldBotRepliesEnabled() { return isFoldBotRepliesEnabled; },
    set isFoldBotRepliesEnabled(v) { isFoldBotRepliesEnabled = !!v; },
    FOLD_BOT_REPLIES_HIDDEN_CLASS,
    FOLD_BOT_REPLIES_CHIP_CLASS,
    FOLD_BOT_REPLIES_PRESSED_CLASS,
    FOLD_BOT_PRESS_HOLD_MS,
    FOLD_BOT_REPLIES_ATTR,
    getFoldBotReplyTarget,
    restoreFoldBotReplies,
    expandFoldBotReplies,
    foldBotMarkPressed,
    foldBotScheduleExpand,
    foldBotCollectClusterCells,
    applyFoldBotReplies,
    scheduleFoldBotReplies,
    initFoldBotReplies,
    bindFoldBotRepliesClick,
    get foldBotRepliesExpanded() { return foldBotRepliesExpanded; },
    set foldBotRepliesExpanded(v) { foldBotRepliesExpanded = !!v; },
    get ownRepliesCleanerLastError() { return ownRepliesCleanerLastError; },
    set ownRepliesCleanerLastError(v) { ownRepliesCleanerLastError = String(v || ''); },
    get ownRepliesCleanerHooks() { return ownRepliesCleanerHooks; },
    setOwnRepliesCleanerHooks(h) {
      ownRepliesCleanerHooks = Object.assign(ownRepliesCleanerHooks, h || {});
    }
  };
}
