// Site-wide 3D Viewer component.
// Mounts on any element matching `.viewer-3d[data-model]`, lazy-loaded via IntersectionObserver.
// Neutral clay material on every mesh, Draco-compressed glb loading, drag-to-rotate via OrbitControls.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

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
  // Iteration 6's Y-only spin (matched via left/right area-ratio heuristic) still wasn't right —
  // that heuristic couldn't see vertical positioning, just left/right mass balance. Iteration 7
  // added a real reference screenshot showing the target angle, so this was matched by rendering
  // the model at a grid of Y/X rotations from the viewer's actual default camera, downsampling
  // each to a coarse luminance grid, and picking the one with the highest normalized cross-
  // correlation against the same downsample of the reference image — a slight forward tilt (X)
  // combined with a small Y spin, not a pure Y spin.
  { match: "ostricheyes", rotation: [(-13 * Math.PI) / 180, (183 * Math.PI) / 180, 0] },
];

// Per-model material tweaks. GO Transit's long, part-cylindrical body and flat base panel catch
// a visible diagonal reflection of the environment's studio light panel that other models' shapes
// don't — rougher + less environment reflection kills the streak without changing the standard
// clay look everywhere else (OstrichEyes and the others already read correctly, unchanged).
const MODEL_MATERIAL_OVERRIDES = [{ match: "gotrain", overrides: { roughness: 0.85, envMapIntensity: 0.12 } }];

function orientationFor(url) {
  const hit = MODEL_ORIENTATION.find((m) => url.includes(m.match));
  return hit ? hit.rotation : [0, 0, 0];
}

function materialOverridesFor(url) {
  const hit = MODEL_MATERIAL_OVERRIDES.find((m) => url.includes(m.match));
  return hit ? hit.overrides : {};
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

  const controls = new OrbitControls(camera, renderer.domElement);
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
            // Meshes sourced from STL (raw CAD/print exports, e.g. GO Transit and SCRUFFY)
            // triangulate every face with its own private vertices — even where two faces
            // touch, they don't share a vertex index, just coordinates. That leaves every
            // face join a hard, faceted edge no matter what normals get computed, reading
            // as "fragmentation" in the render. Weld coincident vertices first so touching
            // faces actually share indices, then compute normals across the welded mesh —
            // this is the standard fix for faceted STL-derived geometry (not the custom
            // Laplacian smoothing pass from an earlier iteration, which made things worse
            // and was reverted; this is a different, well-established technique).
            node.geometry = mergeVertices(node.geometry);
            node.geometry.computeVertexNormals();
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

      // Center + frame the model (Box3.setFromObject includes the rotation above).
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const fitDist = maxDim / (2 * Math.tan((Math.PI * camera.fov) / 360));
      const dist = fitDist * 1.6; // padding so the model doesn't touch the frame edges
      const dir = new THREE.Vector3(0.9, 0.6, 1.1).normalize();
      camera.position.copy(dir.multiplyScalar(dist));
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
