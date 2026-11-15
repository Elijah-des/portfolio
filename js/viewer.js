// Site-wide 3D Viewer component.
// Mounts on any element matching `.viewer-3d[data-model]`, lazy-loaded via IntersectionObserver.
// Neutral clay material on every mesh, Draco-compressed glb loading, drag-to-rotate via OrbitControls.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeVertices, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

// Shared PMREM environment (built lazily from the first renderer) so every viewer instance
// gets consistent image-based lighting. A neutral studio environment keeps the clay material
// reading as a soft matte form rather than a flat, near-black shape.
let sharedEnvTexture = null;
function getEnvTexture(renderer) {
  if (!sharedEnvTexture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    sharedEnvTexture = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  }
  return sharedEnvTexture;
}

const CLAY_MATERIAL = (overrides = {}) =>
  new THREE.MeshStandardMaterial({
    color: 0xbcb5a6, // light warm grey; lit side lands at "light grey", not white
    roughness: 0.55,
    metalness: 0.0,
    envMapIntensity: 0.45, // subtle image-based fill only — a strong key light does the shaping
    ...overrides,
  });

// Per-model default orientation. Each source model was exported from different software with a
// different "up" axis, so a single global rotation can't fix all of them — this maps a substring
// of the model URL to a rotation (radians, applied before auto-centering) so each one loads
// sitting/standing naturally. Values verified visually per model, revised across iterations as
// issues were caught on the live page — treat each entry as specific to that one model.
const D90 = Math.PI / 2;
const MODEL_ORIENTATION = [
  { match: "gotrain", rotation: [-D90, 0, 0] },        // length exported along Y (standing on end) → lay flat, base down
  { match: "bikering", rotation: [-D90, 0, 0] },  // was upside down (legs up, motif frame at bottom); rotate -90 on X so the frame sits up top and legs point down, matching the real fabricated piece
  // OSF cart's own bounding box confirmed the tall axis (1.99m) exported along Z, not Y —
  // a Z-up CAD export. -90° on X maps that axis onto Y (verified: post-rotation size is
  // 1.1 × 1.99 × 0.6, i.e. tall/upright), the same fix gotrain needed for the same reason.
  { match: "osfcart", rotation: [-D90, 0, 0] },
  // Two earlier attempts (iteration 6's area-ratio heuristic, iteration 7's luminance-grid
  // cross-correlation) both landed on the wrong angle — this mesh's two earcups are close
  // enough to symmetric in silhouette that blind pixel-similarity metrics can't reliably tell
  // "left cup bigger/closer" from "right cup bigger/closer." Re-matched by rendering a real
  // grid of candidate angles with the site's actual clay material/lighting and comparing them
  // directly against the project's own reference renders (headset-render.png,
  // shaded-preview-1.png) by eye — X-13/Y90 is the one that actually reproduces their
  // composition: headband arcing left-to-right over the top, left earcup bigger/closer in the
  // foreground, right earcup smaller and receding toward the back.
  // Update: the owner asked for the pose to match the cover render exactly. Re-matched by eye
  // from a fresh grid of candidate angles: headband arcing over the top, the near earcup lower
  // left with its cushion facing the viewer, the far earcup higher on the right, seen slightly
  // from below.
  { match: "ostricheyes", rotation: [(18 * Math.PI) / 180, (208 * Math.PI) / 180, (-16 * Math.PI) / 180] },
  // Exported lying on its side. +90 on X puts the curved hand band on top and the bristle
  // face underneath, the way the scrubber is held and used.
  { match: "scruffy", rotation: [D90, 0, 0] },
];

// Per-model material tweaks. GO Transit's long, part-cylindrical body and flat base panel catch
// a visible diagonal reflection of the environment's studio light panel that other models' shapes
// don't — rougher + less environment reflection kills the streak without changing the standard
// clay look everywhere else (OstrichEyes and the others already read correctly, unchanged).
const MODEL_MATERIAL_OVERRIDES = [{ match: "gotrain", overrides: { roughness: 0.85, envMapIntensity: 0.12 } }];

const CREASE_ANGLE = THREE.MathUtils.degToRad(40);
const MAX_CREASE_TRIANGLES = 150000;

