import * as THREE from "three";

const $ = (sel, root = document) => root.querySelector(sel);

async function loadData() {
  const embedded = document.getElementById("hera-data");
  if (embedded?.textContent?.trim()) {
    try {
      return JSON.parse(embedded.textContent);
    } catch (err) {
      console.warn("Embedded data parse failed", err);
    }
  }
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
  $("#project-name").textContent = String(project.name || "").toUpperCase();
  const tag = $("#project-tag");
  if (tag) tag.textContent = project.tagline || "2425 Team";
  $("#project-desc").textContent = project.description;
  const stamp = $("#footer-stamp");
  if (stamp) stamp.textContent = `${project.name}  ${formatStamp(project.updated)}`;
}

function renderBriefing(briefing) {
  const root = $("#briefing-block");
  if (!root) return;
  if (!briefing || !briefing.body) {
    root.className = "tbd";
    root.innerHTML = `
      <p class="tbd__label earmark">TBD</p>
      <p class="tbd__copy">No briefing posted yet.</p>`;
    return;
  }

  root.className = "briefing";
  const lines = [
    briefing.author ? `<p class="briefing__byline earmark">${escapeHtml(briefing.author)}</p>` : "",
    briefing.role ? `<p class="briefing__byline earmark">${escapeHtml(briefing.role)}</p>` : "",
    briefing.date ? `<p class="briefing__byline earmark">${escapeHtml(formatDate(briefing.date))}</p>` : "",
  ].filter(Boolean);

  root.innerHTML = `
    <p class="briefing__body">${escapeHtml(briefing.body)}</p>
    <div class="briefing__meta">${lines.join("")}</div>`;
}

function renderDecisions(decisions) {
  const list = $("#decisions-list");
  if (!decisions || decisions.length === 0) {
    list.className = "tbd";
    list.innerHTML = `
      <p class="tbd__label earmark">TBD</p>
      <p class="tbd__copy">No decisions logged yet.</p>`;
    return;
  }
  const sorted = [...decisions].sort((a, b) => (a.date < b.date ? 1 : -1));
  list.className = "decisions";
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

function normalizeMission(mission) {
  if (!mission) return [];
  if (typeof mission === "string") {
    return [{ text: mission, muted: false }];
  }
  if (Array.isArray(mission.segments)) {
    return mission.segments.map((s) => ({
      text: String(s.text || ""),
      muted: Boolean(s.muted),
    }));
  }
  if (mission.text) {
    return [{ text: String(mission.text), muted: false }];
  }
  return [];
}

function flattenMissionChars(segments) {
  const chars = [];
  segments.forEach((seg) => {
    for (const ch of seg.text) {
      chars.push({ ch, muted: seg.muted });
    }
  });
  return chars;
}

function paintMission(el, chars, count, showCursor) {
  let html = "";
  let openMuted = false;
  for (let i = 0; i < count; i += 1) {
    const { ch, muted } = chars[i];
    if (muted && !openMuted) {
      html += '<span class="mission-statement__muted">';
      openMuted = true;
    } else if (!muted && openMuted) {
      html += "</span>";
      openMuted = false;
    }
    html += escapeHtml(ch);
  }
  if (openMuted) html += "</span>";
  if (showCursor) {
    html += '<span class="mission-statement__cursor" aria-hidden="true"></span>';
  }
  el.innerHTML = html;
}

let missionTypeTimer = 0;

function renderMission(mission) {
  const el = $("#mission-copy");
  if (!el) return;
  window.clearTimeout(missionTypeTimer);

  const segments = normalizeMission(mission);
  const chars = flattenMissionChars(segments);
  if (chars.length === 0) {
    el.textContent = "";
    return;
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    paintMission(el, chars, chars.length, false);
    el.classList.add("is-done");
    return;
  }

  el.classList.remove("is-done");
  paintMission(el, chars, 0, true);

  const section = $("#mission");
  let started = false;

  const startTyping = () => {
    if (started) return;
    started = true;
    let i = 0;
    const step = () => {
      i += 1;
      const done = i >= chars.length;
      paintMission(el, chars, Math.min(i, chars.length), !done);
      if (done) {
        el.classList.add("is-done");
        return;
      }
      const next = chars[i]?.ch;
      const delay = next === " " ? 18 : next === "." || next === "," ? 70 : 28;
      missionTypeTimer = window.setTimeout(step, delay);
    };
    missionTypeTimer = window.setTimeout(step, 220);
  };

  if (!section) {
    startTyping();
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          startTyping();
          io.disconnect();
        }
      });
    },
    { threshold: 0.35 }
  );
  io.observe(section);
}

