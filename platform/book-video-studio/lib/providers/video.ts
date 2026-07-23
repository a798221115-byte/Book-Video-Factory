import { getDouyinProvider, type DouyinVideo } from "./douyin";

export type SourcePlatform = "douyin" | "wechat_channels" | "mock";

export interface SourceVideo extends DouyinVideo {
  platform: SourcePlatform;
  platformLabel: string;
  sourceId: string;
  encryptedDownloadUrl?: string;
  decodeKey?: string;
  media?: any;
}

export interface SourceVideoProvider {
  fetchVideo(url: string): Promise<SourceVideo>;
}

function isWechatChannelsUrl(url: string) {
  return /https?:\/\/weixin\.qq\.com\/sph\/[A-Za-z0-9]+\/?/i.test(url);
}

function extractWechatChannelsUrl(input: string) {
  return input.match(/https?:\/\/weixin\.qq\.com\/sph\/[A-Za-z0-9]+\/?/i)?.[0] || "";
}

function firstOf(value: any): string {
  if (Array.isArray(value)) return value.find(Boolean) || "";
  return value || "";
}

function joinUrlToken(url?: string, token?: string) {
  if (!url) return "";
  return token ? `${url}${token}` : url;
}

function stringifyId(value: any) {
  return value === undefined || value === null ? "" : String(value);
}

function textValue(...values: any[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "bigint") return String(value);
  }
  return "";
}

function numberValue(value: any): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function maskSecret(value: string) {
  if (!value) return "";
  return value.length <= 8 ? "***" : `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function redactWechatPayload(payload: any) {
  if (!payload) return payload;
  const copy = jsonClone(payload);
  const media = copy?.data?.data?.media || copy?.data?.media || copy?.data?.objects?.[0]?.objectDesc?.media?.[0];
  if (media?.decode_key) media.decode_key = maskSecret(String(media.decode_key));
  if (media?.decodeKey) media.decodeKey = maskSecret(String(media.decodeKey));
  return copy;
}

export function redactSourceVideoForArtifact(video: SourceVideo): SourceVideo {
  if (video.platform !== "wechat_channels") return { ...video, downloadUrl: "" };
  const copy = jsonClone(video);
  if (copy.decodeKey) copy.decodeKey = maskSecret(String(copy.decodeKey));
  if (copy.media?.decode_key) copy.media.decode_key = maskSecret(String(copy.media.decode_key));
  if (copy.media?.decodeKey) copy.media.decodeKey = maskSecret(String(copy.media.decodeKey));
  if ((copy as any).raw) (copy as any).raw = redactWechatPayload((copy as any).raw);
  copy.downloadUrl = "";
  copy.encryptedDownloadUrl = copy.encryptedDownloadUrl ? "[redacted]" : "";
  return copy;
}

class DouyinSourceProvider implements SourceVideoProvider {
  async fetchVideo(url: string): Promise<SourceVideo> {
    const video = await getDouyinProvider().fetchVideo(url);
    return {
      ...video,
      platform: video.downloadUrl === "MOCK" ? "mock" : "douyin",
      platformLabel: video.downloadUrl === "MOCK" ? "Mock" : "抖音",
      sourceId: video.awemeId,
    };
  }
}

class TikHubWechatChannelsProvider implements SourceVideoProvider {
  constructor(private apiKey: string, private baseUrl = "https://api.tikhub.io") {}

  async fetchVideo(url: string): Promise<SourceVideo> {
    const shareUrl = extractWechatChannelsUrl(url);
    if (!shareUrl) throw new Error("视频号采集需要 https://weixin.qq.com/sph/... 分享链接");

    const api = `${this.baseUrl.replace(/\/$/, "")}/api/v1/wechat_channels/v2/fetch_video_detail`;
    const resp = await fetch(api, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({ share_url: shareUrl, raw: false }),
    });
    if (!resp.ok) throw new Error(`TikHub 视频号 ${resp.status}: ${await resp.text()}`);
    const json: any = await resp.json();
    const d = json?.data?.data ?? json?.data ?? json;
    const media = Array.isArray(d?.media) ? d.media[0] : d?.media || {};
    const encryptedDownloadUrl = media.full_url || joinUrlToken(media.url, media.url_token || media.urlToken);
    const decodeKey = media.decode_key || media.decodeKey || "";
    const objectId = stringifyId(d?.id || d?.object_id || d?.objectId);

    return {
      platform: "wechat_channels",
      platformLabel: "视频号",
      sourceId: objectId,
      awemeId: objectId,
      title: textValue(d?.title, d?.description, d?.desc) || "视频号素材",
      author: textValue(d?.nickname, d?.author?.nickname, d?.author?.name),
      stats: {
        plays: numberValue(d?.read_count ?? d?.play_count),
        likes: numberValue(d?.like_count),
        comments: numberValue(d?.comment_count),
        shares: numberValue(d?.forward_count ?? d?.share_count),
        duration: numberValue(media?.duration),
        publishedAt: d?.create_time ? Number(d.create_time) * 1000 : undefined,
      },
      downloadUrl: "",
      encryptedDownloadUrl,
      decodeKey,
      coverUrl: firstOf([media?.cover_url, media?.coverUrl, d?.cover_url, d?.coverUrl]),
      rawAsr: d?.transcript || d?.asr_text || d?.caption || "",
      media,
      raw: redactWechatPayload(json),
    } as SourceVideo;
  }
}

export function getVideoProvider(sourceUrl: string): SourceVideoProvider {
  if (isWechatChannelsUrl(sourceUrl)) {
    const key = process.env.TIKHUB_API_KEY?.trim();
    if (!key) throw new Error("视频号采集需要配置 TIKHUB_API_KEY");
    return new TikHubWechatChannelsProvider(key, process.env.TIKHUB_BASE_URL?.trim() || "https://api.tikhub.io");
  }
  return new DouyinSourceProvider();
}
