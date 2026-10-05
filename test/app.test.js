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

function createWindowObject({
  innerWidth = 390,
  visualViewport,
  clock = createClock(),
  reducedMotion = false
} = {}) {
  return {
    innerWidth,
    visualViewport,
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
  visualViewport,
  reducedMotion = false,
  navigatorOverrides = {},
  storageOverrides = {}
} = {}) {
  const documentObject = createAppDocument();
  const clock = createClock();
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
    windowObject: createWindowObject({ innerWidth, visualViewport, clock, reducedMotion }),
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
    errors,
    clock
  };
}

function createAppDocument() {
  const elements = {
    "#status-message": new FakeElement("P"),
    "#clean-button": new FakeElement("BUTTON"),
    ".clean-button-label": new FakeElement("SPAN"),
    "#clean-form": new FakeElement("FORM"),
    "#clean-input": new FakeElement("TEXTAREA"),
    "#clean-output": new FakeElement("OUTPUT"),
    ".clean-stage": new FakeElement(),
    ".app-panel-hero": new FakeElement(),
    ".history-section": new FakeElement("SECTION"),
    "#history-list": new FakeElement("UL"),
    "#history-empty": new FakeElement("P")
  };
  const documentObject = new FakeElement("HTML");
  elements["#clean-output"].hidden = true;

  return Object.assign(documentObject, {
    body: {
      dataset: {}
    },
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
    }
  });
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

function createKeyEvent(key, extra = {}) {
  return {
    type: "keydown",
    key,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...extra
  };
}

