// Homepage hero: pinned Three.js bracelet canvas, rotation/position driven by scroll progress (GSAP ScrollTrigger),
// releasing into the page as the Featured Work grid appears.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

gsap.registerPlugin(ScrollTrigger);

const stageEl = document.getElementById("bracelet-stage");
// The continuous scroll-tied spin is a real vestibular-motion trigger; users who've asked the
// OS to reduce motion still get the roll-down + fade (it's just position and opacity), but not
// the spin itself.
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (stageEl) {
  const width = window.innerWidth;
  const height = window.innerHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
  camera.position.set(0, 0, 4.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  stageEl.appendChild(renderer.domElement);

  // Environment map — a metallic material reflects its surroundings, so without this
  // the gold bracelet renders as a black silhouette. RoomEnvironment gives it something
  // to reflect and does most of the lighting work.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  // Direction lights add warm highlights on top of the environment reflection.
  const key = new THREE.DirectionalLight(0xfff1d8, 2.2);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd9b98a, 1.1);
  rim.position.set(-4, -1, -3);
  scene.add(rim);

  // Real materials for the homepage hero — the documented exception to the site-wide clay rule.
  // bracelet-compressed.glb has baked PBR textures (base color, metallic-roughness, normal) painted
  // directly onto the UVs, so the gold band and blue stones are already differentiated per-pixel —
  // no per-part material assignment needed here, just load the model's own materials as authored.
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);

  let bracelet;
  let model; // the loaded glb, inside the `bracelet` pivot group
  let modelCenter = new THREE.Vector3(); // its bounding-box center in its own file coordinates
  let frameId;
  let unitScale = 1; // 1 / the model's largest dimension, so "scale" below reads in world units
  let aspectRatio = 0.5; // the tilted bracelet's on-screen height / width, measured at load

  // Rest pose. Desktop values are the long-standing hand-tuned ones; mobile is measured.
  let baseX = 0.75;
  let baseY = -0.14;
  let baseScale = 1.15;
  let driftX = 0.4;

  // Match the headline's own CSS breakpoint (720px), not aspect ratio. A squarish-but-wide
  // window (e.g. 886x944, aspect 0.94) still has the full desktop headline layout.
  const isMobile = () => window.innerWidth <= 720;

  // Size of the camera's view at the bracelet's depth (z = 0), in world units.
  function viewSize() {
    const h = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return { w: h * camera.aspect, h };
  }

  let baseZ = 0;
  function layoutBracelet() {
    if (!isMobile()) {
      // Desktop reproduces the original transform exactly: the file's own origin as the pivot,
      // pushed back by the bounding-box center's z. The headline alignment was hand-tuned
      // against this over several rounds, so it must not shift.
      model.position.set(0, 0, 0);
      baseX = 0.75;
      baseY = -0.14;
      baseZ = -modelCenter.z;
      baseScale = 1.15;
      driftX = 0.4;
    } else {
      // Mobile pivots around the bracelet's true center, so the measured gap is filled exactly.
      model.position.copy(modelCenter).negate();
      baseZ = 0;
      // On a phone the camera's horizontal view is narrow, so the desktop size ends up wider
      // than the screen, and the desktop spot sits right on the headline. Instead, measure the
      // gap between the end of the headline and the "Scroll" cue and fit the bracelet into it.
      // Positions are taken "at rest" (page scrolled to top): .hero-sticky is sticky, so its
      // live position shifts while the nav scrolls away. Offsets inside it don't, though.
      const hero = document.querySelector(".hero-home");
      const sticky = document.querySelector(".hero-sticky");
      const heading = document.querySelector(".hero-home .positioning");
      const cue = document.querySelector(".hero-home .scroll-cue");
      const stickyRect = sticky.getBoundingClientRect();
      const stickyTopAtRest = hero.getBoundingClientRect().top + window.scrollY;
      const gapTop = stickyTopAtRest + (heading.getBoundingClientRect().bottom - stickyRect.top) + 24;
      const gapBottom = cue
        ? stickyTopAtRest + (cue.getBoundingClientRect().top - stickyRect.top) - 24
        : window.innerHeight - 24;

      const { w, h } = viewSize();
      const worldPerPx = h / window.innerHeight;
      const gapH = Math.max(gapBottom - gapTop, 60) * worldPerPx;
      // Widest that fits both 78% of the screen width and the measured gap's height.
      baseScale = Math.min(w * 0.78, gapH / aspectRatio);
      baseX = 0;
      baseY = (0.5 - (gapTop + gapBottom) / 2 / window.innerHeight) * h;
      driftX = 0; // the desktop drift would push it off the edge of a narrow screen
    }
    bracelet.scale.setScalar(baseScale * unitScale);
    applyScroll(lastProgress);
  }

  // The sticky nav's real height (it wraps to two lines on phones), exposed as --nav-h so the
  // mobile hero can pin its headline just below the nav instead of sliding underneath it.
  function syncNavHeight() {
    const nav = document.querySelector(".site-nav");
    if (nav) document.documentElement.style.setProperty("--nav-h", nav.offsetHeight + "px");
  }
  syncNavHeight();
  document.addEventListener("partials:loaded", () => {
    syncNavHeight();
    if (bracelet) layoutBracelet(); // hero position depends on the nav, re-measure once it exists
  });

  // Scroll-driven pose. Kept separate so a resize (e.g. a phone's URL bar collapsing
  // mid-scroll) re-applies the current progress instead of snapping back to the rest pose.
  const cueEl = document.querySelector(".hero-home .scroll-cue");
  let lastProgress = 0;
  function applyScroll(p) {
    lastProgress = p;
    // On phones the bracelet rolls down through the "Scroll" cue, so fade the cue out as soon
    // as scrolling starts; by then it has done its job.
    if (cueEl) cueEl.style.opacity = isMobile() ? String(Math.max(0, 1 - p * 8)) : "";
    if (!prefersReducedMotion) {
      bracelet.rotation.y = p * Math.PI * 5;
      bracelet.rotation.z = p * Math.PI * 0.6;
    }
    bracelet.position.y = baseY - p * 1.7; // rolls down the page as you scroll (halved travel distance per site owner request)
    bracelet.position.x = baseX - p * driftX; // drifts gently toward center on the way down (desktop only)
    bracelet.position.z = baseZ;
    const fadeStart = 0.55;
    stageEl.style.opacity = p < fadeStart ? 1 : Math.max(0, 1 - (p - fadeStart) / (1 - fadeStart));
  }

  function animate() {
    frameId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }

  loader.load(
    "assets/homepage/bracelet-compressed.glb",
    (gltf) => {
      model = gltf.scene;
      model.traverse((node) => {
        if (node.isMesh) {
          if (node.geometry && !node.geometry.attributes.normal) node.geometry.computeVertexNormals();
          // Materials come straight from the glb's own baked textures — real gold/blue-gem
          // differentiation lives in the painted maps, not in code.
          if (node.material) node.material.envMapIntensity = 1.0;
        }
      });

      // Wrap the model in a pivot group; layoutBracelet() decides whether it pivots around the
      // file's origin (desktop, unchanged) or the bracelet's true center (mobile).
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      box.getCenter(modelCenter);
      model.position.copy(modelCenter).negate(); // centered, for the measurement below
      bracelet = new THREE.Group();
      bracelet.add(model);
      unitScale = 1 / (Math.max(size.x, size.y, size.z) || 1);
      bracelet.rotation.x = 0.35;

      // Measure how tall the tilted ring reads on screen relative to its width, for fitting it
      // into the mobile gap. Done at unit scale before it's placed.
      bracelet.scale.setScalar(unitScale);
      bracelet.updateMatrixWorld(true);
      const tilted = new THREE.Box3().setFromObject(bracelet, true).getSize(new THREE.Vector3());
      aspectRatio = tilted.y / (tilted.x || 1);

      layoutBracelet();
      scene.add(bracelet);
      animate();

      ScrollTrigger.create({
        trigger: ".hero-home",
        start: "top top",
        end: "bottom top",
        scrub: 1.2,
        onUpdate: (self) => applyScroll(self.progress),
        onLeave: () => {
          if (frameId) cancelAnimationFrame(frameId);
          frameId = undefined;
        },
        // Restart rendering when scrolling back up into the hero. Without this the render loop
        // stayed stopped after onLeave, so the bracelet froze at its last scrolled-away frame.
        onEnterBack: () => {
          if (!frameId) animate();
        },
      });
    },
    undefined,
    (err) => console.error("Bracelet load error:", err)
  );

  window.addEventListener("resize", () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    syncNavHeight();
    if (bracelet) layoutBracelet();
    if (bracelet && ScrollTrigger) ScrollTrigger.refresh();
  });
}

