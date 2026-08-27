/**
 * Chrome Extension API mock for testing
 * Provides mock implementations of chrome.storage.local, chrome.storage.session, and chrome.runtime
 */

export function createChromeMock() {
  const storageLocal = new Map();
  const storageSession = new Map();
  const storageListeners = [];
  const messageListeners = [];

  const createStorageArea = (store, areaName) => ({
    get(keys, callback) {
      const result = {};
      const keyList = Array.isArray(keys) ? keys : (keys ? [keys] : [...store.keys()]);
      for (const key of keyList) {
        if (store.has(key)) {
          result[key] = store.get(key);
        }
      }
      if (typeof callback === 'function') {
        callback(result);
      }
      return Promise.resolve(result);
    },
    set(items, callback) {
      const changes = {};
      for (const [key, newValue] of Object.entries(items)) {
        const oldValue = store.get(key);
        store.set(key, newValue);
        changes[key] = { oldValue, newValue };
      }
      for (const listener of storageListeners) {
        listener(changes, areaName);
      }
      if (typeof callback === 'function') {
        callback();
      }
      return Promise.resolve();
    },
    remove(keys, callback) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const key of keyList) {
        if (store.has(key)) {
          const oldValue = store.get(key);
          store.delete(key);
          changes[key] = { oldValue };
        }
      }
      if (Object.keys(changes).length > 0) {
        for (const listener of storageListeners) {
          listener(changes, areaName);
        }
      }
      if (typeof callback === 'function') {
        callback();
      }
      return Promise.resolve();
    },
    clear(callback) {
      const changes = {};
      for (const [key, oldValue] of store.entries()) {
        changes[key] = { oldValue };
      }
      store.clear();
      if (Object.keys(changes).length > 0) {
        for (const listener of storageListeners) {
          listener(changes, areaName);
        }
      }
      if (typeof callback === 'function') {
        callback();
      }
      return Promise.resolve();
    },
    _getAll() {
      return Object.fromEntries(store);
    },
    _clear() {
      store.clear();
    }
  });

  const chrome = {
    storage: {
      local: createStorageArea(storageLocal, 'local'),
      session: createStorageArea(storageSession, 'session'),
      onChanged: {
        addListener(fn) {
          storageListeners.push(fn);
        },
        removeListener(fn) {
          const idx = storageListeners.indexOf(fn);
          if (idx >= 0) storageListeners.splice(idx, 1);
        }
      }
    },
    runtime: {
      lastError: null,
      onMessage: {
        addListener(fn) {
          messageListeners.push(fn);
        },
        removeListener(fn) {
          const idx = messageListeners.indexOf(fn);
          if (idx >= 0) messageListeners.splice(idx, 1);
        }
      },
      sendMessage(message, callback) {
        for (const listener of messageListeners) {
          listener(message, {}, callback || (() => {}));
        }
      }
    },
    tabs: {
      query(queryInfo, callback) {
        callback([{ id: 1, url: 'https://x.com/home' }]);
      },
      sendMessage(tabId, message, callback) {
        for (const listener of messageListeners) {
          listener(message, { tab: { id: tabId } }, callback || (() => {}));
        }
      }
    },
    windows: {
      create(options, callback) {
        if (callback) callback({ id: 123 });
      },
      get(id, callback) {
        if (callback) callback({ id });
      },
      update(id, options, callback) {
        if (callback) callback({ id });
      },
      remove(id, callback) {
        if (callback) callback();
      },
      onRemoved: {
        addListener() {}
      }
    },
    commands: {
      onCommand: {
        addListener() {}
      }
    },
    _reset() {
      storageLocal.clear();
      storageSession.clear();
      storageListeners.length = 0;
      messageListeners.length = 0;
    },
    _getStorageListeners() {
      return storageListeners;
    }
  };

  return chrome;
}

export function setupGlobalChrome() {
  const mock = createChromeMock();
  globalThis.chrome = mock;
  return mock;
}
