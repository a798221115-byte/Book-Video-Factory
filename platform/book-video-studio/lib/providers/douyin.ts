// 抖音解析 Provider（架构图：providers/douyin.ts）
// 抽象接口，留 fetchVideo(url) -> {title, author, stats, downloadUrl, coverUrl}
// 默认实现调 TikHub，未配 key 时降级到 Mock
import fs from "node:fs";
import path from "node:path";

export interface DouyinVideo {
  title: string;
  author: string;
  awemeId: string;
  stats: { plays?: number; likes?: number; comments?: number; shares?: number; followers?: number; duration?: number; publishedAt?: number };
  downloadUrl: string; // 无水印 mp4
  coverUrl: string;
  rawAsr?: string;     // 部分接口直接返回字幕/逐字稿
}

export interface DouyinProvider {
  fetchVideo(url: string): Promise<DouyinVideo>;
}

// 工具：3 次指数退避
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 500 * 2 ** i)); }
  }
  throw lastErr;
}

// 从抖音短链 redirect 拿 aweme_id
async function resolveAwemeId(url: string): Promise<string> {
  // 已是长链直接正则
  const direct = url.match(/video\/(\d{15,})/);
  if (direct) return direct[1];
  // 短链 follow redirect
  const resp = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (iPhone)" } });
  const finalUrl = resp.url;
  const m = finalUrl.match(/video\/(\d{15,})/) || finalUrl.match(/modal_id=(\d{15,})/);
  if (!m) throw new Error(`无法从链接解析 aweme_id: ${finalUrl}`);
  return m[1];
}

// TikHub 实现
export class TikHubProvider implements DouyinProvider {
  constructor(private apiKey: string, private baseUrl = "https://api.tikhub.io") {}

  async fetchVideo(url: string): Promise<DouyinVideo> {
    return withRetry(async () => {
      const awemeId = await resolveAwemeId(url);
      const api = `${this.baseUrl}/api/v1/douyin/web/fetch_one_video?aweme_id=${awemeId}`;
      const resp = await fetch(api, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      if (!resp.ok) throw new Error(`TikHub ${resp.status}: ${await resp.text()}`);
      const json: any = await resp.json();
      const d = json?.data?.aweme_detail ?? json?.data ?? json;
      const downloadUrl =
        d?.video?.play_addr?.url_list?.[0] ??
        d?.video?.download_addr?.url_list?.[0] ?? "";
      return {
        title: d?.desc ?? "",
        author: d?.author?.nickname ?? "",
        awemeId,
        stats: {
          plays: d?.statistics?.play_count,
          likes: d?.statistics?.digg_count,
          comments: d?.statistics?.comment_count,
          shares: d?.statistics?.share_count,
          followers: d?.author?.follower_count,
          duration: d?.video?.duration ? Math.round(Number(d.video.duration) / 1000) : undefined,
          publishedAt: d?.create_time ? Number(d.create_time) * 1000 : undefined,
        },
        downloadUrl,
        coverUrl: d?.video?.cover?.url_list?.[0] ?? "",
      };
    });
  }
}

// Mock 实现（无 key 时跑通流程）
export class MockProvider implements DouyinProvider {
  async fetchVideo(url: string): Promise<DouyinVideo> {
    await new Promise((r) => setTimeout(r, 800));
    return {
      title: "关于衰老，肌肉，蛋白质摄入，值得一看 #读书 #健康饮食",
      author: "xWT111",
      awemeId: "mock_" + Date.now(),
      stats: { plays: 1280000, likes: 53000, comments: 1200, shares: 8900, followers: 86000, duration: 88, publishedAt: Date.now() - 86400_000 },
      downloadUrl: "MOCK", // 标记 mock，extract 里跳过真实下载
      coverUrl: "",
      rawAsr:
        "大家好今天给大家分享一本书，这本书讲的是衰老和肌肉的关系。" +
        "很多人到了五十岁以后开始发福，没力气，其实是肌肉在悄悄流失。" +
        "作者彼得阿提亚在书里提到，蛋白质摄入对中老年人特别重要，" +
        "每天每公斤体重要摄入一克二到一克六的蛋白质。" +
        "肌肉、骨骼、血管、大脑、肠道，看起来是五个不同的身体系统，" +
        "但它们其实共同决定了一个人到了中老年以后是越活越健康还是越活越衰弱。" +
        "记得点赞收藏关注我，每天分享好书，喜欢的话主页有更多内容。",
    };
  }
}

export function getDouyinProvider(): DouyinProvider {
  const key = process.env.TIKHUB_API_KEY;
  if (key && key.trim()) return new TikHubProvider(key.trim());
  if (process.env.ALLOW_MOCK_PROVIDERS === "1") return new MockProvider();
  throw new Error("抖音采集需要配置 TIKHUB_API_KEY；第一版不会用模拟数据替代真实视频。");
}
