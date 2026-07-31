import { NextResponse } from "next/server";
import {
  listSocialAccounts, listWeixinAccounts, SOCIAL_ACCOUNTS_DIR,
  SOCIAL_UPLOAD_ROOT, WEIXIN_ACCOUNTS_DIR,
} from "@/lib/socialUpload";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    accounts: listWeixinAccounts().map(({ file: _file, ...account }) => account),
    socialAccounts: listSocialAccounts().map(({ file: _file, ...account }) => account),
    accountsDirectory: WEIXIN_ACCOUNTS_DIR,
    socialAccountsDirectory: SOCIAL_ACCOUNTS_DIR,
    toolRoot: SOCIAL_UPLOAD_ROOT,
    mode: "explicit_authorization_multi_platform_publish",
    supportedPlatforms: ["douyin", "weixin_channels"],
  });
}
