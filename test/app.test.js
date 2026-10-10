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
  constructor(tagName = "DIV") {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.classes = new Set();
    this.dataset = {};
    this.listeners = new Map();
    this.style = {};
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
    this.focused = false;
    this.hidden = false;
    this.textContent = "";
    this.value = "";
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.offsetHeight = 0;
    this.scrollTop = 0;
  }

  focus() {
    this.focused = true;
  }

  select() {
    this.focused = true;
    this.selected = true;
  }

  blur() {
    this.focused = false;
  }

  append(...children) {
    this.children.push(...children);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async dispatchEvent(event) {
    event.target ||= this;
    for (const handler of this.listeners.get(event.type) || []) {
      await handler(event);
    }
  }

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

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  return {
    setTimeout(callback, delay = 0) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, at: now + delay });
      return id;
    },

    clearTimeout(id) {
      timers.delete(id);
    },

    get pending() {
      return timers.size;
    },

    async advance(ms) {
      const target = now + ms;

      for (;;) {
        const [next] = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, left], [, right]) => left.at - right.at);
        if (!next) {
          break;
        }

        const [id, timer] = next;
        timers.delete(id);
        now = timer.at;
        timer.callback();
        await new Promise((resolve) => setImmediate(resolve));
      }

      now = target;
    }
  };
}

function createSelection() {
  return {
    ranges: [],
    removeAllRanges() {
      this.ranges = [];
    },
    addRange(range) {
      this.ranges.push(range);
    }
  };
}

function createWindowObject({
  innerWidth = 390,
  clock = createClock(),
  reducedMotion = false
} = {}) {
  const selection = createSelection();

  return {
    innerWidth,
    selection,
    getSelection() {
      return selection;
    },
    addEventListener() {},
    cancelAnimationFrame() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    matchMedia(query) {
      return {
        media: query,
        matches: reducedMotion && query === "(prefers-reduced-motion: reduce)"
      };
    }
  };
}

function createHarness({
  historyEntries = [],
  domainSettings = {},
  clipboardText = "",
  innerWidth = 390,
  reducedMotion = false,
  navigatorOverrides = {},
  storageOverrides = {}
} = {}) {
  const documentObject = createAppDocument();
  const clock = createClock();
  const windowObject = createWindowObject({ innerWidth, clock, reducedMotion });
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
    windowObject,
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
    windowObject,
    navigatorObject,
    storage,
    historyWrites,
    clipboardWrites,
    errors,
    clock
  };
}

function createAppDocument() {
  const elements = {
    "#status-message": new FakeElement("P"),
    "#clean-button": new FakeElement("BUTTON"),
    ".clean-button-label": new FakeElement("SPAN"),
    "#clean-output": new FakeElement("OUTPUT"),
    ".clean-stage": new FakeElement(),
    ".app-panel-hero": new FakeElement(),
    ".history-section": new FakeElement("SECTION"),
    "#history-list": new FakeElement("UL"),
    "#history-empty": new FakeElement("P")
  };
  const documentObject = new FakeElement("HTML");
  const body = { dataset: {} };
  documentObject.activeElement = body;
  elements["#clean-output"].hidden = true;
  elements["#clean-button"].classes.add("paste-target");
  elements["#clean-button"].classes.add("clean-button");

  return Object.assign(documentObject, {
    body,
    documentElement: {
      style: {
        properties: new Map(),

        setProperty(name, value) {
          this.properties.set(name, value);
        },

        removeProperty(name) {
          this.properties.delete(name);
        }
      }
    },

    querySelector(selector) {
      return elements[selector] || null;
    },

    createElement(tagName) {
      return new FakeElement(tagName.toUpperCase());
    },

    createRange() {
      return {
        node: null,
        selectNodeContents(node) {
          this.node = node;
        }
      };
    }
  });
}

function pasteOnPage(documentObject, text) {
  return documentObject.dispatchEvent(createPasteEvent({ "text/plain": text }, { target: new FakeElement("BUTTON") }));
}

function outputText(output) {
  return output.children.map((token) => token.textContent).join("");
}

function createPasteEvent(data, extra = {}) {
  return {
    type: "paste",
    defaultPrevented: false,
    clipboardData: {
      getData(format) {
        return data[format] || "";
      }
    },
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...extra
  };
}

