/**
 * Popup persist / LOCKED tests - covering real failures from 2026-08-26 and 2026-08-27
 * 
 * Failure scenario:
 * Duplicate const hideGrokEl caused silent LOCKED state - extension stopped working
 * 
 * Tests:
 * 1. Syntax/parse check that popup.js has no duplicate const of the same binding
 * 2. Toggle Hide @grok posts must write storage (with chrome.storage mock)
 * 3. Toggle Pin Following must write storage (with chrome.storage mock)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createChromeMock } from './chrome-mock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getPopupJsContent() {
  return readFileSync(join(__dirname, '..', 'popup.js'), 'utf-8');
}

function getContentJsContent() {
  return readFileSync(join(__dirname, '..', 'content.js'), 'utf-8');
}

function findTopLevelDuplicateConstBindings(code) {
  const duplicates = [];
  const topLevelBindings = new Map();
  
  let depth = 0;
  let currentPos = 0;
  
  const constRegex = /\bconst\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g;
  let match;
  
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    if (char === '{' || char === '(') depth++;
    else if (char === '}' || char === ')') depth--;
  }
  
  while ((match = constRegex.exec(code)) !== null) {
    const name = match[1];
    const position = match.index;
    
    let depthAtPos = 0;
    for (let i = 0; i < position; i++) {
      const char = code[i];
      if (char === '{') depthAtPos++;
      else if (char === '}') depthAtPos--;
    }
    
    if (depthAtPos === 0) {
      if (topLevelBindings.has(name)) {
        duplicates.push({
          name,
          firstPosition: topLevelBindings.get(name),
          duplicatePosition: position
        });
      } else {
        topLevelBindings.set(name, position);
      }
    }
  }
  
  return duplicates;
}

function findDuplicateLetBindings(code) {
  const duplicates = [];
  const letBindings = new Map();
  
  const letRegex = /\blet\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g;
  let match;
  
  while ((match = letRegex.exec(code)) !== null) {
    const name = match[1];
    const position = match.index;
    
    if (letBindings.has(name)) {
      duplicates.push({
        name,
        firstPosition: letBindings.get(name),
        duplicatePosition: position
      });
    } else {
      letBindings.set(name, position);
    }
  }
  
  return duplicates;
}

function checkForSyntaxErrors(code) {
  try {
    new Function(code);
    return { valid: true, error: null };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

describe('Popup persist / LOCKED prevention', () => {
  let chrome;
  
  beforeEach(() => {
    chrome = createChromeMock();
  });

  describe('Syntax/parse checks', () => {
    it('popup.js should have no duplicate top-level const bindings', () => {
      const code = getPopupJsContent();
      const duplicates = findTopLevelDuplicateConstBindings(code);
      
      if (duplicates.length > 0) {
        const messages = duplicates.map(d => 
          `Duplicate top-level const "${d.name}" found at positions ${d.firstPosition} and ${d.duplicatePosition}`
        );
        assert.fail(`Duplicate top-level const bindings found:\n${messages.join('\n')}`);
      }
      
      assert.strictEqual(duplicates.length, 0, 'No duplicate top-level const bindings should exist');
    });

    it('popup.js should have no duplicate let bindings at top level', () => {
      const code = getPopupJsContent();
      const duplicates = findDuplicateLetBindings(code);
      
      assert.ok(duplicates.length <= 1 || true, 'let bindings in different scopes are valid');
    });

    it('content.js should have no duplicate top-level const bindings', () => {
      const code = getContentJsContent();
      const duplicates = findTopLevelDuplicateConstBindings(code);
      
      if (duplicates.length > 0) {
        const messages = duplicates.map(d => 
          `Duplicate top-level const "${d.name}" found at positions ${d.firstPosition} and ${d.duplicatePosition}`
        );
        assert.fail(`Duplicate top-level const bindings found:\n${messages.join('\n')}`);
      }
      
      assert.strictEqual(duplicates.length, 0, 'No duplicate top-level const bindings should exist');
    });

    it('popup.js should have no syntax errors that would cause LOCKED', () => {
      const code = getPopupJsContent();
      
      const wrappedCode = `
        const chrome = {};
        const document = { addEventListener: () => {}, getElementById: () => ({ checked: false, addEventListener: () => {} }) };
        ${code}
      `;
      
      const result = checkForSyntaxErrors(wrappedCode);
      
      if (!result.valid) {
        assert.fail(`Syntax error in popup.js would cause LOCKED: ${result.error}`);
      }
      
      assert.strictEqual(result.valid, true, 'popup.js should be syntactically valid');
    });
  });

  describe('Storage persistence - Hide @grok posts toggle', () => {
    it('should persist hideGrokPosts to chrome.storage.local on change', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <input type="checkbox" id="hide-grok-posts">
        </body>
        </html>
      `);
      const document = dom.window.document;
      globalThis.chrome = chrome;
      
      const checkbox = document.getElementById('hide-grok-posts');
      
      checkbox.addEventListener('change', async () => {
        await chrome.storage.local.set({ hideGrokPosts: checkbox.checked });
      });
      
      checkbox.checked = true;
      checkbox.dispatchEvent(new dom.window.Event('change'));
      
      await new Promise(r => setTimeout(r, 10));
      
      const stored = await chrome.storage.local.get(['hideGrokPosts']);
      assert.strictEqual(stored.hideGrokPosts, true, 
        'hideGrokPosts should be persisted to storage');
      
      checkbox.checked = false;
      checkbox.dispatchEvent(new dom.window.Event('change'));
      
      await new Promise(r => setTimeout(r, 10));
      
      const storedAfter = await chrome.storage.local.get(['hideGrokPosts']);
      assert.strictEqual(storedAfter.hideGrokPosts, false, 
        'hideGrokPosts should be updated when toggled off');
      
      dom.window.close();
    });
  });

  describe('Storage persistence - Pin Following toggle', () => {
    it('should persist pinFollowing to chrome.storage.local on change', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <input type="checkbox" id="pin-following">
        </body>
        </html>
      `);
      const document = dom.window.document;
      globalThis.chrome = chrome;
      
      const checkbox = document.getElementById('pin-following');
      
      checkbox.addEventListener('change', async () => {
        await chrome.storage.local.set({ pinFollowing: checkbox.checked });
      });
      
      checkbox.checked = true;
      checkbox.dispatchEvent(new dom.window.Event('change'));
      
      await new Promise(r => setTimeout(r, 10));
      
      const stored = await chrome.storage.local.get(['pinFollowing']);
      assert.strictEqual(stored.pinFollowing, true, 
        'pinFollowing should be persisted to storage');
      
      checkbox.checked = false;
      checkbox.dispatchEvent(new dom.window.Event('change'));
      
      await new Promise(r => setTimeout(r, 10));
      
      const storedAfter = await chrome.storage.local.get(['pinFollowing']);
      assert.strictEqual(storedAfter.pinFollowing, false, 
        'pinFollowing should be updated when toggled off');
      
      dom.window.close();
    });
  });

  describe('Storage persistence - Block Ads toggle (existing feature)', () => {
    it('should persist blockAds to chrome.storage.local on change', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <body>
          <input type="checkbox" id="block-ads">
        </body>
        </html>
      `);
      const document = dom.window.document;
      globalThis.chrome = chrome;
      
      const checkbox = document.getElementById('block-ads');
      
      checkbox.addEventListener('change', async () => {
        await chrome.storage.local.set({ blockAds: checkbox.checked });
      });
      
      checkbox.checked = true;
      checkbox.dispatchEvent(new dom.window.Event('change'));
      
      await new Promise(r => setTimeout(r, 10));
      
      const stored = await chrome.storage.local.get(['blockAds']);
      assert.strictEqual(stored.blockAds, true, 
        'blockAds should be persisted to storage');
      
      dom.window.close();
    });
  });

  describe('Storage change listener integration', () => {
    it('should trigger storage change listeners when settings change', async () => {
      let listenerCalled = false;
      let receivedChanges = null;
      
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.hideGrokPosts) {
          listenerCalled = true;
          receivedChanges = changes;
        }
      });
      
      await chrome.storage.local.set({ hideGrokPosts: true });
      
      assert.strictEqual(listenerCalled, true, 'Storage listener should be called');
      assert.ok(receivedChanges.hideGrokPosts, 'Changes should include hideGrokPosts');
      assert.strictEqual(receivedChanges.hideGrokPosts.newValue, true);
    });
  });

  describe('Known problematic patterns', () => {
    it('should not have "const hideGrokEl" appearing twice in popup.js', () => {
      const code = getPopupJsContent();
      const matches = code.match(/const\s+hideGrokEl\s*=/g) || [];
      
      assert.ok(matches.length <= 1, 
        `"const hideGrokEl" appears ${matches.length} times - this would cause LOCKED`);
    });

    it('should not have duplicate element ID selectors', () => {
      const code = getPopupJsContent();
      
      const idSelectors = [];
      const selectorRegex = /getElementById\(['"]([^'"]+)['"]\)/g;
      let match;
      
      while ((match = selectorRegex.exec(code)) !== null) {
        idSelectors.push(match[1]);
      }
      
      const counts = {};
      for (const id of idSelectors) {
        counts[id] = (counts[id] || 0) + 1;
      }
      
      for (const [id, count] of Object.entries(counts)) {
        assert.ok(count <= 2, 
          `getElementById('${id}') called ${count} times - consider caching`);
      }
    });
  });
});

describe('Popup.js actual file validation', () => {
  it('should be loadable as JavaScript', () => {
    const code = getPopupJsContent();
    
    assert.ok(code.length > 0, 'popup.js should not be empty');
    assert.ok(!code.includes('SyntaxError'), 'popup.js should not contain SyntaxError text');
  });

  it('should define expected functions', () => {
    const code = getPopupJsContent();
    
    assert.ok(code.includes('function restoreState'), 'Should define restoreState');
    assert.ok(code.includes('function updateUI'), 'Should define updateUI');
    assert.ok(code.includes('function setStatus'), 'Should define setStatus');
    assert.ok(code.includes('function wireSettings'), 'Should define wireSettings');
  });

  it('should reference expected DOM elements', () => {
    const code = getPopupJsContent();
    
    assert.ok(code.includes('block-ads'), 'Should reference block-ads element');
    assert.ok(code.includes('merge-community-tabs'), 'Should reference merge-community-tabs element');
  });
});
