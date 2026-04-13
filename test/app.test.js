import test from "node:test";
import assert from "node:assert/strict";

import { bootApp, createApp } from "../src/app.js";

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.children = [];
    this.classes = new Set();
    this.classList = {
      toggle: (className, force) => {
        const shouldAdd = force === undefined
          ? !this.classes.has(className)
          : Boolean(force);

        if (shouldAdd) {
          this.classes.add(className);
          return true;
        }

        this.classes.delete(className);
        return false;
      }
    };
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.scrollTop = 0;
  }

  append(...children) {
    this.children.push(...children);
  }

  addEventListener() {}

  getBoundingClientRect() {
    return { height: 0 };
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  toggleAttribute(name, force) {
    if (force) {
      this.setAttribute(name, "");
      return;
    }

    this.removeAttribute(name);
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || "";
  }
}

function createWindowObject({ innerWidth = 390 } = {}) {
  return {
    innerWidth,
    addEventListener() {},
    cancelAnimationFrame() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    }
  };
}

function createHarness({
  historyEntries = [],
  domainSettings = {},
  clipboardText = "",
  innerWidth = 390,
  navigatorOverrides = {},
  storageOverrides = {}
} = {}) {
  const documentObject = createAppDocument();
  const historyWrites = [];
  const clipboardWrites = [];
  const errors = [];
  const navigatorObject = {
    onLine: true,
    clipboard: {
      async readText() {
        return clipboardText;
      },

      async writeText(value) {
        clipboardWrites.push(value);
        clipboardText = value;
      }
    },
    ...navigatorOverrides
  };

  const storage = {
    async readHistoryEntries() {
      return historyEntries.map((entry) => ({ ...entry }));
    },

    async writeHistoryEntries(entries) {
      historyWrites.push(entries.map((entry) => ({ ...entry })));
    },

    async readDomainTransformSettings() {
      return domainSettings;
    },

    ...storageOverrides
  };

  const app = createApp({
    documentObject,
    windowObject: createWindowObject({ innerWidth }),
    navigatorObject,
    locationObject: {
      hostname: "example.com"
    },
    storage,
    consoleObject: {
      error(...args) {
        errors.push(args);
      }
    }
  });

  return {
    app,
    documentObject,
    navigatorObject,
    storage,
    historyWrites,
    clipboardWrites,
    errors
  };
}

function createAppDocument() {
  const elements = {
    "#status-message": new FakeElement(),
    "#clean-button": new FakeElement(),
    ".clean-button-label": new FakeElement(),
    ".hero-stage": new FakeElement(),
    ".history-section": new FakeElement(),
    "#history-list": new FakeElement(),
    "#history-empty": new FakeElement(),
    "#history-summary": new FakeElement()
  };

  return {
    body: {
      dataset: {}
    },
    documentElement: {
      style: {
        setProperty() {}
      }
    },

    querySelector(selector) {
      return elements[selector] || null;
    },

    createElement() {
      return new FakeElement();
    },

    addEventListener() {}
  };
}

test("app module can be imported without browser DOM side effects", () => {
  assert.equal(typeof createApp, "function");
  assert.equal(typeof bootApp, "function");
  assert.equal(globalThis.cleanMyLinkTransforms, undefined);
});

test("app keeps saved links loading copy visible until history storage resolves", async () => {
  const documentObject = createAppDocument();
  const historyRead = deferred();
  const errors = [];

  const app = createApp({
    documentObject,
    windowObject: createWindowObject(),
    navigatorObject: {
      onLine: true
    },
    locationObject: {
      hostname: "example.com"
    },
    storage: {
      async readHistoryEntries() {
        return historyRead.promise;
      },

      async writeHistoryEntries() {},

      async readDomainTransformSettings() {
        return {};
      }
    },
    consoleObject: {
      error(...args) {
        errors.push(args);
      }
    }
  });

  const initPromise = app.init();
  await Promise.resolve();

  assert.equal(
    documentObject.querySelector("#history-empty").textContent,
    "Loading saved links from this device..."
  );
  assert.equal(documentObject.querySelector("#history-empty").attributes.get("aria-busy"), "true");

  historyRead.resolve([]);
  await initPromise;

  assert.equal(documentObject.querySelector("#history-empty").textContent, "No links cleaned yet.");
  assert.equal(documentObject.querySelector("#history-empty").attributes.has("aria-busy"), false);
  assert.deepEqual(errors, []);
});

test("app drops expired and unsafe history entries during startup", async () => {
  const now = Date.now();
  const freshEntry = {
    url: "https://example.com/fresh",
    timestamp: now - 60_000
  };
  const expiredEntry = {
    url: "https://example.com/expired",
    timestamp: now - (73 * 60 * 60 * 1000)
  };
  const unsafeEntry = {
    url: "javascript:alert(1)",
    timestamp: now
  };
  const { app, historyWrites, errors } = createHarness({
    historyEntries: [expiredEntry, freshEntry, unsafeEntry]
  });

  await app.init();

  assert.deepEqual(app.state.historyEntries, [freshEntry]);
  assert.deepEqual(historyWrites, [[freshEntry]]);
  assert.deepEqual(errors, []);
});