// Simple entrance fades for sections below the hero.
// Fail-safe by design: content is only ever hidden if the animation is set up AND
// reduced-motion is off, and a safety net guarantees nothing stays permanently invisible.
document.addEventListener("partials:loaded", () => {
  const reveals = gsap.utils.toArray("[data-reveal]");
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReduced) {
    // Never hide content for reduced-motion users.
    gsap.set(reveals, { opacity: 1, y: 0 });
  } else {
    reveals.forEach((el) => {
      gsap.fromTo(
        el,
        { opacity: 0, y: 28 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 92%", once: true },
        }
      );
    });
  }

  // Images (and the hero's 220vh runway) load/resize after ScrollTrigger's first pass,
  // which can leave trigger positions stale — refresh once everything has settled.
  window.addEventListener("load", () => ScrollTrigger.refresh());
  setTimeout(() => ScrollTrigger.refresh(), 600);

  // Safety net: if anything ever leaves a reveal element invisible while it's actually
  // on screen (throttled ticker, missed trigger, etc.), force it visible. A hidden
  // portfolio section is never acceptable; the entrance animation is only polish.
  // Self-terminates once every reveal has been shown at least once.
  const shown = new Set();
  const safety = setInterval(() => {
    reveals.forEach((el) => {
      const r = el.getBoundingClientRect();
      const inView = r.top < window.innerHeight && r.bottom > 0;
      if (parseFloat(getComputedStyle(el).opacity) > 0.9) shown.add(el);
      else if (inView) gsap.set(el, { opacity: 1, y: 0 });
    });
    if (shown.size === reveals.length) clearInterval(safety);
  }, 1200);
});
