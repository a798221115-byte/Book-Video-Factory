import { NextResponse } from "next/server";
import { getArtifacts, getTask, patchArtifact, setStepStatus, taskDir } from "@/lib/pipeline/repo";
import { downstreamOf } from "@/lib/pipeline/steps";
import fs from "node:fs";
import path from "node:path";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const arts = getArtifacts(id);
  const dedup = arts.find((a) => a.stepName === "dedup" && a.kind === "text" && a.content?.trim());
  if (!dedup?.content) {
    return NextResponse.json({ error: "缺少去重稿，请先生成去重稿" }, { status: 400 });
  }

  const rewrite = arts.find((a) => a.stepName === "rewrite" && a.kind === "rewrite");
  if (!rewrite) {
    return NextResponse.json({ error: "缺少主口播稿，请先完成改写步骤" }, { status: 400 });
  }

  const adoptedAt = Date.now();
  const adoptedContent = dedup.content.trim();
  const rewriteMeta = rewrite.meta ? (() => {
    try { return JSON.parse(rewrite.meta || "{}"); } catch { return {}; }
  })() : {};
  patchArtifact(rewrite.id, {
    content: adoptedContent,
    meta: JSON.stringify({
      ...rewriteMeta,
      adoptedFrom: "dedup",
      adoptedFromArtifactId: dedup.id,
      adoptedAt,
    }),
  });

  fs.writeFileSync(path.join(taskDir(id), "script.txt"), adoptedContent, "utf-8");

  const invalidatedDownstream = downstreamOf("rewrite");
  for (const step of invalidatedDownstream) {
    setStepStatus(id, step, { status: "pending", output: "", error: "", progress: 0 });
  }
  setStepStatus(id, "rewrite", {
    output: JSON.stringify({
      adoptedFrom: "dedup",
      adoptedAt,
      rewriteLen: adoptedContent.length,
      invalidatedDownstream,
    }),
  });

  return NextResponse.json({
    ok: true,
    adoptedAt,
    rewriteArtifactId: rewrite.id,
    dedupArtifactId: dedup.id,
    invalidatedDownstream,
  });
}