test("app de-duplicates saved URLs and ignores unsafe history URLs", async () => {
  const existingEntry = {
    url: "https://example.com/path",
    timestamp: Date.now() - 60_000
  };
  const { app, historyWrites } = createHarness();
  app.state.historyEntries = [existingEntry];

  await app.history.save("https://example.com/path");
  await app.history.save("mailto:test@example.com");

  assert.equal(app.state.historyEntries.length, 1);
  assert.equal(app.state.historyEntries[0].url, "https://example.com/path");
  assert.ok(app.state.historyEntries[0].timestamp >= existingEntry.timestamp);
  assert.equal(historyWrites.length, 1);
  assert.deepEqual(historyWrites[0], app.state.historyEntries);
});

test("app cleans clipboard URLs with domain settings and saves only URL results", async () => {
  const { app, clipboardWrites, historyWrites } = createHarness({
    clipboardText: "https://www.reddit.com/r/node/comments/abc123/post?utm_source=share&keep=ok",
    domainSettings: {
      "rewrite-reddit-to-redlib": false
    }
  });

  await app.init();
  const result = await app.clipboard.cleanLatest();

  assert.equal(result.output, "https://www.reddit.com/r/node/comments/abc123/post?keep=ok");
  assert.equal(result.isUrl, true);
  assert.deepEqual(clipboardWrites, ["https://www.reddit.com/r/node/comments/abc123/post?keep=ok"]);
  assert.equal(app.state.historyEntries.length, 1);
  assert.equal(app.state.historyEntries[0].url, "https://www.reddit.com/r/node/comments/abc123/post?keep=ok");
  assert.equal(historyWrites.length, 1);
});

test("app cleans clipboard text without saving it to URL history", async () => {
  const { app, clipboardWrites, historyWrites } = createHarness({
    clipboardText: "HELLO   WORLD.\nTHIS IS FINE."
  });

  await app.init();
  const result = await app.clipboard.cleanLatest();

  assert.equal(result.output, "Hello world. This is fine.");
  assert.equal(result.isUrl, false);
  assert.deepEqual(clipboardWrites, ["Hello world. This is fine."]);
  assert.deepEqual(app.state.historyEntries, []);
  assert.deepEqual(historyWrites, []);
});

test("app renders history newest-first on desktop and newest-near-action on mobile", async () => {
  const olderEntry = {
    url: "https://example.com/older",
    timestamp: Date.now() - 120_000
  };
  const newerEntry = {
    url: "https://example.com/newer",
    timestamp: Date.now() - 60_000
  };

  const desktopHarness = createHarness({
    historyEntries: [olderEntry, newerEntry],
    innerWidth: 960
  });
  await desktopHarness.app.init();
  assert.deepEqual(
    desktopHarness.documentObject.querySelector("#history-list").children.map((item) => item.children[0].href),
    ["https://example.com/newer", "https://example.com/older"]
  );

  const mobileHarness = createHarness({
    historyEntries: [olderEntry, newerEntry],
    innerWidth: 390
  });
  await mobileHarness.app.init();
  assert.deepEqual(
    mobileHarness.documentObject.querySelector("#history-list").children.map((item) => item.children[0].href),
    ["https://example.com/older", "https://example.com/newer"]
  );
});

test("app switches PWA update actions between offline retry and online activation", async () => {
  const postedMessages = [];
  const registration = {
    waiting: {
      postMessage(message) {
        postedMessages.push(message);
      }
    },
    addEventListener() {},
    async update() {}
  };
  const { app, documentObject, navigatorObject } = createHarness({
    navigatorOverrides: {
      onLine: false
    }
  });

  app.pwa.bindRegistration(registration);

  assert.equal(app.state.buttonMode, "retry-update");
  assert.equal(documentObject.querySelector("#status-message").textContent, "Network went offline, can't update.");
  assert.equal(documentObject.querySelector(".clean-button-label").textContent, "Try again");

  navigatorObject.onLine = true;
  app.pwa.setUpdateMode();
  assert.equal(app.state.buttonMode, "update");
  assert.equal(documentObject.querySelector("#status-message").textContent, "A new version for this app is available online.");
  assert.equal(documentObject.querySelector(".clean-button-label").textContent, "Update Now");

  await app.pwa.activateUpdate();

  assert.equal(app.state.isReloadingForUpdate, true);
  assert.deepEqual(postedMessages, [{ type: "SKIP_WAITING" }]);
});
