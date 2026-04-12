import test from "node:test";
import assert from "node:assert/strict";

import { createSettingsApp } from "../src/settings.js";
import { getDefaultDomainTransformSettings } from "../src/settings-storage.js";
import { siteRules } from "../src/transforms.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = "";
    this.textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
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

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || "";
  }
}

class FakeInput extends FakeElement {
  constructor() {
    super("input");
    this.checked = false;
    this.name = "";
    this.type = "";
  }
}

function createSettingsDocument() {
  const elements = {
    "#settings-form": new FakeElement("form"),
    "#settings-list": new FakeElement("ul"),
    ".settings-save-button": new FakeElement("button"),
    "#settings-save-label": new FakeElement("span"),
    "#settings-status": new FakeElement("p")
  };
  const inputs = [];

  return {
    elements,
    inputs,

    querySelector(selector) {
      return elements[selector] || null;
    },

    createElement(tagName) {
      if (tagName === "input") {
        const input = new FakeInput();
        inputs.push(input);
        return input;
      }

      return new FakeElement(tagName);
    }
  };
}

function createHarness({ savedSettings = getDefaultDomainTransformSettings(), writeError } = {}) {
  const documentObject = createSettingsDocument();
  const writes = [];
  const assignedUrls = [];
  const errors = [];

  const storage = {
    async readDomainTransformSettings() {
      return savedSettings;
    },

    async writeDomainTransformSettings(settings) {
      writes.push({ ...settings });
      if (writeError) {
        throw writeError;
      }
    }
  };

  const windowObject = {
    HTMLInputElement: FakeInput,
    location: {
      assign(url) {
        assignedUrls.push(url);
      }
    }
  };

  const app = createSettingsApp({
    documentObject,
    windowObject,
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
    writes,
    assignedUrls,
    errors
  };
}

test("settings app stages domain transform changes and writes only on submit", async () => {
  const savedSettings = {
    ...getDefaultDomainTransformSettings(),
    "rewrite-reddit-to-redlib": true
  };
  const harness = createHarness({ savedSettings });
  const { app, documentObject, writes, assignedUrls } = harness;

  await app.init();

  assert.equal(documentObject.elements["#settings-list"].children.length, siteRules.length);
  assert.deepEqual(
    documentObject.inputs.map((input) => input.name),
    siteRules.map((rule) => rule.id)
  );
  assert.equal(documentObject.inputs.every((input) => input.checked), true);
  assert.equal(
    documentObject.elements["#settings-save-label"].textContent,
    "Confirm and go back to cleaning"
  );
  assert.equal(documentObject.elements["#settings-form"].attributes.get("aria-busy"), "false");
  assert.equal(documentObject.elements[".settings-save-button"].disabled, false);
  assert.deepEqual(writes, []);

  const redditInput = documentObject.inputs.find((input) => input.name === "rewrite-reddit-to-redlib");
  redditInput.checked = false;

  await documentObject.elements["#settings-form"].dispatchEvent({
    type: "change",
    target: redditInput
  });

  assert.deepEqual(writes, []);
  assert.equal(app.state.draftSettings["rewrite-reddit-to-redlib"], false);
  assert.equal(
    documentObject.elements["#settings-save-label"].textContent,
    "Save changes and go back to cleaning"
  );

  await documentObject.elements["#settings-form"].dispatchEvent({
    type: "submit",
    preventDefault() {}
  });

  assert.deepEqual(writes, [
    {
      "rewrite-x-to-fxtwitter": true,
      "rewrite-reddit-to-redlib": false,
      "keep-youtube-video-id": true
    }
  ]);
  assert.deepEqual(assignedUrls, ["/"]);
});

test("settings app reports storage write failures without navigating", async () => {
  const writeError = new Error("quota exceeded");
  const harness = createHarness({ writeError });
  const { app, documentObject, writes, assignedUrls, errors } = harness;

  await app.init();
  await documentObject.elements["#settings-form"].dispatchEvent({
    type: "submit",
    preventDefault() {}
  });

  assert.equal(writes.length, 1);
  assert.deepEqual(assignedUrls, []);
  assert.equal(
    documentObject.elements["#settings-status"].textContent,
    "Settings could not be saved on this device."
  );
  assert.equal(errors.length, 1);
});

test("settings app falls back to defaults when storage cannot be read", async () => {
  const documentObject = createSettingsDocument();
  const errors = [];

  const app = createSettingsApp({
    documentObject,
    windowObject: {
      HTMLInputElement: FakeInput,
      location: {
        assign() {}
      }
    },
    storage: {
      async readDomainTransformSettings() {
        throw new Error("storage unavailable");
      },

      async writeDomainTransformSettings() {}
    },
    consoleObject: {
      error(...args) {
        errors.push(args);
      }
    }
  });

  await app.init();

  assert.deepEqual(app.state.savedSettings, getDefaultDomainTransformSettings());
  assert.equal(documentObject.elements["#settings-list"].children.length, siteRules.length);
  assert.equal(
    documentObject.elements["#settings-status"].textContent,
    "Settings could not be loaded. Defaults are shown."
  );
  assert.equal(documentObject.elements["#settings-form"].attributes.get("aria-busy"), "false");
  assert.equal(documentObject.elements[".settings-save-button"].disabled, false);
  assert.equal(errors.length, 1);
});
