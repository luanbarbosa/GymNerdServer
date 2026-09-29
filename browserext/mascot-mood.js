const LEVELS = ["encouraging", "neutral", "sassy"];
// HomeMascotMood values, in enum order. Key form: home_mascot_message_<mood lowercase>_<level>.
const MOODS = [
  "HAPPY_REST", "HAPPY_FIRST_RECORD", "HAPPY_RECORD", "HAPPY_ABOUT_TO_BREAK_RECORD",
  "HAPPY_1_2", "HAPPY_3_5", "HAPPY_6_8", "HAPPY_9_11", "HAPPY_12_14", "HAPPY_15_PLUS",
  "SAD_LOST_STREAK", "SAD_1_2", "SAD_3_5", "SAD_6_8", "SAD_9_11", "SAD_12_14", "SAD_15_17", "SAD_18_PLUS",
];
const KEY_PATTERN = new RegExp(`^home_mascot_message_(.+)_(${LEVELS.join("|")})$`, "i");

// Local GymNerdApp composeResources, reached through the browserext/app-resources symlink.
const LANGS = {
  en: { label: "en", folder: "values", url: chrome.runtime.getURL("app-resources/values/strings_home.xml") },
  pt: { label: "pt-br", folder: "values-pt", url: chrome.runtime.getURL("app-resources/values-pt/strings_home.xml") },
};

const enInput = document.getElementById("enInput");
const ptInput = document.getElementById("ptInput");
const inputs = { en: enInput, pt: ptInput };
const statusEl = document.getElementById("status");
const levelsEl = document.getElementById("levels");
const levelSelect = document.getElementById("levelSelect");
const exportBtn = document.getElementById("exportBtn");
const exportStatusEl = document.getElementById("exportStatus");

// Per language: { sources: [{ name, xml }], entries: Map<lowercase key, { name, text, sourceIndex }> }
const loaded = {};
// Per language: Map<lowercase key, edited text>. Only holds values that differ from the original.
const edits = { en: new Map(), pt: new Map() };

// Android string escapes: \' \" \@ \? \n \t \\ \uXXXX
function unescapeAndroid(value) {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => {
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    if (c[0] === "u" && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    return c;
  });
}

function escapeAndroid(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/^([@?])/, "\\$1")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseMascotStrings(sources) {
  const entries = new Map();
  sources.forEach(({ name: sourceName, xml }, sourceIndex) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error(`${sourceName} is not valid XML.`);
    for (const el of doc.querySelectorAll("string")) {
      const name = el.getAttribute("name");
      if (KEY_PATTERN.test(name)) {
        entries.set(name.toLowerCase(), { name, text: unescapeAndroid(el.textContent), sourceIndex });
      }
    }
  });
  return { sources, entries };
}

// Uploaded files win over the local app strings.
async function loadSources(input, url) {
  if (input.files.length) {
    return Promise.all([...input.files].map(async (file) => ({ name: file.name, xml: await file.text() })));
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`fetch ${url} failed: ${response.status}. Upload the strings xml instead.`);
  return [{ name: url.split("/").pop(), xml: await response.text() }];
}

function textCell(lang, key) {
  const original = loaded[lang].entries.get(key)?.text;
  const cell = document.createElement("div");
  cell.className = "text";
  cell.dataset.lang = LANGS[lang].label;
  const area = document.createElement("textarea");
  area.value = edits[lang].get(key) ?? original ?? "";
  cell.append(area);

  const refresh = () => {
    cell.classList.toggle("missing", original === undefined && !edits[lang].has(key));
    cell.classList.toggle("dirty", edits[lang].has(key));
  };
  area.oninput = () => {
    if (area.value === (original ?? "")) edits[lang].delete(key);
    else edits[lang].set(key, area.value);
    refresh();
    updateExportState();
  };
  refresh();
  return cell;
}

