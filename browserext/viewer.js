// Local catalog/ from the repo, reached through the browserext/catalog symlink.
const CATALOG_URL = chrome.runtime.getURL("catalog");
const PAGE_SIZE_KEY = "gymnerd.pageSize";
const OFFSET_KEY = "gymnerd.offset";
let pageSize = 4;
try {
  pageSize = Number(localStorage.getItem(PAGE_SIZE_KEY)) || 4;
} catch {}

let exercises = [];
let offset = 0;
// Exercise type to show ("" shows all). Paging and offset apply to the filtered list; cards keep their catalog #.
const TYPE_FILTER_KEY = "gymnerd.typeFilter";
let typeFilter = "";
try {
  typeFilter = localStorage.getItem(TYPE_FILTER_KEY) || "";
} catch {}

// Every exercise in a duplicate group, including the one the others point to.
function inDuplicateGroup(id) {
  return Boolean(duplicates[id]) || Object.values(duplicates).includes(id);
}

// Exercises in a duplicate group are hidden from the grid, as are fixed ones unless "Show fixed" is on.
function visibleExercises() {
  const grouped = new Set([...Object.keys(duplicates), ...Object.values(duplicates)]);
  return exercises.filter(
    (e) => !grouped.has(e.id) && (showFixed || !fixed.includes(e.id)) && (!typeFilter || e.type === typeFilter),
  );
}

// Why an exercise is left out of the grid regardless of the type filter, or null when it can be shown.
function hiddenReason(exercise) {
  if (inDuplicateGroup(exercise.id)) return "Exercise is marked as a duplicate and hidden";
  if (!showFixed && fixed.includes(exercise.id)) return "Exercise is marked as fixed and hidden";
  return null;
}
// Bumped by "Reset" so every image URL changes and the browser refetches it instead of using its cache.
// Persisted so a later page load keeps using the fresh copies rather than older cached ones.
const IMAGE_VERSION_KEY = "gymnerd.imageVersion";
let imageVersion = "";
try {
  imageVersion = localStorage.getItem(IMAGE_VERSION_KEY) || "";
} catch {}

function imageUrl(imageFileId) {
  return `${CATALOG_URL}/images/${imageFileId}.webp${imageVersion ? `?v=${imageVersion}` : ""}`;
}

const grid = document.getElementById("grid");
const status = document.getElementById("status");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const jumpInput = document.getElementById("jump");
const exportBtn = document.getElementById("export");
const clearBtn = document.getElementById("clear");
const typeFilterSelect = document.getElementById("type-filter");
const exportDuplicatesBtn = document.getElementById("export-duplicates");
const toast = document.getElementById("toast");
const pageSizeSelect = document.getElementById("page-size");
const showFixedInput = document.getElementById("show-fixed");
const showFixedLabel = document.getElementById("show-fixed-label");

const PROBLEMS_KEY = "gymnerd.problemExerciseIds";
let problems = loadProblems();