function orientationFor(url) {
  const hit = MODEL_ORIENTATION.find((m) => url.includes(m.match));
  return hit ? hit.rotation : [0, 0, 0];
}

function materialOverridesFor(url) {
  const hit = MODEL_MATERIAL_OVERRIDES.find((m) => url.includes(m.match));
  return hit ? hit.overrides : {};
}

// Camera distance at which a box of `size` (centered on the origin) fills `fill` of the frame.
// The old rule (largest dimension x 1.6) ignored the frame's shape and the viewing angle, so
// most models sat small with a lot of dead space around them, worst on the narrow mobile viewer.
// Auto-rotate orbits the camera around the vertical axis, so every corner is checked across a
// full turn at the camera's fixed elevation: the model is as large as it can be without
// clipping the frame at any point in the spin.
function fitDistance(size, camera, dir, fill = 0.84) {
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const tanH = tanV * camera.aspect;
  const elevation = Math.asin(dir.y);
  const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3(), right = new THREE.Vector3(), camUp = new THREE.Vector3(), c = new THREE.Vector3();
  let dist = 0;
  for (let step = 0; step < 36; step++) {
    const az = (step / 36) * Math.PI * 2;
    n.set(Math.cos(elevation) * Math.sin(az), Math.sin(elevation), Math.cos(elevation) * Math.cos(az)); // target -> camera
    right.crossVectors(up, n).normalize();
    camUp.crossVectors(n, right);
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz);
      const toward = c.dot(n); // how far this corner sits in front of the orbit center
      dist = Math.max(dist, toward + Math.abs(c.dot(right)) / (fill * tanH), toward + Math.abs(c.dot(camUp)) / (fill * tanV));
    }
  }
  return dist || 1;
}

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

