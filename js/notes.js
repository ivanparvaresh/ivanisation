(() => {
  const PAGE_SIZE = 10;
  const listEl = document.getElementById("notes-list");
  const pagerEl = document.getElementById("notes-pager");
  const statusEl = document.getElementById("notes-status");
  const articles = Array.isArray(window.SITE_ARTICLES)
    ? [...window.SITE_ARTICLES]
    : [];

  if (!listEl) return;

  articles.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const total = articles.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageFromUrl = () => {
    const raw = new URLSearchParams(window.location.search).get("page");
    const n = Number.parseInt(raw || "1", 10);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, totalPages);
  };

  const pageHref = (page) => {
    if (page <= 1) return "notes.html";
    return `notes.html?page=${page}`;
  };

  const formatDate = (iso) => {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const renderList = (items) => {
    listEl.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "notes-empty";
      empty.textContent = "No notes yet.";
      listEl.appendChild(empty);
      return;
    }

    for (const item of items) {
      const li = document.createElement("li");
      li.className = "notes-item";

      const link = document.createElement("a");
      link.className = "notes-link";
      link.href = item.href;

      const title = document.createElement("h2");
      title.className = "notes-title";
      title.textContent = item.title;
      link.appendChild(title);

      if (item.deck) {
        const deck = document.createElement("p");
        deck.className = "notes-deck";
        deck.textContent = item.deck;
        link.appendChild(deck);
      }

      const meta = document.createElement("p");
      meta.className = "notes-meta";
      const time = document.createElement("time");
      time.dateTime = item.date;
      time.textContent = formatDate(item.date);
      meta.appendChild(time);
      link.appendChild(meta);

      li.appendChild(link);
      listEl.appendChild(li);
    }
  };

  const renderPager = (page) => {
    if (!pagerEl) return;
    pagerEl.replaceChildren();
    pagerEl.hidden = totalPages <= 1;
    if (totalPages <= 1) return;

    const nav = document.createElement("nav");
    nav.className = "notes-pager-nav";
    nav.setAttribute("aria-label", "Notes pages");

    const prev = document.createElement("a");
    prev.className = "notes-page-btn";
    prev.textContent = "Newer";
    if (page <= 1) {
      prev.setAttribute("aria-disabled", "true");
      prev.tabIndex = -1;
    } else {
      prev.href = pageHref(page - 1);
    }

    const label = document.createElement("span");
    label.className = "notes-page-label";
    label.textContent = `Page ${page} of ${totalPages}`;

    const next = document.createElement("a");
    next.className = "notes-page-btn";
    next.textContent = "Older";
    if (page >= totalPages) {
      next.setAttribute("aria-disabled", "true");
      next.tabIndex = -1;
    } else {
      next.href = pageHref(page + 1);
    }

    nav.append(prev, label, next);
    pagerEl.appendChild(nav);
  };

  const render = (page) => {
    const start = (page - 1) * PAGE_SIZE;
    const slice = articles.slice(start, start + PAGE_SIZE);

    renderList(slice);
    renderPager(page);

    if (!statusEl) return;
    if (!total) {
      statusEl.textContent = "";
    } else if (totalPages === 1) {
      statusEl.textContent = total === 1 ? "1 note" : `${total} notes`;
    } else {
      const from = start + 1;
      const to = Math.min(start + PAGE_SIZE, total);
      statusEl.textContent = `Showing ${from}–${to} of ${total}`;
    }
  };

  render(pageFromUrl());

  window.addEventListener("popstate", () => {
    render(pageFromUrl());
  });

  if (pagerEl) {
    pagerEl.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link || link.getAttribute("aria-disabled") === "true") return;
      event.preventDefault();
      const url = new URL(link.href, window.location.href);
      const nextPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
      const page =
        Number.isFinite(nextPage) && nextPage > 0
          ? Math.min(nextPage, totalPages)
          : 1;
      history.pushState(null, "", pageHref(page));
      render(page);
      listEl.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
})();
