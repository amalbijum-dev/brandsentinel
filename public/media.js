"use strict";
// Browser-side media analysis: video keyframes at scene changes and dominant colours via k-means.
// Done in the browser so no ffmpeg or image library is needed on the server.

function waitFor(target, eventName, ms = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { target.removeEventListener(eventName, ok); resolve(); }, ms);
    const ok = () => { clearTimeout(timer); resolve(); };
    target.addEventListener(eventName, ok, { once: true });
    target.addEventListener("error", () => { clearTimeout(timer); reject(new Error("This video format cannot be read by your browser. Try MP4 (H.264) or WebM.")); }, { once: true });
  });
}

function pixelsFrom(source, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function pushSamples(list, data) {
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) list.push([data[i], data[i + 1], data[i + 2]]);
}

/** k-means (k=5) over RGB samples. Returns [{hex, share}] sorted by share. */
function dominantColors(samples, k = 5) {
  if (samples.length < k) return [];
  const centers = [samples[Math.floor(Math.random() * samples.length)].slice()];
  while (centers.length < k) {
    const d2 = samples.map(p => Math.min(...centers.map(c => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2)));
    const total = d2.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * total, i = 0;
    while (i < d2.length - 1 && (r -= d2[i]) > 0) i++;
    centers.push(samples[i].slice());
  }
  let assign = new Array(samples.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    samples.forEach((p, idx) => {
      let best = 0, bd = Infinity;
      centers.forEach((c, ci) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) { bd = d; best = ci; }
      });
      assign[idx] = best;
      const s = sums[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    });
    sums.forEach((s, i) => { if (s[3]) centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const counts = new Array(k).fill(0);
  assign.forEach(a => counts[a]++);
  const hex = c => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
  return centers
    .map((c, i) => ({ hex: hex(c), share: Math.round((counts[i] / samples.length) * 1000) / 1000 }))
    .filter(c => c.share >= 0.03)
    .sort((a, b) => b.share - a.share);
}

async function colorsFromImages(files) {
  const samples = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const bmp = await createImageBitmap(file);
    pushSamples(samples, pixelsFrom(bmp, 96, Math.max(1, Math.round((96 * bmp.height) / bmp.width))));
    bmp.close?.();
  }
  return dominantColors(samples);
}

/**
 * Samples the video, keeps frames where the picture changes noticeably (scene changes), max 8.
 * Returns { frames: File[], frameTimes: number[], duration, colors }.
 */
async function extractVideo(file, onProgress) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
    await waitFor(video, "loadeddata", 15000);
    const duration = Math.min(video.duration || 0, 180);
    if (!duration) throw new Error("Could not read the video length.");

    const step = Math.max(0.5, duration / 90);
    const kept = [];
    let prev = null;
    const tiny = { w: 48, h: 27 };
    for (let t = 0; t < duration; t += step) {
      video.currentTime = Math.min(t, duration - 0.05);
      await waitFor(video, "seeked");
      const sig = pixelsFrom(video, tiny.w, tiny.h);
      let diff = Infinity;
      if (prev) {
        diff = 0;
        for (let i = 0; i < sig.length; i += 4) diff += Math.abs(sig[i] - prev[i]) + Math.abs(sig[i + 1] - prev[i + 1]) + Math.abs(sig[i + 2] - prev[i + 2]);
        diff /= (sig.length / 4) * 3;
      }
      if (!prev || diff > 22) { kept.push(t); prev = sig; }
      onProgress?.(Math.round((t / duration) * 100));
    }
    // Make sure short or static videos still give a few frames.
    if (kept.length < 3 && duration > 3) {
      for (const f of [0.5, 0.95]) { const t = duration * f; if (!kept.some(k => Math.abs(k - t) < 1)) kept.push(t); }
      kept.sort((a, b) => a - b);
    }
    let picked = kept;
    if (kept.length > 8) picked = Array.from({ length: 8 }, (_, i) => kept[Math.round((i * (kept.length - 1)) / 7)]);

    const frames = [];
    const samples = [];
    const scale = Math.min(1, 960 / (video.videoWidth || 960));
    const W = Math.round((video.videoWidth || 960) * scale), H = Math.round((video.videoHeight || 540) * scale);
    for (const t of picked) {
      video.currentTime = Math.min(t, duration - 0.05);
      await waitFor(video, "seeked");
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      c.getContext("2d").drawImage(video, 0, 0, W, H);
      pushSamples(samples, pixelsFrom(video, 64, 36));
      const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.82));
      frames.push(new File([blob], `frame-${t.toFixed(1)}s.jpg`, { type: "image/jpeg" }));
    }
    return { frames, frameTimes: picked.map(t => Math.round(t * 10) / 10), duration: Math.round(duration), colors: dominantColors(samples) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
