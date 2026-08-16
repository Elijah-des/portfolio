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
  let frameId;
  let baseX = 1.3; // rest position: right side of the hero, clear of the left-aligned headline
  const BASE_Y = -0.14; // vertically aligned with the headline block instead of floating near the top

  function computeBaseX() {
    // Match the headline's own CSS breakpoint (720px), not aspect ratio. A squarish-but-wide
    // window (e.g. 886x944, aspect 0.94) used to fail the old aspect > 1.1 check and fall into
    // the "narrow" branch even though the headline is still in its full desktop layout at that
    // width, putting the bracelet right back on top of the text it was supposed to clear.
    return window.innerWidth > 720 ? 0.75 : 0.15;
  }

  function animate() {
    frameId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }

  loader.load(
    "assets/homepage/bracelet-compressed.glb",
    (gltf) => {
      bracelet = gltf.scene;
      bracelet.traverse((node) => {
        if (node.isMesh) {
          if (node.geometry && !node.geometry.attributes.normal) node.geometry.computeVertexNormals();
          // Materials come straight from the glb's own baked textures — real gold/blue-gem
          // differentiation lives in the painted maps, not in code.
          if (node.material) node.material.envMapIntensity = 1.0;
        }
      });

      const box = new THREE.Box3().setFromObject(bracelet);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      bracelet.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = 1.15 / maxDim; // smaller than before so it doesn't dominate / overlap text
      bracelet.scale.setScalar(scale);
      bracelet.rotation.x = 0.35;

      baseX = computeBaseX();
      bracelet.position.x = baseX;
      bracelet.position.y = BASE_Y;

      scene.add(bracelet);
      animate();

      ScrollTrigger.create({
        trigger: ".hero-home",
        start: "top top",
        end: "bottom top",
        scrub: 1.2,
        onUpdate: (self) => {
          const p = self.progress;
          if (!prefersReducedMotion) {
            bracelet.rotation.y = p * Math.PI * 5;
            bracelet.rotation.z = p * Math.PI * 0.6;
          }
          bracelet.position.y = BASE_Y - p * 1.7;   // rolls down the page as you scroll (halved travel distance per site owner request)
          bracelet.position.x = baseX - p * 0.4; // drifts gently toward center on the way down
          const fadeStart = 0.55;
          stageEl.style.opacity = p < fadeStart ? 1 : Math.max(0, 1 - (p - fadeStart) / (1 - fadeStart));
        },
        onLeave: () => {
          if (frameId) cancelAnimationFrame(frameId);
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
    baseX = computeBaseX();
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
