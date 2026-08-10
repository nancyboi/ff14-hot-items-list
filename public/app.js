const numberFmt = new Intl.NumberFormat("en-US");

// tagId -> TagDef, filled in main() from /api/tags.
let tagsById = new Map();
// tagId -> "include" | "exclude"
const tagState = new Map();

function tagFilterGroupId(category) {
  if (category === "source") return "tagFiltersSource";
  if (category === "gather") return "tagFiltersGather";
  if (category === "craft") return "tagFiltersCraft";
  return "tagFiltersMisc";
}

function buildTagFilters(tags, onChange) {
  for (const tag of tags) {
    tagsById.set(tag.id, tag);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip";
    chip.textContent = tag.label;
    chip.dataset.tagId = tag.id;
    chip.addEventListener("click", () => {
      cycleTagState(tag.id);
      renderTagChip(chip, tag.id);
      onChange?.();
    });

    document.getElementById(tagFilterGroupId(tag.category)).appendChild(chip);
  }
}

function cycleTagState(tagId) {
  const current = tagState.get(tagId);
  if (current === "include") {
    tagState.set(tagId, "exclude");
  } else if (current === "exclude") {
    tagState.delete(tagId);
  } else {
    tagState.set(tagId, "include");
  }
}

function renderTagChip(chip, tagId) {
  const state = tagState.get(tagId);
  chip.classList.toggle("tag-chip--include", state === "include");
  chip.classList.toggle("tag-chip--exclude", state === "exclude");
}

function readTagFilters() {
  const includeTags = [];
  const excludeTags = [];
  for (const [tagId, state] of tagState) {
    if (state === "include") includeTags.push(tagId);
    else if (state === "exclude") excludeTags.push(tagId);
  }
  return { includeTags, excludeTags };
}

function applyTagFilters(includeTags, excludeTags) {
  tagState.clear();
  for (const id of includeTags ?? []) tagState.set(id, "include");
  for (const id of excludeTags ?? []) tagState.set(id, "exclude");

  for (const chip of document.querySelectorAll(".tag-chip")) {
    renderTagChip(chip, chip.dataset.tagId);
  }
}

function tagChipHtml(tagId) {
  const tag = tagsById.get(tagId);
  const label = tag?.label ?? tagId;
  const className = tag?.category ?? "";
  return `<span class="badge tag ${className}">${label}</span>`;
}

function renderRow(item) {
  const tr = document.createElement("tr");

  tr.innerHTML = `
    <td class="name">${item.name}</td>
    <td class="velocity">${item.regularSaleVelocity.toFixed(1)}/day</td>
    <td>${numberFmt.format(Math.round(item.averagePrice))} gil</td>
    <td class="tags">${(item.tags ?? []).map(tagChipHtml).join("")}</td>
  `;
  return tr;
}

function renderResults(data) {
  const subtitle = document.getElementById("subtitle");
  const table = document.getElementById("table");
  const empty = document.getElementById("empty");
  const rows = document.getElementById("rows");

  rows.innerHTML = "";

  const items = data.items ?? [];

  if (items.length === 0) {
    subtitle.textContent = `${data.world} — no hot items found`;
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }

  const generated = new Date(data.generatedAt).toLocaleString();
  const levelsNote = data.myLevelsOnly
    ? ` — filtered to your levels (${Object.entries(data.playerLevels ?? {})
        .filter(([, lvl]) => lvl > 0)
        .map(([job, lvl]) => `${job} ${lvl}`)
        .join(", ") || "none set"})`
    : "";
  const periodNote = data.days ? ` — past ${data.days} day${data.days === 1 ? "" : "s"}` : "";
  subtitle.textContent = `${data.world} — ${items.length} items — generated ${generated}${periodNote}${levelsNote}`;

  for (const item of items) {
    rows.appendChild(renderRow(item));
  }
  empty.classList.add("hidden");
  table.classList.remove("hidden");
}

function levelInputId(jobName) {
  return `level-${jobName}`;
}

function buildLevelFields(jobs) {
  const gatherGroup = document.getElementById("gatherLevels");
  const craftGroup = document.getElementById("craftLevels");

  for (const job of jobs) {
    const label = document.createElement("label");
    label.className = "field level-field";
    label.innerHTML = `
      ${job.abbr}
      <input type="number" min="0" max="90" step="1" value="0" id="${levelInputId(job.name)}" data-job="${job.name}" />
    `;
    (job.category === "gather" ? gatherGroup : craftGroup).appendChild(label);
  }
}

function readPlayerLevels(jobs) {
  const levels = {};
  for (const job of jobs) {
    const input = document.getElementById(levelInputId(job.name));
    levels[job.name] = Number(input.value) || 0;
  }
  return levels;
}

function applyDefaultLevels(playerLevels) {
  for (const [job, level] of Object.entries(playerLevels ?? {})) {
    const input = document.getElementById(levelInputId(job));
    if (input) input.value = level;
  }
}

async function search(jobs) {
  const status = document.getElementById("searchStatus");
  const button = document.getElementById("search");
  status.textContent = "Searching...";
  button.disabled = true;

  try {
    const body = {
      world: document.getElementById("world").value || "Siren",
      days: Number(document.getElementById("days").value) || 7,
      myLevelsOnly: document.getElementById("myLevelsOnly").checked,
      playerLevels: readPlayerLevels(jobs),
      ...readTagFilters(),
    };
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    renderResults(data);
    status.textContent = "";
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

async function main() {
  const subtitle = document.getElementById("subtitle");

  let jobs;
  let tags;
  try {
    jobs = await (await fetch("/api/jobs")).json();
    tags = await (await fetch("/api/tags")).json();
  } catch {
    subtitle.textContent = "Couldn't reach the dev server - run `npm run serve`.";
    return;
  }
  buildLevelFields(jobs);
  buildTagFilters(tags);

  // Show the last saved result (if any) immediately on load, before any search is run.
  try {
    const res = await fetch("/data/hot-items.json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      renderResults(data);
      document.getElementById("world").value = data.world ?? "Siren";
      document.getElementById("days").value = String(data.days ?? 7);
      document.getElementById("myLevelsOnly").checked = data.myLevelsOnly !== false;
      applyDefaultLevels(data.playerLevels);
      applyTagFilters(data.includeTags, data.excludeTags);
    } else {
      subtitle.textContent = "No data yet — set your levels and click Search";
    }
  } catch {
    subtitle.textContent = "No data yet — set your levels and click Search";
  }

  document.getElementById("filters").addEventListener("submit", (e) => {
    e.preventDefault();
    search(jobs);
  });
}

main();
