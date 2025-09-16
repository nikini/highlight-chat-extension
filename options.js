// MV3-safe options logic with loud logging
(() => {
  const DEFAULT_NS = "vpl-yt";
  const ORIGIN = "https://veganpowerlab.com";

  const $ = (id) => document.getElementById(id);
  const $ns = $("ns");
  const $save = $("save");
  const $saveStatus = $("save-status");
  const $overlayUrl = $("overlay-url");
  const $copy = $("copy");
  const $copyStatus = $("copy-status");
  const $open = $("open");
  const $envNote = $("env-note");

  const isExt = !!(globalThis.chrome?.runtime?.id && chrome.storage);

  console.log("[Options] Boot. isExt =", isExt, "runtime.id =", chrome?.runtime?.id);

  const store = {
    get(defaults) {
      return new Promise((resolve) => {
        if (isExt) {
          chrome.storage.sync.get(defaults, (res) => {
            if (chrome.runtime.lastError) {
              console.error("[Options] storage.get error:", chrome.runtime.lastError);
              resolve(defaults);
            } else {
              console.log("[Options] storage.get =>", res);
              resolve(res);
            }
          });
        } else {
          try {
            const raw = localStorage.getItem("ytHighlighterOptions") || "{}";
            const parsed = JSON.parse(raw);
            resolve({ ...defaults, ...parsed });
          } catch (e) {
            console.error("[Options] localStorage.get error:", e);
            resolve(defaults);
          }
        }
      });
    },
    set(obj) {
      return new Promise((resolve, reject) => {
        if (isExt) {
          chrome.storage.sync.set(obj, () => {
            if (chrome.runtime.lastError) {
              console.error("[Options] storage.set error:", chrome.runtime.lastError);
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              console.log("[Options] storage.set OK:", obj);
              resolve();
            }
          });
        } else {
          try {
            const raw = localStorage.getItem("ytHighlighterOptions") || "{}";
            const parsed = JSON.parse(raw);
            localStorage.setItem("ytHighlighterOptions", JSON.stringify({ ...parsed, ...obj }));
            resolve();
          } catch (e) {
            console.error("[Options] localStorage.set error:", e);
            reject(e);
          }
        }
      });
    }
  };

  function buildOverlayUrl(ns) {
    const safe = (ns || DEFAULT_NS).trim() || DEFAULT_NS;
    return `${ORIGIN}/${encodeURIComponent(safe)}/overlay`;
  }

  function renderOverlayUrl(ns) {
    const url = buildOverlayUrl(ns);
    $overlayUrl.innerHTML = `<code class="link">${url}</code>`;
    $open.href = url;
  }

  function flash(el, msg, ok = true) {
    el.textContent = msg;
    el.classList.toggle("success", ok);
    el.classList.toggle("error", !ok);
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.textContent = ""), 1500);
  }

  async function load() {
    if (!isExt) {
      $envNote.textContent = "Opened outside the extension (localStorage fallback). Open via chrome://extensions → your extension → Options.";
    } else {
      $envNote.textContent = "";
    }

    const { ns } = await store.get({ ns: DEFAULT_NS });
    $ns.value = ns || DEFAULT_NS;
    renderOverlayUrl($ns.value);
    console.log("[Options] Loaded ns:", $ns.value);
  }

  async function save() {
    const value = ($ns.value || "").trim() || DEFAULT_NS;
    try {
      await store.set({ ns: value });
      renderOverlayUrl(value);
      flash($saveStatus, "Saved ✓");
      console.log("[Options] Saved ns:", value);
    } catch (e) {
      flash($saveStatus, `Save failed: ${e.message || e}`, false);
    }
  }

  async function copyOverlay() {
    const text = buildOverlayUrl($ns.value);
    try {
      await navigator.clipboard.writeText(text);
      flash($copyStatus, "Copied!");
    } catch {
      const range = document.createRange();
      range.selectNodeContents($overlayUrl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      flash($copyStatus, "Select & copy");
    }
  }

  // Events
  $save.addEventListener("click", save);
  $copy.addEventListener("click", copyOverlay);
  $ns.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });

  // React to changes from other tabs
  if (isExt && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.ns) {
        const newNs = (changes.ns.newValue || DEFAULT_NS).toString().trim() || DEFAULT_NS;
        $ns.value = newNs;
        renderOverlayUrl(newNs);
        flash($saveStatus, "Updated from sync");
        console.log("[Options] ns changed via sync →", newNs);
      }
    });
  }

  // Init
  load();
})();