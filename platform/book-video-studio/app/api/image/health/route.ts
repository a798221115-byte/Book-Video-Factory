import { NextResponse } from "next/server";
import { getConfiguredImageChannels, probeImageChannel } from "@/lib/providers/image";

export const dynamic = "force-dynamic";

export async function GET() {
  let channels;
  try {
    channels = getConfiguredImageChannels();
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      channels: [],
      message: String(error?.message || error || "GPT Image 2 API kit 配置不可用"),
    }, { status: 503 });
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
