import { NextRequest, NextResponse } from "next/server";
import { getArtifacts, getTask, patchArtifact, saveArtifact } from "@/lib/pipeline/repo";

function readConfig(taskId: string, key: string) {
  for (const a of getArtifacts(taskId)) {
    if (a.stepName !== "config" || a.kind !== "json" || !a.meta) continue;
    try {
      const meta = JSON.parse(a.meta);
      if (meta.key === key) return { artifact: a, meta };
    } catch { /* ignore bad config artifact */ }
  }
  return null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getTask(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const key = req.nextUrl.searchParams.get("key") || "";
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  const config = readConfig(id, key);
  return NextResponse.json({ ok: true, key, value: config?.meta?.value ?? null });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getTask(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const key = String(body.key || "").trim();
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const meta = {
    key,
    value: body.value ?? null,
    updatedAt: Date.now(),
  };
  const existing = readConfig(id, key);
  if (existing) {
    patchArtifact(existing.artifact.id, {
      label: `${key} 配置`,
      meta: JSON.stringify(meta),
    });
  } else {
    saveArtifact({
      taskId: id,
      stepName: "config",
      kind: "json",
      label: `${key} 配置`,
      meta,
    });
  }

  return NextResponse.json({ ok: true, key, value: meta.value });
}
