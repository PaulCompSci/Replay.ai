// Screen Recorder Content Script - Simplified & Modular

// Helper function to safely send messages to service worker
function safeSendMessage(message, callback) {
  try {
    // Check if extension context is still valid
    if (!chrome.runtime?.id) {
      return Promise.resolve(null);
    }

    return chrome.runtime.sendMessage(message, (response) => {
      // Check for errors
      if (chrome.runtime.lastError) {
        // Silently ignore extension context errors
        if (
          !chrome.runtime.lastError.message?.includes(
            "Extension context invalidated"
          )
        ) {
          console.warn("Runtime error:", chrome.runtime.lastError.message);
        }
        return;
      }
      if (callback) callback(response);
    });
  } catch (e) {
    // Extension was reloaded or context invalidated
    return Promise.resolve(null);
  }
}

class ScreenRecorder {
  constructor() {
    this.isRecording = false;
    this.recordingStartTime = null;
    this.mutationObserver = null;
    this.abortController = null;
    this.eventBuffer = [];
    this.flushInterval = null;

    this.init();
  }

  init() {
    // Wait for DOM to be ready
    if (document.body) {
      this.injectRecordingButton();
    } else {
      // If body doesn't exist yet, wait for it
      const observer = new MutationObserver((mutations, obs) => {
        if (document.body) {
          this.injectRecordingButton();
          obs.disconnect();
        }
      });
      observer.observe(document.documentElement, { childList: true });
    }
  }

  injectRecordingButton() {
    // Check if button already exists
    if (document.getElementById("screen-recorder-btn")) {
      return;
    }

    const button = document.createElement("div");
    button.id = "screen-recorder-btn";
    button.innerHTML = "⏺ REC";
    button.title = "Click to start recording";

    // Add inline styles as fallback to ensure visibility
    button.style.cssText = `
      position: fixed !important;
      top: 20px !important;
      right: 20px !important;
      z-index: 2147483647 !important;
      background-color: #ff4444 !important;
      color: white !important;
      padding: 12px 24px !important;
      border-radius: 25px !important;
      cursor: pointer !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
      user-select: none !important;
      transition: all 0.3s ease !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-width: 100px !important;
      border: 2px solid rgba(255, 255, 255, 0.3) !important;
      pointer-events: auto !important;
      visibility: visible !important;
      opacity: 1 !important;
    `;

    document.body.appendChild(button);
    button.addEventListener("click", () => this.toggleRecording());

    console.log("✅ Replay.ai recording button injected");
  }

  toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  startRecording() {
    this.isRecording = true;
    this.recordingStartTime = Date.now();
    this.abortController = new AbortController();

    const button = document.getElementById("screen-recorder-btn");
    if (button) {
      button.innerHTML = "⏸ STOP";
      button.title = "Click to stop recording";
      button.classList.add("recording");
      button.style.backgroundColor = "#44ff44";
    }

    // Notify service worker
    safeSendMessage({
      type: "START_RECORDING",
      url: window.location.href,
    });

    // Use single delegated event listener with AbortController for easy cleanup
    this.setupEventListeners();
    this.setupMutationObserver();

    // Initial scan for existing popups
    setTimeout(() => {
      if (this.isRecording) {
        this.scanForExistingPopups();
      }
    }, 100);

    console.log("🎬 Recording started");
  }

  stopRecording() {
    this.isRecording = false;

    const button = document.getElementById("screen-recorder-btn");
    if (button) {
      button.innerHTML = "⏺ REC";
      button.title = "Click to start recording";
      button.classList.remove("recording");
      button.style.backgroundColor = "#ff4444";
    }

    // Notify service worker
    safeSendMessage({
      type: "STOP_RECORDING",
    });

    // Cleanup using AbortController - much simpler!
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    if (this.popupScannerInterval) {
      clearInterval(this.popupScannerInterval);
      this.popupScannerInterval = null;
    }

    // Clear logged elements tracking
    this.loggedElements = new WeakSet();
    this.trackedPopups = new Map();

    console.log("⏹ Recording stopped");
  }

