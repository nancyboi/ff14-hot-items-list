const numberFmt = new Intl.NumberFormat("en-US");

function effortBadge(tier) {
  if (tier === null || tier === undefined) {
    return { className: "tier-unknown", label: "Unknown source" };
  }
  if (tier === 0) return { className: "tier-0", label: "Gather / vendor" };
  if (tier === 1) return { className: "tier-1", label: "Simple craft" };
  if (tier === 2) return { className: "tier-2", label: "Nested craft" };
  return { className: "tier-high", label: `Complex craft (${tier} steps)` };
}

function sourceSummary(item) {
  const parts = [];
  if (item.gatherable) parts.push(item.gatherJobs?.length ? `gather: ${item.gatherJobs.join(", ")}` : "gatherable");
  if (item.vendor) parts.push("vendor-bought");
  if (item.craftable) parts.push(`craft: ${item.craftJobs.join(", ") || "unknown job"}`);
  if (parts.length === 0) return "source unknown (possibly a drop)";
  return parts.join(" · ");
}

function renderRow(item) {
  const tr = document.createElement("tr");
  const badge = effortBadge(item.effortTier);

  tr.innerHTML = `
    <td class="name">${item.name}</td>
    <td class="velocity">${item.regularSaleVelocity.toFixed(1)}/day</td>
    <td>${numberFmt.format(Math.round(item.currentAveragePrice))} gil</td>
    <td>${numberFmt.format(Math.round(item.averagePrice))} gil</td>
    <td><span class="badge ${badge.className}">${badge.label}</span></td>
    <td class="note">${item.blurb ?? sourceSummary(item)}</td>
  `;
  return tr;
}

async function main() {
  const subtitle = document.getElementById("subtitle");
  const table = document.getElementById("table");
  const empty = document.getElementById("empty");
  const rows = document.getElementById("rows");

  let data;
  try {
    const res = await fetch("/data/hot-items.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    subtitle.textContent = "No data yet";
    empty.classList.remove("hidden");
    return;
  }

  if (!data.items || data.items.length === 0) {
    subtitle.textContent = `${data.world} — no hot items found`;
    empty.classList.remove("hidden");
    return;
  }

  const generated = new Date(data.generatedAt).toLocaleString();
  subtitle.textContent = `${data.world} — ${data.items.length} items — generated ${generated}`;

  for (const item of data.items) {
    rows.appendChild(renderRow(item));
  }
  table.classList.remove("hidden");
}

main();
