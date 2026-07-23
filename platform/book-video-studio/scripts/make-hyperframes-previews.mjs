import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const taskId = process.argv[2] || "MW4GhE1OqNnO";
const duration = Number(process.argv[3] || 15);
const maxSlides = Math.max(1, Number(process.argv[4] || 5));
const root = process.cwd();
const taskDir = path.join(root, "data", "tasks", taskId);
const outDir = path.join(taskDir, "hyperframes_previews");
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

function copyAsset(src, name) {
  const dst = path.join(outDir, name);
  fs.copyFileSync(src, dst);
  return name;
}

function copyAssetInto(src, dir, name) {
  const dst = path.join(dir, name);
  fs.copyFileSync(src, dst);
  return name;
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

const imageFiles = fs.readdirSync(taskDir)
  .filter((f) => /^img_\d+_\d+\.jpg$/.test(f))
  .sort((a, b) => {
    const ax = a.match(/^img_(\d+)_(\d+)\.jpg$/).slice(1).map(Number);
    const bx = b.match(/^img_(\d+)_(\d+)\.jpg$/).slice(1).map(Number);
    return ax[0] - bx[0] || ax[1] - bx[1];
  })
  .slice(0, maxSlides)
  .map((f, i) => copyAsset(path.join(taskDir, f), `slide_${String(i + 1).padStart(2, "0")}.jpg`));

const bookTitle = "《身体重置》";
const author = "斯蒂芬・佩里 著";
const statement = "本视频基于斯蒂芬・佩里《身体重置》及相关研究资料整理\n仅用于健康科普分享，不构成任何建议或行为指导。";

const variants = [
  {
    dir: "book_float",
    file: "index.html",
    out: "hf_book_float.mp4",
    cls: "book-float",
    label: "图书卡片 · 浮动景深",
    accent: "#ffe23a",
  },
  {
    dir: "book_flip",
    file: "index.html",
    out: "hf_book_flip.mp4",
    cls: "book-flip",
    label: "图书卡片 · 章节翻页",
    accent: "#62e6d6",
  },
  {
    dir: "book_split",
    file: "index.html",
    out: "hf_book_split.mp4",
    cls: "book-split",
    label: "图书卡片 · 分层推拉",
    accent: "#ff7048",
  },
  {
    dir: "book_pulse",
    file: "index.html",
    out: "hf_book_pulse.mp4",
    cls: "book-pulse",
    label: "图书卡片 · 强节奏标题",
    accent: "#a8ff5f",
  },
];

function htmlFor(v) {
  const slideDuration = duration / imageFiles.length;
  const slidesHtml = imageFiles.map((img, i) => {
    const start = i * slideDuration;
    return `
      <div id="slide-${String(i + 1).padStart(2, "0")}" class="slide clip" data-start="${start.toFixed(3)}" data-duration="${slideDuration.toFixed(3)}">
        <img class="slide-bg" src="${img}" />
        <img class="slide-main" src="${img}" />
      </div>`;
  }).join("\n");
  const cuesJson = JSON.stringify(cues).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>${esc(v.label)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #000; }
      body {
        font-family: "Hiragino Sans GB", sans-serif;
        color: #f7fbfb;
      }
      #root {
        position: relative;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: #000;
      }
      .scanline {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 38%, transparent 0 48%, rgba(0,0,0,.18) 78%, rgba(0,0,0,.42) 100%),
          linear-gradient(to bottom, rgba(255,255,255,.035), transparent 20%, transparent 82%, rgba(255,255,255,.025));
        mix-blend-mode: normal;
        opacity: .22;
        pointer-events: none;
        z-index: 20;
      }
      .top {
        position: absolute;
        top: 122px;
        left: 0;
        width: 1080px;
        text-align: center;
        z-index: 10;
      }
      .title {
        font-size: 90px;
        line-height: 1.15;
        font-weight: 500;
        letter-spacing: 0;
        color: #f7ffff;
        text-shadow: 0 0 24px rgba(255,255,255,.16);
      }
      .author {
        margin-top: 86px;
        font-size: 44px;
        color: #afb4b4;
        letter-spacing: 0;
      }
      .rule {
        position: absolute;
        left: 90px;
        right: 90px;
        top: 480px;
        height: 2px;
        background: linear-gradient(90deg, transparent, ${v.accent}, transparent);
        opacity: .48;
        z-index: 12;
      }
      .frame {
        position: absolute;
        left: 0;
        top: 520px;
        width: 1080px;
        height: 720px;
        overflow: hidden;
        z-index: 5;
        background: #101010;
        transform-origin: center center;
      }
      .slide {
        position: absolute;
        inset: 0;
        opacity: 0;
        transform-origin: center center;
      }
      .slide-bg, .slide-main {
        position: absolute;
        top: 50%;
        left: 50%;
        transform-origin: center center;
      }
      .slide-bg {
        width: 1080px;
        height: 720px;
        object-fit: cover;
        filter: blur(24px) brightness(.72) saturate(.9);
        transform: translate(-50%, -50%) scale(1.12);
      }
      .slide-main {
        width: 720px;
        height: 720px;
        object-fit: cover;
        transform: translate(-50%, -50%) scale(1);
        box-shadow: 0 0 0 1px rgba(255,255,255,.16), 0 18px 50px rgba(0,0,0,.32);
      }
      .subtitle {
        position: absolute;
        left: 90px;
        right: 90px;
        top: 1120px;
        min-height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 14;
        pointer-events: none;
      }
      .subtitle span {
        display: inline-block;
        max-width: 900px;
        padding: 6px 18px 10px;
        color: #ffe44a;
        font-size: 48px;
        line-height: 1.25;
        font-weight: 700;
        text-align: center;
        text-shadow: 0 3px 0 #000, 0 0 14px rgba(0,0,0,.8);
      }
      .statement {
        position: absolute;
        left: 84px;
        right: 84px;
        top: 1296px;
        color: #b5b5b5;
        font-size: 34px;
        line-height: 1.42;
        white-space: pre-wrap;
        z-index: 10;
      }
      .badge {
        position: absolute;
        right: 64px;
        bottom: 82px;
        z-index: 15;
        color: #777;
        font-size: 24px;
        letter-spacing: 0;
      }
      .chapter {
        position: absolute;
        left: 76px;
        top: 1260px;
        color: ${v.accent};
        font-size: 28px;
        font-weight: 700;
        opacity: 0;
        z-index: 15;
      }
      .book-float .frame { box-shadow: 0 -10px 50px rgba(255,255,255,.08), 0 10px 50px rgba(255,226,58,.08); }
      .book-flip .frame { perspective: 1000px; }
      .book-flip .slide-main { border-radius: 2px; }
      .book-split .frame::before,
      .book-split .frame::after {
        content: "";
        position: absolute;
        top: 0;
        width: 50%;
        height: 100%;
        z-index: 7;
        pointer-events: none;
        border-top: 1px solid rgba(255,255,255,.18);
        border-bottom: 1px solid rgba(255,255,255,.18);
      }
      .book-split .frame::before { left: 0; border-right: 1px solid rgba(255,255,255,.14); }
      .book-split .frame::after { right: 0; border-left: 1px solid rgba(0,0,0,.28); }
      .book-pulse .title { color: ${v.accent}; text-shadow: 0 0 28px rgba(168,255,95,.48); }
      audio { display: none; }
    </style>
  </head>
  <body>
    <div id="root" class="${v.cls}" data-composition-id="root" data-width="1080" data-height="1920" data-start="0" data-duration="${duration}">
      <div class="top">
        <div class="title">${esc(bookTitle)}</div>
        <div class="author">${esc(author)}</div>
      </div>
      <div class="rule"></div>
      <div class="frame">${slidesHtml}</div>
      <div class="chapter">${esc(v.label)}</div>
      <div class="subtitle"><span></span></div>
      <div class="statement">${esc(statement)}</div>
      <div class="badge">HyperFrames preview · ${esc(v.label)}</div>
      <div class="scanline"></div>
      <audio id="voice" class="clip" src="preview_audio.m4a" data-start="0" data-duration="${duration}" data-track-index="1" data-volume="1"></audio>
    </div>
    <script id="cues-data" type="application/json">${cuesJson}</script>
    <script>
      window.__renderReady = true;
      window.__timelines = window.__timelines || {};
      const DURATION = ${duration};
      const VARIANT = ${JSON.stringify(v.cls)};
      const cues = JSON.parse(document.getElementById("cues-data").textContent || "[]");
      const root = document.getElementById("root");
      const slides = Array.from(document.querySelectorAll(".slide"));
      const title = document.querySelector(".title");
      const author = document.querySelector(".author");
      const rule = document.querySelector(".rule");
      const frame = document.querySelector(".frame");
      const sub = document.querySelector(".subtitle span");
      const statement = document.querySelector(".statement");
      const chapter = document.querySelector(".chapter");
      function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
      function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
      function between(t, a, b) { return clamp((t - a) / Math.max(.001, b - a), 0, 1); }
      function activeCue(t) {
        return cues.find(c => t >= c.start && t <= c.end) || cues.find(c => t < c.start) || cues[cues.length - 1] || null;
      }
      function setTransform(el, value) { el.style.transform = value; }
      function renderAt(t) {
        t = clamp(Number(t) || 0, 0, DURATION);
        const intro = smooth(between(t, 0, .8));
        title.style.opacity = intro;
        author.style.opacity = smooth(between(t, .22, 1.05));
        rule.style.transform = "scaleX(" + smooth(between(t, .4, 1.1)).toFixed(3) + ")";
        rule.style.opacity = (.16 + .32 * intro).toFixed(3);
        statement.style.opacity = smooth(between(t, .9, 1.7));
        chapter.style.opacity = VARIANT === "book-flip" ? smooth(between(t, 1.0, 1.8)) * .9 : 0;
        const pulse = Math.sin(t * 1.8);
        const slow = Math.sin(t * .55);
        if (VARIANT === "book-float") {
          setTransform(frame, "translateY(" + (slow * 10).toFixed(2) + "px) scale(" + (1 + intro * .012).toFixed(4) + ")");
          setTransform(title, "translateY(" + (-8 + intro * 8 + slow * 2).toFixed(2) + "px)");
        } else if (VARIANT === "book-flip") {
          setTransform(frame, "rotateX(" + (Math.sin(t * .9) * 1.8).toFixed(2) + "deg) rotateY(" + (Math.sin(t * .7) * 2.4).toFixed(2) + "deg)");
          setTransform(title, "translateY(0)");
        } else if (VARIANT === "book-split") {
          setTransform(frame, "translateX(" + (Math.sin(t * .75) * 8).toFixed(2) + "px) scale(1.01)");
          setTransform(title, "translateX(" + (Math.sin(t * 1.1) * 5).toFixed(2) + "px)");
        } else {
          const p = 1 + Math.max(0, pulse) * .018;
          setTransform(frame, "scale(" + p.toFixed(4) + ")");
          setTransform(title, "scale(" + (1 + Math.max(0, pulse) * .022).toFixed(4) + ")");
        }
        slides.forEach((slide, i) => {
          const start = Number(slide.dataset.start);
          const slot = Number(slide.dataset.duration);
          const end = start + slot;
          const local = between(t, start, end);
          const transition = Math.min(.55, slot * .28);
          const fadeIn = i === 0 ? 1 : smooth(between(t, start - transition, start + transition));
          const fadeOut = i === slides.length - 1 ? 1 : 1 - smooth(between(t, end - transition, end + transition));
          const opacity = Math.max(0, Math.min(fadeIn, fadeOut));
          slide.style.opacity = opacity.toFixed(3);
          const main = slide.querySelector(".slide-main");
          const bg = slide.querySelector(".slide-bg");
          const drift = (local - .5);
          if (VARIANT === "book-flip") {
            setTransform(main, "translate(-50%, -50%) rotateY(" + ((1 - opacity) * -16 + drift * 2).toFixed(2) + "deg) scale(" + (1.02 + local * .04).toFixed(4) + ")");
          } else if (VARIANT === "book-split") {
            setTransform(main, "translate(calc(-50% + " + (drift * 34).toFixed(2) + "px), -50%) scale(" + (1.03 + local * .03).toFixed(4) + ")");
          } else if (VARIANT === "book-pulse") {
            setTransform(main, "translate(-50%, -50%) scale(" + (1.01 + Math.max(0, pulse) * .022 + local * .025).toFixed(4) + ")");
          } else {
            setTransform(main, "translate(calc(-50% + " + (drift * 18).toFixed(2) + "px), calc(-50% + " + (slow * 8).toFixed(2) + "px)) scale(" + (1.01 + local * .035).toFixed(4) + ")");
          }
          setTransform(bg, "translate(-50%, -50%) scale(" + (1.14 + local * .045).toFixed(4) + ")");
        });
        const cue = activeCue(t);
        if (cue) {
          sub.textContent = cue.text;
          const fade = Math.min(smooth(between(t, .65, 1.05)), 1 - smooth(between(t, DURATION - .35, DURATION)));
          sub.style.opacity = clamp(fade, 0, 1).toFixed(3);
          sub.style.transform = "translateY(" + ((1 - fade) * 6).toFixed(2) + "px)";
        }
      }
      window.addEventListener("hf-seek", (ev) => renderAt(ev.detail && ev.detail.time));
      window.__timelines.root = {
        duration: () => DURATION,
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
  fs.mkdirSync(variantDir, { recursive: true });
  for (const file of fs.readdirSync(variantDir)) {
    if (/^slide_\d+\.jpg$/.test(file)) {
      fs.rmSync(path.join(variantDir, file));
    }
  }
  fs.copyFileSync(path.join(outDir, "preview_audio.m4a"), path.join(variantDir, "preview_audio.m4a"));
  for (const img of imageFiles) {
    copyAssetInto(path.join(outDir, img), variantDir, img);
  }
  fs.writeFileSync(path.join(variantDir, v.file), htmlFor(v), "utf-8");
}

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({
  taskId,
  duration,
  title: bookTitle,
  author,
  maxSlides,
  images: imageFiles,
  audio: "preview_audio.m4a",
  variants: variants.map(({ dir, file, out, label, cls }) => ({ dir, file, out, label, cls })),
}, null, 2), "utf-8");

console.log(outDir);
