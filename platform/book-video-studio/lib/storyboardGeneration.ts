import fs from "node:fs";
import path from "node:path";
import {
  getArtifacts,
  patchArtifact,
  projectArtifactPath,
  saveArtifact,
  setStepStatus,
  taskDir,
  updateTask,
} from "./pipeline/repo";
import { assertTitleWorkflowComplete } from "./titleWorkflow";

const FALLBACK_REMAINING_IMAGE_JOBS = [
  {
    id: "S01",
    imageFileName: "storyboard-S01-v1.png",
    promptFileName: "storyboard-S01-v1.txt",
    label: "从被动走向主动",
    scene: "清晨室内，同一位约二十五岁的东亚女性从昏暗狭窄的室内走向窗边暖光，空间由闭塞逐渐打开。中远景、轻微侧后方视角，人物位于画面下半部，动作自然，双手不作为视觉重点；不出现倒影。",
  },
  {
    id: "S03",
    imageFileName: "storyboard-S03-v1.png",
    promptFileName: "storyboard-S03-v1.txt",
    label: "由自己启动",
    scene: "安静桌面的象征性物件特写：一盏刚刚被点亮的简洁台灯，暖光照在合起的素色笔记本与自然松开的绳结上。无人物、无手、无文字，表达启动来自内在。",
  },
  {
    id: "S04",
    imageFileName: "storyboard-S04-v1.png",
    promptFileName: "storyboard-S04-v1.txt",
    label: "停止控制别人",
    scene: "薄雾林间的两条道路自然分开，同一位约二十五岁的东亚女性与另一个远处人物各自沿不同方向前行，保持尊重的距离，互不拉扯。大全景，人物很小且比例自然，不表现具体面部和手部。",
  },
  {
    id: "S05",
    imageFileName: "storyboard-S05-v1.png",
    promptFileName: "storyboard-S05-v1.txt",
    label: "尊重各自命运",
    scene: "克制的象征性结尾：一段已经自然松开的细红线静静落在石台边缘，远处同一位约二十五岁的东亚女性独自沿被夕光照亮的道路走向开阔天地。无手部特写，无拉扯动作，情绪是释然与尊重。",
  },
] as const;

type StoryboardImageJob = {
  id: string;
  imageFileName: string;
  promptFileName: string;
  label: string;
  scene: string;
};

function buildPrompt(scene: string) {
  return [
    "Use case: production asset",
    "Asset type: WeChat Channels vertical book-video storyboard background",
    "Primary request:",
    scene,
    "",
    "Match the approved G03 sample exactly:",
    "- Premium literary editorial illustration with cinematic light and delicate painterly paper texture.",
    "- Indigo and teal shadows, warm gold light, parchment neutrals, only tiny restrained coral-red accents.",
    "- Contemporary grounded realism, calm introspective mood, natural proportions.",
    "- 9:16 portrait composition. Keep the upper roughly 15% as natural low-contrast environmental detail for editable titles; do not create a flat blank block.",
    "- When the recurring character appears: the same East Asian woman about 25 years old, shoulder-length dark hair, simple modest dark clothing.",
    "",
    "Text constraints: no Chinese or English text, no book title, no subtitles, no logo, no watermark.",
    "Avoid: extra people, duplicated limbs, malformed anatomy, prominent hands, glamour fashion, exaggerated makeup, fantasy glow, text, symbols, book-cover typography, flat blank color blocks.",
  ].join("\n");
}

export function parseArtifactMeta(meta: string | null | undefined) {
  try { return meta ? JSON.parse(meta) : {}; }
  catch { return {}; }
}

function loadStoryboardImageJobs(taskId: string): StoryboardImageJob[] {
  const storyboardPath = path.join(taskDir(taskId), "storyboard", "storyboard.json");
  if (!fs.existsSync(storyboardPath)) return [...FALLBACK_REMAINING_IMAGE_JOBS];
  try {
    const storyboard = JSON.parse(fs.readFileSync(storyboardPath, "utf8"));
    const beats = Array.isArray(storyboard.beats) ? storyboard.beats : [];
    const styleSampleBeatId = String(storyboard.style_sample?.beat_id || "");
    const jobs = beats
      .filter((beat: any) => String(beat?.id || "") && String(beat.id) !== styleSampleBeatId)
      .map((beat: any): StoryboardImageJob => {
        const id = String(beat.id);
        const imageFileName = path.basename(
          String(beat.image?.file_name || `storyboard-${id}-v1.png`),
        );
        const promptFileName = path.basename(
          String(beat.image?.prompt_file_name || `storyboard-${id}-v1.txt`),
        );
        return {
          id,
          imageFileName,
          promptFileName,
          label: String(beat.script_function || beat.label || id),
          scene: [
            String(beat.visual || ""),
            String(beat.shot || ""),
            beat.script_text ? `对应口播语义：${String(beat.script_text)}` : "",
          ].filter(Boolean).join("。"),
        };
      });
    return jobs.length ? jobs : [...FALLBACK_REMAINING_IMAGE_JOBS];
  } catch {
    return [...FALLBACK_REMAINING_IMAGE_JOBS];
  }
}

export function startRemainingImageQueue(taskId: string) {
  assertTitleWorkflowComplete(taskId);
  const artifacts = getArtifacts(taskId);
  const existing = artifacts.find(
    (item) => item.stepName === "storyboard" && item.kind === "remaining_image_manifest",
  );
  const promptDir = path.join(taskDir(taskId), "storyboard", "prompts");
  fs.mkdirSync(promptDir, { recursive: true });

  const storyboardJobs = loadStoryboardImageJobs(taskId);
  const jobs = storyboardJobs.map((job) => {
    const promptPath = path.join(promptDir, job.promptFileName);
    if (!fs.existsSync(promptPath)) fs.writeFileSync(promptPath, buildPrompt(job.scene), "utf8");
    const previous = existing
      ? (parseArtifactMeta(existing.meta).jobs || []).find((item: any) => item.id === job.id)
      : null;
    return {
      id: job.id,
      label: job.label,
      imageFileName: job.imageFileName,
      promptFileName: job.promptFileName,
      promptPath: projectArtifactPath(promptPath),
      status: previous?.status === "done" ? "done" : "pending",
      imagePath: previous?.imagePath || null,
      sha256: previous?.sha256 || null,
      error: null,
    };
  });
  const meta = {
    generator: "codex-built-in-imagegen",
    status: jobs.every((job) => job.status === "done") ? "done" : "queued",
    requestedAt: Date.now(),
    approvedStyleSample: artifacts.find(
      (item) => item.stepName === "storyboard" && item.kind === "style_sample",
    )?.path || null,
    jobs,
  };

  if (existing) {
    patchArtifact(existing.id, { label: "G04 Codex 剩余分镜生图队列", meta: JSON.stringify(meta) });
  } else {
    saveArtifact({
      taskId,
      stepName: "storyboard",
      kind: "remaining_image_manifest",
      label: "G04 Codex 剩余分镜生图队列",
      meta,
    });
  }
  setStepStatus(taskId, "images", {
    status: meta.status === "done" ? "done" : "running",
    progress: jobs.filter((job) => job.status === "done").length / jobs.length,
    startedAt: Date.now(),
    error: "",
  });
  updateTask(taskId, {
    status: meta.status === "done" ? "waiting_images_confirmation" : "generating_remaining_images",
    currentGate: meta.status === "done" ? "ALL_IMAGES_CONFIRMATION" : "REMAINING_IMAGES_GENERATING",
  });
  return meta;
}
