(() => {
  const bar = document.querySelector(".site-bar");
  const year = document.getElementById("year");
  const printBtn = document.querySelector("[data-print]");
  const navLinks = [...document.querySelectorAll("[data-nav]")];
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  const onScroll = () => {
    if (!bar) return;
    bar.classList.toggle("is-scrolled", window.scrollY > 12);

    if (!sections.length) return;
    const marker = window.scrollY + window.innerHeight * 0.28;
    let current = sections[0];
    for (const section of sections) {
      if (section.offsetTop <= marker) current = section;
    }
    navLinks.forEach((link) => {
      link.classList.toggle(
        "is-active",
        link.getAttribute("href") === `#${current.id}`
      );
    });
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  if (printBtn) {
    printBtn.addEventListener("click", () => window.print());
  }

  const linkBtn = document.querySelector("[data-share-link]");
  if (linkBtn) {
    const label = linkBtn.textContent;
    let resetTimer;

    linkBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        linkBtn.textContent = "Copied";
      } catch {
        linkBtn.textContent = "Copy failed";
      }
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        linkBtn.textContent = label;
      }, 1800);
    });
  }
})();
