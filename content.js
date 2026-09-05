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

// ---- Pin Following feature (1.0.17) ----
let pinFollowingColdPin = false;
let pinFollowingUserClickedForYou = false;
let pinFollowingPinCount = 0;
let pinFollowingMaxPins = 2;
let pinFollowingLoadTime = 0;
let pinFollowingSpaFlipGuardMs = 12000;
let pinFollowingEnabled = true;

function isOnHomePage() {
  const path = window.location.pathname;
  return path === '/home' || path === '/' || path === '/home/';
}

function getTimelineTabs() {
  const tablist = document.querySelector('[role="tablist"]');
  if (!tablist) return null;
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  if (tabs.length < 2) return null;
  
  const forYouTab = tabs.find(t => isForYouLabel(getTabLabel(t)));
  const followingTab = tabs.find(t => isFollowingLabel(getTabLabel(t)));
  
  if (!forYouTab || !followingTab) return null;
  return { forYouTab, followingTab, tablist };
}

function isTabSelected(tab) {
  if (!(tab instanceof HTMLElement)) return false;
  return tab.getAttribute('aria-selected') === 'true';
}

function clickFollowingTab() {
  const tabs = getTimelineTabs();
  if (!tabs) return false;
  
  if (!isTabSelected(tabs.forYouTab) || isTabSelected(tabs.followingTab)) {
    return false;
  }
  
  if (pinFollowingPinCount >= pinFollowingMaxPins) {
    return false;
  }
  
  pinFollowingPinCount++;
  tabs.followingTab.click();
  console.log('Pin Following: Clicked Following tab (count:', pinFollowingPinCount, ')');
  return true;
}

function setupPinFollowing() {
  if (!pinFollowingEnabled) return;
  if (!isOnHomePage()) return;
  
  pinFollowingColdPin = false;
  pinFollowingUserClickedForYou = false;
  pinFollowingPinCount = 0;
  pinFollowingLoadTime = Date.now();
  
  const checkAndPin = () => {
    if (!isOnHomePage()) return;
    if (pinFollowingUserClickedForYou) return;
    
    const tabs = getTimelineTabs();
    if (!tabs) {
      setTimeout(checkAndPin, 500);
      return;
    }
    
    tabs.forYouTab.addEventListener('click', () => {
      pinFollowingUserClickedForYou = true;
      console.log('Pin Following: User clicked For you, disabling re-pin');
    }, { once: true });
    
    if (isTabSelected(tabs.forYouTab) && !isTabSelected(tabs.followingTab)) {
      clickFollowingTab();
      pinFollowingColdPin = true;
    }
  };
  
  if (document.readyState === 'complete') {
    setTimeout(checkAndPin, 300);
  } else {
    window.addEventListener('load', () => setTimeout(checkAndPin, 300), { once: true });
  }
  
  setupPinFollowingSpaGuard();
}

function setupPinFollowingSpaGuard() {
  let lastCheck = 0;
  const observer = new MutationObserver(() => {
    if (!pinFollowingEnabled) return;
    if (!isOnHomePage()) return;
    if (pinFollowingUserClickedForYou) return;
    if (pinFollowingPinCount >= pinFollowingMaxPins) return;
    
    const now = Date.now();
    if (now - lastCheck < 500) return;
    lastCheck = now;
    
    const timeSinceLoad = now - pinFollowingLoadTime;
    if (timeSinceLoad > pinFollowingSpaFlipGuardMs && pinFollowingColdPin) {
      const tabs = getTimelineTabs();
      if (tabs && isTabSelected(tabs.forYouTab) && !isTabSelected(tabs.followingTab)) {
        console.log('Pin Following: SPA flipped back to For you, re-pinning Following');
        clickFollowingTab();
      }
    }
  });
  
  const observeTarget = document.body || document.documentElement;
  if (observeTarget) {
    observer.observe(observeTarget, { childList: true, subtree: true });
  }
}

// ---- Hide Tweet Grok Icon (Pro feature, 1.0.18) ----
const TWEET_GROK_ICON_HIDDEN_CLASS = 'quietx-tweet-grok-hidden';
let isHideTweetGrokIconEnabled = false;
let hideTweetGrokIconObserver = null;

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

function hideTweetGrokIcons() {
  if (!isHideTweetGrokIconEnabled) return;
  const grokButtons = document.querySelectorAll('article[data-testid="tweet"] button[aria-label="Grok actions"]');
  grokButtons.forEach(btn => {
    if (isTweetGrokIconControl(btn)) {
      hideTweetGrokIconNode(btn);
    }
  });
}

