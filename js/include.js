// Lightweight partial-include system — no build step, no framework.
// Usage: <div data-include="nav"></div> on a page whose <body data-root="./"> or data-root="../"
// sets how deep the page sits relative to site root.
(function () {
  const root = document.body.getAttribute("data-root") || "./";
  const page = document.body.getAttribute("data-page") || "";

  async function inject(el) {
    const name = el.getAttribute("data-include");
    const res = await fetch(root + "partials/" + name + ".html");
    let html = await res.text();
    html = html.split("{{root}}").join(root);
    el.outerHTML = html;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const targets = Array.from(document.querySelectorAll("[data-include]"));
    await Promise.all(targets.map(inject));

    // Mark current nav link
    if (page) {
      const link = document.querySelector(`.site-nav [data-nav="${page}"]`);
      if (link) link.classList.add("current");
    }
    const yearEl = document.getElementById("footer-year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Case-study pages: build a row of jump links from the page's own h2 headings,
    // so a new section (or a new project page) gets its link without any extra markup.
    const header = document.querySelector(".project-header .wrap");
    if (header) {
      const heads = Array.from(document.querySelectorAll("section:not(.project-header) .wrap > h2"));
      if (heads.length > 1) {
        const nav = document.createElement("nav");
        nav.className = "jump-links";
        nav.setAttribute("aria-label", "On this page");
        heads.forEach((h) => {
          const label = h.textContent.split(":")[0].trim();
          if (!h.id) h.id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const a = document.createElement("a");
          a.href = "#" + h.id;
          a.textContent = label;
          nav.appendChild(a);
        });
        header.appendChild(nav);
      }
    }

    document.dispatchEvent(new CustomEvent("partials:loaded"));
  });
})();
