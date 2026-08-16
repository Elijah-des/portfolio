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

    document.dispatchEvent(new CustomEvent("partials:loaded"));
  });
})();