  setupEventListeners() {
    const { signal } = this.abortController;

    // Single delegated event listener for all interactions - more efficient!
    document.addEventListener("click", (e) => this.handleClick(e), {
      capture: true,
      signal,
    });
    document.addEventListener("input", (e) => this.handleInput(e), {
      capture: true,
      signal,
    });

    // Throttled scroll using requestAnimationFrame
    let scrollPending = false;
    document.addEventListener(
      "scroll",
      () => {
        if (!scrollPending) {
          scrollPending = true;
          requestAnimationFrame(() => {
            this.handleScroll();
            scrollPending = false;
          });
        }
      },
      { passive: true, signal }
    );

    // Detect page/tab close
    this.setupPageCloseDetection(signal);
  }

  setupPageCloseDetection(signal) {
    // Use beforeunload to detect page close (more reliable than unload)
    window.addEventListener(
      "beforeunload",
      () => {
        if (this.isRecording) {
          this.handlePageClose();
        }
      },
      { signal }
    );

    // Also use pagehide for better browser compatibility
    window.addEventListener(
      "pagehide",
      () => {
        if (this.isRecording) {
          this.handlePageClose();
        }
      },
      { signal }
    );

    // Use visibilitychange to detect tab switching/backgrounding
    document.addEventListener(
      "visibilitychange",
      () => {
        if (this.isRecording && document.hidden) {
          // Tab was switched or minimized
          this.logEvent({
            action: "tab-hidden",
            element: null,
          });
        } else if (this.isRecording && !document.hidden) {
          // Tab was switched back
          this.logEvent({
            action: "tab-visible",
            element: null,
          });
        }
      },
      { signal }
    );
  }

  handlePageClose() {
    if (!this.isRecording) return;

    // Log the page close event
    const logEntry = {
      t: Date.now() - this.recordingStartTime,
      action: "page-close",
      text: "",
      selectors: [],
      domPath: "window",
      url: window.location.href,
    };

    // Try to send to service worker (may fail if page is closing)
    safeSendMessage({
      type: "RECORDING_EVENT",
      event: logEntry,
    });

    // Also log to console if possible
    try {
      console.log(JSON.stringify(logEntry, null, 2));
    } catch (e) {
      // Ignore
    }
  }

  handleClick(e) {
    if (!this.isRecording || e.target.id === "screen-recorder-btn") return;

    this.logEvent({
      action: "click",
      element: e.target,
    });
  }

