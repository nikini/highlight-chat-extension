console.log("🚀 YouTube Chat Highlighter loaded on", location.href);
let currentActiveButton = null;
let currentActiveId = null
let clearAllButton = null;

const SUPPORTED_RENDERERS = [
  'YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER',
  'YT-LIVE-CHAT-PAID-MESSAGE-RENDERER',
  'YT-LIVE-CHAT-MEMBERSHIP-ITEM-RENDERER',
  'YT-LIVE-CHAT-PAID-STICKER-RENDERER'
];

let socket;

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
    zIndex: "10"
  });

  // Get the id
  const id = chatItem.id;
  if (id === currentActiveId) {
    setCurrentActiveButton(button);
    updateButtonState(button, button.isActive, chatItem);
  }

  button.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const scroller = document.querySelector("yt-live-chat-item-list-renderer");

    if (currentActiveButton && currentActiveButton !== button) {
      currentActiveButton.isActive = false;
      updateButtonState(currentActiveButton, false, currentActiveButton.chatItem);
      if (scroller) scroller.disableAutoScroll = false;
    }

    button.isActive = !button.isActive;
    updateButtonState(button, button.isActive, chatItem);
    button.chatItem = chatItem;

    const tag = chatItem.tagName;
    const isDonation = tag === 'YT-LIVE-CHAT-PAID-MESSAGE-RENDERER' || tag === 'YT-LIVE-CHAT-PAID-STICKER-RENDERER';
    const isSticker = tag === 'YT-LIVE-CHAT-PAID-STICKER-RENDERER';
    const amount = chatItem.querySelector("#purchase-amount")?.textContent?.trim() || null;

    // Get the colors
    const backgroundColor = getVariableColor(chatItem, '--yt-live-chat-paid-message-background-color');
    const textColor = getVariableColor(chatItem, '--yt-live-chat-paid-message-header-color'); 

    if (button.isActive) {
      setCurrentActiveButton(button);
      currentActiveId = id;

      const author = chatItem.querySelector("#author-name")?.textContent?.trim();
      const messageEl = chatItem.querySelector("#message");
      const message = messageEl?.innerText || "";

      let messageHTML = messageEl?.innerHTML || "";
      messageHTML = messageHTML
        .replace(/<tp-yt-paper-tooltip[\s\S]*?<\/tp-yt-paper-tooltip>/gi, '')
        .replace(/(<img[^>]+>)\s*:([\w-]+):/g, '$1')
        .replace(/:([\w-]+):/g, '')
        .trim();

      const img = chatItem.querySelector("#author-photo img");
      let avatar = img?.src || "";
      if (avatar.includes("s32-")) {
        avatar = avatar.replace("s32-", "s128-");
      }

      socket.send(JSON.stringify({
        id,
        author,
        message,
        messageHTML,
        avatar,
        isDonation,
        isSticker,
        amount,
        backgroundColor: Array.isArray(backgroundColor) ? rgbToHex(backgroundColor) : '',
        textColor: Array.isArray(textColor) ? rgbToHex(textColor) : ''
      }));

      if (scroller) scroller.disableAutoScroll = true;
    } else {
      setCurrentActiveButton(null);
      currentActiveId = null;
      socket.send('{}');

      if (scroller) scroller.disableAutoScroll = false;
    }
  };

  const container = chatItem.querySelector("#prepend-chat-badges");
  if (container) {
    container.prepend(button);
  }
}

function updateButtonState(button, active, chatItem) {
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
  currentActiveButton = button;
  clearAllButton.style.display = button ? 'block' : 'none';
  if (button) {
    button.isActive = true;
  }
}

function rgbToHex(rgba) {
  const [r, g, b, a = 1] = rgba;
  const toHex = n => n.toString(16).padStart(2, '0');

  // RGB
  let hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return hex;
}

