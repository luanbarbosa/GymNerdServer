// "Fix duplicates": takes the duplicates marked in the viewer, groups linked ids
// (chains like a -> b -> c become one group), lets the user pick each group's primary
// exercise and whose image to keep, and builds a merge prompt to copy. Uses globals from viewer.js.

const fixDialog = document.getElementById("fix-dialog");
const fixTitle = document.getElementById("fix-title");
const fixGroupsEl = document.getElementById("fix-groups");
const fixPromptBtn = document.getElementById("fix-generate");
const fixPromptWrap = document.getElementById("fix-prompt-wrap");
const fixPromptText = document.getElementById("fix-prompt");
const fixTypeFilter = document.getElementById("fix-type-filter");

let fixGroups = [];
let fixPrimaries = [];
// Per group, the exercise whose image the primary keeps (null keeps the primary's own image).
let fixImages = [];

function groupDuplicatePairs(pairs) {
  const parent = new Map();
  const find = (id) => {
    if (!parent.has(id)) parent.set(id, id);
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  pairs.forEach(([a, b]) => parent.set(find(a), find(b)));

  const groups = new Map();
  [...parent.keys()].forEach((id) => {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  });
  return [...groups.values()];
}

function describeExercise(id) {
  const index = exercises.findIndex((e) => e.id === id);
  return { index, exercise: exercises[index] };
}

// Indexes of the groups with at least one exercise of the selected type ("" shows all).
function shownGroupIndexes() {
  const type = fixTypeFilter.value;
  return fixGroups
    .map((ids, groupIndex) => groupIndex)
    .filter((groupIndex) => !type || fixGroups[groupIndex].some((id) => describeExercise(id).exercise?.type === type));
}

function renderFixGroups() {
  const shown = shownGroupIndexes();
  const done = shown.filter((groupIndex) => fixPrimaries[groupIndex]).length;
  fixTitle.textContent = `Fix duplicates: pick a primary to include a group (${done}/${shown.length})`;
  fixPromptBtn.disabled = done === 0;
  fixGroupsEl.innerHTML = "";

  shown.forEach((groupIndex) => {
    const ids = fixGroups[groupIndex];
    const section = document.createElement("section");
    section.className = "fix-group";
    const heading = document.createElement("h3");
    heading.textContent = `Group ${groupIndex + 1}`;
    const options = document.createElement("div");
    options.className = "fix-options";

    const imageId = fixImages[groupIndex] || fixPrimaries[groupIndex];
    ids.forEach((id) => {
      const { index, exercise } = describeExercise(id);
      const wrap = document.createElement("div");
      wrap.className = "fix-option";
      const option = document.createElement("button");
      option.className = fixPrimaries[groupIndex] === id ? "picker-option selected" : "picker-option";
      // Exercises marked as a duplicate of another one can't be the primary.
      option.disabled = Boolean(duplicates[id]);
      option.onclick = () => {
        // Clicking the selected primary again unselects it, which leaves the group out of the prompt.
        fixPrimaries[groupIndex] = fixPrimaries[groupIndex] === id ? null : id;
        renderFixGroups();
      };
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = exercise?.name || id;
      if (exercise?.imageFileId) img.src = imageUrl(exercise.imageFileId);
      const label = document.createElement("span");
      label.textContent = exercise ? `${index + 1}. ${exercise.name}` : `Unknown exercise ${id}`;
      option.append(img, label);
      const keepImage = actionButton(
        imageId === id ? "Image kept ✓" : "Keep this image",
        () => {
          fixImages[groupIndex] = fixImages[groupIndex] === id ? null : id;
          renderFixGroups();
        },
        imageId === id ? "keep-image selected" : "keep-image",
      );
      keepImage.disabled = !exercise?.imageFileId;
      wrap.append(option, keepImage);
      options.appendChild(wrap);
    });

    section.append(heading, options);
    fixGroupsEl.appendChild(section);
  });
}

function exerciseLabel(id) {
  const { exercise } = describeExercise(id);
  return exercise ? `${id} (${exercise.name})` : id;
}

function buildMergePrompt() {
  // Groups hidden by the type filter or without a primary are skipped.
  const selected = shownGroupIndexes()
    .map((groupIndex) => ({ ids: fixGroups[groupIndex], primary: fixPrimaries[groupIndex], image: fixImages[groupIndex] }))
    .filter(({ primary }) => primary);
  const groups = selected.map(({ ids, primary, image }, groupIndex) => {
    const others = ids.filter((id) => id !== primary);
    const imageFileId = image && image !== primary ? describeExercise(image).exercise?.imageFileId : null;
    return [
      `Group ${groupIndex + 1}:`,
      `- Primary: ${exerciseLabel(primary)}`,
      ...others.map((id) => `- Merge into primary: ${exerciseLabel(id)}`),
      imageFileId
        ? `- Image: set the primary's imageFileId to ${imageFileId} (the image of ${exerciseLabel(image)})`
        : "- Image: keep the primary's imageFileId",
    ].join("\n");
  });
  return [
    "Merge the following exercises including their aliases in catalog/exercises.json.",
    "For each group, keep the primary exercise (its id, and the imageFileId given for the group) and move into it the information from the other exercises: " +
      "searchAlias and searchAliasPT (no repeated entries, and add the other exercises' name/namePT as aliases when they differ from the primary's), " +
      "plus any other field the primary is missing. Then remove the merged exercises from the catalog.",
    "",
    groups.join("\n\n"),
  ].join("\n");
}

document.getElementById("fix-duplicates").onclick = () => {
  const pairs = Object.entries(duplicates);
  if (!pairs.length) {
    showToast("No duplicates marked");
    return;
  }
  fixGroups = groupDuplicatePairs(pairs);
  // Each group has one exercise not marked as a duplicate of another; preselect it as the primary.
  fixPrimaries = fixGroups.map((ids) => ids.find((id) => !duplicates[id]) || null);
  fixImages = fixGroups.map(() => null);
  // Starts with the main view's type filter.
  fixTypeFilter.replaceChildren(...[...typeFilterSelect.options].map((o) => new Option(o.text, o.value)));
  fixTypeFilter.value = typeFilter;
  fixPromptWrap.hidden = true;
  renderFixGroups();
  fixDialog.showModal();
};
fixTypeFilter.onchange = () => {
  fixPromptWrap.hidden = true;
  renderFixGroups();
};
fixPromptBtn.onclick = () => {
  fixPromptText.value = buildMergePrompt();
  fixPromptWrap.hidden = false;
  fixPromptWrap.scrollIntoView({ behavior: "smooth" });
};
document.getElementById("fix-copy").onclick = () => copy(fixPromptText.value, "merge prompt");
document.getElementById("close-fix").onclick = () => fixDialog.close();
fixDialog.onclick = (e) => { if (e.target === fixDialog) fixDialog.close(); };
