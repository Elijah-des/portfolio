// More Work shelf lightbox + carousel.
// Any element with `data-gallery` (a JSON array of {src, caption}) becomes clickable and
// opens a lightbox that cycles through its images. Keyboard: ← → to navigate, Esc to close.
(function () {
  let overlay, stageImg, stageVideo, captionEl, counterEl, prevBtn, nextBtn;
  let current = [];
  let index = 0;
  let lastFocused = null;

  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.className = "lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="lightbox-inner">
        <button class="lb-close" aria-label="Close">✕</button>
        <div class="lightbox-stage">
          <button class="lb-btn lb-prev" aria-label="Previous">‹</button>
          <img alt="" />
          <video controls></video>
          <button class="lb-btn lb-next" aria-label="Next">›</button>
        </div>
        <div class="lightbox-counter"></div>
        <div class="lightbox-caption"></div>
      </div>`;
    document.body.appendChild(overlay);

    stageImg = overlay.querySelector("img");
    stageVideo = overlay.querySelector("video");
    captionEl = overlay.querySelector(".lightbox-caption");
    counterEl = overlay.querySelector(".lightbox-counter");
    prevBtn = overlay.querySelector(".lb-prev");
    nextBtn = overlay.querySelector(".lb-next");

    overlay.querySelector(".lb-close").addEventListener("click", close);
    prevBtn.addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
    nextBtn.addEventListener("click", (e) => { e.stopPropagation(); step(1); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", (e) => {
      if (!overlay.classList.contains("open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    });
  }

  function render() {
    const item = current[index];
    const isVideo = item.type === "video";
    stageVideo.pause();
    if (isVideo) {
      stageImg.style.display = "none";
      stageImg.src = "";
      stageVideo.style.display = "";
      stageVideo.src = item.src;
    } else {
      stageVideo.style.display = "none";
      stageVideo.src = "";
      stageImg.style.display = "";
      stageImg.src = item.src;
      stageImg.alt = item.caption || "";
    }
    captionEl.innerHTML = item.caption ? `<span class="lb-title">${item.caption}</span>` : "";
    const multi = current.length > 1;
    counterEl.textContent = multi ? `${index + 1} / ${current.length}` : "";
    prevBtn.style.display = multi ? "" : "none";
    nextBtn.style.display = multi ? "" : "none";
  }

  function step(dir) {
    index = (index + dir + current.length) % current.length;
    render();
  }

  function open(gallery, startIndex) {
    current = gallery;
    index = startIndex || 0;
    lastFocused = document.activeElement;
    render();
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    overlay.querySelector(".lb-close").focus();
  }

  function close() {
    overlay.classList.remove("open");
    document.body.style.overflow = "";
    stageImg.src = "";
    stageVideo.pause();
    stageVideo.src = "";
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function wireCards() {
    document.querySelectorAll("[data-gallery]").forEach((card) => {
      if (card.__wired) return;
      let gallery;
      try { gallery = JSON.parse(card.getAttribute("data-gallery")); }
      catch (e) { console.error("Bad data-gallery on", card, e); return; }
      if (!Array.isArray(gallery) || !gallery.length) return;

      card.__wired = true;
      card.classList.add("is-interactive");
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      const title = card.querySelector("h3")?.textContent?.trim() || "gallery";
      card.setAttribute("aria-label", `View ${title} (${gallery.length} image${gallery.length > 1 ? "s" : ""})`);

      // Show a count badge on multi-image galleries.
      if (gallery.length > 1) {
        const heading = card.querySelector("h3");
        if (heading && !heading.querySelector(".count-badge")) {
          const badge = document.createElement("span");
          badge.className = "count-badge";
          badge.textContent = `${gallery.length} ›`;
          heading.appendChild(badge);
        }
      }

      card.addEventListener("click", () => open(gallery, 0));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(gallery, 0); }
      });
    });
  }

  // Arrow-button navigation for .shelf-wrap > .shelf-scroll rows (replaces the native
  // horizontal scrollbar, which is hidden in CSS). Handles multiple shelves on a page,
  // though currently only the Work page's "More work" row uses this.
  function wireArrows() {
    document.querySelectorAll(".shelf-wrap").forEach((wrap) => {
      if (wrap.__arrowsWired) return;
      const scroller = wrap.querySelector(".shelf-scroll");
      const prev = wrap.querySelector(".shelf-arrow-prev");
      const next = wrap.querySelector(".shelf-arrow-next");
      if (!scroller || !prev || !next) return;
      wrap.__arrowsWired = true;

      const updateDisabled = () => {
        const max = scroller.scrollWidth - scroller.clientWidth;
        // Slack absorbs subpixel rounding and scroll-snap settling slightly off 0 on
        // load (observed ~4px), so neither button gets stuck enabled/disabled a few
        // pixels short of an edge it's functionally already at.
        const slack = 8;
        prev.disabled = scroller.scrollLeft <= slack;
        next.disabled = max <= slack || scroller.scrollLeft >= max - slack;
      };

      // Scroll by ~80% of the visible width per click — enough to feel like real
      // progress without fully losing the card that was at the trailing edge, so it's
      // easy to keep your place scanning across the row.
      prev.addEventListener("click", () => {
        scroller.scrollBy({ left: -scroller.clientWidth * 0.8, behavior: "smooth" });
      });
      next.addEventListener("click", () => {
        scroller.scrollBy({ left: scroller.clientWidth * 0.8, behavior: "smooth" });
      });

      // Reading scrollWidth/clientWidth/scrollLeft and flipping two booleans is cheap
      // enough to run on every scroll event directly — no rAF-throttling needed (and
      // rAF callbacks don't fire at all while the tab isn't visible/composited, which
      // would otherwise leave the buttons stuck in a stale state in that case).
      scroller.addEventListener("scroll", updateDisabled, { passive: true });
      window.addEventListener("resize", updateDisabled);
      updateDisabled();
    });
  }

  function init() {
    if (!overlay) buildOverlay();
    wireCards();
    wireArrows();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  document.addEventListener("partials:loaded", init);
})();
