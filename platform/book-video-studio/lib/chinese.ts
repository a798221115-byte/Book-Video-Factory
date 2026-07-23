import * as OpenCC from "opencc-js";

const traditionalToSimplified = OpenCC.Converter({ from: "tw", to: "cn" });

export function toSimplifiedChinese(value: string) {
  return traditionalToSimplified(String(value || "")).normalize("NFKC");
}

export function normalizeSegmentedTranscript(value: string) {
  return toSimplifiedChinese(value)
    .replace(/\r/g, "")
    .replace(/^```(?:text|txt|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/(?<=[\p{Script=Han}》」』）]),(?=[\p{Script=Han}《「『（])/gu, "，")
    .replace(/(?<=[\p{Script=Han}》」』）]):(?=[\p{Script=Han}《「『（])/gu, "：")
    .replace(/(?<=[\p{Script=Han}》」』）]);(?=[\p{Script=Han}《「『（])/gu, "；")
    .replace(/(?<=[\p{Script=Han}》」』）])!(?=$|\s|[\p{Script=Han}《「『（])/gu, "！")
    .replace(/(?<=[\p{Script=Han}》」』）])\?(?=$|\s|[\p{Script=Han}《「『（])/gu, "？")
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
