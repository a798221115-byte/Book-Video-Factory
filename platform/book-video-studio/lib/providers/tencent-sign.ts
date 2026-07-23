// 腾讯云 TC3-HMAC-SHA256 签名（POST application/json，签 content-type;host;x-tc-action）
import crypto from "node:crypto";

function sha256hex(s: string | Buffer): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function hmac(key: Buffer | string, msg: string): Buffer {
  return crypto.createHmac("sha256", key).update(msg).digest();
}

export interface Tc3Opts {
  secretId: string; secretKey: string; host: string; service: string;
  action: string; version: string; region: string; payload: string;
}

// 返回腾讯云 API 所需的请求头
export function tc3Headers(o: Tc3Opts): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const ct = "application/json; charset=utf-8";
  const canonical =
    `POST\n/\n\ncontent-type:${ct}\nhost:${o.host}\nx-tc-action:${o.action.toLowerCase()}\n\n` +
    `content-type;host;x-tc-action\n` + sha256hex(o.payload);
  const scope = `${date}/${o.service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${ts}\n${scope}\n` + sha256hex(canonical);
  const secretDate = hmac("TC3" + o.secretKey, date);
  const secretService = hmac(secretDate, o.service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = crypto.createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
  const auth = `TC3-HMAC-SHA256 Credential=${o.secretId}/${scope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;
  return {
    Authorization: auth,
    "Content-Type": ct,
    Host: o.host,
    "X-TC-Action": o.action,
    "X-TC-Timestamp": String(ts),
    "X-TC-Version": o.version,
    "X-TC-Region": o.region,
  };
}
