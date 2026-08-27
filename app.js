import {
  clearPrivateData,
  getAsset,
  getMeta,
  listAssets,
  putAsset,
  putMeta
} from "./db.js";

const app = document.querySelector("#app");
const networkStatus = document.querySelector("#network-status");
const offlineBadge = document.querySelector("#offline-badge");
const toast = document.querySelector("#toast");
const audioDock = document.querySelector("#audio-dock");
const audioElement = document.querySelector("#audio-element");
const audioTitle = document.querySelector("#audio-title");
const audioKicker = document.querySelector("#audio-kicker");
const audioToggle = document.querySelector("#audio-toggle");
const audioProgress = document.querySelector("#audio-progress");
const audioTime = document.querySelector("#audio-time");

let trip = await getMeta("trip-data");
let assetNames = new Set(await listAssets());
let shellReady = false;
let currentAudioUrl = null;
let audioQueue = [];
let toastTimer = null;

const storedState = JSON.parse(localStorage.getItem("escocia-ui-state") || "{}");
const state = {
  view: storedState.view || "ruta",
  selectedDay: storedState.selectedDay || null,
  routes: storedState.routes || {},
  done: storedState.done || {},
  checklist: storedState.checklist || {},
  cruiseCanceled: Boolean(storedState.cruiseCanceled)
};

function saveState() {
  localStorage.setItem("escocia-ui-state", JSON.stringify(state));
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function showToast(message, timeout = 3200) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, timeout);
}

function updateNetworkStatus() {
  const online = navigator.onLine;
  networkStatus.textContent = online ? "Con conexión · datos locales" : "Modo avión · datos locales";
  networkStatus.style.color = online ? "" : "#b9dcc8";
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    await navigator.serviceWorker.ready;
    shellReady = Boolean(registration.active || navigator.serviceWorker.controller);
  } catch (error) {
    console.error("No se pudo registrar el service worker", error);
  }
}

function setActiveNav() {
  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
}

function expectedAudioNames() {
  return new Set((trip?.audioManifest || []).map(item => item.name));
}

function installedAudioCount() {
  const expected = expectedAudioNames();
  return [...assetNames].filter(name => expected.has(name)).length;
}

function updateOfflineBadge() {
  const expected = trip?.audioManifest?.length || 29;
  const count = installedAudioCount();
  const ready = Boolean(trip && count === expected && shellReady);
  offlineBadge.textContent = ready ? "Offline listo" : `${count}/${expected} audios`;
  offlineBadge.classList.toggle("is-ready", ready);
}

function dayProgress(day) {
  const ids = day.routes.flatMap(route => route.steps.map(step => step.id));
  const unique = [...new Set(ids)];
  const done = unique.filter(id => state.done[id]).length;
  return { done, total: unique.length };
}

function renderEmpty() {
  app.innerHTML = `
    <section class="empty-state">
      <p class="eyebrow">Configuración privada</p>
      <h1>Tu viaje, guardado en el móvil.</h1>
      <p class="lede">Instala la aplicación y carga el archivo privado del itinerario. Después podrás consultar etapas, textos y mapas sin depender de Drive.</p>
      <div class="notice">La carcasa no contiene datos personales. El itinerario y los audios se importan desde tus archivos y permanecen en este dispositivo.</div>
      <button class="primary-button" type="button" data-view="preparar">Preparar modo offline</button>
    </section>
  `;
}

function renderHome() {
  const audioCount = installedAudioCount();
  const expected = trip.audioManifest.length;
  app.innerHTML = `
    <section class="hero">
      <p class="eyebrow">${esc(trip.dateRange)}</p>
      <h1>${esc(trip.title)}</h1>
      <p class="lede">${esc(trip.subtitle)}</p>
      <div class="hero-meta">
        <span class="chip is-accent">3 días</span>
        <span class="chip">${audioCount}/${expected} audios</span>
        <span class="chip">Datos privados locales</span>
      </div>
    </section>

    <section class="section">
      <div class="section-heading">
        <h2>Elige el día</h2>
        <small>El progreso se guarda aquí</small>
      </div>
      <div class="day-grid">
        ${trip.days.map(day => {
          const progress = dayProgress(day);
          const percent = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
          return `
            <button class="day-card" type="button" data-action="select-day" data-day="${esc(day.id)}">
              <span class="day-number">${day.number}</span>
              <span>
                <strong>${esc(day.title)}</strong>
                <small>${esc(day.date)} · ${esc(day.duration)}</small>
              </span>
              <span class="day-progress">${percent}%</span>
            </button>
          `;
        }).join("")}
      </div>
    </section>

    <section class="section panel">
      <p class="eyebrow">Regla de seguridad</p>
      <h3>${esc(trip.safety.headline)}</h3>
      <p class="muted">${esc(trip.safety.body)}</p>
      <div class="action-row">
        <button class="secondary-button" type="button" data-view="texto">Ver plan completo</button>
        <button class="ghost-button" type="button" data-view="preparar">Comprobar offline</button>
      </div>
    </section>
  `;
}