function mountViewer(container) {
  const modelUrl = container.getAttribute("data-model");
  if (!modelUrl) return;

  const loadingEl = document.createElement("div");
  loadingEl.className = "viewer-loading";
  loadingEl.textContent = "Loading model…";
  container.appendChild(loadingEl);

  const hintEl = document.createElement("div");
  hintEl.className = "viewer-hint";
  hintEl.textContent = "Drag to rotate";
  container.appendChild(hintEl);

  const width = container.clientWidth;
  const height = container.clientHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  // Environment provides gentle fill (kept subtle via envMapIntensity on the material);
  // a dominant directional key light does the actual shaping so the form reads with contrast
  // rather than washing out to a flat, even white.
  scene.environment = getEnvTexture(renderer);

  const hemi = new THREE.HemisphereLight(0xfff6ea, 0x3a3530, 0.35);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(4, 6, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe9d6, 0.5);
  fill.position.set(-5, 2, -3);
  scene.add(fill);

  // Don't trap page scroll. Without this, a plain mouse wheel over the viewer zoomed the model
  // instead of scrolling the page (the viewer fills most of the first screen, so scrolling down
  // a project page stalled there). Registered before OrbitControls so it runs first: wheel
  // only reaches the controls when Ctrl/Cmd is held (which is also how trackpad pinch arrives).
  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) e.stopImmediatePropagation();
    },
    { capture: true, passive: true }
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  // Same on touch: OrbitControls sets touch-action:none, which swallowed vertical swipes over a
  // viewer that is now full-width on phones. pan-y hands vertical swipes back to the page and
  // leaves horizontal drags for rotating the model.
  renderer.domElement.style.touchAction = "pan-y";
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = true;
  // Continuous auto-rotation is a real vestibular-motion trigger for users who've asked
  // the OS to reduce motion — respect that and just let them drag to look around instead.
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotate = !prefersReducedMotion;
  controls.autoRotateSpeed = 0.8;
  controls.addEventListener("start", () => (controls.autoRotate = false));

  let frameId;
  function animate() {
    frameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  gltfLoader.load(
    modelUrl,
    (gltf) => {
      const model = gltf.scene;
      const materialOverrides = materialOverridesFor(modelUrl);
      model.traverse((node) => {
        if (node.isMesh) {
          if (node.geometry) {
            // Shade by crease angle. Fully smooth normals (weld everything, average across every
            // join) smeared light and dark across what are really sharp corners, which read as
            // fragmentation on the boxy, CAD-derived models (worst on SCRUFFY and GO Transit).
            // Fully flat normals facet every curve. Instead: keep only positions (the clay
            // material needs nothing else), weld so touching faces share vertices, then average
            // normals only between faces that meet at less than CREASE_ANGLE. Curved surfaces
            // stay smooth and real edges stay crisp. No vertex is moved: the geometry is the
            // source geometry, only its shading changes.
            //
            // Very dense meshes skip this. The weld and crease pass runs on the page's main
            // thread and its cost grows with triangle count: the OSF cart (about 725,000
            // triangles) froze the page for 15 seconds. A mesh that dense already has facets
            // too small to see, so it keeps the normals it shipped with.
            const src = node.geometry;
            const triangles = (src.index ? src.index.count : src.attributes.position.count) / 3;
            if (triangles > MAX_CREASE_TRIANGLES) {
              if (!src.attributes.normal) src.computeVertexNormals();
            } else {
              const g = new THREE.BufferGeometry();
              g.setAttribute("position", src.attributes.position);
              if (src.index) g.setIndex(src.index);
              node.geometry = toCreasedNormals(mergeVertices(g), CREASE_ANGLE);
            }

          }
          node.material = CLAY_MATERIAL(materialOverrides);
          node.castShadow = false;
          node.receiveShadow = false;
        }
      });

      // Apply the model's default orientation BEFORE measuring, so centering/framing uses the
      // corrected pose.
      const [rx, ry, rz] = orientationFor(modelUrl);
      model.rotation.set(rx, ry, rz);

      // Center + frame the model. `precise` measures the real vertices under the rotation above,
      // not the rotated corners of the unrotated box, which overstates tilted models.
      const box = new THREE.Box3().setFromObject(model, true);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dir = new THREE.Vector3(0.9, 0.6, 1.1).normalize();
      const dist = fitDistance(size, camera, dir);
      camera.position.copy(dir.clone().multiplyScalar(dist));
      camera.near = Math.max(maxDim / 100, 0.001);
      camera.far = maxDim * 50;
      camera.updateProjectionMatrix();

      // Orbit limits scale with the model's own size — fixed absolute values here
      // previously clamped the camera to the wrong distance for models outside a narrow size range.
      controls.minDistance = dist * 0.25;
      controls.maxDistance = dist * 4;
      controls.target.set(0, 0, 0);
      controls.update();

      scene.add(model);
      loadingEl.remove();
      animate();

      // The lazy-mount observer above unobserves itself once a viewer loads — it only ever
      // needed to fire once. But without a second observer, the render loop it started keeps
      // calling requestAnimationFrame forever, even after the visitor scrolls a viewer fully
      // off-screen (e.g. reading further down a project page). Pause/resume on visibility
      // instead of just running unconditionally for the rest of the page's life.
      const visibilityObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              if (!frameId) animate();
            } else if (frameId) {
              cancelAnimationFrame(frameId);
              frameId = undefined;
            }
          });
        },
        { rootMargin: "200px" }
      );
      visibilityObserver.observe(container);
    },
    undefined,
    (err) => {
      loadingEl.textContent = "Couldn't load 3D model.";
      console.error("Viewer load error:", modelUrl, err);
    }
  );

  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(container);
}

const mountedViewers = new WeakSet();

function mountOnce(el) {
  if (mountedViewers.has(el)) return;
  mountedViewers.add(el);
  mountViewer(el);
}

function initLazyViewers() {
  const containers = document.querySelectorAll(".viewer-3d[data-model]");
  if (!containers.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          mountOnce(entry.target);
          io.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "200px" }
  );

  containers.forEach((el) => {
    // Mount immediately if already on/near screen on load — don't rely solely on the
    // observer's first callback, which can be delayed past the point a visitor expects content.
    const rect = el.getBoundingClientRect();
    const nearViewport = rect.top < window.innerHeight + 200 && rect.bottom > -200;
    if (nearViewport) {
      mountOnce(el);
    } else {
      io.observe(el);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLazyViewers);
} else {
  initLazyViewers();
}
// Re-scan after partials/dynamic content load, in case viewers are injected later.
document.addEventListener("partials:loaded", initLazyViewers);