function loadProblems() {
  try {
    return JSON.parse(localStorage.getItem(PROBLEMS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveProblems() {
  try {
    localStorage.setItem(PROBLEMS_KEY, JSON.stringify(problems));
  } catch {
    showToast("Could not save to localStorage");
  }
  exportBtn.textContent = `Export problems (${problems.length})`;
}

// Maps a duplicate exercise id to the exercise id it duplicates.
const DUPLICATES_KEY = "gymnerd.duplicateExerciseIds";
let duplicates = loadDuplicates();

function loadDuplicates() {
  try {
    return JSON.parse(localStorage.getItem(DUPLICATES_KEY)) || {};
  } catch {
    return {};
  }
}

function saveDuplicates() {
  try {
    localStorage.setItem(DUPLICATES_KEY, JSON.stringify(duplicates));
  } catch {
    showToast("Could not save to localStorage");
  }
  exportDuplicatesBtn.textContent = `Export duplicates (${Object.keys(duplicates).length})`;
}

function setDuplicate(id, originalId) {
  if (originalId) duplicates[id] = originalId;
  else delete duplicates[id];
  saveDuplicates();
  goTo(offset);
}

// Follows duplicate links from id to the end of its chain (an exercise not marked as a duplicate).
function duplicateRoot(id) {
  const seen = new Set();
  while (duplicates[id] && !seen.has(id)) {
    seen.add(id);
    id = duplicates[id];
  }
  return id;
}

// Puts both exercises in the same duplicate group without dropping any existing links.
function linkDuplicates(a, b) {
  const rootA = duplicateRoot(a);
  const rootB = duplicateRoot(b);
  if (rootA !== rootB) duplicates[rootA] = rootB;
}

// Exercises already fixed; hidden from the grid unless "Show fixed" is on. Kept across "Reset".
const FIXED_KEY = "gymnerd.fixedExerciseIds";
const SHOW_FIXED_KEY = "gymnerd.showFixed";
let fixed = [];
let showFixed = false;
try {
  fixed = JSON.parse(localStorage.getItem(FIXED_KEY)) || [];
  showFixed = localStorage.getItem(SHOW_FIXED_KEY) === "true";
} catch {}

function saveFixed() {
  try {
    localStorage.setItem(FIXED_KEY, JSON.stringify(fixed));
  } catch {
    showToast("Could not save to localStorage");
  }
  showFixedLabel.textContent = `Show fixed (${fixed.length})`;
}

function toggleFixed(id) {
  fixed = fixed.includes(id) ? fixed.filter((x) => x !== id) : [...fixed, id];
  saveFixed();
  goTo(offset);
}

function toggleProblem(id) {
  problems = problems.includes(id) ? problems.filter((x) => x !== id) : [...problems, id];
  saveProblems();
  render();
}

let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1500);
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  showToast(text.length > 80 ? `Copied ${label}` : `Copied ${label}: ${text}`);
}

function actionButton(label, onClick, className) {
  const button = document.createElement("button");
  button.textContent = label;
  if (className) button.className = className;
  button.onclick = onClick;
  return button;
}

const problemsDialog = document.getElementById("problems-dialog");
const problemsList = document.getElementById("problems-list");
const problemsTitle = document.getElementById("problems-title");

function renderProblemsList() {
  problemsTitle.textContent = `Problematic exercises (${problems.length})`;
  problemsList.innerHTML = "";
  if (!problems.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No problematic exercises marked.";
    problemsList.appendChild(empty);
    return;
  }
  problems.forEach((id) => {
    const index = exercises.findIndex((e) => e.id === id);
    const exercise = exercises[index];

    const row = document.createElement("li");
    const text = document.createElement("div");
    text.className = "row-text";
    const name = document.createElement("div");
    name.className = "row-name";
    name.textContent = exercise ? `${index + 1}. ${exercise.name}` : "Unknown exercise";
    const idText = document.createElement("div");
    idText.className = "row-id";
    idText.textContent = id;
    text.append(name, idText);

    row.append(text, actionButton("Copy", () => copy(id, "exercise id")));
    if (exercise) {
      row.append(actionButton("Go to", () => {
        problemsDialog.close();
        goToExercise(exercise);
      }));
    }
    row.append(actionButton("Remove", () => {
      toggleProblem(id);
      renderProblemsList();
    }));
    problemsList.appendChild(row);
  });
}

const pickerDialog = document.getElementById("picker-dialog");
const pickerTitle = document.getElementById("picker-title");
const pickerSearch = document.getElementById("picker-search");
const pickerGrid = document.getElementById("picker-grid");
const pickerConfirm = document.getElementById("picker-confirm");
const pickerTypeFilter = document.getElementById("picker-type-filter");
let pickerSource = null;
let pickerSelected = [];

function openDuplicatePicker(exercise) {
  pickerSource = exercise;
  pickerTitle.textContent = `"${exercise.name}" is a duplicate of… (select one or more)`;
  pickerSelected = [];
  const index = exercises.indexOf(exercise);
  const sourceImg = document.getElementById("picker-source-img");
  sourceImg.src = exercise.imageFileId ? imageUrl(exercise.imageFileId) : "";
  sourceImg.alt = exercise.name;
  sourceImg.onclick = exercise.imageFileId ? () => openImage(exercise, index) : null;
  document.getElementById("picker-source-name").textContent = `${index + 1}. ${exercise.name}`;
  document.getElementById("picker-source-id").textContent = exercise.id;
  pickerSearch.value = "";
  // Starts with the main view's type filter.
  pickerTypeFilter.replaceChildren(...[...typeFilterSelect.options].map((o) => new Option(o.text, o.value)));
  pickerTypeFilter.value = typeFilter;
  renderPicker();
  pickerDialog.showModal();
  pickerSearch.focus();
}

const imageDialog = document.getElementById("image-dialog");

function openImage(exercise, index) {
  const img = document.getElementById("image-dialog-img");
  img.src = imageUrl(exercise.imageFileId);
  img.alt = exercise.name;
  document.getElementById("image-dialog-caption").textContent = `${index + 1}. ${exercise.name}`;
  imageDialog.showModal();
}

function expandButton(exercise, index) {
  const button = document.createElement("button");
  button.className = "expand-img";
  button.title = "Expand image";
  button.textContent = "⤢";
  button.onclick = () => openImage(exercise, index);
  return button;
}

// Any click closes it, so it only takes one click to get back to the picker.
imageDialog.onclick = () => imageDialog.close();

function renderPicker() {
  pickerConfirm.disabled = !pickerSelected.length;
  pickerConfirm.textContent = `Mark as duplicates (${pickerSelected.length + 1})`;
  const query = pickerSearch.value.trim().toLowerCase();
  pickerGrid.innerHTML = "";
  exercises.forEach((exercise, index) => {
    if (exercise.id === pickerSource.id) return;
    if (pickerTypeFilter.value && exercise.type !== pickerTypeFilter.value) return;
    const haystack = [exercise.name, exercise.namePT, ...(exercise.searchAlias || []), ...(exercise.searchAliasPT || [])]
      .join(" ")
      .toLowerCase();
    if (query && !haystack.includes(query) && String(index + 1) !== query) return;

    const option = document.createElement("button");
    // Already marked as a duplicate of another exercise, so it can't be picked again.
    option.disabled = Boolean(duplicates[exercise.id]);
    option.className = pickerSelected.includes(exercise.id) ? "picker-option selected" : "picker-option";
    option.onclick = () => {
      pickerSelected = pickerSelected.includes(exercise.id)
        ? pickerSelected.filter((id) => id !== exercise.id)
        : [...pickerSelected, exercise.id];
      renderPicker();
    };
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = exercise.name;
    if (exercise.imageFileId) img.src = imageUrl(exercise.imageFileId);
    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${exercise.name}` + (option.disabled ? " (already a duplicate)" : "");
    option.append(img, label);
    // Sibling of the option rather than a child, since a button can't contain another button.
    const cell = document.createElement("div");
    cell.className = "picker-cell";
    cell.appendChild(option);
    if (exercise.imageFileId) cell.appendChild(expandButton(exercise, index));
    pickerGrid.appendChild(cell);
  });
}

function render() {
  grid.innerHTML = "";
  const visible = visibleExercises();
  const page = visible.slice(offset, offset + pageSize);
  page.forEach((exercise) => {
    const card = document.createElement("div");
    const isProblem = problems.includes(exercise.id);
    const originalId = duplicates[exercise.id];
    const isFixed = fixed.includes(exercise.id);
    card.className = ["card", isProblem && "problem", originalId && "duplicate", isFixed && "fixed"]
      .filter(Boolean)
      .join(" ");

    const imgWrap = document.createElement("div");
    imgWrap.className = "img-wrap";
    if (exercise.imageFileId) {
      const img = document.createElement("img");
      img.src = imageUrl(exercise.imageFileId);
      img.alt = exercise.name;
      img.onerror = () => { imgWrap.innerHTML = '<span class="missing">Image failed to load</span>'; };
      imgWrap.appendChild(img);
    } else {
      imgWrap.innerHTML = '<span class="missing">No image</span>';
    }

    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = `${exercises.indexOf(exercise) + 1}. ${exercise.name}`;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = exercise.type || "";
    info.append(name, meta);
    if (originalId) {
      const originalIndex = exercises.findIndex((e) => e.id === originalId);
      const duplicateOf = document.createElement("div");
      duplicateOf.className = "duplicate-of";
      duplicateOf.textContent = originalIndex >= 0
        ? `Duplicate of #${originalIndex + 1} ${exercises[originalIndex].name}`
        : `Duplicate of ${originalId}`;
      info.appendChild(duplicateOf);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      actionButton("Copy exercise id", () => copy(exercise.id, "exercise id")),
      actionButton("Copy image id", () => copy(exercise.imageFileId || "", "image id")),
      actionButton(isProblem ? "Problematic ✓" : "Mark as problematic", () => toggleProblem(exercise.id), "mark"),
      actionButton(
        originalId ? "Duplicate ✓" : "Mark as duplicate",
        () => (originalId ? setDuplicate(exercise.id, null) : openDuplicatePicker(exercise)),
        "dup",
      ),
      actionButton(isFixed ? "Fixed ✓" : "Fixed", () => toggleFixed(exercise.id), "fix"),
    );

    card.append(imgWrap, info, actions);
    grid.appendChild(card);
  });

  const end = Math.min(offset + pageSize, visible.length);
  status.textContent = visible.length ? `${offset + 1}–${end} of ${visible.length}` : "No exercises";
  prevBtn.disabled = offset === 0;
  nextBtn.disabled = end >= visible.length;
  history.replaceState(null, "", `#${offset + 1}`);
  try {
    localStorage.setItem(OFFSET_KEY, String(offset));
  } catch {}
}

function goTo(newOffset) {
  const maxOffset = Math.max(0, visibleExercises().length - 1);
  offset = Math.min(Math.max(0, newOffset), maxOffset);
  render();
}

// Shows the page containing the exercise, clearing the type filter when it hides the exercise.
function goToExercise(exercise) {
  const reason = hiddenReason(exercise);
  if (reason) {
    showToast(reason);
    return;
  }
  if (typeFilter && exercise.type !== typeFilter) setTypeFilter("");
  const index = visibleExercises().indexOf(exercise);
  goTo(index - (index % pageSize));
}

function setTypeFilter(type) {
  typeFilter = type;
  typeFilterSelect.value = type;
  try {
    localStorage.setItem(TYPE_FILTER_KEY, type);
  } catch {}
}

function populateTypeFilter() {
  const types = [...new Set(exercises.map((e) => e.type).filter(Boolean))].sort();
  typeFilterSelect.replaceChildren(new Option("All", ""), ...types.map((type) => new Option(type, type)));
  setTypeFilter(types.includes(typeFilter) ? typeFilter : "");
}
typeFilterSelect.onchange = () => {
  setTypeFilter(typeFilterSelect.value);
  goTo(0);
};

function updateGridShape() {
  let cols = pageSize % 4 === 0 ? 4 : pageSize % 3 === 0 ? 3 : Math.min(pageSize, 4);
  if (window.innerWidth <= 480) cols = 1;
  else if (window.innerWidth <= 900) cols = Math.min(cols, 2);
  grid.style.setProperty("--cols", cols);
  grid.style.setProperty("--rows", Math.ceil(pageSize / cols));
}
window.addEventListener("resize", updateGridShape);

function applyPageSize() {
  pageSizeSelect.value = String(pageSize);
  updateGridShape();
}
pageSizeSelect.onchange = () => {
  pageSize = Number(pageSizeSelect.value);
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
  } catch {}
  applyPageSize();
  goTo(offset - (offset % pageSize));
};
applyPageSize();