function renderTeam(members) {
  const grid = $("#team-grid");
  grid.innerHTML = members
    .map(
      (m, i) => `
      <article class="person" style="--i:${i}">
        <div class="person__media">
          <img
            class="person__photo"
            src="${escapeAttr(m.photo)}"
            alt="${escapeAttr(m.name)}"
            loading="lazy"
          />
        </div>
        <div class="person__meta">
          <p class="person__major earmark">${escapeHtml(m.major || "")}</p>
          <h3 class="person__name">${escapeHtml(m.name)}</h3>
          <p class="person__role">${escapeHtml(m.role)}</p>
          ${
            m.email
              ? `<a class="person__email" href="mailto:${escapeAttr(m.email)}">${escapeHtml(m.email)}</a>`
              : ""
          }
          ${
            m.phone
              ? `<a class="person__phone" href="tel:${escapeAttr(String(m.phone).replace(/[^\d+]/g, ""))}">${escapeHtml(m.phone)}</a>`
              : ""
          }
          ${
            m.linkedin
              ? `<a class="person__linkedin" href="${escapeAttr(m.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`
              : ""
          }
        </div>
      </article>`
    )
    .join("");
}

function renderMilestones(milestones) {
  const root = $("#timeline");
  if (!milestones || milestones.length === 0) {
    root.className = "tbd";
    root.innerHTML = `
      <p class="tbd__label earmark">TBD</p>
      <p class="tbd__copy">Milestones will be posted here.</p>`;
    return;
  }

  root.className = "timeline";
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

function initReveal() {
  const nodes = document.querySelectorAll("[data-reveal], .person");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    nodes.forEach((n) => n.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  nodes.forEach((n) => io.observe(n));
}

function initScene() {
  const canvas = $("#scene");
  if (!canvas) return () => {};

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = window.matchMedia("(max-width: 640px)").matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.4 : 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.045);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  camera.position.set(0, 3.2, 14);

  const accent = 0x4e8af7;
  const white = 0xffffff;

  // Warped terrain
  const terrainGeo = new THREE.PlaneGeometry(40, 40, isMobile ? 48 : 96, isMobile ? 48 : 96);
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z =
      Math.sin(x * 0.22) * Math.cos(y * 0.18) * 1.1 +
      Math.sin(x * 0.55 + y * 0.4) * 0.35 +
      Math.cos((x + y) * 0.12) * 0.55;
    pos.setZ(i, z);
  }
  const terrain = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshBasicMaterial({
      color: accent,
      wireframe: true,
      transparent: true,
      opacity: 0.22,
    })
  );
  terrain.rotation.x = -Math.PI / 2.05;
  terrain.position.y = -1.6;
  scene.add(terrain);

  // Grid
  const grid = new THREE.GridHelper(42, 56, accent, 0x1e2124);
  grid.position.y = -1.55;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  // Nested orbital rings
  const ringGroup = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.4 + i * 0.55, 0.012, 10, 180),
      new THREE.MeshBasicMaterial({
        color: i % 2 ? white : accent,
        transparent: true,
        opacity: 0.55 - i * 0.07,
      })
    );
    ring.rotation.x = Math.PI / 2.2 + i * 0.18;
    ring.rotation.y = i * 0.35;
    ringGroup.add(ring);
  }
  ringGroup.position.set(3.6, 1.8, -1.2);
  scene.add(ringGroup);

  // Core icosahedron cluster
  const coreGroup = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 1),
    new THREE.MeshBasicMaterial({
      color: accent,
      wireframe: true,
      transparent: true,
      opacity: 0.95,
    })
  );
  coreGroup.add(core);
  const coreShell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.9, 0),
    new THREE.MeshBasicMaterial({
      color: white,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
    })
  );
  coreGroup.add(coreShell);
  coreGroup.position.copy(ringGroup.position);
  scene.add(coreGroup);

  // Sweeping scan planes
  const beams = [];
  for (let i = 0; i < 3; i++) {
    const beam = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, 18),
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
      })
    );
    beam.position.set(-12 + i * 4, 2.2, -2 + i);
    beam.rotation.y = 0.15 * i;
    scene.add(beam);
    beams.push({ mesh: beam, speed: 1.4 + i * 0.35, phase: i * 2.1 });
  }

  // Particle field
  const count = isMobile ? 600 : 1800;
  const pointsGeo = new THREE.BufferGeometry();
  const arr = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = (Math.random() - 0.5) * 36;
    arr[i * 3 + 1] = Math.random() * 10 - 1;
    arr[i * 3 + 2] = (Math.random() - 0.5) * 28 - 2;
    speed[i] = 0.2 + Math.random() * 0.8;
  }
  pointsGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  const points = new THREE.Points(
    pointsGeo,
    new THREE.PointsMaterial({
      color: white,
      size: isMobile ? 0.035 : 0.028,
      transparent: true,
      opacity: 0.75,
      sizeAttenuation: true,
    })
  );
  scene.add(points);

  // Connecting arcs (great-circle style lines)
  const arcGroup = new THREE.Group();
  for (let i = 0; i < (isMobile ? 8 : 16); i++) {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3((Math.random() - 0.5) * 16, Math.random() * 2, (Math.random() - 0.5) * 10),
      new THREE.Vector3((Math.random() - 0.5) * 8, 3 + Math.random() * 3, (Math.random() - 0.5) * 6),
      new THREE.Vector3((Math.random() - 0.5) * 16, Math.random() * 2, (Math.random() - 0.5) * 10)
    );
    const pts = curve.getPoints(40);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.22 + Math.random() * 0.25,
      })
    );
    arcGroup.add(line);
  }
  scene.add(arcGroup);

  // Floating nodes
  const nodes = [];
  for (let i = 0; i < (isMobile ? 12 : 24); i++) {
    const node = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.08 + Math.random() * 0.08, 0),
      new THREE.MeshBasicMaterial({
        color: Math.random() > 0.5 ? accent : white,
        wireframe: true,
        transparent: true,
        opacity: 0.7,
      })
    );
    node.position.set(
      (Math.random() - 0.5) * 18,
      Math.random() * 5,
      (Math.random() - 0.5) * 14
    );
    scene.add(node);
    nodes.push({
      mesh: node,
      base: node.position.clone(),
      amp: 0.3 + Math.random() * 0.6,
      freq: 0.4 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
    });
  }

  const pointer = { x: 0, y: 0 };
  const onPointer = (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  let raf = 0;
  const clock = new THREE.Clock();

  const animate = () => {
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    if (!reduced) {
      terrain.rotation.z = Math.sin(t * 0.05) * 0.08;
      ringGroup.rotation.z = t * 0.18;
      ringGroup.rotation.y = t * 0.11;
      coreGroup.rotation.x = t * 0.55;
      coreGroup.rotation.y = t * 0.72;
      core.scale.setScalar(1 + Math.sin(t * 2.2) * 0.06);

      beams.forEach((b) => {
        b.mesh.position.x = -14 + ((t * b.speed + b.phase * 3) % 28);
        b.mesh.material.opacity = 0.12 + (Math.sin(t * 3 + b.phase) * 0.5 + 0.5) * 0.28;
      });

      const pAttr = points.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        let y = pAttr.getY(i) + 0.01 * speed[i];
        if (y > 10) y = -1;
        pAttr.setY(i, y);
      }
      pAttr.needsUpdate = true;
      points.rotation.y = t * 0.03;

      arcGroup.rotation.y = Math.sin(t * 0.08) * 0.15;

      nodes.forEach((n) => {
        n.mesh.position.y = n.base.y + Math.sin(t * n.freq + n.phase) * n.amp;
        n.mesh.rotation.x = t * n.freq;
        n.mesh.rotation.z = t * n.freq * 0.7;
      });

      camera.position.x = pointer.x * 1.8;
      camera.position.y = 3.2 + pointer.y * -0.6;
      camera.position.z = 14 + Math.sin(t * 0.15) * 0.4;
      camera.lookAt(pointer.x * 0.8, 0.6 + pointer.y * -0.2, 0);
    }

    renderer.render(scene, camera);
  };
  animate();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", onPointer);
    renderer.dispose();
  };
}

async function boot() {
  let dispose = () => {};
  try {
    dispose = initScene();
    const data = await loadData();
    renderProject(data.project);
    renderBriefing(data.briefing);
    renderDecisions(data.decisions);
    renderLinks(data.links);
    renderMission(data.mission);
    renderTeam(data.team);
    renderMilestones(data.milestones);
    requestAnimationFrame(() => initReveal());
  } catch (err) {
    console.error(err);
    $("#project-desc").textContent =
      "Could not load site data. Open http://127.0.0.1:8765 instead of the HTML file.";
  }
  window.addEventListener("pagehide", () => dispose(), { once: true });
}

boot();
