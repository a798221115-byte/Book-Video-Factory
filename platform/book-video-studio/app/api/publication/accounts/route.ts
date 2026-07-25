import { NextResponse } from "next/server";
import { listWeixinAccounts, SOCIAL_UPLOAD_ROOT, WEIXIN_ACCOUNTS_DIR } from "@/lib/socialUpload";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    accounts: listWeixinAccounts().map(({ file: _file, ...account }) => account),
    accountsDirectory: WEIXIN_ACCOUNTS_DIR,
    toolRoot: SOCIAL_UPLOAD_ROOT,
    mode: "draft_only",
  });
}
