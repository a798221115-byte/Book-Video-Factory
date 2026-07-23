#!/usr/bin/env node

import {
  STILL_IMAGE_MOTIONS,
  assignStillImageMotions,
  stillImageMotionFilter,
} from "../lib/stillImageMotion.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const keys = Array.from({ length: 40 }, (_, index) => `S${String(index + 1).padStart(2, "0")}.png`);
const first = assignStillImageMotions(keys);
const second = assignStillImageMotions(keys);

assert(JSON.stringify(first) === JSON.stringify(second), "assignment must be reproducible");
assert(first.length === keys.length, "every slide must receive one motion");
assert(first.every((motion) => STILL_IMAGE_MOTIONS.includes(motion)), "unknown motion assigned");
for (let index = 1; index < first.length; index += 1) {
  assert(first[index] !== first[index - 1], `adjacent duplicate at slide ${index + 1}`);
}
assert(new Set(first).size === STILL_IMAGE_MOTIONS.length, "all four motions should occur");

for (const motion of STILL_IMAGE_MOTIONS) {
  const filter = stillImageMotionFilter(motion, {
    width: 1080,
    height: 1920,
    duration: 8,
    fps: 60,
    supersample: 2,
  });
  assert(filter.includes("trim=end_frame=480"), `${motion} must use its full 8-second frame count`);
  assert(filter.includes("scale=1080:1920:flags=lanczos"), `${motion} must finish at delivery size`);
  if (motion.startsWith("zoom-")) {
    assert(filter.includes("x='(iw-2160)/2'"), `${motion} must stay centered`);
    assert(!filter.includes("x='432*"), `${motion} must not pan`);
  } else {
    assert(filter.includes("scale=2592:4608:flags=lanczos"), `${motion} must keep fixed 120% coverage`);
    assert(!filter.includes("scale=w="), `${motion} must not zoom`);
  }
}

console.log(`[ok] ${first.length} deterministic assignments passed with no adjacent duplicates.`);
console.log(`[ok] ${STILL_IMAGE_MOTIONS.length} isolated motion filters passed.`);
