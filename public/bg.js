/* Sentinel network background: drifting nodes linked by faint lines, a slow radar sweep, pointer-reactive. */
(function () {
  const c = document.createElement("canvas");
  c.setAttribute("aria-hidden", "true");
  c.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none";
  document.body.prepend(c);
  const x = c.getContext("2d"), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W, H, N = [], mx = -999, my = -999, t = 0;
  const size = () => { const d = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; c.width = W * d; c.height = H * d; x.setTransform(d, 0, 0, d, 0, 0);
    N = Array.from({ length: Math.round(Math.min(90, W * H / 18000)) }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25, r: Math.random() * 1.4 + .6 })); };
  addEventListener("resize", size); addEventListener("pointermove", e => { mx = e.clientX; my = e.clientY; });
  size();
  function frame() {
    t += .004; x.clearRect(0, 0, W, H);
    // grid
    x.strokeStyle = "rgba(139,167,255,.045)"; x.lineWidth = 1;
    for (let i = 0; i < W; i += 56) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
    for (let j = 0; j < H; j += 56) { x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke(); }
    // radar sweep
    const cx = W * .82, cy = H * .18, R = Math.max(W, H) * .8, a = t * 1.2;
    const g = x.createConicGradient ? x.createConicGradient(a, cx, cy) : null;
    if (g) { g.addColorStop(0, "rgba(110,231,208,.10)"); g.addColorStop(.12, "rgba(110,231,208,0)"); g.addColorStop(1, "rgba(110,231,208,0)"); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill(); }
    x.strokeStyle = "rgba(139,167,255,.07)";
    for (let k = 1; k < 5; k++) { x.beginPath(); x.arc(cx, cy, k * R / 5, 0, 7); x.stroke(); }
    // nodes
    for (const n of N) {
      if (!reduce) { n.x += n.vx; n.y += n.vy; if (n.x < 0 || n.x > W) n.vx *= -1; if (n.y < 0 || n.y > H) n.vy *= -1; }
      const dm = Math.hypot(n.x - mx, n.y - my); if (dm < 140) { n.x += (n.x - mx) * .004; n.y += (n.y - my) * .004; }
    }
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const d = Math.hypot(N[i].x - N[j].x, N[i].y - N[j].y);
      if (d < 150) { x.strokeStyle = `rgba(139,167,255,${.16 * (1 - d / 150)})`; x.beginPath(); x.moveTo(N[i].x, N[i].y); x.lineTo(N[j].x, N[j].y); x.stroke(); }
    }
    for (const n of N) { x.fillStyle = "rgba(160,185,255,.55)"; x.beginPath(); x.arc(n.x, n.y, n.r, 0, 7); x.fill(); }
    if (!reduce) requestAnimationFrame(frame);
  }
  frame();
})();
