const fileInput = document.getElementById("filePicker");
const statusEl = document.getElementById("status");
const prevBtn = document.getElementById("prevBtn");
const skipBtn = document.getElementById("skipBtn");
const resetBtn = document.getElementById("resetBtn");
const cancelBtn = document.getElementById("cancelBtn");
const jsonInput = document.getElementById("jsonInput");
const pasteBtn = document.getElementById("pasteBtn");
const openViewerBtn = document.getElementById("openViewerBtn");
const imageIdRow = document.getElementById("imageIdRow");
const imageIdValue = document.getElementById("imageIdValue");
const copyImageIdBtn = document.getElementById("copyImageIdBtn");

copyImageIdBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(imageIdValue.textContent);
  copyImageIdBtn.title = "Copied!";
  setTimeout(() => { copyImageIdBtn.title = "Copy imageFileId"; }, 1500);
});

openViewerBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
});

document.getElementById("openExerciseDataBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("exercise-data.html") });
});

async function render() {
  const { catalog = [], pointer = 0 } = await chrome.storage.local.get(["catalog", "pointer"]);
  imageIdRow.hidden = true;

  if (!catalog.length) {
    statusEl.textContent = "No catalog loaded.";
    return;
  }
  if (pointer >= catalog.length) {
    statusEl.textContent = `Done. ${catalog.length}/${catalog.length} processed.`;
    return;
  }

  const ex = catalog[pointer];
  statusEl.textContent = `${pointer + 1}/${catalog.length}\n${ex.name}`;
  imageIdValue.textContent = ex.imageFileId;
  imageIdRow.hidden = false;
}

async function loadCatalog(text) {
  try {
    const parsed = JSON.parse(text);
    const catalog = Array.isArray(parsed) ? parsed : [parsed];
    if (!catalog.every((ex) => ex?.imageFileId)) {
      throw new Error("JSON must be an exercise or array of exercises with an imageFileId field.");
    }
    await chrome.storage.local.set({ catalog, pointer: 0 });
    await render();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    imageIdRow.hidden = true;
  }
}

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await loadCatalog(await file.text());
});

pasteBtn.addEventListener("click", async () => {
  const text = jsonInput.value.trim();
  if (!text) return;
  await loadCatalog(text);
});

// Local catalog/exercises.json from the repo, reached through the browserext/catalog symlink.
const LOCAL_CATALOG_URL = chrome.runtime.getURL("catalog/exercises.json");
const imageIdInput = document.getElementById("imageIdInput");
const lookupBtn = document.getElementById("lookupBtn");
const sourcePicker = document.getElementById("sourcePicker");
const sourceStatusEl = document.getElementById("sourceStatus");

// Uploaded exercises.json wins over the local catalog one.
async function getSourceCatalog() {
  const { sourceCatalog } = await chrome.storage.session.get("sourceCatalog");
  if (sourceCatalog) return sourceCatalog;

  const response = await fetch(LOCAL_CATALOG_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`fetch ${LOCAL_CATALOG_URL} failed: ${response.status}. Upload exercises.json instead.`);
  return response.json();
}

async function renderSourceStatus() {
  const { sourceCatalog, sourceName } = await chrome.storage.session.get(["sourceCatalog", "sourceName"]);
  sourceStatusEl.textContent = sourceCatalog
    ? `Using uploaded ${sourceName} (${sourceCatalog.length} exercises)`
    : "Using local catalog/exercises.json";
}

sourcePicker.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) throw new Error("exercises.json must be an array.");
    await chrome.storage.session.set({ sourceCatalog: parsed, sourceName: file.name });
    await renderSourceStatus();
  } catch (err) {
    sourceStatusEl.textContent = `Error: ${err.message}`;
  }
});

lookupBtn.addEventListener("click", async () => {
  const ids = imageIdInput.value.split(/[\s,]+/).filter(Boolean);
  if (!ids.length) return;
  try {
    const source = await getSourceCatalog();
    const byImageId = new Map(source.map((ex) => [ex.imageFileId, ex]));
    const missing = ids.filter((id) => !byImageId.has(id));
    if (missing.length) throw new Error(`Not found: ${missing.join(", ")}`);
    await loadCatalog(JSON.stringify(ids.map((id) => byImageId.get(id))));
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    imageIdRow.hidden = true;
  }
});

prevBtn.addEventListener("click", async () => {
  const { pointer = 0 } = await chrome.storage.local.get("pointer");
  await chrome.storage.local.set({ pointer: Math.max(0, pointer - 1) });
  await render();
});

skipBtn.addEventListener("click", async () => {
  const { pointer = 0 } = await chrome.storage.local.get("pointer");
  await chrome.storage.local.set({ pointer: pointer + 1 });
  await render();
});

resetBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ pointer: 0 });
  await render();
});

cancelBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove(["catalog", "pointer"]);
  fileInput.value = "";
  jsonInput.value = "";
  await render();
});

render();
renderSourceStatus();
