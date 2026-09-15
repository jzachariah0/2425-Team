const $ = (sel, root = document) => root.querySelector(sel);

async function loadData() {
  const res = await fetch("./data.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);
  return res.json();
}

function formatDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatStamp(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, "&#39;");
}

function renderProject(project) {
  document.title = project.name;
  $("#project-name").textContent = project.name;
  $("#project-desc").textContent = project.description;
  $("#project-status").textContent = project.status;
  $("#updated-tag").textContent = `Updated ${formatStamp(project.updated)}`;
  $("#footer-stamp").textContent = `${project.name}  ${formatStamp(project.updated)}`;
}

function renderDecisions(decisions) {
  const list = $("#decisions-list");
  const sorted = [...decisions].sort((a, b) => (a.date < b.date ? 1 : -1));
  list.innerHTML = sorted
    .map(
      (d) => `
      <li class="decision">
        <div class="decision__date">${escapeHtml(formatDate(d.date))}</div>
        <div class="decision__body">
          <p>${escapeHtml(d.decision)}</p>
          <p class="decision__reason">${escapeHtml(d.reason)}</p>
        </div>
      </li>`
    )
    .join("");
}

function renderLinks(links) {
  const row = $("#links-row");
  row.innerHTML = links
    .map(
      (link) => `
      <a class="link" href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer">
        <span class="link__sub">${escapeHtml(link.subtitle)}</span>
        <span class="link__label">
          ${escapeHtml(link.label)}
          <span class="link__arrow" aria-hidden="true">↗</span>
        </span>
      </a>`
    )
    .join("");
}

function renderGlossary(terms) {
  const dl = $("#glossary-list");
  dl.innerHTML = terms
    .map(
      (t) => `
      <div class="glossary__item">
        <dt class="glossary__term">${escapeHtml(t.term)}</dt>
        <dd class="glossary__def">${escapeHtml(t.definition)}</dd>
      </div>`
    )
    .join("");
}

function renderTeam(members) {
  const tbody = $("#team-table tbody");
  tbody.innerHTML = members
    .map(
      (m) => `
      <tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.role)}</td>
        <td>${escapeHtml(m.subsystem)}</td>
      </tr>`
    )
    .join("");
}

function renderMilestones(milestones) {
  const root = $("#timeline");
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const items = milestones.map((m) => ({
    ...m,
    _date: new Date(`${m.date}T12:00:00`),
  }));

  let pastCount = 0;
  let currentIdx = -1;
  items.forEach((m, i) => {
    if (m._date < today) {
      pastCount += 1;
      m._state = "past";
    } else if (currentIdx === -1) {
      currentIdx = i;
      m._state = "current";
    } else {
      m._state = "future";
    }
  });

  const progress =
    items.length <= 1
      ? 0
      : Math.min(1, Math.max(0, pastCount / (items.length - 1)));

  root.innerHTML = `
    <div class="timeline__track"><div class="timeline__progress" style="width:${(progress * 100).toFixed(1)}%"></div></div>
    <div class="timeline__nodes">
      ${items
        .map(
          (m) => `
        <div class="milestone is-${m._state}">
          <div class="milestone__node" aria-hidden="true"></div>
          <div class="milestone__meta">
            <div class="milestone__date">${escapeHtml(formatDate(m.date))}</div>
            <div class="milestone__label">${escapeHtml(m.label)}</div>
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}

async function boot() {
  try {
    const data = await loadData();
    renderProject(data.project);
    renderDecisions(data.decisions);
    renderLinks(data.links);
    renderGlossary(data.glossary);
    renderTeam(data.team);
    renderMilestones(data.milestones);
  } catch (err) {
    console.error(err);
    $("#project-desc").textContent =
      "Could not load data.json. Serve this folder over HTTP.";
  }
}

boot();
