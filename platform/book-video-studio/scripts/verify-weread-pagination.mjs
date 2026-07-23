import assert from "node:assert/strict";
import {
  mergeRankedHighlights,
  paginateRankedHighlights,
} from "../lib/providers/weread.ts";

const source = Array.from({ length: 25 }, (_, index) => ({
  id: `highlight-${index + 1}`,
  text: `热门划线 ${index + 1}`,
  chapter: `第 ${Math.floor(index / 5) + 1} 章`,
  count: 2500 - index * 50,
  chapterUid: Math.floor(index / 5) + 1,
  range: `${index * 10}-${index * 10 + 8}`,
}));
const duplicateWithHigherCount = {
  ...source[12],
  count: source[12].count + 5,
};
const ranked = mergeRankedHighlights([
  source.slice(0, 20),
  [duplicateWithHigherCount, ...source.slice(20)],
]);

assert.equal(ranked.length, 25, "重复划线应被去重");
assert.equal(
  ranked.find((item) => item.id === duplicateWithHigherCount.id)?.count,
  duplicateWithHigherCount.count,
  "重复划线应保留更高热度",
);
assert.ok(
  ranked.every((item, index) => index === 0 || ranked[index - 1].count >= item.count),
  "所有划线必须按热度降序排列",
);

const first = paginateRankedHighlights(ranked, 0, 10);
const second = paginateRankedHighlights(ranked, 10, 10);
const third = paginateRankedHighlights(ranked, 20, 10);
assert.equal(first.highlights.length, 10);
assert.equal(second.highlights.length, 10);
assert.equal(third.highlights.length, 5);
assert.equal(first.hasMore, true);
assert.equal(second.hasMore, true);
assert.equal(third.hasMore, false);
assert.equal(
  new Set([...first.highlights, ...second.highlights, ...third.highlights].map((item) => item.id)).size,
  25,
  "连续获取不应出现重复划线",
);

console.log(JSON.stringify({
  ok: true,
  pages: [first.highlights.length, second.highlights.length, third.highlights.length],
  total: ranked.length,
}));
