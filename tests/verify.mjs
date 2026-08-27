import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const privateDataPath = process.env.TRIP_DATA_PATH
  ? path.resolve(process.env.TRIP_DATA_PATH)
  : null;

const requiredShell = [
  "index.html",
  "app.css",
  "app.js",
  "db.js",
  "manifest.webmanifest",
  "service-worker.js",
  "vendor/jszip.min.js",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

for (const file of requiredShell) {
  assert.ok(fs.existsSync(path.join(appRoot, file)), `Falta ${file}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, "manifest.webmanifest"), "utf8"));
assert.equal(manifest.display, "standalone");
assert.equal(manifest.icons.length, 2);

const serviceWorker = fs.readFileSync(path.join(appRoot, "service-worker.js"), "utf8");
for (const file of requiredShell.filter(file => file !== "service-worker.js")) {
  const relative = `./${file}`;
  assert.ok(serviceWorker.includes(relative), `El service worker no precarga ${relative}`);
}

const publicFiles = fs.readdirSync(appRoot, { recursive: true }).map(String);
assert.ok(
  !publicFiles.some(file => /Escocia-datos-privados|\.mp3$|\.zip$|\.pdf$/i.test(file)),
  "Hay datos privados en la carpeta pública"
);

const report = {
  status: "ok",
  publicShellFiles: requiredShell.length,
  privateDataChecked: false
};

if (privateDataPath) {
  const trip = JSON.parse(fs.readFileSync(privateDataPath, "utf8"));
  assert.equal(trip.schemaVersion, 1);
  assert.equal(trip.days.length, 3);
  assert.equal(trip.audioManifest.length, 29);
  assert.ok(trip.sourceText.length > 20_000);
  assert.equal(trip.zipPackages.length, 3);
  assert.deepEqual(trip.days.map(day => day.routes.length), [1, 2, 2]);

  const names = trip.audioManifest.map(track => track.name);
  assert.equal(new Set(names).size, 29, "Hay nombres de audio duplicados");
  assert.ok(trip.audioManifest.every(track => track.size > 400_000));

  const references = new Set();
  for (const day of trip.days) {
    assert.ok(day.routes.some(route => route.id === day.defaultRoute), `Ruta predeterminada inexistente en ${day.id}`);
    for (const route of day.routes) {
      assert.ok(route.steps.length >= 6, `Ruta demasiado corta: ${day.id}/${route.id}`);
      assert.ok(route.masterLinks.length >= 1, `Sin ruta maestra: ${day.id}/${route.id}`);
      for (const link of route.masterLinks) assert.match(link.url, /^https:\/\//);
      for (const step of route.steps) {
        assert.ok(step.id && step.time && step.title && step.kind && step.summary);
        if (step.mapUrl) assert.match(step.mapUrl, /^https:\/\//);
        if (step.walkUrl) assert.match(step.walkUrl, /^https:\/\//);
        for (const entry of step.audio || []) {
          if (entry.file) references.add(entry.file);
          for (const item of entry.sequence || []) references.add(item.file);
          for (const item of entry.cruiseAlternative || []) references.add(item.file);
        }
      }
    }
  }

  assert.deepEqual(
    [...references].sort(),
    [...names].sort(),
    "Las referencias de audio y el manifiesto no coinciden"
  );

  for (const pack of trip.zipPackages) {
    assert.match(pack.name, /^Dia-[123]-paquete-movil\.zip$/);
    assert.match(pack.sha256, /^[a-f0-9]{64}$/);
    assert.ok(pack.size > 60_000_000);
  }

  Object.assign(report, {
    privateDataChecked: true,
    days: trip.days.length,
    routes: trip.days.reduce((sum, day) => sum + day.routes.length, 0),
    steps: trip.days.reduce((sum, day) => sum + day.routes.reduce((count, route) => count + route.steps.length, 0), 0),
    audioFiles: trip.audioManifest.length,
    audioBytes: trip.audioManifest.reduce((sum, track) => sum + track.size, 0),
    sourceTextCharacters: trip.sourceText.length
  });
}

console.log(JSON.stringify(report, null, 2));
