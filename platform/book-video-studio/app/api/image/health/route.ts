import { NextResponse } from "next/server";
import { getConfiguredImageChannels, probeImageChannel } from "@/lib/providers/image";

export const dynamic = "force-dynamic";

export async function GET() {
  const channels = getConfiguredImageChannels();
  if (!channels.length) {
    return NextResponse.json({
      ok: true,
      channels: [{
        name: "mock-image",
        baseUrl: "local",
        model: "mock",
        keyHint: "无需 key",
        ok: true,
        status: 200,
        latencyMs: 0,
        message: "未配置外部生图通道，当前会使用本地占位图。",
      }],
    });
  }

  const results = await Promise.all(channels.map((channel) => probeImageChannel(channel)));
  return NextResponse.json({
    ok: results.some((item) => item.ok),
    channels: results.map((result, index) => ({
      ...channels[index],
      ...result,
    })),
  });
}