function render() {
  levelsEl.replaceChildren();
  // Moods found in the files but not in the enum are listed after the known ones.
  const extraMoods = new Set();
  for (const lang of Object.keys(LANGS)) {
    for (const key of loaded[lang].entries.keys()) {
      const mood = key.match(KEY_PATTERN)[1];
      if (!MOODS.some((known) => known.toLowerCase() === mood)) extraMoods.add(mood);
    }
  }
  const moods = [...MOODS.map((mood) => mood.toLowerCase()), ...[...extraMoods].sort()];
  let missing = 0;

  for (const level of LEVELS) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = level;
    section.append(heading);
    const visible = levelSelect.value === "all" || levelSelect.value === level;

    for (const mood of moods) {
      const key = `home_mascot_message_${mood}_${level}`;
      const row = document.createElement("div");
      row.className = "row";
      const keyEl = document.createElement("div");
      keyEl.className = "key";
      keyEl.textContent = mood.toUpperCase();
      keyEl.title = key;
      row.append(keyEl, textCell("en", key), textCell("pt", key));
      missing += !loaded.en.entries.has(key) + !loaded.pt.entries.has(key);
      section.append(row);
    }
    if (visible) levelsEl.append(section);
  }

  statusEl.classList.remove("error");
  statusEl.textContent = `${moods.length} moods x ${LEVELS.length} levels (strings found, en: ${loaded.en.entries.size}, pt-br: ${loaded.pt.entries.size})` +
    (missing ? `\n${missing} missing translations (red outline, empty)` : "") +
    (extraMoods.size ? `\nUnknown moods: ${[...extraMoods].join(", ")}` : "");
  updateExportState();
}

function updateExportState() {
  const counts = Object.keys(LANGS).map((lang) => `${LANGS[lang].label}: ${edits[lang].size}`);
  const total = edits.en.size + edits.pt.size;
  exportBtn.disabled = total === 0;
  setExportStatus(total ? `Edited strings (${counts.join(", ")})` : "No edits yet.");
}

function setExportStatus(text, isError = false) {
  exportStatusEl.textContent = text;
  exportStatusEl.classList.toggle("error", isError);
}

// Rewrites only the edited <string> values in the raw xml, leaving everything else byte-identical.
function patchSource(xml, changes) {
  let patched = xml;
  const additions = [];
  for (const { name, text, exists } of changes) {
    const escaped = escapeAndroid(text);
    if (!exists) {
      additions.push(`    <string name="${name}">${escaped}</string>\n`);
      continue;
    }
    const pattern = new RegExp(`(<string\\b[^>]*\\bname="${name}"[^>]*>)[\\s\\S]*?(</string>)`);
    if (!pattern.test(patched)) throw new Error(`Could not find <string name="${name}"> to edit.`);
    patched = patched.replace(pattern, (_, open, close) => `${open}${escaped}${close}`);
  }
  if (additions.length) {
    if (!patched.includes("</resources>")) throw new Error("No </resources> tag to add new strings to.");
    patched = patched.replace("</resources>", () => `${additions.join("")}</resources>`);
  }
  return patched;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, conflictAction: "overwrite", saveAs: false },
      (downloadId) => {
        URL.revokeObjectURL(url);
        if (chrome.runtime.lastError || downloadId === undefined) {
          reject(new Error(`Download of ${filename} failed: ${chrome.runtime.lastError?.message}`));
          return;
        }
        resolve(downloadId);
      },
    );
  });
}

exportBtn.onclick = async () => {
  try {
    const exported = [];
    for (const [lang, { folder }] of Object.entries(LANGS)) {
      if (!edits[lang].size) continue;
      const { sources, entries } = loaded[lang];
      // Group changes by the source file holding the key; new keys go to the first file.
      const bySource = new Map();
      for (const [key, text] of edits[lang]) {
        const entry = entries.get(key);
        const name = entry?.name ?? key;
        const sourceIndex = entry?.sourceIndex ?? 0;
        if (!bySource.has(sourceIndex)) bySource.set(sourceIndex, []);
        bySource.get(sourceIndex).push({ name, text, exists: Boolean(entry) });
      }
      for (const [sourceIndex, changes] of bySource) {
        const source = sources[sourceIndex];
        const filename = `${folder}/${source.name}`;
        await downloadText(filename, patchSource(source.xml, changes));
        exported.push(`${filename}: ${changes.length} strings`);
      }
    }
    setExportStatus(`Downloaded ${exported.length} files\n${exported.join("\n")}`);
  } catch (err) {
    setExportStatus(`Error: ${err.message}`, true);
  }
};

async function update() {
  try {
    for (const [lang, { url }] of Object.entries(LANGS)) {
      loaded[lang] = parseMascotStrings(await loadSources(inputs[lang], url));
      // Drop edits that now equal the (re)loaded original.
      for (const [key, text] of edits[lang]) {
        if (text === (loaded[lang].entries.get(key)?.text ?? "")) edits[lang].delete(key);
      }
    }
    render();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.classList.add("error");
  }
}

levelSelect.onchange = () => { if (loaded.en && loaded.pt) render(); };
enInput.onchange = update;
ptInput.onchange = update;
update();
