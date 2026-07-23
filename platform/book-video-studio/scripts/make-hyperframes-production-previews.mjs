import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const taskId = process.argv[2] || "MW4GhE1OqNnO";
const duration = Number(process.argv[3] || 12);
const maxSlides = Math.max(2, Number(process.argv[4] || 4));
const root = process.cwd();
const taskDir = path.join(root, "data", "tasks", taskId);
const outDir = path.join(taskDir, "hyperframes_production_previews");
const ffmpeg = process.env.FFMPEG_BIN?.trim() || "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imageSort(a, b) {
  const ax = a.match(/^img_(\d+)_(\d+)\.jpg$/).slice(1).map(Number);
  const bx = b.match(/^img_(\d+)_(\d+)\.jpg$/).slice(1).map(Number);
  return ax[0] - bx[0] || ax[1] - bx[1];
}

function pickImages() {
  const groups = new Map();
  for (const file of fs.readdirSync(taskDir).filter((f) => /^img_\d+_\d+\.jpg$/.test(f)).sort(imageSort)) {
    const group = file.match(/^img_(\d+)_/)[1];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(file);
  }

  const picked = [];
  for (const files of groups.values()) {
    const index = Math.min(files.length - 1, Math.floor(files.length / 2));
    picked.push(files[index]);
    if (picked.length >= maxSlides) break;
  }

  if (picked.length < maxSlides) {
    for (const file of fs.readdirSync(taskDir).filter((f) => /^img_\d+_\d+\.jpg$/.test(f)).sort(imageSort)) {
      if (!picked.includes(file)) picked.push(file);
      if (picked.length >= maxSlides) break;
    }
  }

  return picked.slice(0, maxSlides);
}

fs.mkdirSync(outDir, { recursive: true });

execFileSync(ffmpeg, [
  "-y",
  "-i", path.join(taskDir, "tts.wav"),
  "-t", String(duration),
  "-c:a", "aac",
  "-b:a", "128k",
  path.join(outDir, "preview_audio.m4a"),
], { stdio: "inherit" });

const cues = readJson(path.join(taskDir, "cues.json"))
  .map((c) => ({
    start: Math.max(0, Number(c.start) || 0),
    end: Math.min(duration, Math.max(Number(c.start) || 0, Number(c.end) || 0)),
    text: String(c.text || ""),
  }))
  .filter((c) => c.text.trim() && c.start < duration);

const imageFiles = pickImages().map((file, i) => ({
  src: path.join(taskDir, file),
  name: `slide_${String(i + 1).padStart(2, "0")}.jpg`,
}));

const bookTitle = "《身体重置》";
const author = "斯蒂芬・佩里 著";
const statement = "本视频基于斯蒂芬・佩里《身体重置》及相关研究资料整理\n仅用于健康科普分享，不构成任何建议或行为指导。";

const variants = [
  {
    dir: "match_zoom",
    out: "hf_prod_match_zoom.mp4",
    cls: "match-zoom",
    label: "match zoom",
    accent: "#f4d35e",
  },
  {
    dir: "vertical_card",
    out: "hf_prod_vertical_card.mp4",
    cls: "vertical-card",
    label: "vertical card",
    accent: "#8bd4ff",
  },
  {
    dir: "stack_slide",
    out: "hf_prod_stack_slide.mp4",
    cls: "stack-slide",
    label: "stack slide",
    accent: "#ff9f6e",
  },
  {
    dir: "documentary_cut",
    out: "hf_prod_documentary_cut.mp4",
    cls: "documentary-cut",
    label: "documentary cut",
    accent: "#a7e36f",
  },
];