prevBtn.onclick = () => goTo(offset - pageSize);
nextBtn.onclick = () => goTo(offset + pageSize);
jumpInput.onchange = () => {
  const exercise = exercises[Number(jumpInput.value) - 1];
  if (!exercise) return;
  const reason = hiddenReason(exercise);
  if (reason) {
    showToast(reason);
    return;
  }
  if (typeFilter && exercise.type !== typeFilter) setTypeFilter("");
  goTo(visibleExercises().indexOf(exercise));
};
document.getElementById("show-problems").onclick = () => {
  renderProblemsList();
  problemsDialog.showModal();
};
document.getElementById("close-problems").onclick = () => problemsDialog.close();
problemsDialog.onclick = (e) => { if (e.target === problemsDialog) problemsDialog.close(); };
document.getElementById("copy-all").onclick = () => {
  const imageIds = problems.map((id) => exercises.find((e) => e.id === id)?.imageFileId).filter(Boolean);
  if (imageIds.length) copy(imageIds.join(","), `${imageIds.length} image ids`);
};
pickerSearch.oninput = renderPicker;
pickerTypeFilter.onchange = renderPicker;
pickerConfirm.onclick = () => {
  pickerSelected.forEach((id) => linkDuplicates(pickerSource.id, id));
  saveDuplicates();
  goTo(offset);
  pickerDialog.close();
  showToast(`Marked ${pickerSelected.length + 1} exercises as duplicates`);
};
document.getElementById("close-picker").onclick = () => pickerDialog.close();
pickerDialog.onclick = (e) => { if (e.target === pickerDialog) pickerDialog.close(); };