function showTweetGrokIcons() {
  document.querySelectorAll('.' + TWEET_GROK_ICON_HIDDEN_CLASS).forEach(el => {
    el.classList.remove(TWEET_GROK_ICON_HIDDEN_CLASS);
  });
}

function setupHideTweetGrokIconObserver() {
  if (hideTweetGrokIconObserver) return;
  hideTweetGrokIconObserver = new MutationObserver(() => {
    if (isHideTweetGrokIconEnabled) {
      hideTweetGrokIcons();
    }
  });
  hideTweetGrokIconObserver.observe(document.body, { childList: true, subtree: true });
}

function teardownHideTweetGrokIconObserver() {
  if (hideTweetGrokIconObserver) {
    hideTweetGrokIconObserver.disconnect();
    hideTweetGrokIconObserver = null;
  }
}

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

// Initialize
function init() {
  chrome.storage.local.get(
    ["mergeCommunityTabs", "lastCommunityTabLabel", "pinFollowing"],
    (result) => {
      console.log("X Dislike: Initializing...");
      initTweetHistory();
      createRecycleBin();
      initializePosts();

      // Load Ad Blocking preference
      chrome.storage.local.get(['blockAds'], (r) => {
          isAdBlockingEnabled = !!r.blockAds;
          if (isAdBlockingEnabled) console.log("X Dislike: Ad Blocking Enabled 🛡️");
      });

      // Load Hide Tweet Grok Icon preference (Pro only, default ON for Pro)
      chrome.storage.local.get(['isPro', 'hideTweetGrokIcon'], (r) => {
          const isPro = !!r.isPro;
          if (isPro) {
              isHideTweetGrokIconEnabled = r.hideTweetGrokIcon !== false;
              if (isHideTweetGrokIconEnabled) {
                  console.log("X Dislike: Hide Tweet Grok Icon Enabled ✨");
                  hideTweetGrokIcons();
                  setupHideTweetGrokIconObserver();
              }
          }
      });

      // Pin Following feature (default ON, 1.0.17)
      pinFollowingEnabled = result.pinFollowing !== false;
      if (pinFollowingEnabled) {
          console.log("X Dislike: Pin Following Enabled 📌");
          setupPinFollowing();
      }

      // Watch for storage changes (Dynamic Toggle)
      chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local') return;

          if (changes.blockAds) {
              isAdBlockingEnabled = !!changes.blockAds.newValue;
              console.log("X Dislike: Ad Blocking switched to:", isAdBlockingEnabled);
              if (isAdBlockingEnabled) {
                   // Re-run to hide existing
                   initializePosts();
              } else {
                  // Show all hidden ads
                 const hiddenAds = document.querySelectorAll('article[style*="display: none"]');
                 hiddenAds.forEach(el => {
                     if (isAd(el)) el.style.display = "";
                 });
              }
          }

          if (changes.hideTweetGrokIcon || changes.isPro) {
              chrome.storage.local.get(['isPro', 'hideTweetGrokIcon'], (r) => {
                  const isPro = !!r.isPro;
                  const wasEnabled = isHideTweetGrokIconEnabled;
                  isHideTweetGrokIconEnabled = isPro && r.hideTweetGrokIcon !== false;

                  console.log("X Dislike: Hide Tweet Grok Icon switched to:", isHideTweetGrokIconEnabled);

                  if (isHideTweetGrokIconEnabled && !wasEnabled) {
                      hideTweetGrokIcons();
                      setupHideTweetGrokIconObserver();
                  } else if (!isHideTweetGrokIconEnabled && wasEnabled) {
                      showTweetGrokIcons();
                      teardownHideTweetGrokIconObserver();
                  }
              });
          }

          if (changes.pinFollowing) {
              pinFollowingEnabled = changes.pinFollowing.newValue !== false;
              console.log("X Dislike: Pin Following switched to:", pinFollowingEnabled);
              if (pinFollowingEnabled) {
                  setupPinFollowing();
              }
          }
      });

      // Watch for new posts (infinite scroll)
      setInterval(initializePosts, 2000);

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

// Popup bridge for local cleanup mode. This intentionally stays DOM-only:
// no X API templates, tokens, request sniffing, or batch account actions.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content received message:', request);
  if (request.action === 'TOGGLE_CLEANER_MODE') {
    const enabled = toggleFocusCleanupMode();
    sendResponse({status: 'ok', enabled});
  }
});