function currentRoute(day) {
  const selected = state.routes[day.id] || day.defaultRoute;
  return day.routes.find(route => route.id === selected) || day.routes[0];
}

function routeSelector(day, route) {
  if (day.routes.length < 2) return "";
  return `
    <div class="select-wrap">
      <label for="route-select">Sentido / contingencia</label>
      <select id="route-select" data-action="change-route" data-day="${esc(day.id)}">
        ${day.routes.map(option => `
          <option value="${esc(option.id)}" ${option.id === route.id ? "selected" : ""}>${esc(option.title)}</option>
        `).join("")}
      </select>
    </div>
  `;
}

function routeLinks(route) {
  return `
    <div class="route-links">
      ${route.masterLinks.map(link => `
        <a class="map-button" href="${esc(link.url)}" target="_blank" rel="noopener">
          <span aria-hidden="true">↗</span> ${esc(link.title)}
        </a>
      `).join("")}
    </div>
  `;
}

function appleMapsUrl(destination) {
  return `https://maps.apple.com/?q=${encodeURIComponent(destination || "")}`;
}

function resolvedAudio(entry) {
  if (state.cruiseCanceled && entry.cruiseAlternative) return entry.cruiseAlternative;
  if (entry.sequence) return entry.sequence;
  if (entry.file) return [{ file: entry.file, title: entry.title }];
  return [];
}

function renderAudioCue(entry) {
  const files = resolvedAudio(entry);
  if (!files.length) return "";
  const installed = files.every(item => assetNames.has(item.file));
  const payload = encodeURIComponent(JSON.stringify(files));
  const label = files.length > 1 ? `Reproducir ${files.length} partes` : "Reproducir";
  const cueTitle = state.cruiseCanceled && entry.cruiseAlternative
    ? `${entry.title} · versión sin crucero`
    : entry.title;
  return `
    <div class="audio-cue">
      <small>Audioguía · inicio sugerido</small>
      <strong>${esc(cueTitle)}</strong>
      <p>${esc(entry.cue)}</p>
      <button class="audio-button" type="button" data-action="play-sequence" data-files="${esc(payload)}" ${installed ? "" : "disabled"}>
        <span aria-hidden="true">${installed ? "▶" : "↓"}</span>
        ${installed ? label : "Audio aún no importado"}
      </button>
    </div>
  `;
}