function createDragEvent(type, data) {
  return {
    type,
    defaultPrevented: false,
    dataTransfer: {
      types: Object.keys(data),
      dropEffect: "none",
      getData(format) {
        return data[format] || "";
      }
    },
    preventDefault() {
      this.defaultPrevented = true;
    }
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

test("app falls back to empty history when saved history cannot be read", async () => {
  const { app, historyWrites, errors } = createHarness({
    storageOverrides: {
      async readHistoryEntries() {
        throw new SyntaxError("malformed history storage");
      }
    }
  });

  await app.init();

  assert.deepEqual(app.state.historyEntries, []);
  assert.deepEqual(historyWrites, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /History storage read failed/);
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

test("app caps saved history at the configured limit", async () => {
  const { app, historyWrites } = createHarness();
  app.state.historyEntries = Array.from({ length: 100 }, (_, index) => ({
    url: `https://example.com/${index}`,
    timestamp: Date.now() - index
  }));

  await app.history.save("https://example.com/new");

  assert.equal(app.state.historyEntries.length, 100);
  assert.equal(app.state.historyEntries[0].url, "https://example.com/new");
  assert.equal(
    app.state.historyEntries.some((entry) => entry.url === "https://example.com/99"),
    false
  );
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

test("app reports unchanged valid URLs as successful clipboard cleans", async () => {
  const { app, clipboardWrites, historyWrites, documentObject } = createHarness({
    clipboardText: "https://example.com/path?keep=ok"
  });

  await app.init();
  const result = await app.clipboard.cleanLatest();

  assert.equal(result.changed, false);
  assert.equal(result.output, "https://example.com/path?keep=ok");
  assert.deepEqual(clipboardWrites, ["https://example.com/path?keep=ok"]);
  assert.equal(documentObject.querySelector("#status-message").textContent, "All clear!");
  assert.equal(historyWrites.length, 1);
});

test("app extracts the single URL from share text and saves it to history", async () => {
  const { app, clipboardWrites, historyWrites } = createHarness({
    clipboardText: "Look at this https://example.com/share?utm_source=app&keep=1 via the app"
  });

  await app.init();
  const result = await app.clipboard.cleanLatest();

  assert.equal(result.output, "https://example.com/share?keep=1");
  assert.equal(result.isUrl, true);
  assert.equal(result.changed, true);
  assert.deepEqual(clipboardWrites, ["https://example.com/share?keep=1"]);
  assert.equal(app.state.historyEntries.length, 1);
  assert.equal(app.state.historyEntries[0].url, "https://example.com/share?keep=1");
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

test("app starts clipboard reads from the click before disabling the primary button", async () => {
  let button;
  let readCalls = 0;
  const { app, documentObject } = createHarness({
    navigatorOverrides: {
      clipboard: {
        async readText() {
          readCalls += 1;
          assert.equal(button.disabled, false);
          return "";
        }
      }
    }
  });

  button = documentObject.querySelector("#clean-button");
  await app.init();
  await button.dispatchEvent({ type: "click" });

  assert.equal(readCalls, 1);
  assert.equal(button.disabled, false);
});

test("app reports unexpected clipboard failures and restores the primary button", async () => {
  const { app, documentObject, errors } = createHarness({
    navigatorOverrides: {
      clipboard: {
        async readText() {
          throw new Error("clipboard exploded");
        }
      }
    }
  });

  await app.init();
  await documentObject.querySelector("#clean-button").dispatchEvent({
    type: "click"
  });

  assert.equal(
    documentObject.querySelector("#status-message").textContent,
    "Something went sideways while cleaning your clipboard."
  );
  assert.equal(documentObject.querySelector("#clean-button").disabled, false);
  assert.equal(errors.length, 1);
});

test("app shows the paste target in idle with its label and the paste mode", async () => {
  const { app, documentObject } = createHarness();
  const button = documentObject.querySelector("#clean-button");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();

  assert.equal(documentObject.querySelector(".clean-button-label").textContent, "Click to paste a link here");
  assert.equal(app.state.buttonMode, "paste");
  assert.equal(stage.dataset.state, "idle");
  assert.equal(stage.dataset.mode, "paste");
  assert.equal(button.classes.has("paste-target"), true);
  assert.equal(button.classes.has("push-button"), false);
  assert.equal(button.focused, false);
  assert.equal(documentObject.querySelector("#clean-output").hidden, true);
});

test("app cleans document pastes outside editable elements and ignores the rest", async () => {
  const { app, documentObject, clipboardWrites, historyWrites } = createHarness();
  const text = { "text/plain": "https://example.com/path?utm_source=newsletter&keep=1" };

  await app.init();

  const pageTarget = createPasteEvent(text, { target: new FakeElement("BUTTON") });
  await documentObject.dispatchEvent(pageTarget);
  assert.equal(pageTarget.defaultPrevented, true);
  assert.deepEqual(clipboardWrites, ["https://example.com/path?keep=1"]);
  assert.equal(app.state.historyEntries[0].url, "https://example.com/path?keep=1");
  assert.equal(historyWrites.length, 1);
  assert.equal(documentObject.querySelector("#status-message").textContent, "All clear!");

  const otherField = createPasteEvent(text, { target: new FakeElement("INPUT") });
  const editableRegion = createPasteEvent(text, { target: { isContentEditable: true } });
  const handled = createPasteEvent(text, { target: new FakeElement("BUTTON"), defaultPrevented: true });
  await documentObject.dispatchEvent(otherField);
  await documentObject.dispatchEvent(editableRegion);
  await documentObject.dispatchEvent(handled);

  assert.equal(otherField.defaultPrevented, false);
  assert.equal(editableRegion.defaultPrevented, false);
  assert.deepEqual(clipboardWrites, ["https://example.com/path?keep=1"]);
});

test("app leaves whitespace-only document pastes to the browser", async () => {
  const { app, documentObject, clipboardWrites } = createHarness();
  const status = documentObject.querySelector("#status-message");
  const stage = documentObject.querySelector(".clean-stage");
  const pagePaste = createPasteEvent({ "text/plain": "  \n\t " }, { target: new FakeElement("BUTTON") });

  await app.init();
  const statusBefore = status.textContent;
  await documentObject.dispatchEvent(pagePaste);

  assert.equal(pagePaste.defaultPrevented, false);
  assert.deepEqual(clipboardWrites, []);
  assert.equal(status.textContent, statusBefore);
  assert.equal(stage.dataset.state, "idle");
});

test("app cleans dropped links, preferring text/uri-list over text/plain", async () => {
  const { app, documentObject, clipboardWrites } = createHarness();
  const panel = documentObject.querySelector(".app-panel-hero");
  const uriData = {
    "text/uri-list": "# dragged from the address bar\r\nhttps://example.com/a?utm_source=x\r\n",
    "text/plain": "https://example.com/b"
  };

  await app.init();

  const enter = createDragEvent("dragenter", uriData);
  await panel.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(panel.classes.has("is-dragover"), true);

  const over = createDragEvent("dragover", uriData);
  await panel.dispatchEvent(over);
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, "copy");

  const drop = createDragEvent("drop", uriData);
  await panel.dispatchEvent(drop);
  assert.equal(drop.defaultPrevented, true);
  assert.equal(panel.classes.has("is-dragover"), false);
  assert.deepEqual(clipboardWrites, ["https://example.com/a"]);

  await panel.dispatchEvent(createDragEvent("drop", { "text/plain": "https://example.com/b?fbclid=1" }));
  assert.deepEqual(clipboardWrites, ["https://example.com/a", "https://example.com/b"]);

  const files = createDragEvent("drop", { Files: "" });
  await panel.dispatchEvent(files);
  assert.equal(files.defaultPrevented, false);
});

test("app hides the target behind the output, holds the clean string, then returns to idle", async () => {
  const { app, documentObject, clipboardWrites, clock } = createHarness({
    clipboardText: "https://example.com/?gclid=1"
  });
  const button = documentObject.querySelector("#clean-button");
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");
  const label = documentObject.querySelector(".clean-button-label");

  await app.init();
  await button.dispatchEvent({ type: "click" });

  assert.deepEqual(clipboardWrites, ["https://example.com/"]);
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(stage.dataset.mode, "paste");
  assert.equal(output.hidden, false);
  assert.equal(button.disabled, false);

  await clock.advance(app.config.revealHoldMs);
  await output.dispatchEvent({ type: "transitionend", propertyName: "color" });
  assert.equal(stage.dataset.state, "cleaning");

  await output.dispatchEvent({ type: "transitionend", propertyName: "font-size" });
  assert.equal(stage.dataset.state, "done");
  assert.equal(stage.dataset.mode, "paste");
  assert.equal(output.hidden, false);
  assert.equal(output.classes.has("is-animating"), false);
  assert.deepEqual(output.children.map((token) => token.textContent), ["https://example.com/"]);
  assert.equal(label.textContent, "Click to paste a link here");

  await clock.advance(app.config.resultHoldMs - 1);
  assert.equal(stage.dataset.state, "done");

  await clock.advance(1);
  assert.equal(output.hidden, true);
  assert.deepEqual(output.children, []);
  assert.equal(label.textContent, "Click to paste a link here");
  assert.equal(stage.dataset.state, "idle");
  assert.equal(stage.dataset.mode, "paste");
  assert.equal(button.classes.has("paste-target"), true);
  assert.equal(button.focused, true);
  assert.equal(clock.pending, 0);
});

test("app leaves focus alone after a clean when another element holds it", async () => {
  const { app, documentObject, clock } = createHarness();
  const button = documentObject.querySelector("#clean-button");
  const elsewhere = new FakeElement("A");

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/?gclid=1");
  documentObject.activeElement = elsewhere;
  await clock.advance(app.config.revealHoldMs + app.config.animationTimeoutMs + app.config.resultHoldMs);

  assert.equal(app.state.stage, "idle");
  assert.equal(button.focused, false);
});

test("app renders the transformation as text spans after the write-back has started", async () => {
  const clipboardWrites = [];
  let documentObject;
  const harness = createHarness({
    navigatorOverrides: {
      clipboard: {
        async writeText(value) {
          const output = documentObject.querySelector("#clean-output");
          assert.equal(output.hidden, true);
          assert.equal(output.children.length, 0);
          clipboardWrites.push(value);
        }
      }
    }
  });
  documentObject = harness.documentObject;
  const { app } = harness;
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");
  const historySection = documentObject.querySelector(".history-section");

  await app.init();
  historySection.scrollHeight = 500;
  historySection.clientHeight = 200;
  historySection.scrollTop = 0;
  await pasteOnPage(documentObject, "<b>x</b>   y");

  assert.deepEqual(clipboardWrites, ["<b>x</b> y"]);
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(output.hidden, false);
  assert.equal(output.classes.has("is-animating"), false);
  assert.equal(output.innerHTML, "");
  assert.deepEqual(
    output.children.map((token) => [token.tagName, token.className, token.textContent]),
    [
      ["SPAN", "tok tok-same", "<b>x</b>"],
      ["SPAN", "tok tok-removed", "   "],
      ["SPAN", "tok tok-added", " "],
      ["SPAN", "tok tok-same", "y"]
    ]
  );
  assert.equal(historySection.scrollTop, 500);

  await harness.clock.advance(app.config.revealHoldMs - 1);
  assert.equal(output.classes.has("is-animating"), false);
  assert.equal(stage.dataset.state, "cleaning");
  await harness.clock.advance(1);
  assert.equal(output.classes.has("is-animating"), true);
  assert.equal(stage.dataset.state, "cleaning");
});

test("app reveals the pasted text for a beat before the animation, and counts the timeout from there", async () => {
  const { app, documentObject, clock } = createHarness();
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/?utm_source=x");

  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(output.classes.has("is-animating"), false);
  assert.equal(outputText(output), "https://example.com/?utm_source=x");
  assert.equal(clock.pending, 1);

  await clock.advance(app.config.revealHoldMs);
  assert.equal(output.classes.has("is-animating"), true);
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(clock.pending, 1);

  await clock.advance(app.config.animationTimeoutMs - 1);
  assert.equal(stage.dataset.state, "cleaning");
  await clock.advance(1);
  assert.equal(stage.dataset.state, "done");
  assert.equal(outputText(output), "https://example.com/");
});

test("app cancels the reveal when a second paste arrives during it", async () => {
  const { app, documentObject, clipboardWrites, clock } = createHarness();
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/a?fbclid=1");
  await clock.advance(app.config.revealHoldMs - 50);
  assert.equal(output.classes.has("is-animating"), false);

  await pasteOnPage(documentObject, "https://example.com/b?gclid=2");
  assert.equal(outputText(output), "https://example.com/b?gclid=2");
  assert.equal(output.classes.has("is-animating"), false);
  assert.equal(clock.pending, 1);

  await clock.advance(app.config.revealHoldMs);
  assert.equal(output.classes.has("is-animating"), true);
  assert.equal(outputText(output), "https://example.com/b?gclid=2");

  await clock.advance(app.config.animationTimeoutMs + app.config.resultHoldMs);
  assert.deepEqual(clipboardWrites, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(stage.dataset.state, "idle");
  assert.equal(clock.pending, 0);
});

test("app finishes the stage immediately when the injected matchMedia reports reduced motion", async () => {
  const { app, documentObject, clipboardWrites, clock } = createHarness({ reducedMotion: true });
  const output = documentObject.querySelector("#clean-output");
  const status = documentObject.querySelector("#status-message");

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/?utm_source=x");

  assert.deepEqual(clipboardWrites, ["https://example.com/"]);
  assert.equal(output.hidden, true);
  assert.deepEqual(output.children, []);
  assert.equal(app.state.stage, "idle");
  assert.equal(app.state.buttonMode, "paste");
  assert.equal(documentObject.querySelector(".clean-button-label").textContent, "Click to paste a link here");
  assert.equal(clock.pending, 0);

  await pasteOnPage(documentObject, "https://example.com/path?keep=ok");
  assert.equal(status.textContent, "All clear!");
  assert.equal(status.classes.has("is-pulsing"), false);
  assert.equal(output.hidden, true);
  assert.equal(clock.pending, 0);
});

test("app shows Copy immediately under reduced motion when the write-back is refused", async () => {
  const clipboardWrites = [];
  const { app, documentObject, windowObject, clock } = createHarness({
    reducedMotion: true,
    navigatorOverrides: {
      clipboard: createRefusingClipboard({ clipboardWrites })
    }
  });
  const output = documentObject.querySelector("#clean-output");

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/?utm_source=x&keep=1");

  assert.equal(app.state.buttonMode, "copy");
  assert.equal(app.state.stage, "done");
  assert.equal(output.hidden, false);
  assert.equal(outputText(output), "https://example.com/?keep=1");
  assert.equal(windowObject.selection.ranges.length, 1);
  assert.equal(windowObject.selection.ranges[0].node, output);
  assert.equal(clock.pending, 0);
});

test("app ends the animation after the timeout when transitionend never fires", async () => {
  const { app, documentObject, clock } = createHarness();
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/?utm_source=x");
  await clock.advance(app.config.revealHoldMs);

  await clock.advance(app.config.animationTimeoutMs - 1);
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(clock.pending, 1);

  await clock.advance(1);
  assert.equal(stage.dataset.state, "done");
  assert.equal(clock.pending, 1);

  await clock.advance(app.config.resultHoldMs);
  assert.equal(stage.dataset.state, "idle");
  assert.equal(clock.pending, 0);
});

test("app cancels the pending animation and hold when a second paste arrives", async () => {
  const { app, documentObject, clipboardWrites, clock } = createHarness();
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/a?fbclid=1");
  await clock.advance(app.config.revealHoldMs + 100);
  assert.equal(output.classes.has("is-animating"), true);

  await pasteOnPage(documentObject, "https://example.com/b?gclid=2");
  assert.equal(outputText(output), "https://example.com/b?gclid=2");
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(clock.pending, 1);

  await clock.advance(app.config.revealHoldMs + app.config.animationTimeoutMs - 1);
  assert.equal(stage.dataset.state, "cleaning");
  await clock.advance(1);
  assert.equal(stage.dataset.state, "done");
  assert.equal(outputText(output), "https://example.com/b");

  await pasteOnPage(documentObject, "HELLO   WORLD.");
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(clock.pending, 1);

  await clock.advance(app.config.revealHoldMs + app.config.animationTimeoutMs + app.config.resultHoldMs);
  assert.deepEqual(clipboardWrites, ["https://example.com/a", "https://example.com/b", "Hello world."]);
  assert.deepEqual(app.state.historyEntries.map((entry) => entry.url), ["https://example.com/b", "https://example.com/a"]);
  assert.equal(stage.dataset.state, "idle");
  assert.equal(output.hidden, true);
  assert.equal(clock.pending, 0);
});

test("app cancels the stage on a switch to update mode and returns to idle afterwards", async () => {
  const { app, documentObject, clock } = createHarness();
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/?utm_source=y");
  await clock.advance(app.config.revealHoldMs + app.config.animationTimeoutMs);
  assert.equal(stage.dataset.state, "done");

  app.pwa.bindRegistration(createWaitingRegistration());
  assert.equal(stage.dataset.state, "update");
  assert.equal(stage.dataset.mode, "update");
  assert.equal(output.hidden, true);
  assert.equal(clock.pending, 0);

  app.ui.setPrimaryActionMode("paste");
  assert.equal(stage.dataset.state, "idle");
  assert.equal(stage.dataset.mode, "paste");
});

test("app skips the collapse for unchanged results and pulses the status", async () => {
  const { app, documentObject, clock } = createHarness();
  const output = documentObject.querySelector("#clean-output");
  const status = documentObject.querySelector("#status-message");

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/path?keep=ok");

  assert.equal(output.classes.has("is-animating"), false);
  assert.deepEqual(output.children.map((token) => token.className), ["tok tok-same"]);
  assert.equal(status.textContent, "All clear!");
  assert.equal(status.classes.has("is-pulsing"), true);
  assert.equal(app.state.stage, "done");

  await clock.advance(app.config.resultHoldMs);
  assert.equal(app.state.stage, "idle");
  assert.equal(output.hidden, true);
});

test("app clears the stage when the write-back fails unexpectedly", async () => {
  const { app, documentObject, errors, clock } = createHarness({
    navigatorOverrides: {
      clipboard: {
        async writeText() {
          throw new Error("clipboard exploded");
        }
      }
    }
  });

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/?utm_source=x");

  assert.equal(documentObject.querySelector("#clean-output").hidden, true);
  assert.equal(app.state.stage, "idle");
  assert.equal(app.state.buttonMode, "paste");
  assert.equal(
    documentObject.querySelector("#status-message").textContent,
    "Something went sideways while cleaning your clipboard."
  );
  assert.equal(errors.length, 1);
  assert.equal(clock.pending, 0);
});

test("app shows the keyboard hint when the target cannot read the clipboard", async () => {
  const { app, documentObject, errors, clock } = createHarness({
    navigatorOverrides: {
      clipboard: {}
    }
  });
  const button = documentObject.querySelector("#clean-button");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await button.dispatchEvent({ type: "click" });

  assert.equal(
    documentObject.querySelector("#status-message").textContent,
    "Press Cmd+V or Ctrl+V to paste a link."
  );
  assert.equal(button.disabled, false);
  assert.equal(stage.dataset.state, "idle");
  assert.equal(app.state.buttonMode, "paste");
  assert.equal(documentObject.querySelector("#clean-output").hidden, true);
  assert.equal(clock.pending, 0);
  assert.deepEqual(errors, []);
});

function createRefusingClipboard({ refusals = 1, clipboardWrites }) {
  let remainingRefusals = refusals;

  return {
    async readText() {
      return "";
    },

    async writeText(value) {
      if (remainingRefusals > 0) {
        remainingRefusals -= 1;
        const error = new Error("Write permission denied.");
        error.name = "NotAllowedError";
        throw error;
      }

      clipboardWrites.push(value);
    }
  };
}

test("app switches the control to Copy beside the selected output when the write-back is refused", async () => {
  const clipboardWrites = [];
  const { app, documentObject, windowObject, errors, clock } = createHarness({
    navigatorOverrides: {
      clipboard: createRefusingClipboard({ clipboardWrites })
    }
  });
  const button = documentObject.querySelector("#clean-button");
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await pasteOnPage(documentObject, "https://example.com/?utm_source=x&keep=1");
  assert.equal(app.state.stage, "cleaning");
  assert.equal(app.state.buttonMode, "paste");

  await clock.advance(app.config.revealHoldMs + app.config.animationTimeoutMs);
  assert.deepEqual(clipboardWrites, []);
  assert.equal(clock.pending, 0);
  assert.equal(app.state.buttonMode, "copy");
  assert.equal(documentObject.querySelector(".clean-button-label").textContent, "Copy");
  assert.equal(documentObject.querySelector("#status-message").textContent, "All clear!");
  assert.equal(stage.dataset.state, "done");
  assert.equal(stage.dataset.mode, "copy");
  assert.equal(button.classes.has("push-button"), true);
  assert.equal(button.classes.has("paste-target"), false);
  assert.equal(output.hidden, false);
  assert.equal(output.classes.has("is-animating"), false);
  assert.equal(outputText(output), "https://example.com/?keep=1");
  assert.equal(windowObject.selection.ranges.length, 1);
  assert.equal(windowObject.selection.ranges[0].node, output);
  assert.equal(app.state.historyEntries[0].url, "https://example.com/?keep=1");
  assert.deepEqual(errors, []);
});

test("app writes the last result when Copy is tapped, then empties the output and returns to the target", async () => {
  const clipboardWrites = [];
  const { app, documentObject, clock } = createHarness({
    navigatorOverrides: {
      clipboard: createRefusingClipboard({ clipboardWrites })
    }
  });
  const button = documentObject.querySelector("#clean-button");
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await pasteOnPage(documentObject, "HELLO   WORLD.");
  await clock.advance(app.config.revealHoldMs + app.config.animationTimeoutMs);
  assert.equal(outputText(output), "Hello world.");

  await button.dispatchEvent({ type: "click" });

  assert.deepEqual(clipboardWrites, ["Hello world."]);
  assert.equal(output.hidden, true);
  assert.deepEqual(output.children, []);
  assert.equal(app.state.buttonMode, "paste");
  assert.equal(documentObject.querySelector(".clean-button-label").textContent, "Click to paste a link here");
  assert.equal(stage.dataset.state, "idle");
  assert.equal(stage.dataset.mode, "paste");
  assert.equal(button.classes.has("paste-target"), true);
  assert.equal(button.classes.has("push-button"), false);
  assert.equal(documentObject.querySelector("#status-message").textContent, "All clear!");
});

test("app keeps the Copy control and reports the block when Copy is refused too", async () => {
  const clipboardWrites = [];
  const { app, documentObject } = createHarness({
    navigatorOverrides: {
      clipboard: createRefusingClipboard({ refusals: 2, clipboardWrites })
    }
  });
  const output = documentObject.querySelector("#clean-output");

  await app.init();
  await pasteOnPage(documentObject, "plain text");
  await documentObject.querySelector("#clean-button").dispatchEvent({ type: "click" });

  assert.deepEqual(clipboardWrites, []);
  assert.equal(app.state.buttonMode, "copy");
  assert.equal(output.hidden, false);
  assert.equal(outputText(output), "plain text");
  assert.equal(
    documentObject.querySelector("#status-message").textContent,
    "Clipboard access is blocked. Try allowing clipboard permissions."
  );
});

test("app leaves Copy mode when a new paste replaces the held result", async () => {
  const clipboardWrites = [];
  const { app, documentObject, clock } = createHarness({
    navigatorOverrides: {
      clipboard: createRefusingClipboard({ clipboardWrites })
    }
  });
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await pasteOnPage(documentObject, "plain text");
  assert.equal(app.state.buttonMode, "copy");

  await pasteOnPage(documentObject, "https://example.com/?utm_source=x");
  assert.equal(app.state.buttonMode, "paste");
  assert.equal(stage.dataset.mode, "paste");
  assert.equal(stage.dataset.state, "cleaning");
  assert.deepEqual(clipboardWrites, ["https://example.com/"]);

  await clock.advance(app.config.revealHoldMs + app.config.animationTimeoutMs + app.config.resultHoldMs);
  assert.equal(stage.dataset.state, "idle");
  assert.equal(output.hidden, true);
  assert.equal(clock.pending, 0);
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

test("app shares saved history entries when the Web Share API can share them", async () => {
  const entry = {
    url: "https://example.com/shared",
    timestamp: Date.now()
  };
  const shareCalls = [];
  const canShareCalls = [];
  const { app, documentObject } = createHarness({
    historyEntries: [entry],
    navigatorOverrides: {
      canShare(data) {
        canShareCalls.push(data);
        return true;
      },

      async share(data) {
        shareCalls.push(data);
      }
    }
  });
  let preventedDefault = false;

  await app.init();
  const link = documentObject.querySelector("#history-list").children[0].children[0];
  await link.dispatchEvent({
    type: "click",
    preventDefault() {
      preventedDefault = true;
    }
  });

  assert.equal(preventedDefault, true);
  assert.deepEqual(canShareCalls, [{ url: entry.url }]);
  assert.deepEqual(shareCalls, [{ url: entry.url }]);
  assert.equal(link.href, entry.url);
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
});

test("app leaves saved history links as safe external links when sharing is unavailable", async () => {
  const entry = {
    url: "https://example.com/fallback",
    timestamp: Date.now()
  };
  const { app, documentObject } = createHarness({
    historyEntries: [entry]
  });
  let preventedDefault = false;

  await app.init();
  const link = documentObject.querySelector("#history-list").children[0].children[0];
  await link.dispatchEvent({
    type: "click",
    preventDefault() {
      preventedDefault = true;
    }
  });

  assert.equal(preventedDefault, false);
  assert.equal(link.href, entry.url);
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
});

test("app falls back to saved history links when Web Share cannot share an entry", async () => {
  const entry = {
    url: "https://example.com/cannot-share",
    timestamp: Date.now()
  };
  const shareCalls = [];
  const { app, documentObject } = createHarness({
    historyEntries: [entry],
    navigatorOverrides: {
      canShare() {
        return false;
      },

      async share(data) {
        shareCalls.push(data);
      }
    }
  });
  let preventedDefault = false;

  await app.init();
  const link = documentObject.querySelector("#history-list").children[0].children[0];
  await link.dispatchEvent({
    type: "click",
    preventDefault() {
      preventedDefault = true;
    }
  });

  assert.equal(preventedDefault, false);
  assert.deepEqual(shareCalls, []);
});

test("app ignores user-cancelled saved history shares", async () => {
  const entry = {
    url: "https://example.com/cancelled-share",
    timestamp: Date.now()
  };
  const abortError = new Error("share cancelled");
  abortError.name = "AbortError";
  const { app, documentObject, errors } = createHarness({
    historyEntries: [entry],
    navigatorOverrides: {
      async share() {
        throw abortError;
      }
    }
  });

  await app.init();
  const link = documentObject.querySelector("#history-list").children[0].children[0];
  await link.dispatchEvent({
    type: "click",
    preventDefault() {}
  });

  assert.deepEqual(errors, []);
});

function createWaitingRegistration() {
  return {
    waiting: {
      postMessage() {}
    },
    addEventListener() {},
    async update() {}
  };
}

test("app ignores pastes and drops in update mode", async () => {
  const { app, documentObject, clipboardWrites } = createHarness();
  const status = documentObject.querySelector("#status-message");

  await app.init();
  app.pwa.bindRegistration(createWaitingRegistration());

  const documentPaste = createPasteEvent(
    { "text/plain": "https://example.com/?utm_source=x" },
    { target: new FakeElement("BUTTON") }
  );
  const drop = createDragEvent("drop", { "text/plain": "https://example.com/?utm_source=x" });
  await documentObject.dispatchEvent(documentPaste);
  await documentObject.querySelector(".app-panel-hero").dispatchEvent(drop);

  assert.equal(documentPaste.defaultPrevented, false);
  assert.equal(drop.defaultPrevented, false);
  assert.deepEqual(clipboardWrites, []);
  assert.equal(app.state.buttonMode, "update");
  assert.equal(status.textContent, "A new version for this app is available online.");
});

test("app turns the target into a full-row button in update mode and restores it afterwards", async () => {
  const { app, documentObject } = createHarness({
    navigatorOverrides: {
      onLine: false
    }
  });
  const button = documentObject.querySelector("#clean-button");
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");
  const label = documentObject.querySelector(".clean-button-label");

  await app.init();
  app.pwa.bindRegistration(createWaitingRegistration());

  assert.equal(stage.dataset.state, "update");
  assert.equal(stage.dataset.mode, "retry-update");
  assert.equal(button.classes.has("push-button"), true);
  assert.equal(button.classes.has("paste-target"), false);
  assert.equal(output.hidden, true);
  assert.equal(label.textContent, "Try again");

  app.pwa.setUpdateMode();
  assert.equal(stage.dataset.state, "update");
  assert.equal(stage.dataset.mode, "retry-update");

  app.ui.setPrimaryActionMode("paste");
  assert.equal(stage.dataset.state, "idle");
  assert.equal(stage.dataset.mode, "paste");
  assert.equal(button.classes.has("paste-target"), true);
  assert.equal(button.classes.has("push-button"), false);
  assert.equal(label.textContent, "Click to paste a link here");
  assert.equal(
    documentObject.querySelector("#status-message").textContent,
    "Remove junk parameters from any URL you paste or drop in."
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

test("app eases the hero panel between heights around a status change and keeps the history bottom in view", async () => {
  const { app, documentObject } = createHarness({
    historyEntries: [{ url: "https://example.com/a", timestamp: Date.now() }]
  });
  const panel = documentObject.querySelector(".app-panel-hero");
  const section = documentObject.querySelector(".history-section");
  const status = documentObject.querySelector("#status-message");
  const animations = [];
  // The rect is the height on screen, which an easing may be moving; the
  // natural height is what the content needs after the change.
  let rectHeight = 300;
  let naturalHeight = 300;

  panel.getBoundingClientRect = () => ({ height: rectHeight });
  Object.defineProperty(panel, "offsetHeight", { get: () => naturalHeight });
  panel.animate = (keyframes, options) => {
    const animation = {
      keyframes,
      options,
      cancelled: false,
      cancel() {
        this.cancelled = true;
      }
    };
    animations.push(animation);
    return animation;
  };
  section.scrollHeight = 500;
  section.clientHeight = 200;

  await app.init();
  assert.equal(animations.length, 0);

  naturalHeight = 120;
  app.ui.setStatus("success");

  assert.equal(status.textContent, "All clear!");
  assert.equal(status.classes.has("is-swapping"), true);
  assert.equal(animations.length, 1);
  assert.deepEqual(animations[0].keyframes, [{ height: "300px" }, { height: "120px" }]);
  assert.equal(animations[0].options.duration, app.config.panelResizeMs);
  assert.equal(panel.classes.has("is-resizing"), true);
  assert.equal(app.state.panelAnimation, animations[0]);
  assert.equal(section.scrollTop, 500);

  animations[0].onfinish();
  assert.equal(animations[0].cancelled, true);
  assert.equal(panel.classes.has("is-resizing"), false);
  assert.equal(app.state.panelAnimation, null);

  rectHeight = 120;
  app.ui.setStatus("success");
  assert.equal(animations.length, 1);

  naturalHeight = 200;
  app.ui.setStatus("empty");
  assert.deepEqual(animations[1].keyframes, [{ height: "120px" }, { height: "200px" }]);

  rectHeight = 150;
  naturalHeight = 260;
  app.ui.setStatus("blocked");
  assert.equal(animations.length, 3);
  assert.equal(animations[1].cancelled, true);
  assert.deepEqual(animations[2].keyframes, [{ height: "150px" }, { height: "260px" }]);
  assert.equal(app.state.panelAnimation, animations[2]);
});

test("app changes the hero panel without easing under reduced motion", async () => {
  const { app, documentObject } = createHarness({ reducedMotion: true });
  const panel = documentObject.querySelector(".app-panel-hero");
  const status = documentObject.querySelector("#status-message");
  let calls = 0;

  panel.getBoundingClientRect = () => ({ height: 300 });
  panel.offsetHeight = 120;
  panel.animate = () => {
    calls += 1;
    return {};
  };

  await app.init();
  app.ui.setStatus("success");

  assert.equal(calls, 0);
  assert.equal(status.textContent, "All clear!");
  assert.equal(status.classes.has("is-swapping"), false);
  assert.equal(panel.classes.has("is-resizing"), false);
});

test("app marks the first history render as entering and only the newest entry after a clean", async () => {
  const { app, documentObject, windowObject } = createHarness({
    historyEntries: [{ url: "https://example.com/old", timestamp: Date.now() }]
  });
  const list = documentObject.querySelector("#history-list");

  await app.init();
  assert.equal(list.classes.has("is-entering"), true);
  assert.deepEqual(list.children.map((item) => item.className), ["history-item"]);

  await pasteOnPage(documentObject, "https://example.com/new?utm_source=x");
  assert.equal(list.classes.has("is-entering"), false);
  assert.deepEqual(
    list.children.map((item) => item.className),
    ["history-item", "history-item is-new"]
  );

  windowObject.innerWidth = 1280;
  app.layout.apply();
  assert.equal(list.classes.has("is-entering"), false);
  assert.deepEqual(
    list.children.map((item) => item.className),
    ["history-item", "history-item"]
  );
});
