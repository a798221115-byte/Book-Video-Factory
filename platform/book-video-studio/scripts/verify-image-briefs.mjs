#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "lib", "steps", "imageBriefs.ts");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "book-video-studio-image-briefs-"));
const compiledPath = path.join(tempDir, "imageBriefs.mjs");

function compileHelper() {
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  fs.writeFileSync(compiledPath, compiled, "utf8");
}

function uniqueCount(values) {
  return new Set(values).size;
}

try {
  compileHelper();
  const helper = await import(pathToFileURL(compiledPath).href);
  const {
    buildFallbackImageBriefs,
    expandImageBriefs,
    isImageBriefUsable,
    normalizeImageBrief,
    selectQualityImageBriefs,
  } = helper;

  const sources = [
    "睡眠变差以后，身体会先从饮食和运动习惯里露出信号。",
    "真正的改变不是立刻吃药，而是把每天的小选择重新整理好。",
  ];

  assert.equal(normalizeImageBrief("1.  晨光里的书桌。"), "晨光里的书桌");
  assert.equal(isImageBriefUsable("生活", sources), false, "generic brief should be rejected");
  assert.equal(isImageBriefUsable("睡眠变差以后身体会先从饮食", sources), false, "direct source reuse should be rejected");
  assert.equal(
    isImageBriefUsable("晨光里的翻开书页与茶杯", sources, ["晨光里的翻开书页与茶杯"]),
    false,
    "exact duplicate should be rejected",
  );
  assert.equal(
    isImageBriefUsable("午后柔光里的翻开书页与茶杯", sources, ["晨光里的翻开书页与茶杯"]),
    false,
    "near duplicate should be rejected",
  );
  assert.equal(isImageBriefUsable("厨房窗边的清淡早餐", sources), true, "safe visual metaphor should pass");

  const selected = selectQualityImageBriefs(sources, [
    "生活",
    "睡眠变差以后身体会先从饮食",
    "厨房窗边的清淡早餐",
    "厨房窗边的清淡早餐",
    "运动鞋旁的水杯",
  ], 3);
  assert.deepEqual(selected, ["厨房窗边的清淡早餐", "运动鞋旁的水杯"]);

  const fallback = buildFallbackImageBriefs(sources, selected, 90);
  assert.equal(fallback.length, 90, "fallback should reach current backend max target count");
  assert.equal(uniqueCount(fallback), fallback.length, "fallback should not duplicate briefs");
  for (const brief of fallback) {
    assert.ok(brief.length >= 6 && brief.length <= 25, `fallback brief length invalid: ${brief}`);
    assert.equal(isImageBriefUsable(brief, sources, fallback.filter((item) => item !== brief)), true, `fallback brief unusable: ${brief}`);
  }

  const expansionCalls = [];
  const expanded = await expandImageBriefs(
    sources,
    [
      "厨房窗边的清淡早餐",
      "生活",
      "睡眠变差以后身体会先从饮食",
      "厨房窗边的清淡早餐",
    ],
    8,
    async (request) => {
      expansionCalls.push(request);
      return [
        "厨房窗边的清淡早餐",
        "午后柔光里的厨房窗边的清淡早餐",
        "睡眠变差以后身体会先从饮食",
        "生活场景",
        "运动鞋旁的水杯",
      ];
    },
  );
  assert.equal(expansionCalls.length, 1, "LLM expander should be called when seed briefs are insufficient");
  assert.deepEqual(
    expansionCalls[0].existingBriefs,
    ["厨房窗边的清淡早餐"],
    "expander should receive only quality-filtered seed briefs",
  );
  assert.equal(expanded.length, 8, "expansion fallback should fill LLM shortfall to target count");
  assert.equal(uniqueCount(expanded), expanded.length, "expanded briefs should stay unique");
  assert.ok(expanded.includes("厨房窗边的清淡早餐"), "expanded result should keep valid seed brief");
  assert.ok(expanded.includes("运动鞋旁的水杯"), "expanded result should keep the one valid LLM brief");
  assert.equal(expanded.includes("生活场景"), false, "expanded result should reject generic LLM brief");
  assert.equal(expanded.includes("睡眠变差以后身体会先从饮食"), false, "expanded result should reject direct source reuse");
  for (const brief of expanded) {
    assert.ok(brief.length >= 6 && brief.length <= 25, `expanded brief length invalid: ${brief}`);
    assert.equal(isImageBriefUsable(brief, sources, expanded.filter((item) => item !== brief)), true, `expanded brief unusable: ${brief}`);
  }

  console.log("OK: image brief filters, LLM expansion fallback, and 90-item fallback all produce distinct visual briefs.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