exportBtn.onclick = () => downloadLines("problem-images.txt", problems);
// Merges ids from a problem-images.txt (one per line or comma separated) into the current list.
const importFile = document.getElementById("import-file");
document.getElementById("import").onclick = () => importFile.click();
importFile.onchange = async () => {
  const file = importFile.files[0];
  importFile.value = "";
  if (!file) return;
  const ids = (await file.text()).split(/[\s,]+/).filter(Boolean);
  const known = new Set(exercises.map((e) => e.id));
  const added = ids.filter((id) => !problems.includes(id));
  const unknown = added.filter((id) => !known.has(id)).length;
  problems = [...new Set([...problems, ...added])];
  saveProblems();
  render();
  showToast(`Imported ${new Set(added).size} new ids` + (unknown ? ` (${unknown} not in catalog)` : ""));
};
exportDuplicatesBtn.onclick = () => {
  downloadLines("duplicates.txt", Object.entries(duplicates).map(([id, originalId]) => `${id} -> ${originalId}`));
};

function downloadLines(filename, lines) {
  const blob = new Blob([lines.join("\n") + (lines.length ? "\n" : "")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download(
    { url, filename, conflictAction: "overwrite", saveAs: false },
    (downloadId) => {
      URL.revokeObjectURL(url);
      if (chrome.runtime.lastError || downloadId === undefined) {
        showToast(`Export failed: ${chrome.runtime.lastError?.message}`);
        return;
      }
      chrome.downloads.show(downloadId);
    },
  );
};
clearBtn.onclick = () => {
  if (!problems.length || !window.confirm(`Clear ${problems.length} problematic exercise ids?`)) return;
  problems = [];
  saveProblems();
  render();
};
showFixedInput.checked = showFixed;
showFixedInput.onchange = () => {
  showFixed = showFixedInput.checked;
  try {
    localStorage.setItem(SHOW_FIXED_KEY, String(showFixed));
  } catch {}
  goTo(offset);
};
saveProblems();
saveDuplicates();
saveFixed();
document.addEventListener("keydown", (e) => {
  if (e.target === jumpInput || e.target === pageSizeSelect || e.target === typeFilterSelect || e.target === showFixedInput || document.querySelector("dialog[open]")) return;
  if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); if (!nextBtn.disabled) nextBtn.click(); }
  if (e.key === "ArrowLeft") { e.preventDefault(); if (!prevBtn.disabled) prevBtn.click(); }
});

