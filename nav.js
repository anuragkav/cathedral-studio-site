// Cathedral Studio — mobile nav toggle, shared across every page.
// Progressive enhancement: style.css only hides .nav-links / shows
// .nav-toggle under ".js-nav", a class this script adds once it runs — so
// with JS absent/blocked, every link stays visible and reachable instead
// of sitting behind a dead button.

document.querySelectorAll(".nav-toggle").forEach(function (toggle) {
  const nav = toggle.closest(".nav");
  const links = nav.querySelector(".nav-links");

  nav.classList.add("js-nav");

  toggle.addEventListener("click", function () {
    const open = nav.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  links.addEventListener("click", function (e) {
    if (e.target.closest("a")) {
      nav.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && nav.classList.contains("nav-open") && nav.contains(document.activeElement)) {
      nav.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    }
  });
});