async function typeInto(input, value) {
  input.value = value;
  await input.dispatchEvent({ type: "input" });
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

test("app cleans text pasted into the field instead of inserting it", async () => {
  const { app, documentObject, clipboardWrites, historyWrites } = createHarness();
  const input = documentObject.querySelector("#clean-input");
  const paste = createPasteEvent({
    "text/plain": "https://example.com/path?utm_source=newsletter&keep=1"
  });

  await app.init();
  await input.dispatchEvent(paste);

  assert.equal(paste.defaultPrevented, true);
  assert.deepEqual(clipboardWrites, ["https://example.com/path?keep=1"]);
  assert.equal(app.state.historyEntries[0].url, "https://example.com/path?keep=1");
  assert.equal(historyWrites.length, 1);
  assert.equal(documentObject.querySelector("#status-message").textContent, "All clear!");
  assert.equal(input.value, "");
});

test("app cleans document pastes outside editable elements and ignores the rest", async () => {
  const { app, documentObject, clipboardWrites } = createHarness();
  const text = { "text/plain": "HELLO   WORLD." };

  await app.init();

  const pageTarget = createPasteEvent(text, { target: new FakeElement("BUTTON") });
  await documentObject.dispatchEvent(pageTarget);
  assert.equal(pageTarget.defaultPrevented, true);
  assert.deepEqual(clipboardWrites, ["Hello world."]);

  const otherField = createPasteEvent(text, { target: new FakeElement("INPUT") });
  const editableRegion = createPasteEvent(text, { target: { isContentEditable: true } });
  const mainField = createPasteEvent(text, { target: documentObject.querySelector("#clean-input") });
  await documentObject.dispatchEvent(otherField);
  await documentObject.dispatchEvent(editableRegion);
  await documentObject.dispatchEvent(mainField);

  assert.equal(otherField.defaultPrevented, false);
  assert.equal(editableRegion.defaultPrevented, false);
  assert.equal(mainField.defaultPrevented, false);
  assert.deepEqual(clipboardWrites, ["Hello world."]);
});

test("app labels the button Paste when the field is empty and Clean once it has typed text", async () => {
  let readCalls = 0;
  const clipboardWrites = [];
  const { app, documentObject, clock } = createHarness({
    navigatorOverrides: {
      clipboard: {
        async readText() {
          readCalls += 1;
          return "";
        },

        async writeText(value) {
          clipboardWrites.push(value);
        }
      }
    }
  });
  const input = documentObject.querySelector("#clean-input");
  const label = documentObject.querySelector(".clean-button-label");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  assert.equal(label.textContent, "Paste");
  assert.equal(stage.dataset.state, "idle");

  await typeInto(input, "HELLO   WORLD.");
  assert.equal(label.textContent, "Clean");
  assert.equal(app.state.buttonMode, "clean");
  assert.equal(stage.dataset.state, "editing");

  await documentObject.querySelector("#clean-button").dispatchEvent({ type: "click" });

  assert.equal(readCalls, 0);
  assert.deepEqual(clipboardWrites, ["Hello world."]);

  await clock.advance(app.config.animationTimeoutMs + app.config.resultHoldMs);
  assert.equal(label.textContent, "Paste");
  assert.equal(stage.dataset.state, "idle");
});

test("app cleans the typed value on Enter and empties the field on Escape", async () => {
  const { app, documentObject, clipboardWrites } = createHarness();
  const input = documentObject.querySelector("#clean-input");

  await app.init();

  await typeInto(input, "first line");
  const shiftEnter = createKeyEvent("Enter", { shiftKey: true });
  await input.dispatchEvent(shiftEnter);
  assert.equal(shiftEnter.defaultPrevented, false);
  assert.deepEqual(clipboardWrites, []);

  const enter = createKeyEvent("Enter");
  await input.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(clipboardWrites, ["first line"]);

  await typeInto(input, "never cleaned");
  const escape = createKeyEvent("Escape");
  await input.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(input.value, "");
  assert.equal(documentObject.querySelector(".clean-button-label").textContent, "Paste");
  assert.deepEqual(clipboardWrites, ["first line"]);
});

test("app keeps the form from submitting natively", async () => {
  const { app, documentObject, clipboardWrites } = createHarness();
  const submit = createKeyEvent("Enter", { type: "submit" });

  await app.init();
  await typeInto(documentObject.querySelector("#clean-input"), "typed text");
  await documentObject.querySelector("#clean-form").dispatchEvent(submit);

  assert.equal(submit.defaultPrevented, true);
  assert.deepEqual(clipboardWrites, ["typed text"]);
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

test("app holds the clean string after the animation, then empties and blurs the field", async () => {
  const { app, documentObject, clipboardWrites, clock } = createHarness();
  const input = documentObject.querySelector("#clean-input");
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");
  const label = documentObject.querySelector(".clean-button-label");

  await app.init();
  assert.equal(input.focused, true);

  await typeInto(input, "https://example.com/?gclid=1");
  await input.dispatchEvent(createKeyEvent("Enter"));

  assert.deepEqual(clipboardWrites, ["https://example.com/"]);
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(input.focused, true);

  await output.dispatchEvent({ type: "transitionend", propertyName: "color" });
  assert.equal(stage.dataset.state, "cleaning");

  await output.dispatchEvent({ type: "transitionend", propertyName: "font-size" });
  assert.equal(stage.dataset.state, "done");
  assert.equal(output.hidden, false);
  assert.equal(output.classes.has("is-animating"), false);
  assert.deepEqual(output.children.map((token) => token.textContent), ["https://example.com/"]);
  assert.equal(input.focused, true);
  assert.equal(label.textContent, "Clean");

  await clock.advance(app.config.resultHoldMs - 1);
  assert.equal(stage.dataset.state, "done");
  assert.equal(input.value, "https://example.com/?gclid=1");

  await clock.advance(1);
  assert.equal(input.value, "");
  assert.equal(input.focused, false);
  assert.equal(output.hidden, true);
  assert.deepEqual(output.children, []);
  assert.equal(stage.classes.has("has-output"), false);
  assert.equal(label.textContent, "Paste");
  assert.equal(stage.dataset.state, "idle");
  assert.equal(clock.pending, 0);
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
  const input = documentObject.querySelector("#clean-input");
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");
  const historySection = documentObject.querySelector(".history-section");

  await app.init();
  historySection.scrollHeight = 500;
  historySection.clientHeight = 200;
  historySection.scrollTop = 0;
  await input.dispatchEvent(createPasteEvent({ "text/plain": "<b>x</b>   y" }));

  assert.deepEqual(clipboardWrites, ["<b>x</b> y"]);
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(stage.classes.has("has-output"), true);
  assert.equal(output.hidden, false);
  assert.equal(output.classes.has("is-animating"), true);
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
  assert.equal(input.focused, true);
});

test("app finishes the stage immediately when the injected matchMedia reports reduced motion", async () => {
  const { app, documentObject, clipboardWrites, clock } = createHarness({ reducedMotion: true });
  const input = documentObject.querySelector("#clean-input");
  const output = documentObject.querySelector("#clean-output");
  const status = documentObject.querySelector("#status-message");

  await app.init();
  await typeInto(input, "https://example.com/?utm_source=x");
  await input.dispatchEvent(createKeyEvent("Enter"));

  assert.deepEqual(clipboardWrites, ["https://example.com/"]);
  assert.equal(output.hidden, true);
  assert.deepEqual(output.children, []);
  assert.equal(input.value, "");
  assert.equal(input.focused, false);
  assert.equal(app.state.stage, "idle");
  assert.equal(documentObject.querySelector(".clean-button-label").textContent, "Paste");
  assert.equal(clock.pending, 0);

  await input.dispatchEvent(createPasteEvent({ "text/plain": "https://example.com/path?keep=ok" }));
  assert.equal(status.textContent, "All clear!");
  assert.equal(status.classes.has("is-pulsing"), false);
  assert.equal(output.hidden, true);
  assert.equal(clock.pending, 0);
});

test("app shows Copy immediately under reduced motion when the write-back is refused", async () => {
  const clipboardWrites = [];
  const { app, documentObject, clock } = createHarness({
    reducedMotion: true,
    navigatorOverrides: {
      clipboard: createRefusingClipboard({ clipboardWrites })
    }
  });
  const input = documentObject.querySelector("#clean-input");

  await app.init();
  await input.dispatchEvent(createPasteEvent({ "text/plain": "https://example.com/?utm_source=x&keep=1" }));

  assert.equal(app.state.buttonMode, "copy");
  assert.equal(app.state.stage, "done");
  assert.equal(input.value, "https://example.com/?keep=1");
  assert.equal(input.selected, true);
  assert.equal(documentObject.querySelector("#clean-output").hidden, true);
  assert.equal(clock.pending, 0);
});

test("app ends the animation after 600 ms when transitionend never fires", async () => {
  const { app, documentObject, clock } = createHarness();
  const input = documentObject.querySelector("#clean-input");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await input.dispatchEvent(createPasteEvent({ "text/plain": "https://example.com/?utm_source=x" }));

  await clock.advance(599);
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(clock.pending, 1);

  await clock.advance(1);
  assert.equal(stage.dataset.state, "done");
  assert.equal(clock.pending, 1);

  await clock.advance(app.config.resultHoldMs);
  assert.equal(stage.dataset.state, "idle");
  assert.equal(input.focused, false);
  assert.equal(clock.pending, 0);
});

test("app cancels the pending animation and hold when a second paste arrives", async () => {
  const { app, documentObject, clipboardWrites, clock } = createHarness();
  const input = documentObject.querySelector("#clean-input");
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");
  const text = (element) => element.children.map((token) => token.textContent).join("");

  await app.init();
  await input.dispatchEvent(createPasteEvent({ "text/plain": "https://example.com/a?fbclid=1" }));
  await clock.advance(300);

  await input.dispatchEvent(createPasteEvent({ "text/plain": "https://example.com/b?gclid=2" }));
  assert.equal(text(output), "https://example.com/b?gclid=2");
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(clock.pending, 1);

  await clock.advance(599);
  assert.equal(stage.dataset.state, "cleaning");
  await clock.advance(1);
  assert.equal(stage.dataset.state, "done");
  assert.equal(text(output), "https://example.com/b");

  await documentObject.dispatchEvent(createPasteEvent(
    { "text/plain": "HELLO   WORLD." },
    { target: new FakeElement("BUTTON") }
  ));
  assert.equal(stage.dataset.state, "cleaning");
  assert.equal(clock.pending, 1);

  await clock.advance(app.config.animationTimeoutMs + app.config.resultHoldMs);
  assert.deepEqual(clipboardWrites, ["https://example.com/a", "https://example.com/b", "Hello world."]);
  assert.deepEqual(app.state.historyEntries.map((entry) => entry.url), ["https://example.com/b", "https://example.com/a"]);
  assert.equal(stage.dataset.state, "idle");
  assert.equal(output.hidden, true);
  assert.equal(clock.pending, 0);
});

test("app cancels the stage on Escape and on a switch to update mode", async () => {
  const { app, documentObject, clock } = createHarness();
  const input = documentObject.querySelector("#clean-input");
  const output = documentObject.querySelector("#clean-output");
  const stage = documentObject.querySelector(".clean-stage");

  await app.init();
  await input.dispatchEvent(createPasteEvent({ "text/plain": "https://example.com/?utm_source=x" }));
  const escape = createKeyEvent("Escape");
  await input.dispatchEvent(escape);

  assert.equal(escape.defaultPrevented, true);
  assert.equal(stage.dataset.state, "idle");
  assert.equal(output.hidden, true);
  assert.equal(input.focused, true);
  assert.equal(clock.pending, 0);

  await input.dispatchEvent(createPasteEvent({ "text/plain": "https://example.com/?utm_source=y" }));
  await clock.advance(app.config.animationTimeoutMs);
  assert.equal(stage.dataset.state, "done");

  app.pwa.bindRegistration(createWaitingRegistration());
  assert.equal(stage.dataset.state, "update");
  assert.equal(output.hidden, true);
  assert.equal(clock.pending, 0);

  app.ui.setPrimaryActionMode("paste");
  assert.equal(stage.dataset.state, "idle");
});

test("app restores the field when typing interrupts the stage", async () => {
  const { app, documentObject, clock } = createHarness();
  const input = documentObject.querySelector("#clean-input");
  const output = documentObject.querySelector("#clean-output");

  await app.init();
  await typeInto(input, "https://example.com/?utm_source=x");
  await input.dispatchEvent(createKeyEvent("Enter"));
  await typeInto(input, "https://example.com/?utm_source=x&more");

  assert.equal(output.hidden, true);
  assert.equal(app.state.stage, "editing");
  assert.equal(app.state.buttonMode, "clean");
  assert.equal(clock.pending, 0);
});

test("app skips the collapse for unchanged results and pulses the status", async () => {
  const { app, documentObject, clock } = createHarness();
  const input = documentObject.querySelector("#clean-input");
  const output = documentObject.querySelector("#clean-output");
  const status = documentObject.querySelector("#status-message");

  await app.init();
  await input.dispatchEvent(createPasteEvent({ "text/plain": "https://example.com/path?keep=ok" }));

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
  const input = documentObject.querySelector("#clean-input");

  await app.init();
  await typeInto(input, "https://example.com/?utm_source=x");
  await input.dispatchEvent(createKeyEvent("Enter"));

  assert.equal(documentObject.querySelector("#clean-output").hidden, true);
  assert.equal(app.state.stage, "editing");
  assert.equal(input.value, "https://example.com/?utm_source=x");
  assert.equal(
    documentObject.querySelector("#status-message").textContent,
    "Something went sideways while cleaning your clipboard."
  );
  assert.equal(errors.length, 1);
  assert.equal(clock.pending, 0);
});

test("app focuses the field when the paste button cannot read the clipboard", async () => {
  const { app, documentObject, errors } = createHarness({
    navigatorOverrides: {
      clipboard: {}
    }
  });
  const input = documentObject.querySelector("#clean-input");

  await app.init();
  const status = documentObject.querySelector("#status-message");
  status.textContent = app.config.defaultStatus;
  input.blur();
  await documentObject.querySelector("#clean-button").dispatchEvent({ type: "click" });

  assert.equal(input.focused, true);
  assert.equal(status.textContent, "Remove junk parameters from any URL you paste, type or drop in.");
  assert.deepEqual(errors, []);
});

test("app syncs the field height and keeps the newest mobile entry in view when the field grows", async () => {
  const { app, documentObject } = createHarness();
  const input = documentObject.querySelector("#clean-input");
  const historySection = documentObject.querySelector(".history-section");

  await app.init();
  historySection.scrollHeight = 500;
  historySection.clientHeight = 200;
  historySection.scrollTop = 0;

  input.scrollHeight = 88;
  input.clientHeight = 88;
  input.offsetHeight = 90;
  await typeInto(input, "a\nb\nc");

  assert.equal(input.style.height, "90px");
  assert.equal(historySection.scrollTop, 500);
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

test("app switches the button to Copy when the clipboard write-back is refused", async () => {
  const clipboardWrites = [];
  const { app, documentObject, errors, clock } = createHarness({
    navigatorOverrides: {
      clipboard: createRefusingClipboard({ clipboardWrites })
    }
  });
  const input = documentObject.querySelector("#clean-input");

  await app.init();
  await input.dispatchEvent(createPasteEvent({ "text/plain": "https://example.com/?utm_source=x&keep=1" }));
  assert.equal(app.state.stage, "cleaning");
  assert.equal(app.state.buttonMode, "paste");

  await clock.advance(app.config.animationTimeoutMs);
  assert.deepEqual(clipboardWrites, []);
  assert.equal(documentObject.querySelector("#clean-output").hidden, true);
  assert.equal(clock.pending, 0);
  assert.equal(app.state.buttonMode, "copy");
  assert.equal(documentObject.querySelector(".clean-button-label").textContent, "Copy");
  assert.equal(documentObject.querySelector("#status-message").textContent, "All clear!");
  assert.equal(documentObject.querySelector(".clean-stage").dataset.state, "done");
  assert.equal(input.value, "https://example.com/?keep=1");
  assert.equal(input.selected, true);
  assert.equal(app.state.historyEntries[0].url, "https://example.com/?keep=1");
  assert.deepEqual(errors, []);
});

test("app writes the last result when Copy is tapped, then empties the field and returns to Paste", async () => {
  const clipboardWrites = [];
  const { app, documentObject, clock } = createHarness({
    navigatorOverrides: {
      clipboard: createRefusingClipboard({ clipboardWrites })
    }
  });
  const input = documentObject.querySelector("#clean-input");
  const button = documentObject.querySelector("#clean-button");

  await app.init();
  await typeInto(input, "HELLO   WORLD.");
  await input.dispatchEvent(createKeyEvent("Enter"));
  await clock.advance(app.config.animationTimeoutMs);
  assert.equal(input.value, "Hello world.");

  await button.dispatchEvent({ type: "click" });

  assert.deepEqual(clipboardWrites, ["Hello world."]);
  assert.equal(input.value, "");
  assert.equal(input.focused, false);
  assert.equal(app.state.buttonMode, "paste");
  assert.equal(documentObject.querySelector(".clean-button-label").textContent, "Paste");
  assert.equal(documentObject.querySelector(".clean-stage").dataset.state, "idle");
  assert.equal(documentObject.querySelector("#status-message").textContent, "All clear!");
});

test("app keeps the Copy button and reports the block when Copy is refused too", async () => {
  const clipboardWrites = [];
  const { app, documentObject } = createHarness({
    navigatorOverrides: {
      clipboard: createRefusingClipboard({ refusals: 2, clipboardWrites })
    }
  });
  const input = documentObject.querySelector("#clean-input");

  await app.init();
  await input.dispatchEvent(createPasteEvent({ "text/plain": "plain text" }));
  await documentObject.querySelector("#clean-button").dispatchEvent({ type: "click" });

  assert.deepEqual(clipboardWrites, []);
  assert.equal(app.state.buttonMode, "copy");
  assert.equal(input.value, "plain text");
  assert.equal(
    documentObject.querySelector("#status-message").textContent,
    "Clipboard access is blocked. Try allowing clipboard permissions."
  );
});

test("app leaves Copy mode when the field is edited or emptied", async () => {
  const clipboardWrites = [];
  const { app, documentObject } = createHarness({
    navigatorOverrides: {
      clipboard: createRefusingClipboard({ clipboardWrites })
    }
  });
  const input = documentObject.querySelector("#clean-input");

  await app.init();
  await input.dispatchEvent(createPasteEvent({ "text/plain": "plain text" }));
  assert.equal(app.state.buttonMode, "copy");

  await typeInto(input, "plain text, edited");
  assert.equal(app.state.buttonMode, "clean");
  assert.equal(documentObject.querySelector(".clean-stage").dataset.state, "editing");

  await input.dispatchEvent(createKeyEvent("Escape"));
  assert.equal(app.state.buttonMode, "paste");
  assert.equal(input.value, "");
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

test("app sizes the mobile column from the visual viewport and clears it on desktop", async () => {
  const mobileHarness = createHarness({
    innerWidth: 390,
    visualViewport: {
      height: 512.5,
      addEventListener() {}
    }
  });
  await mobileHarness.app.init();
  assert.equal(
    mobileHarness.documentObject.documentElement.style.properties.get("--viewport-height"),
    "512.5px"
  );

  const desktopHarness = createHarness({
    innerWidth: 1440,
    visualViewport: {
      height: 900,
      addEventListener() {}
    }
  });
  await desktopHarness.app.init();
  assert.equal(
    desktopHarness.documentObject.documentElement.style.properties.has("--viewport-height"),
    false
  );

  const noViewportHarness = createHarness({ innerWidth: 390 });
  await noViewportHarness.app.init();
  assert.equal(
    noViewportHarness.documentObject.documentElement.style.properties.has("--viewport-height"),
    false
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

test("app ignores pastes, drops, and Enter in update mode", async () => {
  const { app, documentObject, clipboardWrites } = createHarness();
  const input = documentObject.querySelector("#clean-input");
  const status = documentObject.querySelector("#status-message");

  await app.init();
  await typeInto(input, "typed before the update");
  app.pwa.bindRegistration(createWaitingRegistration());

  const fieldPaste = createPasteEvent({ "text/plain": "https://example.com/?utm_source=x" });
  const documentPaste = createPasteEvent(
    { "text/plain": "https://example.com/?utm_source=x" },
    { target: new FakeElement("BUTTON") }
  );
  const drop = createDragEvent("drop", { "text/plain": "https://example.com/?utm_source=x" });
  const enter = createKeyEvent("Enter");
  await input.dispatchEvent(fieldPaste);
  await documentObject.dispatchEvent(documentPaste);
  await documentObject.querySelector(".app-panel-hero").dispatchEvent(drop);
  await input.dispatchEvent(enter);

  assert.equal(fieldPaste.defaultPrevented, false);
  assert.equal(documentPaste.defaultPrevented, false);
  assert.equal(drop.defaultPrevented, false);
  assert.deepEqual(clipboardWrites, []);
  assert.equal(app.state.buttonMode, "update");
  assert.equal(status.textContent, "A new version for this app is available online.");
});

test("app disables the field in update mode and restores it on return to clean mode", async () => {
  const { app, documentObject } = createHarness({
    navigatorOverrides: {
      onLine: false
    }
  });
  const input = documentObject.querySelector("#clean-input");
  const stage = documentObject.querySelector(".clean-stage");
  const label = documentObject.querySelector(".clean-button-label");

  await app.init();
  app.pwa.bindRegistration(createWaitingRegistration());

  assert.equal(input.disabled, true);
  assert.equal(stage.dataset.state, "update");
  assert.equal(label.textContent, "Try again");

  app.pwa.setUpdateMode();
  assert.equal(input.disabled, true);
  assert.equal(stage.dataset.state, "update");

  app.ui.setPrimaryActionMode("paste");
  assert.equal(input.disabled, false);
  assert.equal(stage.dataset.state, "idle");
  assert.equal(label.textContent, "Paste");
  assert.equal(
    documentObject.querySelector("#status-message").textContent,
    "Remove junk parameters from any URL you paste, type or drop in."
  );

  input.value = "kept while updating";
  app.pwa.setUpdateMode();
  app.ui.setPrimaryActionMode("paste");
  assert.equal(app.state.buttonMode, "clean");
  assert.equal(label.textContent, "Clean");
  assert.equal(stage.dataset.state, "editing");
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
