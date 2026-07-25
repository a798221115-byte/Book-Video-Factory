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
  ["app", "api", "tasks", "[id]", "publication", "route.ts"],
  ["app", "api", "tasks", "[id]", "metrics", "route.ts"],
]) {
  assert.ok(exists(...route), `missing API route ${route.join("/")}`);
}

const uploader = read("scripts", "upload_weixin_draft.py");
assert.match(uploader, /is_draft=True/, "uploader must force draft mode");
assert.doesNotMatch(uploader, /click\([^)]*正式发布/, "adapter must not automate formal publication");

const manifest = JSON.parse(read("integrations", "third-party-tools.json"));
assert.equal(manifest.tools["social-auto-upload"].mode, "weixin_channels_draft_only");
assert.equal(manifest.tools["social-auto-upload"].formalPublishAutomation, false);
assert.match(manifest.tools["social-auto-upload"].installPath, /^F:\\/);
assert.match(manifest.tools["media-publish-check"].installPath, /^F:\\/);

const compliance = read("lib", "complianceWorkflow.ts");
assert.match(compliance, /existingThreadId: task\.codexThreadId/);
assert.match(compliance, /media-publish-check/);
assert.match(compliance, /action: "generate_long"/, "C01 pass must start the title branch");
assert.match(compliance, /continuePostProduction: false/, "C01 pass must start early voice without post-production");

console.log("workflow-extension-verification-ok");
