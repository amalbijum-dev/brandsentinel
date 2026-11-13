/* BrandSentinel motion layer (GSAP).
   The app renders views by swapping DOM nodes, so instead of wiring animations into every view
   we watch for new nodes and animate whatever lands. Elements are tagged once so re-renders
   of the same node don't replay. */
(function () {
  "use strict";
  if (!window.gsap) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  const ease = "power3.out";
  const seen = el => { if (el.dataset.mo) return true; el.dataset.mo = "1"; return false; };
  const jitter = () => (Math.random() - 0.5) * 1.6; // tiny tilt so it feels placed by hand
  let sidebarShown = sessionStorage.getItem("bs-side") === "1";

  // ---- headline: words rise out of a mask ----
  function splitHeadline(h1) {
    if (seen(h1) || h1.querySelector(".mo-w")) return;
    const words = h1.textContent.trim().split(/\s+/);
    h1.textContent = "";
    words.forEach((w, i) => {
      const outer = document.createElement("span");
      outer.style.cssText = "display:inline-block;overflow:hidden;vertical-align:bottom;padding-bottom:.08em";
      const inner = document.createElement("span");
      inner.className = "mo-w"; inner.style.display = "inline-block"; inner.textContent = w;
      outer.append(inner);
      h1.append(outer, i < words.length - 1 ? " " : "");
    });
    gsap.from(h1.querySelectorAll(".mo-w"), { yPercent: 110, rotate: 4, duration: .8, ease: "power4.out", stagger: .06 });
  }

  // ---- numbers count up ----
  function countUp(el) {
    if (seen(el)) return;
    const n = parseFloat(el.textContent);
    if (!isFinite(n) || n === 0) return;
    const suffix = el.textContent.replace(/^[\d.,\s]+/, "");
    const o = { v: 0 };
    gsap.to(o, { v: n, duration: 1.1, ease: "power2.out", onUpdate: () => { el.textContent = Math.round(o.v) + suffix; } });
  }

  function animateTree(root) {
    if (!(root instanceof Element)) return;
    const q = sel => [root, ...root.querySelectorAll(sel)].filter(e => e.matches && e.matches(sel) && !e.dataset.mo);

    // sidebar: only on first sign-in of the session, otherwise it would replay on every route
    q(".side").forEach(side => {
      seen(side);
      if (sidebarShown) return;
      sidebarShown = true; sessionStorage.setItem("bs-side", "1");
      const tl = gsap.timeline({ defaults: { ease } });
      tl.from(side, { xPercent: -100, duration: .7 })
        .from(side.querySelector(".logo"), { scale: 0, rotate: -180, duration: .6, ease: "back.out(2)" }, "-=.3")
        .from(side.querySelectorAll(".nav a"), { x: -16, opacity: 0, duration: .4, stagger: .04 }, "-=.35")
        .from(side.querySelector(".userbox"), { opacity: 0, y: 10, duration: .4 }, "-=.2");
    });
    q(".topbar").forEach(t => { seen(t); gsap.from(t, { opacity: 0, y: -8, duration: .5, ease }); });

    q("h1").forEach(splitHeadline);

    const cards = q(".card, .issue, .step, .review-actions, .perks-card, tr.click");
    if (cards.length) {
      cards.forEach(seen);
      gsap.fromTo(cards,
        { opacity: 0, y: 22, rotate: () => jitter() },
        { opacity: 1, y: 0, rotate: 0, duration: .6, ease, stagger: { each: .045, from: "start" }, clearProps: "transform,opacity" });
    }

    // rubber-stamp effect on badges
    const badges = q(".badge, .tag");
    if (badges.length) {
      badges.forEach(seen);
      gsap.from(badges, { scale: 1.9, opacity: 0, duration: .45, ease: "back.out(3)", stagger: .03, delay: .25, clearProps: "scale,opacity" });
    }

    q(".stat b").forEach(countUp);

    q(".bar i").forEach(b => { seen(b); gsap.from(b, { width: 0, duration: 1, ease: "power2.out", delay: .2 }); });
    q(".swatch i").forEach(s => { seen(s); gsap.from(s, { scale: 0, duration: .4, ease: "back.out(2)", delay: Math.random() * .3 }); });
    q("h1").forEach(() => {}); // headline underline handled by CSS

    // toast slides in from the right
    q(".toast").forEach(t => { seen(t); gsap.from(t, { x: 60, opacity: 0, rotate: 3, duration: .5, ease: "back.out(1.6)" }); });

    // in-app auth wrapper
    q(".auth").forEach(a => { seen(a); gsap.from(a, { y: 30, opacity: 0, duration: .7, ease }); });
  }

  // busy overlay pops when shown
  function watchBusy() {
    const busy = document.getElementById("busy");
    if (!busy) return;
    new MutationObserver(() => {
      if (!busy.hidden) gsap.fromTo(busy.querySelector(".busy-box"), { scale: .85, rotate: -3, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: .45, ease: "back.out(2)" });
    }).observe(busy, { attributes: true, attributeFilter: ["hidden"] });
  }

  // a small ring that trails the pointer and swells over clickable things
  function cursor() {
    if (matchMedia("(hover: none)").matches) return;
    const ring = document.createElement("div");
    ring.className = "ink-cursor";
    document.body.append(ring);
    const xTo = gsap.quickTo(ring, "x", { duration: .35, ease: "power3" });
    const yTo = gsap.quickTo(ring, "y", { duration: .35, ease: "power3" });
    let shown = false;
    addEventListener("pointermove", e => {
      if (!shown) { shown = true; gsap.to(ring, { opacity: .8, duration: .3 }); }
      xTo(e.clientX); yTo(e.clientY);
    });
    document.addEventListener("pointerover", e => {
      const hot = e.target.closest("a, button, tr.click, summary, .role-opt, .drop, input, select, textarea");
      gsap.to(ring, { scale: hot ? 1.8 : 1, backgroundColor: hot ? "rgba(255,255,255,.1)" : "rgba(0,0,0,0)", duration: .25 });
    });
    addEventListener("pointerdown", () => gsap.to(ring, { scale: .7, duration: .12, yoyo: true, repeat: 1 }));
    document.addEventListener("pointerleave", () => gsap.to(ring, { opacity: 0, duration: .2 }));
  }

  // primary buttons lean slightly toward the cursor
  function magnetic() {
    document.addEventListener("pointermove", e => {
      const b = e.target.closest && e.target.closest("button.primary, .btn");
      if (!b || b.disabled) return;
      const r = b.getBoundingClientRect();
      gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * .12, y: (e.clientY - r.top - r.height / 2) * .25, duration: .3, ease: "power2.out" });
    });
    document.addEventListener("pointerout", e => {
      const b = e.target.closest && e.target.closest("button.primary, .btn");
      if (b && !b.contains(e.relatedTarget)) gsap.to(b, { x: 0, y: 0, duration: .5, ease: "elastic.out(1, .4)" });
    });
  }

  // standalone pages (login / signup / video check)
  function authPage() {
    const card = document.querySelector("body > main.card");
    if (!card) return;
    seen(card);
    const word = document.createElement("div");
    word.className = "bg-word"; word.setAttribute("aria-hidden", "true"); word.textContent = "on brand.";
    document.body.prepend(word);
    const tl = gsap.timeline({ defaults: { ease } });
    tl.from(word, { xPercent: 12, opacity: 0, duration: 1.4, ease: "power2.out" })
      .from(card, { y: 60, rotate: -4, opacity: 0, duration: .9, ease: "power4.out" }, 0)
      .from(card.querySelector(".brand i"), { scale: 0, rotate: -200, duration: .7, ease: "back.out(2)" }, "-=.5")
      .from([...card.children].filter(c => c.tagName !== "FORM"), { y: 14, opacity: 0, duration: .5, stagger: .06 }, "-=.5")
      .from(card.querySelectorAll("form > *"), { y: 12, opacity: 0, duration: .45, stagger: .035, clearProps: "all" }, "-=.35");
    card.querySelectorAll("h1, .badge, .tag").forEach(seen);

    // role switch: perks list re-reveals
    card.addEventListener("click", e => {
      if (!e.target.closest(".role-opt")) return;
      requestAnimationFrame(() => gsap.from(card.querySelectorAll(".perks-list li, .perks-title"), { x: -10, opacity: 0, duration: .35, stagger: .05, ease }));
    });
    // shake the card on error messages
    const msg = document.getElementById("msg");
    if (msg) new MutationObserver(() => {
      if (msg.classList.contains("err")) gsap.fromTo(card, { x: -8 }, { x: 0, duration: .5, ease: "elastic.out(1.2, .3)" });
    }).observe(msg, { attributes: true, attributeFilter: ["class"] });

    // results added later on the video page
    const out = document.getElementById("out");
    if (out) new MutationObserver(m => m.forEach(r => r.addedNodes.forEach(animateTree))).observe(out, { childList: true, subtree: true });
  }

  function start() {
    authPage();
    const app = document.getElementById("app");
    if (app) {
      animateTree(app);
      new MutationObserver(muts => {
        for (const m of muts) m.addedNodes.forEach(animateTree);
      }).observe(app, { childList: true, subtree: true });
    }
    const toasts = document.getElementById("toasts");
    if (toasts) new MutationObserver(m => m.forEach(r => r.addedNodes.forEach(animateTree))).observe(toasts, { childList: true });
    watchBusy();
    cursor();
    magnetic();
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();

  // sign-out resets the intro so it plays again on next sign-in
  document.addEventListener("click", e => {
    if (e.target.closest(".userbox button")) sessionStorage.removeItem("bs-side");
  });
})();
