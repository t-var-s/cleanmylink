import "./transforms.js";

const sharedTransforms = globalThis.cleanMyLinkTransforms;

const app = {
  config: {
    storageKey: "clean-my-link-history",
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
    status: document.querySelector("#status-message"),
    button: document.querySelector("#clean-button"),
    buttonLabel: document.querySelector(".clean-button-label"),
    heroStage: document.querySelector(".hero-stage"),
    historySection: document.querySelector(".history-section"),
    historyList: document.querySelector("#history-list"),
    historyEmpty: document.querySelector("#history-empty"),
    historySummary: document.querySelector("#history-summary")
  },

  state: {
    layout: null,
    resizeFrame: 0,
    viewportListenerBound: false,
    buttonMode: "clean",
    pwaRegistration: null,
    isReloadingForUpdate: false,
    historyEntries: []
  },

  transforms: sharedTransforms,

  storage: {
    async readHistoryEntries() {
      const entries = JSON.parse(localStorage.getItem(app.config.storageKey) || "[]");
      return Array.isArray(entries) ? entries : [];
    },

    async writeHistoryEntries(entries) {
      localStorage.setItem(app.config.storageKey, JSON.stringify(entries));
    }
  },

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
        console.error("History storage read failed", error);
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
        console.error("History storage write failed", error);
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
      return window.innerWidth >= app.config.desktopBreakpoint;
    },

    isMobile() {
      return !app.layout.isDesktop();
    },

    apply() {
      const nextLayout = app.layout.isDesktop() ? "desktop" : "mobile";
      const changed = nextLayout !== app.state.layout;

      app.state.layout = nextLayout;
      document.body.dataset.layout = nextLayout;
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

      document.documentElement.style.setProperty("--hero-stage-height", `${heroHeight}px`);
    },

    scheduleApply() {
      if (app.state.resizeFrame) {
        cancelAnimationFrame(app.state.resizeFrame);
      }

      app.state.resizeFrame = requestAnimationFrame(() => {
        app.state.resizeFrame = 0;
        app.layout.apply();
      });
    },

    bind() {
      window.addEventListener("resize", app.layout.scheduleApply, { passive: true });
      window.addEventListener("orientationchange", app.layout.scheduleApply);

      if (window.visualViewport && !app.state.viewportListenerBound) {
        window.visualViewport.addEventListener("resize", app.layout.scheduleApply, { passive: true });
        app.state.viewportListenerBound = true;
      }

      if (!window.ResizeObserver) {
        return;
      }

      const heroObserver = new ResizeObserver(() => {
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
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
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
      app.elements.historyEmpty.hidden = entries.length > 0;
      app.ui.setHistorySummary(entries.length);

      for (const entry of orderedEntries) {
        const item = document.createElement("li");
        item.className = "history-item";

        const link = document.createElement("a");
        link.className = "history-link";
        link.href = entry.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        const urlText = document.createElement("span");
        urlText.className = "history-url";
        urlText.textContent = entry.url;

        const metaText = document.createElement("span");
        metaText.className = "history-meta";
        metaText.textContent = `Saved ${app.history.relativeTime(entry.timestamp)}`;

        link.append(urlText, metaText);
        item.append(link);
        app.elements.historyList.append(item);
      }

      app.ui.syncHistoryScroll();
    },

    syncHistoryScroll() {
      requestAnimationFrame(() => {
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

    setHistorySummary(count) {
      if (!app.elements.historySummary) {
        return;
      }

      app.elements.historySummary.textContent = count > 0
        ? `${count} saved in the last 72 hours`
        : "Saved for 72 hours on this device.";
    }
  },

  clipboard: {
    async cleanLatest() {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        app.ui.setStatus("empty");
        return {
          changed: false,
          hadClipboardText: false
        };
      }

      const result = app.transforms.cleanInput(clipboardText);
      await navigator.clipboard.writeText(result.output);
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
      app.ui.setPrimaryActionMode(navigator.onLine ? "update" : "retry-update");
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
            navigator.serviceWorker.controller
          ) {
            app.pwa.setUpdateMode();
          }
        });
      });
    },

    async checkForUpdate() {
      if (!app.state.pwaRegistration || !navigator.onLine) {
        return;
      }

      try {
        await app.state.pwaRegistration.update();
      } catch (error) {
        console.error("Service worker update check failed", error);
      }
    },

    async activateUpdate() {
      const registration = app.state.pwaRegistration;
      if (!registration) {
        return;
      }

      if (!navigator.onLine) {
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
        console.error("Service worker update activation failed", error);
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

      if (!("serviceWorker" in navigator)) {
        return;
      }

      try {
        const registration = await navigator.serviceWorker.register("sw.js");
        app.pwa.bindRegistration(registration);
        await app.pwa.checkForUpdate();
      } catch (error) {
        console.error("Service worker registration failed", error);
      }
    }
  },

  dev: {
    isLocalhost() {
      return (
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1" ||
        location.hostname === "[::1]"
      );
    },

    installHelpers() {
      if (!app.dev.isLocalhost()) {
        return;
      }

      window.resetAppCache = async ({ reload = true } = {}) => {
        const registrations = "serviceWorker" in navigator
          ? await navigator.serviceWorker.getRegistrations()
          : [];
        const cacheKeys = "caches" in window
          ? await caches.keys()
          : [];

        await Promise.all(registrations.map((registration) => registration.unregister()));
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));

        const summary = {
          unregisteredServiceWorkers: registrations.length,
          deletedCaches: cacheKeys.length
        };

        if (reload) {
          window.location.reload();
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
          console.error(error);
        } finally {
          app.ui.setButtonLoading(false);
        }
      });

      window.addEventListener("focus", () => {
        app.pwa.checkForUpdate();
      });

      window.addEventListener("online", () => {
        if (app.state.buttonMode !== "clean") {
          app.pwa.setUpdateMode();
        }

        app.pwa.checkForUpdate();
      });

      window.addEventListener("offline", () => {
        if (app.state.buttonMode !== "clean") {
          app.ui.setPrimaryActionMode("retry-update");
        }
      });

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          app.pwa.checkForUpdate();
        }
      });

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (app.state.isReloadingForUpdate) {
            window.location.reload();
          }
        });
      }
    }
  },

  async init() {
    if (!app.transforms) {
      throw new Error("Clean My Link transforms failed to load.");
    }

    await app.history.load();
    app.layout.apply();
    app.dev.installHelpers();
    app.events.bind();
    await app.pwa.register();
  }
};

app.init().catch((error) => {
  app.ui.setStatus("error");
  console.error(error);
});
