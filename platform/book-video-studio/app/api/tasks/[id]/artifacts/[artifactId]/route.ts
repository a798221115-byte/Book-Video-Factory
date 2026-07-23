import { NextRequest, NextResponse } from "next/server";
import { getArtifactById, getArtifacts, getTask, patchArtifact, saveArtifact, updateArtifactContent, setStepStatus } from "@/lib/pipeline/repo";
import { downstreamOf, STEP_NAMES, type StepName } from "@/lib/pipeline/steps";
import { estimateSegmentDuration, splitScriptSegments, toScriptSegmentMeta } from "@/lib/steps/scriptSegments";

// 人工编辑文本产物（改写稿等）。保存后把该步下游全部置 pending（需重跑）
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; artifactId: string }> }) {
  const { id, artifactId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const content = typeof body?.content === "string" ? body.content : null;
  if (content === null) return NextResponse.json({ error: "缺少 content" }, { status: 400 });

  const a = getArtifactById(artifactId);
  if (!a || a.taskId !== id) return NextResponse.json({ error: "产物不存在" }, { status: 404 });

  updateArtifactContent(artifactId, content);

  let segmentWarning = "";
  if (a.stepName === "rewrite" && a.kind === "rewrite") {
    const task = getTask(id);
    if (task) {
      try {
        const segments = await splitScriptSegments(task, content);
        const meta = {
          source: "manual-edit",
          segments: toScriptSegmentMeta(segments).map((segment) => ({
            ...segment,
            estimatedDur: estimateSegmentDuration(segment.text),
          })),
          count: segments.length,
          updatedAt: Date.now(),
        };
        const existing = getArtifacts(id).find((artifact) => artifact.stepName === "rewrite" && artifact.kind === "segments");
        if (existing) {
          patchArtifact(existing.id, { meta: JSON.stringify(meta) });
        } else {
          saveArtifact({
            taskId: id,
            stepName: "rewrite",
            kind: "segments",
            label: "口播分段",
            meta,
          });
        }
      } catch (e: any) {
        segmentWarning = `口播分段刷新失败：${String(e?.message || e).slice(0, 160)}`;
      }
    }
  }

  // 编辑了某步产物 → 该步下游级联失效（需用户重跑）
  if (STEP_NAMES.includes(a.stepName as StepName)) {
    for (const ds of downstreamOf(a.stepName as StepName)) {
      setStepStatus(id, ds, { status: "pending", output: "", error: "", progress: 0 });
    }
  }
  return NextResponse.json({ ok: true, invalidatedDownstream: downstreamOf(a.stepName as StepName), segmentWarning });
}