function renderStep(step, index) {
  const done = Boolean(state.done[step.id]);
  const classes = [
    "step-card",
    done ? "is-done" : "",
    step.optional ? "is-muted" : ""
  ].filter(Boolean).join(" ");
  const externalLinks = (step.links || []).map(link => `
    <a class="ghost-button" href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.title)}</a>
  `).join("");
  return `
    <article class="${classes}" id="${esc(step.id)}">
      <span class="step-marker">${done ? "✓" : index + 1}</span>
      <div class="step-body">
        <div class="step-topline">
          <span class="step-time">${esc(step.time)}</span>
          <span class="step-kind">${esc(step.kind)}${step.optional ? " · opcional" : ""}</span>
        </div>
        <h3>${esc(step.title)}</h3>
        <p>${esc(step.summary)}</p>
        ${step.details?.length ? `
          <details>
            <summary>Detalles operativos</summary>
            <ul class="detail-list">
              ${step.details.map(item => `<li>${esc(item)}</li>`).join("")}
            </ul>
          </details>
        ` : ""}
        ${(step.audio || []).map(renderAudioCue).join("")}
        <div class="step-actions">
          ${step.mapUrl ? `<a class="map-button" href="${esc(step.mapUrl)}" target="_blank" rel="noopener">Google Maps</a>` : ""}
          ${step.destination ? `<a class="ghost-button" href="${esc(appleMapsUrl(step.destination))}" target="_blank" rel="noopener">Apple Maps</a>` : ""}
          ${step.walkUrl ? `<a class="ghost-button" href="${esc(step.walkUrl)}" target="_blank" rel="noopener">Ruta a pie</a>` : ""}
          ${step.alternateMapUrl ? `<a class="ghost-button" href="${esc(step.alternateMapUrl)}" target="_blank" rel="noopener">Parking alternativo</a>` : ""}
          ${externalLinks}
          ${step.destination ? `<button class="ghost-button" type="button" data-action="copy-destination" data-destination="${esc(step.destination)}">Copiar destino</button>` : ""}
          <button class="${done ? "secondary-button" : "primary-button"} full" type="button" data-action="toggle-done" data-step="${esc(step.id)}">
            ${done ? "Marcar pendiente" : "Etapa completada"}
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderDay(dayId) {
  const day = trip.days.find(item => item.id === dayId) || trip.days[0];
  state.selectedDay = day.id;
  const route = currentRoute(day);
  const progress = route.steps.filter(step => state.done[step.id]).length;
  const cruiseSwitch = day.id === "d3" ? `
    <label class="switch-row">
      <span>
        <strong>Crucero cancelado</strong>
        <small>Cambia automáticamente la apertura de la pista D3-04.</small>
      </span>
      <input type="checkbox" data-action="toggle-cruise" ${state.cruiseCanceled ? "checked" : ""}>
    </label>
  ` : "";
  app.innerHTML = `
    <button class="ghost-button" type="button" data-action="back-days">← Los tres días</button>
    <section class="section">
      <p class="eyebrow">${esc(day.date)}</p>
      <h1>Día ${day.number}<br>${esc(day.title)}</h1>
      <p class="lede">${esc(day.summary)}</p>
      <div class="chip-row">
        <span class="chip">${esc(day.distance)}</span>
        <span class="chip">${esc(day.duration)}</span>
        <span class="chip is-accent">${progress}/${route.steps.length} etapas</span>
      </div>
    </section>

    <section class="day-toolbar">
      ${routeSelector(day, route)}
      ${routeLinks(route)}
    </section>
    ${cruiseSwitch}

    <div class="notice">Los enlaces de mapas necesitan que la región esté descargada previamente. El conductor no debe tocar el teléfono.</div>

    <section class="section">
      <div class="timeline">
        ${route.steps.map(renderStep).join("")}
      </div>
    </section>

    <section class="section panel">
      <p class="eyebrow">Plan B</p>
      <h3>Prioridades y contingencias</h3>
      <ul class="detail-list">
        ${day.contingencies.map(item => `<li>${esc(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function renderAudios() {
  if (!trip) return renderEmpty();
  const byDay = trip.days.map(day => ({
    day,
    tracks: trip.audioManifest.filter(track => track.day === day.id)
  }));
  app.innerHTML = `
    <section>
      <p class="eyebrow">Biblioteca local</p>
      <h1>Las 29 pistas</h1>
      <p class="lede">Las variantes aparecen por separado. Durante la ruta usa los botones de cada etapa: ya eligen el sentido correcto.</p>
    </section>
    ${byDay.map(group => `
      <section class="section">
        <div class="section-heading">
          <h2>Día ${group.day.number}</h2>
          <small>${group.tracks.filter(track => assetNames.has(track.name)).length}/${group.tracks.length}</small>
        </div>
        ${group.tracks.map(track => {
          const installed = assetNames.has(track.name);
          const files = encodeURIComponent(JSON.stringify([{ file: track.name, title: track.title }]));
          return `
            <article class="audio-card">
              <span>
                <strong>${esc(track.title)}</strong>
                <small>${installed ? formatBytes(track.size) + " · disponible offline" : "Pendiente de importar"}</small>
              </span>
              <button class="round-button" type="button" data-action="play-sequence" data-files="${esc(files)}" ${installed ? "" : "disabled"} aria-label="Reproducir ${esc(track.title)}">
                ${installed ? "▶" : "↓"}
              </button>
            </article>
          `;
        }).join("")}
      </section>
    `).join("")}
  `;
}

async function storageStatus() {
  if (!navigator.storage?.estimate) return { used: null, quota: null, persisted: false };
  const estimate = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  return { used: estimate.usage, quota: estimate.quota, persisted };
}

async function renderPrepare() {
  const expected = trip?.audioManifest?.length || 29;
  const installed = installedAudioCount();
  const storage = await storageStatus();
  const dataReady = Boolean(trip);
  app.innerHTML = `
    <section>
      <p class="eyebrow">Comprobación previa</p>
      <h1>Modo offline</h1>
      <p class="lede">Haz esta preparación con Wi-Fi. Después todo el itinerario y los audios permanecen en el dispositivo.</p>
    </section>

    <section class="section setup-card">
      <div class="readiness">
        ${readinessRow(shellReady, "Aplicación guardada", shellReady ? "La carcasa está en caché." : "Abre la app una vez más tras instalarla.", shellReady ? "Listo" : "Pendiente")}
        ${readinessRow(dataReady, "Itinerario privado", dataReady ? trip.dateRange : "Importa Escocia-datos-privados.json.", dataReady ? "Listo" : "0/1")}
        ${readinessRow(installed === expected, "Audioguías", `${installed} de ${expected} MP3 guardados en el dispositivo.`, `${installed}/${expected}`)}
        ${readinessRow(storage.persisted, "Almacenamiento persistente", storage.persisted ? "El navegador ha aceptado conservar los datos." : "Solicita protección contra limpieza automática.", storage.persisted ? "Sí" : "Solicitar")}
      </div>
      <p class="muted">Uso local aproximado: ${storage.used == null ? "no disponible" : formatBytes(storage.used)}${storage.quota ? ` de ${formatBytes(storage.quota)}` : ""}.</p>
      <button class="secondary-button" type="button" data-action="persist-storage">Proteger almacenamiento</button>
    </section>

    <section class="section setup-card">
      <p class="eyebrow">1 · Itinerario</p>
      <h3>Importa el archivo privado</h3>
      <p class="muted">Selecciona <span class="mono">Escocia-datos-privados.json</span>. Sustituye la versión anterior sin borrar los audios.</p>
      <label class="file-picker">
        <span><strong>Elegir JSON privado</strong>Desde Drive o Archivos</span>
        <input id="data-import" type="file" accept=".json,application/json">
      </label>
    </section>

    <section class="section setup-card">
      <p class="eyebrow">2 · Audio</p>
      <h3>Importa los tres ZIP</h3>
      <p class="muted">Puedes seleccionar los tres a la vez. Se validan y se descomprimen de uno en uno para no saturar el móvil.</p>
      <label class="file-picker">
        <span><strong>Elegir ZIP de los días 1, 2 y 3</strong>Conserva después los ZIP en Archivos/Descargas</span>
        <input id="zip-import" type="file" accept=".zip,application/zip" multiple>
      </label>
      <div class="progress-track" aria-hidden="true"><div id="import-progress" class="progress-bar"></div></div>
      <p id="import-status" class="muted">Esperando archivos.</p>
    </section>

    ${trip ? `
      <section class="section setup-card">
        <p class="eyebrow">3 · Mapas</p>
        <h3>Descarga estas regiones</h3>
        <ul class="check-list">
          ${trip.offlineMaps.regions.map(region => `<li>□ ${esc(region)}</li>`).join("")}
        </ul>
        <div class="notice">${esc(trip.offlineMaps.body)}</div>
      </section>

      <section class="section setup-card">
        <p class="eyebrow">4 · Lista final</p>
        <h3>Antes de salir</h3>
        <ul class="check-list">
          ${trip.checklist.map((item, index) => `
            <li>
              <label class="check-row">
                <input type="checkbox" data-action="check-item" data-index="${index}" ${state.checklist[index] ? "checked" : ""}>
                <span>${esc(item)}</span>
              </label>
            </li>
          `).join("")}
        </ul>
      </section>

      <section class="section setup-card">
        <p class="eyebrow">Enlaces en directo</p>
        <div class="action-row">
          ${trip.liveLinks.map(link => `<a class="ghost-button" href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.title)}</a>`).join("")}
        </div>
      </section>
    ` : ""}

    <section class="section setup-card">
      <p class="eyebrow">Privacidad</p>
      <h3>Datos de este dispositivo</h3>
      <p class="muted">Borrar elimina el itinerario, los audios y el progreso solo de este móvil. Los originales de Drive no se modifican.</p>
      <button class="danger-button" type="button" data-action="clear-data">Borrar datos locales</button>
    </section>
  `;
  bindFileInputs();
}

function readinessRow(good, title, detail, value) {
  return `
    <div class="readiness-row ${good ? "is-good" : ""}">
      <span class="readiness-icon">${good ? "✓" : "·"}</span>
      <span><strong>${esc(title)}</strong><small>${esc(detail)}</small></span>
      <span>${esc(value)}</span>
    </div>
  `;
}

function renderText() {
  if (!trip) return renderEmpty();
  app.innerHTML = `
    <button class="ghost-button" type="button" data-action="back-days">← Ruta</button>
    <section class="section">
      <p class="eyebrow">Copia offline del documento</p>
      <h1>Plan completo</h1>
      <p class="lede">Texto de la sección Road trip capturado el ${esc(trip.source.capturedAt)}. Los enlaces accionables están integrados en cada etapa.</p>
      <div class="source-text">${esc(trip.sourceText || "Texto no incluido en este paquete.")}</div>
    </section>
  `;
}

async function render() {
  setActiveNav();
  updateOfflineBadge();
  if (!trip && state.view !== "preparar") {
    renderEmpty();
    return;
  }
  if (state.view === "audios") {
    renderAudios();
  } else if (state.view === "preparar") {
    await renderPrepare();
  } else if (state.view === "texto") {
    renderText();
  } else if (state.selectedDay) {
    renderDay(state.selectedDay);
  } else {
    renderHome();
  }
}

function bindFileInputs() {
  const dataInput = document.querySelector("#data-import");
  const zipInput = document.querySelector("#zip-import");
  dataInput?.addEventListener("change", event => importTripData(event.target.files?.[0]));
  zipInput?.addEventListener("change", event => importZipFiles([...event.target.files || []]));
}

function validateTripData(data) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.days) || !Array.isArray(data.audioManifest)) {
    throw new Error("El JSON no tiene el formato esperado.");
  }
  if (data.days.length !== 3 || data.audioManifest.length !== 29) {
    throw new Error("El paquete debe contener 3 días y 29 archivos de audio.");
  }
}

async function importTripData(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    validateTripData(data);
    await putMeta("trip-data", data);
    trip = data;
    state.selectedDay = null;
    saveState();
    showToast("Itinerario privado importado.");
    await render();
  } catch (error) {
    console.error(error);
    showToast(`No se pudo importar el itinerario: ${error.message}`, 5200);
  }
}

async function sha256(buffer) {
  if (!crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function updateImportProgress(percent, message) {
  const bar = document.querySelector("#import-progress");
  const status = document.querySelector("#import-status");
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (status) status.textContent = message;
}

async function importZipFiles(files) {
  if (!files.length) return;
  if (!window.JSZip) {
    showToast("No está disponible el lector de ZIP.");
    return;
  }
  try {
    let completed = 0;
    const logs = (await getMeta("zip-imports")) || {};
    for (const file of files) {
      updateImportProgress(completed / files.length * 100, `Leyendo ${file.name}…`);
      const buffer = await file.arrayBuffer();
      const expected = trip?.zipPackages?.find(item => item.name === file.name);
      if (expected && expected.size !== file.size) {
        throw new Error(`${file.name} tiene un tamaño inesperado.`);
      }
      const hash = await sha256(buffer);
      if (expected?.sha256 && hash && hash !== expected.sha256) {
        throw new Error(`La huella de ${file.name} no coincide.`);
      }
      const zip = await window.JSZip.loadAsync(buffer);
      const entries = Object.values(zip.files).filter(entry => {
        const name = entry.name.toLowerCase();
        return !entry.dir && (name.endsWith(".mp3") || name.endsWith(".m3u8") || name.endsWith(".txt"));
      });
      let entryIndex = 0;
      for (const entry of entries) {
        const name = entry.name.split("/").pop();
        const blob = await entry.async("blob");
        await putAsset(name, blob);
        assetNames.add(name);
        entryIndex += 1;
        const base = completed / files.length * 100;
        const share = entryIndex / entries.length / files.length * 100;
        updateImportProgress(base + share, `Guardando ${name}…`);
      }
      logs[file.name] = {
        size: file.size,
        sha256: hash,
        importedAt: new Date().toISOString(),
        entries: entries.length
      };
      completed += 1;
    }
    await putMeta("zip-imports", logs);
    updateImportProgress(100, `Importación completa: ${installedAudioCount()}/${trip?.audioManifest?.length || 29} audios.`);
    showToast("Paquetes de audio importados y validados.", 4200);
    updateOfflineBadge();
    await renderPrepare();
  } catch (error) {
    console.error(error);
    updateImportProgress(0, `Error: ${error.message}`);
    showToast(`Importación detenida: ${error.message}`, 6000);
  }
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    showToast("Este navegador no ofrece almacenamiento persistente.");
    return;
  }
  const granted = await navigator.storage.persist();
  showToast(granted ? "Almacenamiento protegido." : "El sistema no ha concedido protección; conserva los ZIP como respaldo.");
  await renderPrepare();
}

async function playSequence(files) {
  audioQueue = [...files];
  await playNextInQueue();
}

async function playNextInQueue() {
  const next = audioQueue.shift();
  if (!next) return;
  const blob = await getAsset(next.file);
  if (!blob) {
    showToast(`Falta ${next.file}. Importa el ZIP correspondiente.`);
    audioQueue = [];
    return;
  }
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = URL.createObjectURL(blob);
  audioElement.src = currentAudioUrl;
  audioTitle.textContent = next.title || next.file;
  audioKicker.textContent = audioQueue.length ? `Audioguía · quedan ${audioQueue.length + 1} partes` : "Audioguía";
  audioDock.hidden = false;
  try {
    await audioElement.play();
  } catch (error) {
    console.error(error);
    showToast("Pulsa reproducir para iniciar el audio.");
  }
}

function closeAudio() {
  audioQueue = [];
  audioElement.pause();
  audioElement.removeAttribute("src");
  audioElement.load();
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = null;
  audioDock.hidden = true;
}

document.addEventListener("click", async event => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.view = viewButton.dataset.view;
    if (state.view !== "ruta") state.selectedDay = null;
    saveState();
    await render();
    app.focus();
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === "home" || action === "back-days") {
    state.view = "ruta";
    state.selectedDay = null;
    saveState();
    await render();
  } else if (action === "select-day") {
    state.view = "ruta";
    state.selectedDay = actionButton.dataset.day;
    saveState();
    await render();
    app.focus();
  } else if (action === "toggle-done") {
    const id = actionButton.dataset.step;
    state.done[id] = !state.done[id];
    saveState();
    await render();
    document.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "center" });
  } else if (action === "copy-destination") {
    try {
      await navigator.clipboard.writeText(actionButton.dataset.destination);
      showToast("Destino copiado.");
    } catch {
      showToast(actionButton.dataset.destination, 6000);
    }
  } else if (action === "play-sequence") {
    const files = JSON.parse(decodeURIComponent(actionButton.dataset.files));
    await playSequence(files);
  } else if (action === "persist-storage") {
    await requestPersistentStorage();
  } else if (action === "close-audio") {
    closeAudio();
  } else if (action === "clear-data") {
    const confirmed = window.confirm("¿Borrar itinerario, audios y progreso de este dispositivo? Los archivos de Drive no se tocarán.");
    if (!confirmed) return;
    closeAudio();
    await clearPrivateData();
    localStorage.removeItem("escocia-ui-state");
    trip = null;
    assetNames = new Set();
    state.view = "preparar";
    state.selectedDay = null;
    state.routes = {};
    state.done = {};
    state.checklist = {};
    state.cruiseCanceled = false;
    showToast("Datos locales borrados.");
    await render();
  }
});

document.addEventListener("change", async event => {
  const target = event.target;
  if (target.matches('[data-action="change-route"]')) {
    state.routes[target.dataset.day] = target.value;
    saveState();
    await render();
  } else if (target.matches('[data-action="toggle-cruise"]')) {
    state.cruiseCanceled = target.checked;
    saveState();
    await render();
  } else if (target.matches('[data-action="check-item"]')) {
    state.checklist[target.dataset.index] = target.checked;
    saveState();
  }
});

audioToggle.addEventListener("click", () => {
  if (audioElement.paused) audioElement.play();
  else audioElement.pause();
});

audioElement.addEventListener("play", () => {
  audioToggle.textContent = "Ⅱ";
});

audioElement.addEventListener("pause", () => {
  audioToggle.textContent = "▶";
});

audioElement.addEventListener("timeupdate", () => {
  const duration = audioElement.duration || 0;
  const current = audioElement.currentTime || 0;
  audioProgress.value = duration ? Math.round(current / duration * 1000) : 0;
  audioTime.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
});

audioElement.addEventListener("ended", async () => {
  if (audioQueue.length) await playNextInQueue();
  else audioToggle.textContent = "▶";
});

audioProgress.addEventListener("input", () => {
  if (!audioElement.duration) return;
  audioElement.currentTime = Number(audioProgress.value) / 1000 * audioElement.duration;
});

window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);

updateNetworkStatus();
await registerServiceWorker();
await render();
