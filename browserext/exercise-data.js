const splitInput = document.getElementById("splitInput");
const splitBtn = document.getElementById("splitBtn");
const splitStatus = document.getElementById("splitStatus");
const mergeInput = document.getElementById("mergeInput");
const mergeBtn = document.getElementById("mergeBtn");
const mergeStatus = document.getElementById("mergeStatus");

splitInput.onchange = () => { splitBtn.disabled = !splitInput.files.length; };
mergeInput.onchange = () => { mergeBtn.disabled = !mergeInput.files.length; };

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle("error", isError);
}

async function readExerciseArray(file) {
  const parsed = JSON.parse(await file.text());
  if (!Array.isArray(parsed)) throw new Error(`${file.name} must be an array of exercises.`);
  return parsed;
}

// Same formatting as catalog/exercises.json: 2-space indent, trailing newline.
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
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

splitBtn.onclick = async () => {
  try {
    const exercises = await readExerciseArray(splitInput.files[0]);
    const byType = new Map();
    for (const ex of exercises) {
      const type = ex.type ?? "UNKNOWN";
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(ex);
    }
    for (const [type, list] of byType) await downloadJson(`${type}.json`, list);
    const summary = [...byType].map(([type, list]) => `${type}.json: ${list.length}`).join("\n");
    setStatus(splitStatus, `Downloaded ${byType.size} files (${exercises.length} exercises)\n${summary}`);
  } catch (err) {
    setStatus(splitStatus, `Error: ${err.message}`, true);
  }
};

mergeBtn.onclick = async () => {
  try {
    const merged = [];
    const seenIds = new Set();
    const duplicates = [];
    for (const file of mergeInput.files) {
      for (const ex of await readExerciseArray(file)) {
        if (ex.id && seenIds.has(ex.id)) {
          duplicates.push(`${ex.id} (${file.name})`);
          continue;
        }
        if (ex.id) seenIds.add(ex.id);
        merged.push(ex);
      }
    }
    await downloadJson("exercises.json", merged);
    const dupText = duplicates.length ? `\nSkipped ${duplicates.length} duplicate ids:\n${duplicates.join("\n")}` : "";
    setStatus(mergeStatus, `Downloaded exercises.json (${merged.length} exercises from ${mergeInput.files.length} files)${dupText}`);
  } catch (err) {
    setStatus(mergeStatus, `Error: ${err.message}`, true);
  }
};
