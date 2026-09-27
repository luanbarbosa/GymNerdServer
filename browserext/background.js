const MENU_ID = "gymnerd-download";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Download for GymApp",
    contexts: ["image"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const { catalog = [], pointer = 0 } = await chrome.storage.local.get(["catalog", "pointer"]);

  if (!catalog.length) {
    console.warn("GymNerd: no catalog loaded. Open popup and pick a JSON file first.");
    return;
  }
  if (pointer >= catalog.length) {
    console.warn("GymNerd: catalog exhausted. Reset pointer in popup to reuse.");
    return;
  }

  const exercise = catalog[pointer];
  const filename = `${exercise.imageFileId}.webp`;

  let url;
  try {
    url = await toWebpDataUrl(info.srcUrl);
  } catch (err) {
    console.error("GymNerd: webp conversion failed", err);
    return;
  }

  chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      console.error("GymNerd: download failed", chrome.runtime.lastError);
      return;
    }
    chrome.storage.local.set({ pointer: pointer + 1 });
    if (tab?.id !== undefined) {
      chrome.tabs.remove(tab.id);
    }
  });
});

const WEBP_QUALITY = 0.8;

async function toWebpDataUrl(srcUrl) {
  const response = await fetch(srcUrl);
  if (!response.ok) throw new Error(`fetch failed: ${response.status}`);

  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Already webp (static or animated): keep as-is, canvas would drop animation frames.
  if (isWebp(bytes)) return toDataUrl(bytes, "image/webp");
  if (isGif(bytes)) return gifToAnimatedWebpDataUrl(toDataUrl(bytes, "image/gif"));

  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();

  const webp = await canvas.convertToBlob({ type: "image/webp", quality: WEBP_QUALITY });
  return toDataUrl(new Uint8Array(await webp.arrayBuffer()), "image/webp");
}

// ImageDecoder (needed to read GIF frames) isn't exposed to service workers, so the
// animated encode runs in an offscreen document.
async function gifToAnimatedWebpDataUrl(gifDataUrl) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Decode GIF frames and encode them as animated WebP"
    });
  }
  const result = await chrome.runtime.sendMessage({
    type: "gif-to-webp",
    dataUrl: gifDataUrl,
    quality: WEBP_QUALITY
  });
  if (result?.error) throw new Error(result.error);
  return result.dataUrl;
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

// Checks bytes since servers often send wrong Content-Type.
function isWebp(bytes) {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
}

function isGif(bytes) {
  return bytes.length >= 6 && ascii(bytes, 0, 4) === "GIF8";
}

function toDataUrl(bytes, mimeType) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function openSearchTab(name) {
  const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${name} draw`)}`;
  const { searchTabId } = await chrome.storage.local.get("searchTabId");

  if (searchTabId !== undefined) {
    chrome.tabs.update(searchTabId, { url, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        createSearchTab(url);
      }
    });
    return;
  }

  createSearchTab(url);
}

function createSearchTab(url) {
  chrome.tabs.create({ url }, (tab) => {
    chrome.storage.local.set({ searchTabId: tab.id });
  });
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { searchTabId } = await chrome.storage.local.get("searchTabId");
  if (tabId === searchTabId) {
    chrome.storage.local.remove("searchTabId");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.catalog && !changes.pointer) return;

  chrome.storage.local.get(["catalog", "pointer"]).then(({ catalog = [], pointer = 0 }) => {
    const remaining = catalog.length - pointer;
    chrome.action.setBadgeText({ text: remaining > 0 ? String(remaining) : "" });

    if (remaining > 0) {
      openSearchTab(catalog[pointer].name);
    }
  });
});
