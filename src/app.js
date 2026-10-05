import * as sharedTransforms from "./transforms.js";
import { createStorageAdapter } from "./storage.js";
import { composeEnabledTransforms } from "./settings-storage.js";
import { diffSegments } from "./diff.js";

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
      animationTimeoutMs: 600,
      resultHoldMs: 800,
      reducedMotionQuery: "(prefers-reduced-motion: reduce)",
      defaultStatus: "Remove junk parameters from any URL you paste, type or drop in.",
      defaultButtonLabel: "Paste",
      buttonLabels: {
        clean: "Clean",
        copy: "Copy",
        update: "Update Now",
        "retry-update": "Try again"
      }
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
      form: documentObject.querySelector("#clean-form"),
      input: documentObject.querySelector("#clean-input"),
      output: documentObject.querySelector("#clean-output"),
      stage: documentObject.querySelector(".clean-stage"),
      heroPanel: documentObject.querySelector(".app-panel-hero"),
      historySection: documentObject.querySelector(".history-section"),
      historyList: documentObject.querySelector("#history-list"),
      historyEmpty: documentObject.querySelector("#history-empty")
    },

    state: {
      layout: null,
      resizeFrame: 0,
      viewportListenerBound: false,
      buttonMode: "paste",
      stage: "idle",
      lastResult: null,
      stageResult: null,
      isAnimating: false,
      animationTimer: 0,
      inputHeight: 0,
      dragDepth: 0,
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

    sharing: {
      buildShareData(entry) {
        return {
          url: entry.url
        };
      },

      canShareEntry(entry) {
        if (typeof navigatorObject.share !== "function") {
          return false;
        }

        const shareData = app.sharing.buildShareData(entry);
        if (typeof navigatorObject.canShare !== "function") {
          return true;
        }

        try {
          return navigatorObject.canShare(shareData);
        } catch (error) {
          consoleObject.error("History link share availability check failed", error);
          return false;
        }
      },

      async shareEntry(entry) {
        await navigatorObject.share(app.sharing.buildShareData(entry));
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
        app.layout.syncViewportHeight();
        app.layout.resetViewportPan();

        if (changed) {
          app.ui.renderHistory();
          return;
        }

        app.ui.syncHistoryScroll();
      },

      syncViewportHeight() {
        const viewportHeight = app.layout.isMobile()
          ? windowObject.visualViewport?.height
          : null;

        if (viewportHeight > 0) {
          documentObject.documentElement.style.setProperty("--viewport-height", `${viewportHeight}px`);
          return;
        }

        documentObject.documentElement.style.removeProperty("--viewport-height");
      },

      resetViewportPan() {
        const viewport = windowObject.visualViewport;
        const scale = viewport?.scale ?? 1;
        const offsetTop = viewport?.offsetTop ?? 0;
        const scrollY = windowObject.scrollY ?? 0;

        // iOS pans the visual viewport to reveal the focused field before the
        // body shrinks to the keyboard-free height, which leaves a gap. Pinch
        // zoom also pans, so leave anything above scale 1 alone.
        if (app.layout.isMobile() && scale <= 1 && (offsetTop > 0 || scrollY > 0)) {
          windowObject.scrollTo(0, 0);
        }
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
          windowObject.visualViewport.addEventListener("scroll", app.layout.scheduleApply, { passive: true });
          app.state.viewportListenerBound = true;
        }
      }
    },

    ui: {
      setStatus(key) {
        app.elements.status.textContent = app.messages[key] || app.config.defaultStatus;
        app.layout.scheduleApply();
      },

      pulseStatus() {
        const { status } = app.elements;
        status.classList.toggle("is-pulsing", false);
        // Reading layout restarts the animation when the class comes back.
        void status.offsetWidth;
        status.classList.toggle("is-pulsing", true);
      },

      setButtonLabel(label) {
        app.elements.buttonLabel.textContent = label;
      },

      setButtonLoading(isLoading) {
        app.elements.button.classList.toggle("is-loading", isLoading);
        app.elements.button.disabled = isLoading;
        app.elements.button.toggleAttribute("aria-busy", isLoading);
      },

      isUpdateMode(mode = app.state.buttonMode) {
        return mode === "update" || mode === "retry-update";
      },

      setPrimaryActionMode(mode) {
        const wasUpdateMode = app.ui.isUpdateMode();
        const isUpdateMode = app.ui.isUpdateMode(mode);
        app.state.buttonMode = mode;
        app.ui.setButtonLabel(app.config.buttonLabels[mode] || app.config.defaultButtonLabel);
        app.elements.input.disabled = isUpdateMode;

        if (isUpdateMode) {
          app.stage.cancel();
          app.stage.setState("update");
          app.ui.setStatus(mode === "update" ? "updateAvailable" : "updateOffline");
          return;
        }

        if (wasUpdateMode) {
          app.elements.status.textContent = app.config.defaultStatus;
          app.input.refresh();
          app.layout.scheduleApply();
        }
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

          if (app.sharing.canShareEntry(entry)) {
            link.addEventListener("click", async (event) => {
              event.preventDefault();

              try {
                await app.sharing.shareEntry(entry);
              } catch (error) {
                if (error?.name !== "AbortError") {
                  consoleObject.error("History link share failed", error);
                }
              }
            });
          }

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
      async cleanLatest(clipboardTextPromise = navigatorObject.clipboard.readText()) {
        return app.input.clean(await clipboardTextPromise, { source: "clipboard" });
      },

      async writeBack(output) {
        if (typeof navigatorObject.clipboard?.writeText !== "function") {
          return { written: false };
        }

        try {
          await navigatorObject.clipboard.writeText(output);
          return { written: true };
        } catch (error) {
          if (error?.name === "NotAllowedError") {
            return { written: false };
          }

          throw error;
        }
      },

      async copyLast() {
        const { written } = await app.clipboard.writeBack(app.state.lastResult.output);

        if (!written) {
          app.ui.setStatus("blocked");
          return { written };
        }

        app.input.reset({ blur: true });
        return { written };
      }
    },

    stage: {
      setState(name) {
        app.state.stage = name;
        app.elements.stage.dataset.state = name;
      },

      isBusy() {
        return app.state.stageResult !== null;
      },

      prefersReducedMotion() {
        return windowObject.matchMedia?.(app.config.reducedMotionQuery)?.matches === true;
      },

      play(input, result) {
        app.stage.cancel();
        app.state.stageResult = result;

        if (app.stage.prefersReducedMotion()) {
          return;
        }

        if (!result.changed) {
          app.stage.render([{ text: result.output, kind: "same" }]);
          return;
        }

        app.stage.render(diffSegments(input, result.output));
        app.stage.animate();
      },

      render(segments) {
        const { output } = app.elements;
        output.innerHTML = "";
        output.classList.toggle("is-animating", false);

        for (const { text, kind } of segments) {
          const token = documentObject.createElement("span");
          token.className = `tok tok-${kind}`;
          token.textContent = text;
          output.append(token);
        }

        app.stage.showOutput(true);
        app.stage.setState("cleaning");
      },

      showOutput(isVisible) {
        app.elements.output.hidden = !isVisible;
        app.elements.stage.classList.toggle("has-output", isVisible);
        app.layout.scheduleApply();
      },

      animate() {
        const { output } = app.elements;
        // Reading layout commits the starting styles, so the class change transitions.
        void output.offsetWidth;
        output.classList.toggle("is-animating", true);
        app.state.isAnimating = true;
        app.state.animationTimer = windowObject.setTimeout(
          app.stage.endAnimation,
          app.config.animationTimeoutMs
        );
      },

      handleTransitionEnd(event) {
        if (event.propertyName === "font-size") {
          app.stage.endAnimation();
        }
      },

      endAnimation() {
        if (!app.state.isAnimating) {
          return;
        }

        app.state.isAnimating = false;
        app.stage.clearTimer();

        if (typeof app.state.stageResult?.written === "boolean") {
          app.stage.settle();
        }
      },

      finish(result) {
        if (result !== app.state.stageResult) {
          return;
        }

        if (!result.changed && !app.stage.prefersReducedMotion()) {
          app.ui.pulseStatus();
        }

        if (!app.state.isAnimating) {
          app.stage.settle();
        }
      },

      settle() {
        const result = app.state.stageResult;

        if (!result.written) {
          app.stage.cancel();
          app.input.showCopy(result.output);
          return;
        }

        if (app.stage.prefersReducedMotion()) {
          app.input.reset({ blur: true });
          return;
        }

        app.stage.render([{ text: result.output, kind: "same" }]);
        app.stage.setState("done");
        app.state.animationTimer = windowObject.setTimeout(
          () => app.input.reset({ blur: true }),
          app.config.resultHoldMs
        );
      },

      clearTimer() {
        if (app.state.animationTimer) {
          windowObject.clearTimeout(app.state.animationTimer);
          app.state.animationTimer = 0;
        }
      },

      cancel() {
        app.stage.clearTimer();
        app.state.isAnimating = false;
        app.state.stageResult = null;

        if (!app.elements.output.hidden) {
          app.elements.output.innerHTML = "";
          app.elements.output.classList.toggle("is-animating", false);
          app.stage.showOutput(false);
        }
      }
    },

    input: {
      async clean(text, { source } = {}) {
        if (!text.trim()) {
          app.ui.setStatus("empty");
          return {
            changed: false,
            hadClipboardText: false
          };
        }

        const result = app.transforms.cleanInput(text, {
          enabledTransforms: app.state.enabledTransforms
        });
        const cleaning = { ...result, source };
        app.state.lastResult = cleaning;
        // The write-back starts before anything else so it stays inside the activation.
        const writing = app.clipboard.writeBack(result.output);
        app.stage.play(text.trim(), cleaning);

        let written;
        try {
          ({ written } = await writing);
        } catch (error) {
          if (app.state.stageResult === cleaning) {
            app.stage.cancel();
            app.input.refresh();
          }

          throw error;
        }

        cleaning.written = written;
        app.ui.setStatus(result.changed ? "success" : "unchanged");
        app.stage.finish(cleaning);

        if (result.isUrl) {
          await app.history.save(result.output);
          app.ui.renderHistory();
        }

        return {
          ...result,
          hadClipboardText: true,
          written
        };
      },

      async guard(task) {
        try {
          return await task();
        } catch (error) {
          const statusKey = error?.name === "NotAllowedError" ? "blocked" : "error";
          app.ui.setStatus(statusKey);
          consoleObject.error(error);
          return null;
        } finally {
          app.ui.setButtonLoading(false);
        }
      },

      async pasteFromClipboard() {
        if (typeof navigatorObject.clipboard?.readText !== "function") {
          app.elements.input.focus();
          return null;
        }

        return app.input.guard(() => {
          app.ui.setStatus("loading");
          const clipboardTextPromise = navigatorObject.clipboard.readText();
          app.ui.setButtonLoading(true);
          return app.clipboard.cleanLatest(clipboardTextPromise);
        });
      },

      isEditableTarget(target) {
        return Boolean(
          target &&
          (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        );
      },

      handlePaste(event) {
        const text = event.clipboardData?.getData("text/plain") || "";
        if (!text.trim() || app.ui.isUpdateMode()) {
          return null;
        }

        event.preventDefault();
        return app.input.guard(() => app.input.clean(text, { source: "paste" }));
      },

      handleDocumentPaste(event) {
        if (event.defaultPrevented || app.input.isEditableTarget(event.target)) {
          return null;
        }

        return app.input.handlePaste(event);
      },

      isHoldingResult() {
        return app.stage.isBusy() && app.state.stageResult.written === true;
      },

      handleSubmit(event) {
        event?.preventDefault();

        const text = app.elements.input.value;
        if (!text.trim() || app.ui.isUpdateMode() || app.input.isHoldingResult()) {
          return null;
        }

        return app.input.guard(() => app.input.clean(text, { source: "typed" }));
      },

      handleKeydown(event) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          return app.input.handleSubmit(event);
        }

        if (event.key === "Escape" && (app.elements.input.value || app.stage.isBusy())) {
          event.preventDefault();
          app.input.reset();
        }

        return null;
      },

      handleInput() {
        app.stage.cancel();
        app.input.syncHeight();
        app.input.refresh();
      },

      acceptsDrag(event) {
        if (app.ui.isUpdateMode()) {
          return false;
        }

        const types = Array.from(event.dataTransfer?.types || []);
        return types.includes("text/uri-list") || types.includes("text/plain");
      },

      setDragHighlight(isActive) {
        app.elements.heroPanel.classList.toggle("is-dragover", isActive);
      },

      handleDragEnter(event) {
        if (!app.input.acceptsDrag(event)) {
          return;
        }

        event.preventDefault();
        app.state.dragDepth += 1;
        app.input.setDragHighlight(true);
      },

      handleDragOver(event) {
        if (!app.input.acceptsDrag(event)) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },

      handleDragLeave(event) {
        if (!app.input.acceptsDrag(event)) {
          return;
        }

        app.state.dragDepth = Math.max(0, app.state.dragDepth - 1);
        if (app.state.dragDepth === 0) {
          app.input.setDragHighlight(false);
        }
      },

      handleDrop(event) {
        if (!app.input.acceptsDrag(event)) {
          return null;
        }

        event.preventDefault();
        app.state.dragDepth = 0;
        app.input.setDragHighlight(false);

        const text = app.input.readDropText(event.dataTransfer);
        if (!text.trim()) {
          return null;
        }

        return app.input.guard(() => app.input.clean(text, { source: "drop" }));
      },

      readDropText(dataTransfer) {
        const uri = (dataTransfer.getData("text/uri-list") || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line && !line.startsWith("#"));

        return uri || dataTransfer.getData("text/plain") || "";
      },

      refresh() {
        if (app.ui.isUpdateMode()) {
          return;
        }

        const hasText = app.elements.input.value.trim() !== "";
        app.ui.setPrimaryActionMode(hasText ? "clean" : "paste");
        app.stage.setState(hasText ? "editing" : "idle");
      },

      showCopy(output) {
        if (app.ui.isUpdateMode()) {
          return;
        }

        app.elements.input.value = output;
        app.input.syncHeight();
        app.ui.setPrimaryActionMode("copy");
        app.stage.setState("done");
        app.elements.input.select();
      },

      reset({ blur = false } = {}) {
        app.stage.cancel();
        app.elements.input.value = "";
        app.input.syncHeight();
        app.input.refresh();

        if (blur) {
          app.elements.input.blur();
        }
      },

      syncHeight() {
        const { input } = app.elements;

        if (!windowObject.CSS?.supports?.("field-sizing", "content")) {
          input.style.height = "auto";
          input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
        }

        if (input.offsetHeight !== app.state.inputHeight) {
          app.state.inputHeight = input.offsetHeight;
          app.layout.scheduleApply();
        }
      },

      focusOnLoad() {
        const active = documentObject.activeElement;
        if (!active || active === documentObject.body) {
          app.elements.input.focus({ preventScroll: true });
        }
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

        const { button, form, input, output, stage, heroPanel } = app.elements;

        button.addEventListener("click", async () => {
          if (app.ui.isUpdateMode()) {
            await app.pwa.activateUpdate();
            return;
          }

          if (app.state.buttonMode === "clean") {
            await app.input.handleSubmit();
            return;
          }

          if (app.state.buttonMode === "copy") {
            await app.input.guard(() => app.clipboard.copyLast());
            return;
          }

          await app.input.pasteFromClipboard();
        });

        form.addEventListener("submit", app.input.handleSubmit);
        input.addEventListener("paste", app.input.handlePaste);
        input.addEventListener("keydown", app.input.handleKeydown);
        input.addEventListener("input", app.input.handleInput);
        documentObject.addEventListener("paste", app.input.handleDocumentPaste);
        heroPanel.addEventListener("dragenter", app.input.handleDragEnter);
        heroPanel.addEventListener("dragover", app.input.handleDragOver);
        heroPanel.addEventListener("dragleave", app.input.handleDragLeave);
        heroPanel.addEventListener("drop", app.input.handleDrop);
        output.addEventListener("transitionend", app.stage.handleTransitionEnd);
        stage.addEventListener("click", (event) => {
          if (event.target !== input && !input.disabled) {
            input.focus();
          }
        });

        windowObject.addEventListener("focus", () => {
          app.pwa.checkForUpdate();
        });

        windowObject.addEventListener("online", () => {
          if (app.ui.isUpdateMode()) {
            app.pwa.setUpdateMode();
          }

          app.pwa.checkForUpdate();
        });

        windowObject.addEventListener("offline", () => {
          if (app.ui.isUpdateMode()) {
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
      app.input.handleInput();
      app.input.focusOnLoad();
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