function htmlFor(v) {
  const slot = duration / imageFiles.length;
  const renderDuration = duration + 1 / 24;
  const slidesHtml = imageFiles.map((img, i) => `
        <div id="slide-${String(i + 1).padStart(2, "0")}" class="slide" data-t0="${(i * slot).toFixed(3)}" data-slot="${slot.toFixed(3)}" style="--image: url('${img.name}')">
          <img class="slide-main" src="${img.name}" />
        </div>`).join("\n");
  const cuesJson = JSON.stringify(cues).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>${esc(v.label)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #050706; }
      body { font-family: "Hiragino Sans GB", sans-serif; color: #f7fbfb; }
      #root {
        position: relative;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background:
          radial-gradient(circle at 50% 35%, rgba(255,255,255,.055), transparent 39%),
          linear-gradient(180deg, #030504 0%, #070908 46%, #030403 100%);
      }
      .vignette {
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 45%, transparent 0 52%, rgba(0,0,0,.16) 77%, rgba(0,0,0,.5) 100%);
        z-index: 40;
        pointer-events: none;
      }
      .top {
        position: absolute;
        top: 118px;
        left: 0;
        width: 1080px;
        text-align: center;
        z-index: 25;
      }
      .title {
        font-size: 90px;
        line-height: 1.15;
        font-weight: 500;
        letter-spacing: 0;
        color: #f8ffff;
        text-shadow: 0 0 24px rgba(255,255,255,.18);
      }
      .author {
        margin-top: 80px;
        font-size: 44px;
        color: #afb4b4;
        letter-spacing: 0;
      }
      .rule {
        position: absolute;
        left: 110px;
        right: 110px;
        top: 482px;
        height: 2px;
        background: linear-gradient(90deg, transparent, ${v.accent}, transparent);
        opacity: .38;
        transform-origin: center;
        z-index: 26;
      }
      .frame {
        position: absolute;
        left: 0;
        top: 510px;
        width: 1080px;
        height: 840px;
        overflow: hidden;
        background: #111312;
        transform-origin: center;
        z-index: 10;
      }
      .slide {
        position: absolute;
        inset: 0;
        opacity: 0;
        overflow: hidden;
        transform-origin: center;
        will-change: transform, opacity;
      }
      .slide::before {
        content: "";
        position: absolute;
        inset: -42px;
        background-image: var(--image);
        background-position: center;
        background-size: cover;
        filter: blur(28px) brightness(.58) saturate(.9);
        transform: scale(1.08);
      }
      .slide-main {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 860px;
        height: 820px;
        object-fit: cover;
        transform: translate(-50%, -50%) scale(1.02);
        transform-origin: center;
        box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 18px 54px rgba(0,0,0,.34);
        will-change: transform, filter, opacity;
      }
      .frame::before,
      .frame::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        width: 150px;
        z-index: 18;
        pointer-events: none;
      }
      .frame::before { left: 0; background: linear-gradient(90deg, rgba(5,7,6,.68), transparent); }
      .frame::after { right: 0; background: linear-gradient(270deg, rgba(5,7,6,.68), transparent); }
      .subtitle {
        position: absolute;
        left: 90px;
        right: 90px;
        top: 1190px;
        min-height: 78px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 30;
        pointer-events: none;
      }
      .subtitle span {
        display: inline-block;
        max-width: 900px;
        color: #ffe44a;
        font-size: 48px;
        line-height: 1.25;
        font-weight: 700;
        text-align: center;
        text-shadow: 0 3px 0 #000, 0 0 14px rgba(0,0,0,.84);
      }
      .statement {
        position: absolute;
        left: 84px;
        right: 84px;
        top: 1392px;
        color: #b8b8b8;
        font-size: 34px;
        line-height: 1.42;
        white-space: pre-wrap;
        z-index: 25;
      }
      .vertical-card .slide-main,
      .stack-slide .slide-main { box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 24px 64px rgba(0,0,0,.42); }
      .stack-slide .slide-main { border-radius: 4px; }
      audio { display: none; }
    </style>
  </head>
  <body>
    <div id="root" class="${v.cls}" data-composition-id="root" data-width="1080" data-height="1920" data-start="0" data-duration="${renderDuration.toFixed(6)}">
      <div class="top">
        <div class="title">${esc(bookTitle)}</div>
        <div class="author">${esc(author)}</div>
      </div>
      <div class="rule"></div>
      <div class="frame">${slidesHtml}
      </div>
      <div class="subtitle"><span></span></div>
      <div class="statement">${esc(statement)}</div>
      <div class="vignette"></div>
      <audio id="voice" class="clip" src="preview_audio.m4a" data-start="0" data-duration="${duration}" data-track-index="1" data-volume="1"></audio>
    </div>
    <script id="cues-data" type="application/json">${cuesJson}</script>
    <script>
      window.__renderReady = true;
      window.__timelines = window.__timelines || {};
      const CONTENT_DURATION = ${duration};
      const RENDER_DURATION = ${renderDuration.toFixed(6)};
      const VARIANT = ${JSON.stringify(v.cls)};
      const slides = Array.from(document.querySelectorAll(".slide"));
      const cues = JSON.parse(document.getElementById("cues-data").textContent || "[]");
      const title = document.querySelector(".title");
      const author = document.querySelector(".author");
      const rule = document.querySelector(".rule");
      const frame = document.querySelector(".frame");
      const sub = document.querySelector(".subtitle span");
      const statement = document.querySelector(".statement");

      function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
      function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
      function between(t, a, b) { return clamp((t - a) / Math.max(.001, b - a), 0, 1); }
      function activeCue(t) {
        return cues.find(c => t >= c.start && t <= c.end) || cues.find(c => t < c.start) || cues[cues.length - 1] || null;
      }
      function setTransform(el, value) { el.style.transform = value; }

      function transitionSeconds() {
        if (VARIANT === "documentary-cut") return .12;
        if (VARIANT === "match-zoom") return .16;
        if (VARIANT === "vertical-card") return .34;
        return .36;
      }

      function baseVisibility(t, slide, i, transition) {
        const start = Number(slide.dataset.t0);
        const slot = Number(slide.dataset.slot);
        const end = start + slot;
        const enter = i === 0 ? 1 : smooth(between(t, start - transition, start));
        const exit = i === slides.length - 1 ? 0 : smooth(between(t, end - transition, end));
        const active = t >= start && (i === slides.length - 1 ? t <= end : t < end);
        const entering = i > 0 && t >= start - transition && t < start;
        const exiting = i < slides.length - 1 && t >= end - transition && t < end;
        const visible = active || entering || exiting;
        const local = between(t, start, end);
        return { start, slot, end, enter, exit, active, entering, exiting, visible, local };
      }

      function renderAt(rawTime) {
        const t = clamp(Number(rawTime) || 0, 0, CONTENT_DURATION);
        const intro = smooth(between(t, 0, .85));
        title.style.opacity = intro.toFixed(3);
        author.style.opacity = smooth(between(t, .18, 1.0)).toFixed(3);
        rule.style.transform = "scaleX(" + smooth(between(t, .3, 1.08)).toFixed(3) + ")";
        statement.style.opacity = smooth(between(t, .82, 1.5)).toFixed(3);
        const rootPulse = 0;
        setTransform(frame, "translateY(" + rootPulse.toFixed(2) + "px)");

        slides.forEach((slide, i) => {
          const img = slide.querySelector(".slide-main");
          const transition = transitionSeconds();
          const state = baseVisibility(t, slide, i, transition);
          const pan = state.local - .5;
          slide.style.zIndex = String(10 + i);
          slide.style.opacity = state.visible ? "1" : "0";
          img.style.filter = "none";

          if (VARIANT === "match-zoom") {
            slide.style.opacity = state.active ? "1" : "0";
            const zoom = 1.028 + state.local * .058;
            const settle = state.active && t - state.start < .2 ? (1 - smooth(between(t, state.start, state.start + .2))) * .035 : 0;
            setTransform(slide, "translateX(0) scale(1)");
            setTransform(img, "translate(calc(-50% + " + (pan * 14).toFixed(2) + "px), calc(-50% + " + (Math.sin(t * .22 + i) * 2.2).toFixed(2) + "px)) scale(" + (zoom + settle).toFixed(4) + ")");
          } else if (VARIANT === "vertical-card") {
            const cover = state.entering ? smooth(between(state.enter, .04, .18)) : 1;
            slide.style.opacity = state.visible ? clamp(cover, 0, 1).toFixed(3) : "0";
            const y = state.entering ? (1 - state.enter) * 230 : state.exiting ? -state.exit * 42 : 0;
            const scale = 1.018 + state.local * .042 - (state.exiting ? state.exit * .012 : 0);
            setTransform(slide, "translateY(" + y.toFixed(2) + "px) scale(" + (1 - state.exit * .018).toFixed(4) + ")");
            setTransform(img, "translate(calc(-50% + " + (pan * 12).toFixed(2) + "px), -50%) scale(" + scale.toFixed(4) + ")");
          } else if (VARIANT === "stack-slide") {
            const direction = i % 2 === 0 ? 1 : -1;
            const cover = state.entering ? smooth(between(state.enter, .03, .14)) : 1;
            slide.style.opacity = state.visible ? clamp(cover, 0, 1).toFixed(3) : "0";
            const x = state.entering ? (1 - state.enter) * 210 * direction : state.exiting ? -state.exit * 48 * direction : 0;
            const y = state.entering ? (1 - state.enter) * 32 : state.exiting ? -state.exit * 20 : 0;
            const rotate = state.entering ? (1 - state.enter) * 1.2 * direction : state.exiting ? -state.exit * .5 * direction : 0;
            setTransform(slide, "translate(" + x.toFixed(2) + "px, " + y.toFixed(2) + "px) rotate(" + rotate.toFixed(2) + "deg) scale(" + (1 - state.exit * .018).toFixed(4) + ")");
            setTransform(img, "translate(calc(-50% + " + (pan * 14).toFixed(2) + "px), -50%) scale(" + (1.018 + state.local * .052).toFixed(4) + ")");
          } else {
            slide.style.opacity = state.active ? "1" : "0";
            setTransform(slide, "translateY(0)");
            setTransform(img, "translate(calc(-50% + " + (pan * 24).toFixed(2) + "px), calc(-50% + " + (Math.sin(t * .18 + i) * 2.4).toFixed(2) + "px)) scale(" + (1.018 + state.local * .056).toFixed(4) + ")");
          }
        });

        const cue = activeCue(t);
        if (cue) {
          sub.textContent = cue.text;
          const fade = Math.min(smooth(between(t, .58, 1.0)), 1 - smooth(between(t, CONTENT_DURATION - .35, CONTENT_DURATION)));
          sub.style.opacity = clamp(fade, 0, 1).toFixed(3);
          sub.style.transform = "translateY(" + ((1 - fade) * 6).toFixed(2) + "px)";
        }
      }

      window.addEventListener("hf-seek", (ev) => renderAt(ev.detail && ev.detail.time));
      window.__timelines.root = {
        duration: () => RENDER_DURATION,
        totalTime: (time) => { renderAt(time); return window.__timelines.root; },
        seek: (time) => { renderAt(time); return window.__timelines.root; },
        pause: () => window.__timelines.root,
        play: () => window.__timelines.root,
        getChildren: () => [],
      };
      renderAt(0);
    </script>
  </body>
</html>`;
}

for (const v of variants) {
  const variantDir = path.join(outDir, v.dir);
  fs.rmSync(variantDir, { recursive: true, force: true });
  fs.mkdirSync(variantDir, { recursive: true });
  fs.copyFileSync(path.join(outDir, "preview_audio.m4a"), path.join(variantDir, "preview_audio.m4a"));
  for (const img of imageFiles) {
    fs.copyFileSync(img.src, path.join(variantDir, img.name));
  }
  fs.writeFileSync(path.join(variantDir, "index.html"), htmlFor(v), "utf-8");
}

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({
  taskId,
  duration,
  maxSlides,
  title: bookTitle,
  author,
  images: imageFiles.map((img) => path.basename(img.src)),
  variants: variants.map(({ dir, out, label, cls }) => ({ dir, out, label, cls })),
}, null, 2), "utf-8");

console.log(outDir);