  handleInput(e) {
    if (!this.isRecording) return;

    const element = e.target;
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      this.logEvent({
        action: "input",
        element: element,
        value: element.value,
      });
    }
  }

  handleScroll() {
    if (!this.isRecording) return;

    this.logEvent({
      action: "scroll",
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    });
  }

  setupMutationObserver() {
    this.mutationObserver = new MutationObserver((mutations) => {
      if (!this.isRecording) return;

      mutations.forEach((mutation) => {
        // Filter out our own recording button changes
        if (mutation.target.id === "screen-recorder-btn") return;

        if (mutation.type === "childList") {
          // Check for popup patterns on added nodes
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              // Immediately check if it's a popup
              this.checkAndLogPopup(node);

              // Also check with a delay (for CSS animations/transitions)
              setTimeout(() => {
                if (this.isRecording) {
                  this.checkAndLogPopup(node);
                }
              }, 100);

              setTimeout(() => {
                if (this.isRecording) {
                  this.checkAndLogPopup(node);
                }
              }, 300);

              // Also check children (for shadow DOM and nested popups)
              this.checkChildrenForPopups(node);
            }
          });

          // Check for popup patterns on REMOVED nodes (popup closed)
          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              this.checkAndLogPopupClose(node);
            }
          });
        }

        // Track attribute changes that might indicate popup appearance/disappearance
        if (mutation.type === "attributes") {
          const element = mutation.target;
          if (element.nodeType === 1) {
            const attrName = mutation.attributeName;

            // Check if this element is or was a tracked popup
            const wasTracked = this.wasPopupTracked(element);
            const isPopupNow = this.isPopupElement(element);

            // Handle different attribute changes
            if (attrName === "style") {
              this.handleStyleChange(element, wasTracked, isPopupNow);
            } else if (attrName === "class") {
              this.handleClassChange(element, wasTracked, isPopupNow);
            } else if (attrName === "aria-hidden") {
              this.handleAriaHiddenChange(element, wasTracked, isPopupNow);
            } else if (attrName === "hidden") {
              this.handleHiddenAttributeChange(element, wasTracked);
            } else if (attrName === "aria-modal" || attrName === "role") {
              this.handleRoleChange(element, wasTracked, isPopupNow);
            }
          }
        }
      });
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [
        "style",
        "class",
        "aria-hidden",
        "aria-modal",
        "role",
        "hidden",
      ],
    });

    // Use IntersectionObserver to detect when elements become visible
    this.setupIntersectionObserver();

    // Periodically scan for popups that might have been missed
    this.setupPopupScanner();
  }

  setupIntersectionObserver() {
    // Track elements that become visible and might be popups
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (!this.isRecording) return;

        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.1) {
            const element = entry.target;
            // Only log if it's a significant popup (covers at least 10% of viewport)
            if (
              this.isPopupElement(element) &&
              !this.isAlreadyLogged(element)
            ) {
              this.logEvent({
                action: "popup",
                element: element,
              });
              this.markAsLogged(element);
            }
          }
        });
      },
      {
        threshold: [0.1, 0.5, 1.0],
        rootMargin: "0px",
      }
    );

    // Observe all potential popup elements
    this.observePotentialPopups();
  }

  setupPopupScanner() {
    // Scan for popups more frequently to catch ones that might be missed
    this.popupScannerInterval = setInterval(() => {
      if (!this.isRecording) return;
      this.scanForExistingPopups();
      // Also check for closed popups
      this.checkForClosedPopups();
    }, 200); // More frequent scanning (every 200ms)
  }

  scanForExistingPopups() {
    try {
      // More comprehensive selector list
      const selectors = [
        '[role="dialog"]',
        '[role="alertdialog"]',
        '[aria-modal="true"]',
        ".modal",
        ".popup",
        ".dialog",
        ".overlay",
        ".backdrop",
        "[data-modal]",
        "[data-popup]",
        "[data-dialog]",
        // Common framework patterns
        '[class*="Modal"]',
        '[class*="Dialog"]',
        '[class*="Popup"]',
        '[class*="Overlay"]',
        '[class*="Backdrop"]',
        '[id*="modal"]',
        '[id*="popup"]',
        '[id*="dialog"]',
        '[id*="Modal"]',
        '[id*="Dialog"]',
        '[id*="Popup"]',
      ];

      // Check all selectors
      selectors.forEach((selector) => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach((element) => {
            this.checkAndLogPopup(element);
          });
        } catch (e) {
          // Invalid selector, skip
        }
      });

      // Also check for high z-index elements that might be popups
      this.scanForHighZIndexPopups();
    } catch (e) {
      // Ignore errors
    }
  }

  checkAndLogPopup(element) {
    if (!element || element.nodeType !== 1) return;

    // Skip our own button
    if (element.id === "screen-recorder-btn") return;

    // Check if it's a popup and visible
    if (
      this.isPopupElement(element) &&
      this.isElementVisible(element) &&
      !this.isAlreadyLogged(element)
    ) {
      this.logEvent({
        action: "popup-open",
        element: element,
      });
      this.markAsLogged(element);

      // Track this popup for close detection
      this.trackPopupForClose(element);

      // Observe for future changes
      if (this.intersectionObserver) {
        this.intersectionObserver.observe(element);
      }

      // Also check children
      this.checkChildrenForPopups(element);
    }
  }

  checkAndLogPopupClose(element) {
    if (!element || element.nodeType !== 1) return;

    // Skip our own button
    if (element.id === "screen-recorder-btn") return;

    // Check if this was a tracked popup
    if (this.wasPopupTracked(element)) {
      const popupData = this.trackedPopups.get(element);

      // Log with stored data
      const logEntry = {
        t: Date.now() - this.recordingStartTime,
        action: "popup-close",
        text: popupData.text,
        selectors: popupData.selectors,
        domPath: popupData.domPath,
        url: window.location.href,
      };

      console.log(JSON.stringify(logEntry, null, 2));

      safeSendMessage({
        type: "RECORDING_EVENT",
        event: logEntry,
      });

      this.untrackPopup(element);
    }

    // Also check children for closed popups
    try {
      if (element.querySelectorAll) {
        const childPopups = element.querySelectorAll(
          '[role="dialog"], [role="alertdialog"], .modal, .popup, .dialog, [data-modal]'
        );
        childPopups.forEach((child) => {
          if (this.wasPopupTracked(child)) {
            const childData = this.trackedPopups.get(child);
            const logEntry = {
              t: Date.now() - this.recordingStartTime,
              action: "popup-close",
              text: childData.text,
              selectors: childData.selectors,
              domPath: childData.domPath,
              url: window.location.href,
            };

            console.log(JSON.stringify(logEntry, null, 2));

            safeSendMessage({
              type: "RECORDING_EVENT",
              event: logEntry,
            });

            this.untrackPopup(child);
          }
        });
      }
    } catch (e) {
      // Ignore errors
    }
  }

  // Track open popups for close detection (using Map instead of WeakSet for better control)
  trackedPopups = new Map(); // Map<element, {text, selectors, domPath, timestamp}>

  trackPopupForClose(element) {
    if (!element) return;
    // Store popup data for logging when it closes
    this.trackedPopups.set(element, {
      text: this.getElementText(element),
      selectors: this.generateSelectors(element),
      domPath: this.getDOMPath(element),
      timestamp: Date.now(),
    });
  }

  wasPopupTracked(element) {
    return this.trackedPopups.has(element);
  }

  untrackPopup(element) {
    this.trackedPopups.delete(element);
  }

  // Attribute change handlers
  handleStyleChange(element, wasTracked, isPopup) {
    setTimeout(() => {
      if (!this.isRecording) return;

      const isVisible = this.isElementVisible(element);

      if (wasTracked && !isVisible) {
        // Was visible, now hidden
        console.log("🔴 Style change hid popup");
        this.checkAndLogPopupClose(element);
      } else if (!wasTracked && isPopup && isVisible) {
        // Was hidden, now visible
        console.log("🟢 Style change showed popup");
        this.checkAndLogPopup(element);
      }
    }, 50);
  }

  handleClassChange(element, wasTracked, isPopup) {
    setTimeout(() => {
      if (!this.isRecording) return;

      const isVisible = this.isElementVisible(element);

      // Check for common "hidden" or "closed" class patterns
      const classes = element.className.toLowerCase();
      const hasHiddenClass = /hidden|closed|hide|invisible|fade-out/.test(
        classes
      );

      if (wasTracked && (hasHiddenClass || !isVisible)) {
        console.log("🔴 Class change hid popup:", classes);
        this.checkAndLogPopupClose(element);
      } else if (!wasTracked && isPopup && isVisible) {
        console.log("🟢 Class change showed popup:", classes);
        this.checkAndLogPopup(element);
      }
    }, 50);
  }

  handleAriaHiddenChange(element, wasTracked, isPopup) {
    const ariaHidden = element.getAttribute("aria-hidden");

    if (wasTracked && ariaHidden === "true") {
      console.log("🔴 aria-hidden=true - popup closed");
      setTimeout(() => this.checkAndLogPopupClose(element), 50);
    } else if (!wasTracked && isPopup && ariaHidden !== "true") {
      console.log("🟢 aria-hidden=false - popup opened");
      setTimeout(() => this.checkAndLogPopup(element), 50);
    }
  }

  handleHiddenAttributeChange(element, wasTracked) {
    const hasHidden = element.hasAttribute("hidden");

    if (wasTracked && hasHidden) {
      console.log("🔴 hidden attribute added - popup closed");
      setTimeout(() => this.checkAndLogPopupClose(element), 50);
    }
  }

  handleRoleChange(element, wasTracked, isPopup) {
    setTimeout(() => {
      if (!this.isRecording) return;

      const isVisible = this.isElementVisible(element);

      if (!wasTracked && isPopup && isVisible) {
        console.log("🟢 Role changed to dialog - popup opened");
        this.checkAndLogPopup(element);
      }
    }, 50);
  }

  checkForClosedPopups() {
    // Check all tracked popups to see if they're still visible
    const closedPopups = [];

    this.trackedPopups.forEach((popupData, element) => {
      // Check if element is still in DOM and visible
      const stillInDOM = document.contains(element);
      const stillVisible = stillInDOM && this.isElementVisible(element);

      if (!stillVisible) {
        // Popup was closed (removed or hidden)
        closedPopups.push({ element, popupData });
      }
    });

    // Log all closed popups
    closedPopups.forEach(({ element, popupData }) => {
      // Log with the stored data since element might be removed from DOM
      const logEntry = {
        t: Date.now() - this.recordingStartTime,
        action: "popup-close",
        text: popupData.text,
        selectors: popupData.selectors,
        domPath: popupData.domPath,
        url: window.location.href,
      };

      // Log to console
      console.log("🔴 Periodic check found closed popup");
      console.log(JSON.stringify(logEntry, null, 2));

      // Send to service worker
      safeSendMessage({
        type: "RECORDING_EVENT",
        event: logEntry,
      });

      // Remove from tracked popups
      this.untrackPopup(element);
    });
  }

  checkChildrenForPopups(parentElement) {
    if (!parentElement || !parentElement.querySelectorAll) return;

    try {
      const childSelectors = [
        '[role="dialog"]',
        '[role="alertdialog"]',
        '[aria-modal="true"]',
        ".modal",
        ".popup",
        ".dialog",
        "[data-modal]",
        "[data-popup]",
        "[data-dialog]",
      ];

      childSelectors.forEach((selector) => {
        try {
          const children = parentElement.querySelectorAll(selector);
          children.forEach((child) => {
            this.checkAndLogPopup(child);
          });
        } catch (e) {
          // Skip invalid selectors
        }
      });
    } catch (e) {
      // Ignore errors (e.g., shadow DOM)
    }
  }

  scanForHighZIndexPopups() {
    // Find all elements with high z-index that might be popups
    try {
      const allElements = document.querySelectorAll("*");
      const highZIndexElements = [];

      allElements.forEach((element) => {
        if (element.id === "screen-recorder-btn") return;

        const style = window.getComputedStyle(element);
        const zIndex = parseInt(style.zIndex, 10);
        const position = style.position;

        // Check for high z-index with fixed/absolute positioning
        if (
          !isNaN(zIndex) &&
          zIndex >= 100 &&
          (position === "fixed" || position === "absolute")
        ) {
          const rect = element.getBoundingClientRect();
          // Must be visible and reasonably sized
          if (
            rect.width > 30 &&
            rect.height > 30 &&
            this.isElementVisible(element)
          ) {
            highZIndexElements.push({ element, zIndex, rect });
          }
        }
      });

      // Sort by z-index and check top ones
      highZIndexElements
        .sort((a, b) => b.zIndex - a.zIndex)
        .slice(0, 10) // Check top 10 highest z-index elements
        .forEach(({ element }) => {
          // If it covers significant area or matches popup patterns, log it
          if (
            this.isElementCoveringViewport(element) ||
            this.hasPopupIndicators(element)
          ) {
            this.checkAndLogPopup(element);
          }
        });
    } catch (e) {
      // Ignore errors
    }
  }

  hasPopupIndicators(element) {
    // Quick check for common popup indicators
    const tagName = element.tagName.toLowerCase();
    const className = (element.className || "").toLowerCase();
    const id = (element.id || "").toLowerCase();

    // Check for common popup-related terms
    const popupTerms = [
      "modal",
      "popup",
      "dialog",
      "overlay",
      "backdrop",
      "drawer",
      "sheet",
      "panel",
      "dropdown",
      "menu",
      "tooltip",
      "notification",
      "alert",
      "toast",
      "lightbox",
      "drawer",
    ];

    return (
      popupTerms.some((term) => className.includes(term)) ||
      popupTerms.some((term) => id.includes(term)) ||
      element.hasAttribute("data-modal") ||
      element.hasAttribute("data-popup") ||
      element.hasAttribute("data-dialog") ||
      element.getAttribute("role") === "dialog" ||
      element.getAttribute("aria-modal") === "true"
    );
  }

  observePotentialPopups() {
    // Observe elements that match popup selectors
    const selectors = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[aria-modal="true"]',
      ".modal",
      ".popup",
      ".dialog",
      ".overlay",
      ".backdrop",
      "[data-modal]",
    ];

    selectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          this.intersectionObserver.observe(el);
        });
      } catch (e) {
        // Ignore invalid selectors
      }
    });
  }

  isPopupElement(element) {
    if (!element || element.nodeType !== 1) return false;

    // Skip our own button
    if (element.id === "screen-recorder-btn") return false;

    // 1. Check ARIA roles and attributes
    const role = element.getAttribute("role");
    if (role === "dialog" || role === "alertdialog") return true;
    if (element.getAttribute("aria-modal") === "true") return true;

    // 2. Check class names (case-insensitive)
    const className = element.className;
    if (typeof className === "string") {
      const classLower = className.toLowerCase();
      const popupClasses = [
        "modal",
        "popup",
        "dialog",
        "overlay",
        "backdrop",
        "drawer",
        "sheet",
        "panel",
        "dropdown",
        "menu",
        "tooltip",
        "notification",
        "alert",
        "toast",
      ];
      if (popupClasses.some((popupClass) => classLower.includes(popupClass)))
        return true;
    }

    // 3. Check ID (case-insensitive)
    const id = element.id;
    if (id) {
      const idLower = id.toLowerCase();
      if (
        /modal|popup|dialog|overlay|backdrop|drawer|sheet|panel|dropdown|menu|tooltip|notification|alert|toast/.test(
          idLower
        )
      )
        return true;
    }

    // 4. Check data attributes
    if (
      element.hasAttribute("data-modal") ||
      element.hasAttribute("data-popup") ||
      element.hasAttribute("data-dialog")
    )
      return true;

    // 5. Check if element covers significant portion of viewport (likely a popup)
    if (this.isElementCoveringViewport(element)) return true;

    // 6. Check for high z-index with fixed/absolute positioning
    if (this.isHighZIndexOverlay(element)) return true;

    // 7. Check for backdrop/overlay pattern (element with specific styling)
    if (this.hasBackdropPattern(element)) return true;

    return false;
  }

  isElementVisible(element) {
    if (!element) return false;

    try {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      // More lenient visibility check
      const isDisplayed = style.display !== "none";
      const isVisible = style.visibility !== "hidden";
      const hasOpacity = parseFloat(style.opacity) > 0;
      const hasSize = rect.width > 0 && rect.height > 0;
      const inViewport =
        rect.top < window.innerHeight + 100 && // Allow some margin
        rect.bottom > -100 &&
        rect.left < window.innerWidth + 100 &&
        rect.right > -100;

      return isDisplayed && isVisible && hasOpacity && hasSize && inViewport;
    } catch (e) {
      // If we can't check, assume it might be visible
      return true;
    }
  }

  isElementCoveringViewport(element) {
    if (!this.isElementVisible(element)) return false;

    try {
      const rect = element.getBoundingClientRect();
      const viewportArea = window.innerWidth * window.innerHeight;
      const elementArea = rect.width * rect.height;
      const coverage = elementArea / viewportArea;

      // Lower threshold - if element covers more than 20% of viewport, likely a popup
      if (coverage > 0.2) {
        const style = window.getComputedStyle(element);
        const position = style.position;
        // Must be fixed or absolute to be considered a popup overlay
        return position === "fixed" || position === "absolute";
      }
    } catch (e) {
      // Ignore errors
    }

    return false;
  }

  isHighZIndexOverlay(element) {
    try {
      const style = window.getComputedStyle(element);
      const zIndex = parseInt(style.zIndex, 10);
      const position = style.position;

      // Lower threshold - z-index >= 100 with fixed/absolute positioning suggests popup
      if (
        !isNaN(zIndex) &&
        zIndex >= 100 &&
        (position === "fixed" || position === "absolute")
      ) {
        const rect = element.getBoundingClientRect();
        // Must be visible and reasonably sized
        return (
          rect.width > 30 && rect.height > 30 && this.isElementVisible(element)
        );
      }
    } catch (e) {
      // Ignore errors
    }

    return false;
  }

  hasBackdropPattern(element) {
    const style = window.getComputedStyle(element);
    const bgColor = style.backgroundColor;
    const opacity = parseFloat(style.opacity);

    // Check for semi-transparent backdrop (common in modals)
    if (
      bgColor !== "transparent" &&
      bgColor !== "rgba(0, 0, 0, 0)" &&
      opacity > 0.3
    ) {
      const rect = element.getBoundingClientRect();
      const viewportArea = window.innerWidth * window.innerHeight;
      const elementArea = rect.width * rect.height;

      // Large semi-transparent element is likely a backdrop
      return elementArea > viewportArea * 0.5;
    }

    return false;
  }

  // Track logged elements to avoid duplicates
  loggedElements = new WeakSet();

  isAlreadyLogged(element) {
    return this.loggedElements.has(element);
  }

  markAsLogged(element) {
    this.loggedElements.add(element);
    // Clean up after 5 seconds to allow re-logging if element is removed and re-added
    setTimeout(() => {
      // WeakSet will automatically clean up if element is removed from DOM
    }, 5000);
  }

  // Simplified selector generation using modern browser APIs
  generateSelectors(element) {
    if (!element || element.nodeType !== 1) return [];

    const selectors = [];
    const text = this.getElementText(element);
    const tagName = element.tagName.toLowerCase();

    // 1. ID selector (highest priority)
    if (element.id) {
      selectors.push(`#${CSS.escape(element.id)}`);
    }

    // 2. Text-based selector (Playwright-style)
    if (text && text.length > 0 && text.length < 50) {
      selectors.push(`${tagName}:has-text('${text.replace(/'/g, "\\'")}')`);
    }

    // 3. Class-based selector
    if (element.className && typeof element.className === "string") {
      const classes = element.className
        .trim()
        .split(/\s+/)
        .filter((c) => c && !/^(hover|active|focus)/.test(c));
      if (classes.length > 0 && classes.length <= 3) {
        const classSelector = classes.map((c) => `.${CSS.escape(c)}`).join("");
        selectors.push(`${tagName}${classSelector}`);
      }
    }

    // 4. Attribute selectors (data attributes, name, etc)
    for (const attr of ["data-testid", "data-test", "name", "aria-label"]) {
      const value = element.getAttribute(attr);
      if (value) {
        selectors.push(`${tagName}[${attr}="${CSS.escape(value)}"]`);
        break; // Only use first matching attribute
      }
    }

    // 5. CSS path (fallback)
    const cssPath = this.getCSSPath(element);
    if (cssPath) {
      selectors.push(cssPath);
    }

    return selectors;
  }

  getCSSPath(element, maxDepth = 5) {
    if (!element || element.nodeType !== 1) return null;

    const path = [];
    let current = element;
    let depth = 0;

    while (current && current !== document.body && depth < maxDepth) {
      let selector = current.tagName.toLowerCase();

      // Stop early if we find an ID
      if (current.id) {
        selector += `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      }

      // Add first stable class if exists
      if (current.className && typeof current.className === "string") {
        const classes = current.className
          .trim()
          .split(/\s+/)
          .filter((c) => c && !/^(hover|active|focus)/.test(c));
        if (classes.length > 0) {
          selector += `.${CSS.escape(classes[0])}`;
        }
      }

      // Add nth-child only if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (el) => el.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }
      }

      path.unshift(selector);
      current = parent;
      depth++;
    }

    return path.join(" > ") || element.tagName.toLowerCase();
  }

  getDOMPath(element) {
    // Reuse getCSSPath for consistency
    return this.getCSSPath(element, 10); // Longer path for full DOM representation
  }

  getElementText(element) {
    if (!element) return "";

    // For input elements, return placeholder or label
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      return (
        element.placeholder ||
        element.getAttribute("aria-label") ||
        element.name ||
        element.type ||
        ""
      );
    }

    // Use innerText (rendered text) instead of textContent for better accuracy
    const text = element.innerText || element.textContent || "";

    // Limit to first line or 100 chars
    return text.trim().split("\n")[0].substring(0, 100);
  }

  logEvent(eventData) {
    if (!this.isRecording || !this.recordingStartTime) return;

    const timestamp = Date.now() - this.recordingStartTime;
    const element = eventData.element;

    const logEntry = {
      t: timestamp,
      action: eventData.action,
      url: window.location.href,
    };

    // Add element-specific data
    if (element) {
      logEntry.text = this.getElementText(element);
      logEntry.selectors = this.generateSelectors(element);
      logEntry.domPath = this.getDOMPath(element);
    } else {
      logEntry.text = "";
      logEntry.selectors = [];
      logEntry.domPath = [
        "scroll",
        "tab-hidden",
        "tab-visible",
        "page-close",
      ].includes(eventData.action)
        ? "window"
        : "";
    }

    // Add action-specific fields
    if (eventData.action === "input" && eventData.value !== undefined) {
      logEntry.value = eventData.value.substring(0, 100);
    }

    if (eventData.action === "scroll") {
      logEntry.scrollX = eventData.scrollX;
      logEntry.scrollY = eventData.scrollY;
    }

    // Output to console (page console)
    console.log(JSON.stringify(logEntry, null, 2));

    // Send to service worker for collection
    safeSendMessage({
      type: "RECORDING_EVENT",
      event: logEntry,
    });
  }
}

// Initialize recorder
const recorder = new ScreenRecorder();

// Debug helper: Test popup detection on current page
window.replayDebug = {
  scanPopups: () => {
    console.log("🔍 Scanning for popups...");
    const allElements = document.querySelectorAll("*");
    let found = 0;
    allElements.forEach((el) => {
      if (recorder.isPopupElement(el) && recorder.isElementVisible(el)) {
        console.log("✅ Found popup:", el, {
          tag: el.tagName,
          id: el.id,
          classes: el.className,
          role: el.getAttribute("role"),
          zIndex: window.getComputedStyle(el).zIndex,
          position: window.getComputedStyle(el).position,
          rect: el.getBoundingClientRect(),
        });
        found++;
      }
    });
    console.log(`Found ${found} potential popups`);
  },
  testVisibility: (selector) => {
    const el = document.querySelector(selector);
    if (!el) {
      console.log("❌ Element not found");
      return;
    }
    console.log("Visibility check:", {
      isVisible: recorder.isElementVisible(el),
      isPopup: recorder.isPopupElement(el),
      display: window.getComputedStyle(el).display,
      visibility: window.getComputedStyle(el).visibility,
      opacity: window.getComputedStyle(el).opacity,
      rect: el.getBoundingClientRect(),
    });
  },
  showTrackedPopups: () => {
    console.log(`📋 Currently tracked popups: ${recorder.trackedPopups.size}`);
    recorder.trackedPopups.forEach((data, element) => {
      const stillVisible =
        document.contains(element) && recorder.isElementVisible(element);
      console.log("Popup:", {
        element,
        stillVisible,
        inDOM: document.contains(element),
        data,
      });
    });
  },
};

console.log(
  "💡 Debug helpers: window.replayDebug.scanPopups() | testVisibility(selector) | showTrackedPopups()"
);