function loadExercises() {
  return fetch(`${CATALOG_URL}/exercises.json`, { cache: "no-store" }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

// Reloads exercises.json and every image from scratch and clears all problem and duplicate markings.
document.getElementById("reset").onclick = async () => {
  const markings = problems.length + Object.keys(duplicates).length;
  if (markings && !window.confirm(`Reset the catalog? This clears ${problems.length} problems and ${Object.keys(duplicates).length} duplicates.`)) return;
  problems = [];
  duplicates = {};
  saveProblems();
  saveDuplicates();
  imageVersion = String(Date.now());
  try {
    localStorage.setItem(IMAGE_VERSION_KEY, imageVersion);
  } catch {}
  status.textContent = "Resetting…";
  try {
    exercises = await loadExercises();
    populateTypeFilter();
    goTo(offset);
    showToast(`Reloaded ${exercises.length} exercises`);
  } catch (err) {
    status.textContent = `Failed to load exercises: ${err.message}`;
  }
};

loadExercises()
  .then((data) => {
    exercises = data;
    populateTypeFilter();
    // URL hash wins so links to a specific exercise still work; otherwise resume the last position.
    let start = parseInt(location.hash.slice(1), 10);
    if (!Number.isFinite(start)) {
      try {
        start = Number(localStorage.getItem(OFFSET_KEY)) + 1;
      } catch {}
    }
    goTo(Number.isFinite(start) ? start - 1 : 0);
  })
  .catch((err) => { status.textContent = `Failed to load exercises: ${err.message}`; });
