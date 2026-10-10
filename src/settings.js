import { siteRules } from "./transforms.js";
import { createStorageAdapter } from "./storage.js";
import {
  domainTransformSettingsEqual,
  getDefaultDomainTransformSettings
} from "./settings-storage.js";

export function createSettingsApp({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  storage,
  storageObject,
  consoleObject = globalThis.console
} = {}) {
  if (!documentObject || !windowObject) {
    throw new Error("Clean My Link settings require browser globals or injected test doubles.");
  }

  const storageAdapter = storage || createStorageAdapter({ storageObject });

  const app = {
    elements: {
      form: documentObject.querySelector("#settings-form"),
      list: documentObject.querySelector("#settings-list"),
      saveButton: documentObject.querySelector(".settings-save-button"),
      saveLabel: documentObject.querySelector("#settings-save-label"),
      status: documentObject.querySelector("#settings-status"),
      inputs: new Map()
    },

    state: {
      savedSettings: getDefaultDomainTransformSettings(),
      draftSettings: {}
    },

    storage: storageAdapter,

    ui: {
      renderRules() {
        app.elements.list.innerHTML = "";
        app.elements.inputs.clear();

        for (const rule of siteRules) {
          const item = documentObject.createElement("li");
          item.className = "settings-item";

          const label = documentObject.createElement("label");
          label.className = "settings-toggle";

          const copy = documentObject.createElement("span");
          copy.className = "settings-toggle-copy";

          const domain = documentObject.createElement("span");
          domain.className = "settings-domain";
          domain.textContent = rule.domainLabel || rule.label;

          const description = documentObject.createElement("span");
          description.className = "settings-description";
          description.textContent = rule.label;

          const input = documentObject.createElement("input");
          input.type = "checkbox";
          input.name = rule.id;
          input.checked = app.state.draftSettings[rule.id] === true;
          app.elements.inputs.set(rule.id, input);

          const control = documentObject.createElement("span");
          control.className = "settings-switch";
          control.setAttribute("aria-hidden", "true");

          copy.append(domain, description);
          label.append(copy, input, control);
          item.append(label);
          app.elements.list.append(item);
        }
      },

      // The toggles render before the saved settings arrive, so the page has
      // its final size from the first frame. This moves them to the saved
      // states and commits the styles while the form is still busy, so the
      // switch transition does not play on load.
      applyDraft() {
        for (const [id, input] of app.elements.inputs) {
          input.checked = app.state.draftSettings[id] === true;
        }

        void app.elements.list.offsetWidth;
      },

      syncSaveLabel() {
        const hasChanges = !domainTransformSettingsEqual(
          app.state.savedSettings,
          app.state.draftSettings
        );

        app.elements.saveLabel.textContent = hasChanges
          ? "Save changes and go back to cleaning"
          : "Confirm and go back to cleaning";
      },

      setStatus(message) {
        if (app.elements.status) {
          app.elements.status.textContent = message;
        }
      },

      setLoading(isLoading) {
        if (app.elements.form) {
          app.elements.form.setAttribute("aria-busy", isLoading ? "true" : "false");
        }

        if (app.elements.saveButton) {
          app.elements.saveButton.disabled = isLoading;
        }

        for (const input of app.elements.inputs.values()) {
          input.disabled = isLoading;
        }
      }
    },

    events: {
      bind() {
        app.elements.form.addEventListener("change", (event) => {
          const input = event.target;
          if (!(input instanceof windowObject.HTMLInputElement) || input.type !== "checkbox") {
            return;
          }

          app.state.draftSettings[input.name] = input.checked;
          app.ui.syncSaveLabel();
        });

        app.elements.form.addEventListener("submit", async (event) => {
          event.preventDefault();

          try {
            await app.storage.writeDomainTransformSettings(app.state.draftSettings);
            windowObject.location.assign("/");
          } catch (error) {
            app.ui.setStatus("Settings could not be saved on this device.");
            consoleObject.error("Settings storage write failed", error);
          }
        });
      }
    },

    async init() {
      app.state.draftSettings = { ...app.state.savedSettings };
      app.ui.renderRules();
      app.ui.syncSaveLabel();
      app.ui.setLoading(true);

      try {
        app.state.savedSettings = await app.storage.readDomainTransformSettings();
      } catch (error) {
        app.state.savedSettings = getDefaultDomainTransformSettings();
        app.ui.setStatus("Settings could not be loaded. Defaults are shown.");
        consoleObject.error("Settings storage read failed", error);
      }

      app.state.draftSettings = { ...app.state.savedSettings };
      app.ui.applyDraft();
      app.ui.syncSaveLabel();
      app.ui.setLoading(false);
      app.events.bind();
    }
  };

  return app;
}

export async function bootSettingsApp(options) {
  const app = createSettingsApp(options);
  await app.init();
  return app;
}