function getVariableColor(chatItem, variable) {
  const color = getComputedStyle(chatItem)
    .getPropertyValue(variable)
    .trim();
  const rgba = color?.match(/\d+/g)?.map(Number);
  return rgba;
}

function getThemeColor(chatItem) {
  const rgb = getVariableColor(chatItem, '--yt-live-chat-paid-message-background-color');
  if (rgb && rgb.length >= 3) {
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    return brightness < 128 ? "white" : "black";
  }
  return "white";
}

function injectAllExisting() {
  const allItems = document.querySelectorAll(
    SUPPORTED_RENDERERS.map(tag => tag.toLowerCase()).join(',')
  );
  allItems.forEach(item => {
    if (item.getBoundingClientRect().top > 0) {
      injectButton(item);
    }
  });
}

function waitForChatContainer(callback) {
  const check = () => {
    const chatContainer = document.querySelector("yt-live-chat-item-list-renderer") || document.querySelector('#chat-container');
    if (chatContainer) {
      callback(chatContainer);
    } else {
      requestAnimationFrame(check);
    }
  };
  check();
}

function updateButtonStateBasedOnId(id, chatItem, isActive = true) {
  const button = chatItem.querySelector(".highlight-btn");
  if (!button) {
    return;
  }
  if (id === currentActiveId) {
    button.isActive = isActive;
  } else {
    button.isActive = false;
  }
  updateButtonState(button, button.isActive, chatItem);
}

function getChatDocument() {
  let chatDoc = document;

  if (document.querySelector('#chatframe')) {
    const iframe = document.querySelector('iframe#chatframe');
    chatDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
  }

  return chatDoc;
}
function getItems() {
  return getChatDocument().querySelectorAll(
    SUPPORTED_RENDERERS.map(tag => tag.toLowerCase()).join(',')
  );
}

function injectClearButton(dock) {
  const clearId = 'clear-highlighted-button';

  if (dock.querySelector(`#${clearId}`) || clearAllButton) {
    return;
  }

  const button = document.createElement("button");
  button.textContent = "Clear highlighted";
  button.className = "clear-highlight-btn";
  button.id = clearId;

  clearAllButton = button;

  Object.assign(button.style, {
    fontSize: "14px",
    cursor: "pointer",
    padding: "10px 15px",
    width: '100%',
    borderRadius: '10px',
    display: currentActiveButton && currentActiveId ? 'block' : 'none'
  });

  button.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    setCurrentActiveButton(null);
    currentActiveId = null;
    socket.send('{}');

    const scroller = document.querySelector("yt-live-chat-item-list-renderer");
    if (scroller) scroller.disableAutoScroll = false;

    const items = getItems();
    items.forEach(item => {
      updateButtonStateBasedOnId(currentActiveId, item, false);
    });
  };

  dock.prepend(button);
}

waitForChatContainer((chatContainer) => {
  injectAllExisting();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          node.nodeType === 1 &&
          SUPPORTED_RENDERERS.includes(node.tagName)
        ) {
          injectButton(node);
        }
      }
    }
  });

  observer.observe(chatContainer, {
    childList: true,
    subtree: true // 👈 this is critical for nested additions
  });

  // Connect to socket
  socket = new WebSocket('ws://localhost:3001/extension');
  socket.onopen = () => {
    console.log('Connected to local socket');
  };

  socket.onmessage = async (event) => {
    try {
      const dataText = event.data instanceof Blob ? await event.data.text() : event.data;
      const data = JSON.parse(dataText);
      currentActiveId = data.id || null;
    } catch (err) {
      console.error('Invalid message from extension:', err);
    }
  };

  setInterval(() => {
    const items = getItems();
  
    items.forEach(item => {
      if (!item.querySelector(".highlight-btn") && item.getBoundingClientRect().top > 0) {
        injectButton(item);
      }
    });

    const dock = getChatDocument().querySelector('yt-live-chat-docked-message #container #docked-item');
    if (dock) {
      injectClearButton(dock)
    }
  }, 500); // every 0.5 seconds
});