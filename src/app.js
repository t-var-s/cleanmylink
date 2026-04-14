import * as sharedTransforms from "./transforms.js";
import { createStorageAdapter } from "./storage.js";
import { composeEnabledTransforms } from "./settings-storage.js";

export function createApp({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  navigatorObject = globalThis.navigator,
  storage,
  storageObject,
  locationObject = globalThis.location,
  consoleObject = globalThis.console
} = {}) {
  if (!documentObject || !windowObject || !navigatorObject || !locationObject) {
    throw new Error("Clean My Link app requires browser globals or injected test doubles.");
  }

  const storageAdapter = storage || createStorageAdapter({ storageObject });

  const app = {
    config: {
      historyTtlMs: 72 * 60 * 60 * 1000,
      historyLimit: 100,
      desktopBreakpoint: 960,
      defaultStatus: "Remove junk parameters from any URL you've just copied.",
      defaultButtonLabel: "Clean My Copied Link"
    },

    messages: {
      loading: "Accessing Clipboard",
      success: "All clear!",
      empty: "No text was found in your clipboard.",
      unchanged: "All clear!",
      blocked: "Clipboard access is blocked. Try allowing clipboard permissions.",
      error: "Something went sideways while cleaning your clipboard.",
      updateAvailable: "A new version for this app is available online.",
      updateOffline: "Network went offline, can't update."
    },

    elements: {
      status: documentObject.querySelector("#status-message"),
      button: documentObject.querySelector("#clean-button"),
      buttonLabel: documentObject.querySelector(".clean-button-label"),
      heroStage: documentObject.querySelector(".hero-stage"),
      historySection: documentObject.querySelector(".history-section"),
      historyList: documentObject.querySelector("#history-list"),
      historyEmpty: documentObject.querySelector("#history-empty")
    },

    state: {
      layout: null,
      resizeFrame: 0,
      viewportListenerBound: false,
      buttonMode: "clean",
      pwaRegistration: null,
      isReloadingForUpdate: false,
      historyEntries: [],
      enabledTransforms: sharedTransforms.defaultEnabledTransforms
    },

    transforms: sharedTransforms,

    storage: storageAdapter,

    history: {
      async load() {
        try {
          const rawEntries = await app.storage.readHistoryEntries();
          const freshEntries = rawEntries.filter((entry) => app.history.isValidEntry(entry));

          if (freshEntries.length !== rawEntries.length) {
            await app.storage.writeHistoryEntries(freshEntries);
          }

          app.state.historyEntries = freshEntries.sort((left, right) => right.timestamp - left.timestamp);
        } catch (error) {
          consoleObject.error("History storage read failed", error);
          app.state.historyEntries = [];
        }
      },

      async save(url) {
        if (!app.transforms.isSafeHttpUrl(url)) {
          return;
        }

        const entries = app.state.historyEntries.filter((entry) => entry.url !== url);
        entries.unshift({
          url,
          timestamp: Date.now()
        });
        app.state.historyEntries = entries.slice(0, app.config.historyLimit);

        try {
          await app.storage.writeHistoryEntries(app.state.historyEntries);
        } catch (error) {
          consoleObject.error("History storage write failed", error);
        }
      },

      isValidEntry(entry) {
        return (
          entry &&
          typeof entry === "object" &&
          typeof entry.url === "string" &&
          typeof entry.timestamp === "number" &&
          Number.isFinite(entry.timestamp) &&
          Date.now() - entry.timestamp < app.config.historyTtlMs &&
          app.transforms.isSafeHttpUrl(entry.url)
        );
      },

      relativeTime(timestamp) {
        const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
        if (minutes < 60) {
          return `${minutes} min ago`;
        }

        const hours = Math.round(minutes / 60);
        return `${hours} hr${hours === 1 ? "" : "s"} ago`;
      }
    },

    layout: {
      isDesktop() {
        return windowObject.innerWidth >= app.config.desktopBreakpoint;
      },

      isMobile() {
        return !app.layout.isDesktop();
      },

      apply() {
        const nextLayout = app.layout.isDesktop() ? "desktop" : "mobile";
        const changed = nextLayout !== app.state.layout;

        app.state.layout = nextLayout;
        documentObject.body.dataset.layout = nextLayout;
        app.layout.measureHeroStage();

        if (changed) {
          app.ui.renderHistory();
          return;
        }

        app.ui.syncHistoryScroll();
      },

      measureHeroStage() {
        const heroHeight = app.layout.isMobile()
          ? Math.ceil(app.elements.heroStage.getBoundingClientRect().height)
          : 0;

        documentObject.documentElement.style.setProperty("--hero-stage-height", `${heroHeight}px`);
      },

      scheduleApply() {
        if (app.state.resizeFrame) {
          windowObject.cancelAnimationFrame(app.state.resizeFrame);
        }

        app.state.resizeFrame = windowObject.requestAnimationFrame(() => {
          app.state.resizeFrame = 0;
          app.layout.apply();
        });
      },

      bind() {
        windowObject.addEventListener("resize", app.layout.scheduleApply, { passive: true });
        windowObject.addEventListener("orientationchange", app.layout.scheduleApply);

        if (windowObject.visualViewport && !app.state.viewportListenerBound) {
          windowObject.visualViewport.addEventListener("resize", app.layout.scheduleApply, { passive: true });
          app.state.viewportListenerBound = true;
        }

        if (!windowObject.ResizeObserver) {
          return;
        }

        const heroObserver = new windowObject.ResizeObserver(() => {
          app.layout.scheduleApply();
        });

        heroObserver.observe(app.elements.heroStage);
      }
    },

    ui: {
      setStatus(key) {
        app.elements.status.textContent = app.messages[key] || app.config.defaultStatus;
        app.layout.scheduleApply();
      },

      setButtonLabel(label) {
        app.elements.buttonLabel.textContent = label;
      },

      setButtonLoading(isLoading) {
        app.elements.button.classList.toggle("is-loading", isLoading);
        app.elements.button.disabled = isLoading;
        app.elements.button.toggleAttribute("aria-busy", isLoading);
      },

      waitForNextPaint() {
        return new Promise((resolve) => {
          windowObject.requestAnimationFrame(() => {
            windowObject.requestAnimationFrame(resolve);
          });
        });
      },

      setPrimaryActionMode(mode) {
        app.state.buttonMode = mode;

        if (mode === "update") {
          app.ui.setStatus("updateAvailable");
          app.ui.setButtonLabel("Update Now");
          return;
        }

        if (mode === "retry-update") {
          app.ui.setStatus("updateOffline");
          app.ui.setButtonLabel("Try again");
          return;
        }

        app.elements.status.textContent = app.config.defaultStatus;
        app.ui.setButtonLabel(app.config.defaultButtonLabel);
        app.layout.scheduleApply();
      },

      getOrderedEntries(entries) {
        return app.layout.isMobile() ? entries.slice().reverse() : entries;
      },

      renderHistory() {
        const entries = app.state.historyEntries;
        const orderedEntries = app.ui.getOrderedEntries(entries);

        app.elements.historyList.innerHTML = "";
        app.elements.historyEmpty.textContent = entries.length > 0
          ? ""
          : "No links cleaned yet.";
        app.elements.historyEmpty.hidden = entries.length > 0;
        app.elements.historyEmpty.removeAttribute("aria-busy");

        for (const entry of orderedEntries) {
          const item = documentObject.createElement("li");
          item.className = "history-item";

          const link = documentObject.createElement("a");
          link.className = "history-link";
          link.href = entry.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";

          const urlText = documentObject.createElement("span");
          urlText.className = "history-url";
          urlText.textContent = entry.url;

          const metaText = documentObject.createElement("span");
          metaText.className = "history-meta";
          metaText.textContent = `Saved ${app.history.relativeTime(entry.timestamp)}`;

          link.append(urlText, metaText);
          item.append(link);
          app.elements.historyList.append(item);
        }

        app.ui.syncHistoryScroll();
      },

      syncHistoryScroll() {
        windowObject.requestAnimationFrame(() => {
          if (app.layout.isMobile()) {
            const { scrollHeight, clientHeight } = app.elements.historySection;
            app.elements.historySection.scrollTop = scrollHeight > clientHeight
              ? scrollHeight
              : 0;
            return;
          }

          app.elements.historySection.scrollTop = 0;
        });
      },

      setHistoryLoading(isLoading) {
        if (!app.elements.historyEmpty) {
          return;
        }

        if (!isLoading) {
          app.elements.historyEmpty.removeAttribute("aria-busy");
          return;
        }

        app.elements.historyEmpty.hidden = false;
        app.elements.historyEmpty.textContent = "Loading saved links from this device...";
        app.elements.historyEmpty.setAttribute("aria-busy", "true");
      }
    },

    clipboard: {
      async cleanLatest() {
        const clipboardText = await navigatorObject.clipboard.readText();
        if (!clipboardText.trim()) {
          app.ui.setStatus("empty");
          return {
            changed: false,
            hadClipboardText: false
          };
        }

        const result = app.transforms.cleanInput(clipboardText, {
          enabledTransforms: app.state.enabledTransforms
        });
        await navigatorObject.clipboard.writeText(result.output);
        app.ui.setStatus(result.changed ? "success" : "unchanged");

        if (result.isUrl) {
          await app.history.save(result.output);
          app.ui.renderHistory();
        }

        return {
          ...result,
          hadClipboardText: true
        };
      }
    },

    pwa: {
      setUpdateMode() {
        app.ui.setPrimaryActionMode(navigatorObject.onLine ? "update" : "retry-update");
      },

      bindRegistration(registration) {
        app.state.pwaRegistration = registration;

        if (registration.waiting) {
          app.pwa.setUpdateMode();
        }

        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          if (!installingWorker) {
            return;
          }

          installingWorker.addEventListener("statechange", () => {
            if (
              installingWorker.state === "installed" &&
              navigatorObject.serviceWorker.controller
            ) {
              app.pwa.setUpdateMode();
            }
          });
        });
      },

      async checkForUpdate() {
        if (!app.state.pwaRegistration || !navigatorObject.onLine) {
          return;
        }

        try {
          await app.state.pwaRegistration.update();
        } catch (error) {
          consoleObject.error("Service worker update check failed", error);
        }
      },

      async activateUpdate() {
        const registration = app.state.pwaRegistration;
        if (!registration) {
          return;
        }

        if (!navigatorObject.onLine) {
          app.ui.setPrimaryActionMode("retry-update");
          return;
        }

        const waitingWorker = registration.waiting;
        if (waitingWorker) {
          app.state.isReloadingForUpdate = true;
          app.ui.setButtonLoading(true);
          waitingWorker.postMessage({ type: "SKIP_WAITING" });
          return;
        }

        app.ui.setButtonLoading(true);

        try {
          await registration.update();

          if (registration.waiting) {
            app.state.isReloadingForUpdate = true;
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
            return;
          }
        } catch (error) {
          consoleObject.error("Service worker update activation failed", error);
          app.ui.setPrimaryActionMode("retry-update");
        } finally {
          if (!app.state.isReloadingForUpdate) {
            app.ui.setButtonLoading(false);
          }
        }
      },

      async register() {
        if (import.meta.env?.DEV) {
          return;
        }

        if (!("serviceWorker" in navigatorObject)) {
          return;
        }

        try {
          const registration = await navigatorObject.serviceWorker.register("sw.js");
          app.pwa.bindRegistration(registration);
          await app.pwa.checkForUpdate();
        } catch (error) {
          consoleObject.error("Service worker registration failed", error);
        }
      }
    },

    dev: {
      isLocalhost() {
        return (
          locationObject.hostname === "localhost" ||
          locationObject.hostname === "127.0.0.1" ||
          locationObject.hostname === "[::1]"
        );
      },

      installHelpers() {
        if (!app.dev.isLocalhost()) {
          return;
        }

        windowObject.resetAppCache = async ({ reload = true } = {}) => {
          const registrations = "serviceWorker" in navigatorObject
            ? await navigatorObject.serviceWorker.getRegistrations()
            : [];
          const cacheKeys = "caches" in windowObject
            ? await windowObject.caches.keys()
            : [];

          await Promise.all(registrations.map((registration) => registration.unregister()));
          await Promise.all(cacheKeys.map((key) => windowObject.caches.delete(key)));

          const summary = {
            unregisteredServiceWorkers: registrations.length,
            deletedCaches: cacheKeys.length
          };

          if (reload) {
            windowObject.location.reload();
          }

          return summary;
        };
      }
    },

    events: {
      bind() {
        app.layout.bind();

        app.elements.button.addEventListener("click", async () => {
          if (app.state.buttonMode !== "clean") {
            await app.pwa.activateUpdate();
            return;
          }

          app.ui.setStatus("loading");
          app.ui.setButtonLoading(true);

          try {
            await app.ui.waitForNextPaint();
            await app.clipboard.cleanLatest();
          } catch (error) {
            const statusKey = error?.name === "NotAllowedError" ? "blocked" : "error";
            app.ui.setStatus(statusKey);
            consoleObject.error(error);
          } finally {
            app.ui.setButtonLoading(false);
          }
        });

        windowObject.addEventListener("focus", () => {
          app.pwa.checkForUpdate();
        });

        windowObject.addEventListener("online", () => {
          if (app.state.buttonMode !== "clean") {
            app.pwa.setUpdateMode();
          }

          app.pwa.checkForUpdate();
        });

        windowObject.addEventListener("offline", () => {
          if (app.state.buttonMode !== "clean") {
            app.ui.setPrimaryActionMode("retry-update");
          }
        });

        documentObject.addEventListener("visibilitychange", () => {
          if (documentObject.visibilityState === "visible") {
            app.pwa.checkForUpdate();
          }
        });

        if ("serviceWorker" in navigatorObject) {
          navigatorObject.serviceWorker.addEventListener("controllerchange", () => {
            if (app.state.isReloadingForUpdate) {
              windowObject.location.reload();
            }
          });
        }
      }
    },

    async init() {
      if (!app.transforms) {
        throw new Error("Clean My Link transforms failed to load.");
      }

      app.ui.setHistoryLoading(true);
      await app.history.load();
      app.ui.setHistoryLoading(false);
      app.layout.apply();

      try {
        app.state.enabledTransforms = composeEnabledTransforms(
          await app.storage.readDomainTransformSettings()
        );
      } catch (error) {
        app.state.enabledTransforms = composeEnabledTransforms();
        consoleObject.error("Transform settings storage read failed", error);
      }

      app.dev.installHelpers();
      app.events.bind();
      await app.pwa.register();
    }
  };

  return app;
}

export function bootApp(options) {
  const app = createApp(options);
  app.init().catch((error) => {
    app.ui.setStatus("error");
    console.error(error);
  });
  return app;
}
