import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const exists = (...parts) => fs.existsSync(path.join(root, ...parts));

const schema = read("lib", "db", "schema.ts");
for (const table of ["workflow_runs", "publication_records", "metric_snapshots"]) {
  assert.match(schema, new RegExp(`"${table}"`), `missing ${table}`);
}
assert.match(schema, /codexThreadId/, "tasks must retain one stable Codex task/thread id");

const steps = read("lib", "pipeline", "steps.ts");
for (const step of [
  "topic_discovery", "text_compliance", "voice_timeline",
  "media_compliance", "draft_upload", "publication", "analytics",
]) {
  assert.match(steps, new RegExp(`"${step}"`), `missing workflow step ${step}`);
}

for (const route of [
  ["app", "api", "topics", "weread", "route.ts"],
  ["app", "api", "tasks", "[id]", "compliance", "route.ts"],
  ["app", "api", "tasks", "[id]", "voice-timeline", "route.ts"],
  ["app", "api", "tasks", "[id]", "draft-upload", "route.ts"],
  ["app", "api", "tasks", "[id]", "auto-publish", "route.ts"],
  ["app", "api", "tasks", "[id]", "publication", "route.ts"],
  ["app", "api", "tasks", "[id]", "metrics", "route.ts"],
  ["app", "api", "tasks", "[id]", "rollback", "route.ts"],
]) {
  assert.ok(exists(...route), `missing API route ${route.join("/")}`);
}

const uploader = read("scripts", "upload_weixin_draft.py");
assert.match(uploader, /is_draft=True/, "uploader must force draft mode");
assert.doesNotMatch(uploader, /click\([^)]*正式发布/, "adapter must not automate formal publication");
const draftUploadRoute = read("app", "api", "tasks", "[id]", "draft-upload", "route.ts");
assert.match(draftUploadRoute, /duplicatePrevented/);
assert.match(draftUploadRoute, /waiting_publication_confirmation/, "restored draft must return to G08");
const autoPublishRoute = read("app", "api", "tasks", "[id]", "auto-publish", "route.ts");
assert.match(autoPublishRoute, /AUTO_PUBLISH_CONFIRMED/, "formal publication requires explicit per-task authorization");
assert.match(autoPublishRoute, /publicationIdempotencyKey/, "formal publication must be idempotent per target");
assert.match(autoPublishRoute, /publication_partial_failure/, "multi-platform partial failure must be retryable");
assert.match(autoPublishRoute, /publication-copy\.txt/, "formal publication must prefer the audited publication copy");
const socialPublisher = read("scripts", "publish_social_video.py");
assert.match(socialPublisher, /"douyin", "weixin_channels"/, "publisher must support Douyin and WeChat Channels");
assert.match(socialPublisher, /is_draft=False/, "authorized WeChat Channels publication must publish formally");
assert.match(socialPublisher, /含有AI生成内容/, "WeChat Channels publisher must select the AI-generated-content declaration");
assert.match(socialPublisher, /未确认视频号原创声明，已阻止正式发布/, "missing original declaration must fail closed");
assert.match(socialPublisher, /无法验证视频号AI生成声明已选中，已阻止正式发布/, "unverified AI declaration must fail closed");
assert.match(socialPublisher, /ProactorEventLoop/, "Windows async browser automation must use the verified Proactor thread runner");

const manifest = JSON.parse(read("integrations", "third-party-tools.json"));
assert.equal(manifest.tools["social-auto-upload"].mode, "explicit_authorization_multi_platform_publish");
assert.equal(manifest.tools["social-auto-upload"].formalPublishAutomation, true);
assert.equal(manifest.tools["social-auto-upload"].requiresPerTaskExplicitAuthorization, true);
assert.deepEqual(manifest.tools["social-auto-upload"].supportedPlatforms, ["douyin", "weixin_channels"]);
assert.match(manifest.tools["social-auto-upload"].installPath, /^F:\\/);
assert.match(manifest.tools["media-publish-check"].installPath, /^F:\\/);

const compliance = read("lib", "complianceWorkflow.ts");
assert.match(compliance, /existingThreadId: task\.codexThreadId/);
assert.match(compliance, /media-publish-check/);
assert.match(compliance, /action: "generate_long"/, "C01 pass must start the title branch");
assert.match(compliance, /autoSelect: true/, "C01 pass must automatically adopt long and short titles");
assert.match(compliance, /continuePostProduction: false/, "C01 pass must start early voice without post-production");
assert.match(compliance, /delivery-assets/);
assert.match(compliance, /approvalMode: "automatic"/, "C02 pass must automatically register delivery artifacts");

const styleRegistry = read("lib", "styleSampleRegistry.ts");
assert.match(styleRegistry, /approvalRequired: false/);
assert.match(styleRegistry, /approvalMode: "automatic"/);
assert.match(styleRegistry, /enqueueCodexRemainingImages/, "passing style sample must continue to remaining images");

const rollback = read("lib", "workflowRollback.ts");
for (const target of [
  "book", "sources", "script", "long_title", "short_title",
  "style", "images", "post_production", "delivery_review", "publication",
]) {
  assert.match(rollback, new RegExp(`"${target}"`), `missing rollback target ${target}`);
}
assert.match(rollback, /invalidatedAt/, "rollback must invalidate downstream artifacts");
assert.match(rollback, /superseded/, "rollback must supersede downstream runs");
assert.doesNotMatch(rollback, /clearArtifacts|deleteArtifact|rmSync|unlinkSync/, "rollback must preserve previous artifacts");

const intakeView = read("components", "intake", "IntakeTaskView.tsx");
for (const label of ["返回修改文稿", "返回重选长标题", "返回重选短标题", "返回修改风格样图", "返回修改分镜图片", "返回重做后期"]) {
  assert.match(intakeView, new RegExp(label), `missing workbench return action: ${label}`);
}
assert.match(intakeView, /第 1 次确认：确认文案并自动生产/);
assert.match(intakeView, /第 2 次确认：确认图片并自动完成后期/);
assert.match(intakeView, /action: "generate_long", autoSelect: true/);
assert.doesNotMatch(intakeView, /第三次确认：/);

console.log("workflow-extension-verification-ok");
