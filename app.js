const sharedTransforms = globalThis.cleanMyLinkTransforms;

const app = {
  config: {
    storageKey: "clean-my-link-history",
    historyTtlMs: 24 * 60 * 60 * 1000,
    historyLimit: 20,
    desktopBreakpoint: 960,
    defaultStatus: "Remove junk parameters from any URL you've just copied."
  },

  messages: {
    loading: "Accessing Clipboard",
    success: "All clear!",
    empty: "No text was found in your clipboard.",
    unchanged: "All clear!",
    blocked: "Clipboard access is blocked. Try allowing clipboard permissions.",
    error: "Something went sideways while cleaning your clipboard."
  },

  elements: {
    status: document.querySelector("#status-message"),
    button: document.querySelector("#clean-button"),
    buttonSparks: Array.from(document.querySelectorAll(".button-spark")),
    heroStage: document.querySelector(".hero-stage"),
    historySection: document.querySelector(".history-section"),
    historyList: document.querySelector("#history-list"),
    historyEmpty: document.querySelector("#history-empty"),
    historySummary: document.querySelector("#history-summary")
  },

  state: {
    layout: null,
    resizeFrame: 0,
    viewportListenerBound: false
  },

  transforms: sharedTransforms,

  history: {
    read() {
      try {
        const rawEntries = JSON.parse(localStorage.getItem(app.config.storageKey) || "[]");
        const freshEntries = rawEntries.filter((entry) => app.history.isValidEntry(entry));

        if (freshEntries.length !== rawEntries.length) {
          localStorage.setItem(app.config.storageKey, JSON.stringify(freshEntries));
        }

        return freshEntries.sort((left, right) => right.timestamp - left.timestamp);
      } catch {
        return [];
      }
    },

    save(url) {
      if (!app.transforms.isSafeHttpUrl(url)) {
        return;
      }

      const entries = app.history.read().filter((entry) => entry.url !== url);
      entries.unshift({
        url,
        timestamp: Date.now()
      });
      localStorage.setItem(
        app.config.storageKey,
        JSON.stringify(entries.slice(0, app.config.historyLimit))
      );
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

    burstButton() {
      app.elements.button.classList.remove("is-bursting");
      app.ui.setButtonBurst();
      void app.elements.button.offsetWidth;
      app.elements.button.classList.add("is-bursting");
    },

    setButtonBurst() {
      const tilt = `${((Math.random() * 2) - 1) * 1.8}deg`;
      app.elements.button.style.setProperty("--button-tilt", tilt);

      app.elements.buttonSparks.forEach((spark, index) => {
        const baseAngle = (Math.PI * 2 * index) / app.elements.buttonSparks.length;
        const angle = baseAngle + (((Math.random() * 2) - 1) * 0.38);
        const distance = 18 + Math.random() * 22;
        const size = 4 + Math.random() * 5;
        const delay = Math.floor(Math.random() * 90);

        spark.style.setProperty("--spark-x", `${Math.cos(angle) * distance}px`);
        spark.style.setProperty("--spark-y", `${Math.sin(angle) * distance}px`);
        spark.style.setProperty("--spark-size", `${size}px`);
        spark.style.setProperty("--spark-delay", `${delay}ms`);
      });
    },

    getOrderedEntries(entries) {
      return app.layout.isMobile() ? entries.slice().reverse() : entries;
    },

    renderHistory() {
      const entries = app.history.read();
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
        ? `${count} saved in the last 24 hours`
        : "Saved for 24 hours on this device.";
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
        app.history.save(result.output);
        app.ui.renderHistory();
      }

      return {
        ...result,
        hadClipboardText: true
      };
    }
  },

  pwa: {
    async register() {
      if (!("serviceWorker" in navigator)) {
        return;
      }

      try {
        await navigator.serviceWorker.register("sw.js");
      } catch (error) {
        console.error("Service worker registration failed", error);
      }
    }
  },

  events: {
    bind() {
      app.layout.bind();

      app.elements.button.addEventListener("click", async () => {
        let shouldBurst = false;
        app.ui.setStatus("loading");
        app.ui.setButtonLoading(true);

        try {
          await app.ui.waitForNextPaint();
          const result = await app.clipboard.cleanLatest();
          shouldBurst = Boolean(result?.hadClipboardText);
        } catch (error) {
          const statusKey = error?.name === "NotAllowedError" ? "blocked" : "error";
          app.ui.setStatus(statusKey);
          console.error(error);
        } finally {
          app.ui.setButtonLoading(false);

          if (shouldBurst) {
            app.ui.burstButton();
          }
        }
      });
    }
  },

  init() {
    if (!app.transforms) {
      throw new Error("Clean My Link transforms failed to load.");
    }

    app.layout.apply();
    app.events.bind();
    app.pwa.register();
  }
};

app.init();
