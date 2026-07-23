import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const taskId = process.argv[2] || "MW4GhE1OqNnO";
const duration = Number(process.argv[3] || 12);
const maxSlides = Math.max(2, Number(process.argv[4] || 4));
const root = process.cwd();
const taskDir = path.join(root, "data", "tasks", taskId);
const outDir = path.join(taskDir, "hyperframes_transition_previews");
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

function copyInto(src, dir, name) {
  fs.copyFileSync(src, path.join(dir, name));
  return name;
}

function imageSort(a, b) {
  const ax = a.match(/^img_(\d+)_(\d+)\.jpg$/).slice(1).map(Number);
  const bx = b.match(/^img_(\d+)_(\d+)\.jpg$/).slice(1).map(Number);
  return ax[0] - bx[0] || ax[1] - bx[1];
}

function pickRepresentativeImages() {
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

const imageFiles = pickRepresentativeImages().map((file, i) => ({
  src: path.join(taskDir, file),
  name: `slide_${String(i + 1).padStart(2, "0")}.jpg`,
}));

const bookTitle = "《身体重置》";
const author = "斯蒂芬・佩里 著";
const statement = "本视频基于斯蒂芬・佩里《身体重置》及相关研究资料整理\n仅用于健康科普分享，不构成任何建议或行为指导。";

const variants = [
  {
    dir: "cinematic_push",
    out: "hf_transition_cinematic_push.mp4",
    cls: "cinematic-push",
    label: "电影推拉",
    accent: "#ffd84d",
  },
  {
    dir: "book_page",
    out: "hf_transition_book_page.mp4",
    cls: "book-page",
    label: "书页翻转",
    accent: "#66eadf",
  },
  {
    dir: "soft_reveal",
    out: "hf_transition_soft_reveal.mp4",
    cls: "soft-reveal",
    label: "柔边揭示",
    accent: "#ff8a56",
  },
  {
    dir: "documentary_pan",
    out: "hf_transition_documentary_pan.mp4",
    cls: "documentary-pan",
    label: "纪录片慢摇",
    accent: "#a7ee6b",
  },
];

function htmlFor(v) {
  const slot = duration / imageFiles.length;
  const slidesHtml = imageFiles.map((img, i) => `
        <div id="slide-${String(i + 1).padStart(2, "0")}" class="slide" data-t0="${(i * slot).toFixed(3)}" data-slot="${slot.toFixed(3)}">
          <img class="slide-main" src="${img.name}" />
          <div class="reveal-band"></div>
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
          radial-gradient(circle at 50% 36%, rgba(255,255,255,.055), transparent 38%),
          linear-gradient(180deg, #030504 0%, #070908 44%, #030403 100%);
      }
      .vignette {
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 45%, transparent 0 50%, rgba(0,0,0,.18) 76%, rgba(0,0,0,.48) 100%);
        z-index: 30;
        pointer-events: none;
      }
      .top {
        position: absolute;
        top: 124px;
        left: 0;
        width: 1080px;
        text-align: center;
        z-index: 20;
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
        margin-top: 84px;
        font-size: 44px;
        color: #afb4b4;
        letter-spacing: 0;
      }
      .rule {
        position: absolute;
        left: 98px;
        right: 98px;
        top: 482px;
        height: 2px;
        background: linear-gradient(90deg, transparent, ${v.accent}, transparent);
        opacity: .46;
        transform-origin: center;
        z-index: 22;
      }
      .frame {
        position: absolute;
        left: 0;
        top: 520px;
        width: 1080px;
        height: 760px;
        overflow: hidden;
        background: #101211;
        transform-origin: center;
        perspective: 1300px;
        z-index: 10;
      }
      .slide {
        position: absolute;
        inset: 0;
        opacity: 0;
        overflow: hidden;
        transform-origin: center;
        backface-visibility: hidden;
        will-change: transform, opacity, clip-path;
      }
      .slide-main {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 820px;
        height: 760px;
        object-fit: cover;
        transform: translate(-50%, -50%) scale(1.02);
        transform-origin: center;
        box-shadow: 0 0 0 1px rgba(255,255,255,.16), 0 18px 54px rgba(0,0,0,.38);
        will-change: transform, filter;
      }
      .frame::before,
      .frame::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        width: 160px;
        z-index: 14;
        pointer-events: none;
      }
      .frame::before { left: 0; background: linear-gradient(90deg, rgba(5,7,6,.72), transparent); }
      .frame::after { right: 0; background: linear-gradient(270deg, rgba(5,7,6,.72), transparent); }
      .reveal-band {
        position: absolute;
        top: -12%;
        bottom: -12%;
        width: 170px;
        opacity: 0;
        transform: translateX(-230px) skewX(-10deg);
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.22), ${v.accent}, rgba(255,255,255,.18), transparent);
        filter: blur(1px);
        z-index: 12;
        pointer-events: none;
      }
      .subtitle {
        position: absolute;
        left: 90px;
        right: 90px;
        top: 1150px;
        min-height: 78px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 24;
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
        top: 1320px;
        color: #b8b8b8;
        font-size: 34px;
        line-height: 1.42;
        white-space: pre-wrap;
        z-index: 20;
      }
      .badge {
        position: absolute;
        right: 64px;
        bottom: 82px;
        color: #7a7a7a;
        font-size: 24px;
        letter-spacing: 0;
        z-index: 20;
      }
      .chapter {
        position: absolute;
        left: 76px;
        top: 1286px;
        color: ${v.accent};
        font-size: 28px;
        font-weight: 700;
        z-index: 24;
      }
      .cinematic-push .frame { box-shadow: 0 -8px 44px rgba(255,216,77,.06), 0 12px 50px rgba(0,0,0,.25); }
      .book-page .slide { transform-origin: left center; }
      .book-page .frame { box-shadow: inset 0 0 0 1px rgba(102,234,223,.14); }
      .soft-reveal .frame { box-shadow: inset 0 0 0 1px rgba(255,138,86,.14); }
      .documentary-pan .frame { box-shadow: inset 0 0 0 1px rgba(255,255,255,.09); }
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
      <div class="frame">${slidesHtml}
      </div>
      <div class="subtitle"><span></span></div>
      <div class="chapter">转场方案 · ${esc(v.label)}</div>
      <div class="statement">${esc(statement)}</div>
      <div class="badge">HyperFrames preview · ${esc(v.label)}</div>
      <div class="vignette"></div>
      <audio id="voice" class="clip" src="preview_audio.m4a" data-start="0" data-duration="${duration}" data-track-index="1" data-volume="1"></audio>
    </div>
    <script id="cues-data" type="application/json">${cuesJson}</script>
    <script>
      window.__renderReady = true;
      window.__timelines = window.__timelines || {};
      const DURATION = ${duration};
      const VARIANT = ${JSON.stringify(v.cls)};
      const slides = Array.from(document.querySelectorAll(".slide"));
      const cues = JSON.parse(document.getElementById("cues-data").textContent || "[]");
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
      function setClip(el, value) {
        el.style.clipPath = value;
        el.style.webkitClipPath = value;
      }

      function renderAt(rawTime) {
        const t = clamp(Number(rawTime) || 0, 0, DURATION);
        const intro = smooth(between(t, 0, .9));
        title.style.opacity = intro.toFixed(3);
        author.style.opacity = smooth(between(t, .2, 1.05)).toFixed(3);
        rule.style.transform = "scaleX(" + smooth(between(t, .32, 1.12)).toFixed(3) + ")";
        statement.style.opacity = smooth(between(t, .85, 1.55)).toFixed(3);
        chapter.style.opacity = smooth(between(t, .95, 1.5)).toFixed(3);
        setTransform(frame, "translateZ(0)");

        slides.forEach((slide, i) => {
          const start = Number(slide.dataset.t0);
          const slot = Number(slide.dataset.slot);
          const end = start + slot;
          const img = slide.querySelector(".slide-main");
          const band = slide.querySelector(".reveal-band");
          const transition = VARIANT === "documentary-pan" ? Math.min(1.15, slot * .42) : Math.min(.74, slot * .28);
          const enter = i === 0 ? 1 : smooth(between(t, start - transition, start));
          const exit = i === slides.length - 1 ? 0 : smooth(between(t, end - transition, end));
          const local = between(t, start, end);
          const inWindow = t >= start - transition && t <= end;
          const isPast = t > end;
          const baseScale = 1.025 + local * .055;
          const pan = (local - .5);

          slide.style.zIndex = String(10 + i);
          band.style.opacity = "0";
          setClip(slide, "inset(0 0 0 0)");
          img.style.filter = "none";

          if (VARIANT === "cinematic-push") {
            const direction = i % 2 === 0 ? 1 : -1;
            const x = (1 - enter) * 190 * direction - exit * 120 * direction + pan * 18;
            const y = (1 - enter) * 22 - exit * 10;
            slide.style.opacity = inWindow ? "1" : "0";
            setTransform(slide, "translate(" + x.toFixed(2) + "px, " + y.toFixed(2) + "px) scale(" + (1 - exit * .018).toFixed(4) + ")");
            setTransform(img, "translate(calc(-50% + " + (pan * 26).toFixed(2) + "px), -50%) scale(" + baseScale.toFixed(4) + ")");
          } else if (VARIANT === "book-page") {
            const rotate = -72 * exit;
            const incoming = (1 - enter) * 36;
            slide.style.opacity = inWindow || (!isPast && enter > .01) ? (enter < 1 ? (.18 + enter * .82).toFixed(3) : "1") : "0";
            setTransform(slide, "translateX(" + incoming.toFixed(2) + "px) rotateY(" + rotate.toFixed(2) + "deg)");
            setTransform(img, "translate(calc(-50% + " + (pan * 18).toFixed(2) + "px), -50%) scale(" + (baseScale + exit * .018).toFixed(4) + ")");
          } else if (VARIANT === "soft-reveal") {
            const right = i === 0 ? 0 : (100 - enter * 100);
            slide.style.opacity = (inWindow || enter > .01) && !isPast ? "1" : "0";
            setClip(slide, "inset(0 " + right.toFixed(2) + "% 0 0)");
            setTransform(slide, "translateX(" + ((1 - enter) * 18 - exit * 10).toFixed(2) + "px)");
            setTransform(img, "translate(calc(-50% + " + (pan * 18).toFixed(2) + "px), -50%) scale(" + baseScale.toFixed(4) + ")");
            band.style.opacity = (enter > .02 && enter < .98) ? ".78" : "0";
            band.style.transform = "translateX(" + (-210 + enter * 1240).toFixed(2) + "px) skewX(-10deg)";
          } else {
            const opacity = Math.min(enter, 1 - exit);
            const holdOpacity = inWindow || (enter > .01 && !isPast) ? clamp(opacity, 0, 1) : 0;
            slide.style.opacity = holdOpacity.toFixed(3);
            setTransform(slide, "translateY(" + ((1 - enter) * 14 - exit * 12).toFixed(2) + "px)");
            setTransform(img, "translate(calc(-50% + " + (pan * 34).toFixed(2) + "px), calc(-50% + " + (Math.sin(t * .32 + i) * 6).toFixed(2) + "px)) scale(" + (1.02 + local * .07).toFixed(4) + ")");
          }
        });

        const cue = activeCue(t);
        if (cue) {
          sub.textContent = cue.text;
          const fade = Math.min(smooth(between(t, .6, 1.05)), 1 - smooth(between(t, DURATION - .35, DURATION)));
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
  fs.rmSync(variantDir, { recursive: true, force: true });
  fs.mkdirSync(variantDir, { recursive: true });
  fs.copyFileSync(path.join(outDir, "preview_audio.m4a"), path.join(variantDir, "preview_audio.m4a"));
  for (const img of imageFiles) {
    copyInto(img.src, variantDir, img.name);
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
