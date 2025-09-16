// content.js
// YouTube Chat Highlighter – content script
// - Adds a ⭐ button to each chat item to send it to your overlay via WebSocket
// - Namespace (`ns`) is configurable via extension Options (chrome.storage.sync)
// - Robust against iframe chat, dynamic DOM, and reconnects

(() => { 
  console.log("🚀 YouTube Chat Highlighter loaded on", location.href);

  // ------------------------------
  // Config
  // ------------------------------
  const DEFAULT_NS = "vpl-yt"; // fallback if user hasn't set one yet
  const WS_ORIGIN = "wss://veganpowerlab.com"; // change to wss:// if you have TLS
  const INJECT_INTERVAL_MS = 500;
  const RECONNECT_MIN_MS = 1000;
  const RECONNECT_MAX_MS = 10000;

  const SUPPORTED_RENDERERS = [
    "YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER",
    "YT-LIVE-CHAT-PAID-MESSAGE-RENDERER",
    "YT-LIVE-CHAT-MEMBERSHIP-ITEM-RENDERER",
    "YT-LIVE-CHAT-PAID-STICKER-RENDERER",
  ];

  // ------------------------------
  // State
  // ------------------------------
  let socket = null;
  let ns = DEFAULT_NS;
  let currentActiveButton = null;
  let currentActiveId = null;
  let clearAllButton = null;
  let chatObserver = null;
  let reconnectTimer = null;

  // ------------------------------
  // Storage helpers
  // ------------------------------
  async function loadNamespace() {
    try {
      const res = await chrome.storage.sync.get({ ns: DEFAULT_NS });
      const value = (res.ns ?? DEFAULT_NS).toString().trim();
      return value || DEFAULT_NS;
    } catch {
      return DEFAULT_NS;
    }
  }

  function watchNamespaceChanges() {
    if (!chrome.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.ns) {
        const newNs = (changes.ns.newValue || DEFAULT_NS).toString().trim() || DEFAULT_NS;
        if (newNs !== ns) {
          ns = newNs;
          console.log("[YouTube Chat Highlighter] ns changed →", ns);
          reconnectSocket(true);
        }
      }
    });
  }

  // ------------------------------
  // WebSocket logic
  // ------------------------------
  function wsUrl() {
    return `${WS_ORIGIN}/${encodeURIComponent(ns)}/extension`;
  }

  function connectSocket() {
    cleanupSocket();
    try {
      socket = new WebSocket(wsUrl());
    } catch (e) {
      console.warn("WS create failed:", e);
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      console.log("🔌 WS connected:", wsUrl());
      clearTimeout(reconnectTimer);
    };

    socket.onclose = () => {
      console.warn("🔌 WS closed");
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      console.warn("🔌 WS error:", err);
      try { socket.close(); } catch {}
    };

    socket.onmessage = async (event) => {
      try {
        const dataText = event.data instanceof Blob ? await event.data.text() : event.data;
        const data = JSON.parse(dataText);
        currentActiveId = data.id || null;

        // Reflect highlight state visually across existing items
        const items = getItems();
        items.forEach((item) => updateButtonStateBasedOnId(currentActiveId, item, Boolean(currentActiveId)));
      } catch (err) {
        console.error("Invalid message from overlay:", err);
      }
    };
  }

  function cleanupSocket() {
    if (socket) {
      try { socket.onopen = socket.onclose = socket.onmessage = socket.onerror = null; } catch {}
      try { socket.close(); } catch {}
    }
    socket = null;
  }

  function reconnectSocket(immediate = false) {
    if (immediate) {
      clearTimeout(reconnectTimer);
      connectSocket();
      return;
    }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    const delay = Math.floor(Math.random() * (RECONNECT_MAX_MS - RECONNECT_MIN_MS + 1)) + RECONNECT_MIN_MS;
    reconnectTimer = setTimeout(connectSocket, delay);
  }

  function wsSend(obj) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(obj));
    } catch (e) {
      console.warn("WS send failed:", e);
    }
  }

  // ------------------------------
  // DOM helpers
  // ------------------------------
  function getChatDocument() {
    // Live chat is usually inside iframe#chatframe on watch pages; on popout it's top-level.
    const iframe = document.querySelector("iframe#chatframe");
    if (iframe?.contentDocument) return iframe.contentDocument;
    if (iframe?.contentWindow?.document) return iframe.contentWindow.document;
    return document;
  }

  function getItems() {
    const chatDoc = getChatDocument();
    if (!chatDoc) return [];
    return chatDoc.querySelectorAll(SUPPORTED_RENDERERS.map((t) => t.toLowerCase()).join(","));
  }

  function getScroller() {
    const chatDoc = getChatDocument();
    return chatDoc?.querySelector("yt-live-chat-item-list-renderer") || null;
  }

  function waitForChatContainer(cb) {
    const poll = () => {
      const chatDoc = getChatDocument();
      const container =
        chatDoc?.querySelector("yt-live-chat-item-list-renderer") ||
        chatDoc?.querySelector("#chat-container");
      if (container) cb(container);
      else requestAnimationFrame(poll);
    };
    poll();
  }

  // ------------------------------
  // UI: buttons + styles
  // ------------------------------
  function injectButton(chatItem) {
    if (!chatItem || chatItem.querySelector(".highlight-btn")) return;
    if (chatItem.getBoundingClientRect().top <= 0) return; // Skip offscreen items

    const button = document.createElement("button");
    button.textContent = "★";
    button.className = "highlight-btn";
    button.isActive = false;

    Object.assign(button.style, {
      fontSize: "16px",
      background: "none",
      color: getThemeColor(chatItem),
      border: "none",
      cursor: "pointer",
      padding: "2px 6px",
      marginRight: "6px",
      zIndex: "10",
    });

    const id = chatItem.id;
    if (id === currentActiveId) {
      setCurrentActiveButton(button);
      updateButtonState(button, true, chatItem);
    }

    button.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const scroller = getScroller();

      // if another is active, deactivate it
      if (currentActiveButton && currentActiveButton !== button) {
        currentActiveButton.isActive = false;
        updateButtonState(currentActiveButton, false, currentActiveButton.chatItem);
        if (scroller) scroller.disableAutoScroll = false;
      }

      button.isActive = !button.isActive;
      updateButtonState(button, button.isActive, chatItem);
      button.chatItem = chatItem;

      const tag = chatItem.tagName;
      const isDonation =
        tag === "YT-LIVE-CHAT-PAID-MESSAGE-RENDERER" || tag === "YT-LIVE-CHAT-PAID-STICKER-RENDERER";
      const isSticker = tag === "YT-LIVE-CHAT-PAID-STICKER-RENDERER";
      const amount = chatItem.querySelector("#purchase-amount")?.textContent?.trim() || null;

      const backgroundColor = getVariableColor(chatItem, "--yt-live-chat-paid-message-background-color");
      const textColor = getVariableColor(chatItem, "--yt-live-chat-paid-message-header-color");

      if (button.isActive) {
        setCurrentActiveButton(button);
        currentActiveId = id;

        const author = chatItem.querySelector("#author-name")?.textContent?.trim();
        const messageEl = chatItem.querySelector("#message");
        const message = messageEl?.innerText || "";

        let messageHTML = messageEl?.innerHTML || "";
        messageHTML = messageHTML
          .replace(/<tp-yt-paper-tooltip[\s\S]*?<\/tp-yt-paper-tooltip>/gi, "")
          .replace(/(<img[^>]+>)\s*:([\w-]+):/g, "$1")
          .replace(/:([\w-]+):/g, "")
          .trim();

        const img = chatItem.querySelector("#author-photo img");
        let avatar = img?.src || "";
        if (avatar.includes("s32-")) avatar = avatar.replace("s32-", "s128-");

        wsSend({
          id,
          author,
          message,
          messageHTML,
          avatar,
          isDonation,
          isSticker,
          amount,
          backgroundColor: Array.isArray(backgroundColor) ? rgbToHex(backgroundColor) : "",
          textColor: Array.isArray(textColor) ? rgbToHex(textColor) : "",
        });

        if (scroller) scroller.disableAutoScroll = true;
      } else {
        setCurrentActiveButton(null);
        currentActiveId = null;
        wsSend({}); // clear
        if (scroller) scroller.disableAutoScroll = false;
      }
    };

    const container = chatItem.querySelector("#prepend-chat-badges");
    if (container) container.prepend(button);
  }

  function updateButtonState(button, active, chatItem) {
    if (!button || !chatItem) return;
    if (active) {
      button.style.color = "#f1c40f";
      chatItem.style.paddingLeft = "24px";
      chatItem.style.backgroundColor = "rgba(255, 234, 100, 0.15)";
      chatItem.style.borderLeft = "4px solid #f1c40f";
    } else {
      button.style.color = getThemeColor(chatItem);
      chatItem.style.paddingLeft = "";
      chatItem.style.backgroundColor = "";
      chatItem.style.borderLeft = "";
    }
  }

  function setCurrentActiveButton(button) {
    currentActiveButton = button || null;
    if (button) button.isActive = true;
    if (clearAllButton) clearAllButton.style.display = button ? "block" : "none";
  }

  function updateButtonStateBasedOnId(id, chatItem, isActive = true) {
    const button = chatItem.querySelector(".highlight-btn");
    if (!button) return;
    button.isActive = id && chatItem.id === id ? isActive : false;
    updateButtonState(button, button.isActive, chatItem);
  }

  function injectAllExisting() {
    const items = getItems();
    items.forEach((item) => {
      if (item.getBoundingClientRect().top > 0) injectButton(item);
    });
  }

  function injectClearButton(dock) {
    const clearId = "clear-highlighted-button";
    if (dock.querySelector(`#${clearId}`) || clearAllButton) return;

    const button = document.createElement("button");
    button.textContent = "Clear highlighted";
    button.className = "clear-highlight-btn";
    button.id = clearId;
    clearAllButton = button;

    Object.assign(button.style, {
      fontSize: "14px",
      cursor: "pointer",
      padding: "10px 15px",
      width: "100%",
      borderRadius: "10px",
      display: currentActiveButton && currentActiveId ? "block" : "none",
    });

    button.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      setCurrentActiveButton(null);
      currentActiveId = null;
      wsSend({}); // clear

      const scroller = getScroller();
      if (scroller) scroller.disableAutoScroll = false;

      const items = getItems();
      items.forEach((item) => updateButtonStateBasedOnId(currentActiveId, item, false));
    };

    dock.prepend(button);
  }

  // ------------------------------
  // Color helpers
  // ------------------------------
  function rgbToHex(rgba) {
    const [r, g, b] = rgba;
    const toHex = (n) => (Number(n) & 0xff).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function getVariableColor(el, variable) {
    const style = el && getComputedStyle(el);
    const color = style?.getPropertyValue(variable)?.trim() || "";
    const nums = color.match(/\d+/g)?.map(Number);
    return nums?.length >= 3 ? nums : null;
  }

  function getThemeColor(chatItem) {
    const rgb = getVariableColor(chatItem, "--yt-live-chat-paid-message-background-color");
    if (rgb && rgb.length >= 3) {
      const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
      return brightness < 128 ? "white" : "black";
    }
    return "white";
  }

  // ------------------------------
  // Boot
  // ------------------------------
  (async function bootstrap() {
    ns = await loadNamespace();
    watchNamespaceChanges();
    connectSocket();

    waitForChatContainer((chatContainer) => {
      // Initial pass
      injectAllExisting();

      // Observe dynamic additions inside the chat container (and its subtree)
      if (chatObserver) {
        try { chatObserver.disconnect(); } catch {}
      }
      chatObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node?.nodeType === 1 && SUPPORTED_RENDERERS.includes(node.tagName)) {
              injectButton(node);
            }
          }
        }
      });
      chatObserver.observe(chatContainer, { childList: true, subtree: true });

      // Periodic sweep: catch missed items + ensure clear button in dock
      setInterval(() => {
        const items = getItems();
        items.forEach((item) => {
          if (!item.querySelector(".highlight-btn") && item.getBoundingClientRect().top > 0) {
            injectButton(item);
          }
        });

        const chatDoc = getChatDocument();
        const dock = chatDoc?.querySelector("yt-live-chat-docked-message #container #docked-item");
        if (dock) injectClearButton(dock);
      }, INJECT_INTERVAL_MS);
    });
  })();
})();