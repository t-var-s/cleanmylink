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
    this.classList = {
      toggle() {}
    };
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
    windowObject: {
      innerWidth: 390,
      addEventListener() {},
      cancelAnimationFrame() {},
      requestAnimationFrame(callback) {
        callback();
        return 1;
      }
    },
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
