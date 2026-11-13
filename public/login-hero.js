/* Login hero: a looping demo of what BrandSentinel does — scan, flag, cite, suggest, approve. */
(function () {
  const h = document.createElement("aside");
  h.className = "hero-demo"; h.setAttribute("aria-hidden", "true");
  h.innerHTML = `
    <div class="hd-eyebrow"><span class="live"></span>PRE-PUBLICATION REVIEW</div>
    <h2>Every post, checked against your brand before it goes live.</h2>
    <div class="hd-card">
      <div class="hd-bar"><i></i><i></i><i></i><span>reel-caption.txt</span><em class="hd-scan">scanning…</em></div>
      <p class="hd-text">Spectrum Fest is back on <mark class="m1">15 March</mark> at the <mark class="m2">Main Auditorium</mark>. <mark class="m3">Guaranteed best fest ever!</mark></p>
      <div class="hd-beam"></div>
      <div class="hd-find f1"><b class="sev high">HIGH</b><div><strong>Contradicts approved fact</strong><small>Event fact sheet says 14 March</small></div></div>
      <div class="hd-find f2"><b class="sev ok">PASS</b><div><strong>Venue matches brand kit</strong><small>Checklist · Venue</small></div></div>
      <div class="hd-find f3"><b class="sev med">MED</b><div><strong>Unsupported superlative</strong><small>Claims policy §2 · no source</small></div></div>
      <div class="hd-fix"><small>SUGGESTED FIX · human decides</small>Spectrum Fest is back on <u>14 March</u> at the Main Auditorium.</div>
    </div>
    <div class="hd-stats"><div><b data-n="98">0</b><span>% of ads need edits (ASCI)</span></div><div><b data-n="42">0</b><span>% learn it's off-brand after publishing</span></div><div><b data-n="3">0</b><span>human approvals, full audit trail</span></div></div>`;
  document.body.append(h);
  const css = document.createElement("style");
  css.textContent = `
  .hero-demo{display:none;position:fixed;left:clamp(32px,5vw,90px);top:50%;transform:translateY(-50%);width:min(450px,34vw);z-index:1;color:#e8ecf8}
  @media(min-width:1180px){body{padding-left:min(520px,38vw)}.hero-demo{display:block}}
  .hd-eyebrow{font:500 11px/1 var(--mono);letter-spacing:.14em;color:#9aa6c6;display:flex;gap:9px;align-items:center}
  .live{width:7px;height:7px;border-radius:50%;background:#34d399;box-shadow:0 0 10px #34d399;animation:lv 1.6s infinite}@keyframes lv{50%{opacity:.35}}
  .hero-demo h2{font:600 30px/1.15 var(--serif);letter-spacing:-.025em;margin:14px 0 22px;color:#f4f6ff}
  .hd-card{position:relative;border:1px solid #2b3350;border-radius:14px;background:rgba(14,18,30,.78);backdrop-filter:blur(10px);padding:0 0 14px;overflow:hidden;box-shadow:0 30px 60px -30px #000}
  .hd-bar{display:flex;gap:6px;align-items:center;padding:10px 14px;border-bottom:1px solid #232a43;font:12px var(--mono);color:#8e9ab8}
  .hd-bar i{width:9px;height:9px;border-radius:50%;background:#2b3350}.hd-bar span{margin-left:8px}.hd-bar em{margin-left:auto;font-style:normal;color:#8ba7ff}
  .hd-text{padding:16px 16px 6px;font-size:15px;line-height:1.7;margin:0}
  .hd-text mark{background:transparent;color:inherit;border-radius:3px;padding:0 2px;transition:background .3s}
  .hd-text mark.on-high{background:rgba(251,113,133,.22);box-shadow:0 2px 0 #fb7185}
  .hd-text mark.on-ok{background:rgba(52,211,153,.18);box-shadow:0 2px 0 #34d399}
  .hd-text mark.on-med{background:rgba(251,191,36,.2);box-shadow:0 2px 0 #fbbf24}
  .hd-beam{position:absolute;left:0;right:0;top:44px;height:2px;background:linear-gradient(90deg,transparent,#8ba7ff,transparent);box-shadow:0 0 18px #8ba7ff;opacity:0}
  .hd-find{display:flex;gap:11px;align-items:center;margin:8px 14px 0;padding:9px 11px;border:1px solid #2b3350;border-radius:10px;background:rgba(255,255,255,.03);opacity:0}
  .hd-find strong{display:block;font-size:13px}.hd-find small{color:#8e9ab8;font-size:11.5px}
  .sev{font:600 10px var(--mono);padding:3px 7px;border-radius:5px;letter-spacing:.06em}
  .sev.high{background:rgba(251,113,133,.16);color:#fb7185}.sev.ok{background:rgba(52,211,153,.16);color:#34d399}.sev.med{background:rgba(251,191,36,.16);color:#fbbf24}
  .hd-fix{margin:10px 14px 0;padding:10px 12px;border-left:2px solid #34d399;background:rgba(52,211,153,.08);border-radius:0 8px 8px 0;font-size:13px;opacity:0}
  .hd-fix small{display:block;font:500 10px var(--mono);letter-spacing:.1em;color:#34d399;margin-bottom:3px}.hd-fix u{text-decoration-color:#34d399}
  .hd-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:22px}
  .hd-stats b{font:600 28px var(--serif);color:#f4f6ff}.hd-stats span{display:block;font-size:11.5px;color:#8e9ab8;line-height:1.35;margin-top:2px}`;
  document.head.append(css);

  if (!window.gsap) return;
  const q = s => h.querySelector(s), qa = s => h.querySelectorAll(s);
  const count = () => qa(".hd-stats b").forEach(b => { const o = { v: 0 }; gsap.to(o, { v: +b.dataset.n, duration: 1.6, ease: "power2.out", onUpdate: () => b.textContent = Math.round(o.v) }); });
  gsap.from(h.children, { y: 26, opacity: 0, duration: .8, stagger: .12, ease: "power3.out", delay: .3 });
  count();
  const reset = () => { qa("mark").forEach((m, i) => m.className = "m" + (i + 1)); gsap.set(".hd-find,.hd-fix", { opacity: 0, y: 10 }); gsap.set(".hd-beam", { opacity: 0, top: 44 }); q(".hd-scan").textContent = "scanning…"; };
  const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.6, delay: 1.2, onRepeat: reset });
  reset();
  const flag = (sel, cls, f, at) => { tl.call(() => q(sel).classList.add(cls), null, at); tl.to(f, { opacity: 1, y: 0, duration: .45, ease: "back.out(1.6)" }, at + .1); };
  tl.to(".hd-beam", { opacity: 1, duration: .2 }, 0).to(".hd-beam", { top: 120, duration: 2.6, ease: "none" }, 0);
  flag(".m1", "on-high", ".f1", .7); flag(".m2", "on-ok", ".f2", 1.5); flag(".m3", "on-med", ".f3", 2.2);
  tl.to(".hd-beam", { opacity: 0, duration: .3 }, 2.7).call(() => q(".hd-scan").textContent = "3 findings", null, 2.8)
    .to(".hd-fix", { opacity: 1, y: 0, duration: .5 }, 3.2).to({}, { duration: 3 });
})();
