export function splitTextIntoChunks(text: string, maxChars = 1800): string[] {
  const normalized = String(text ?? "").replace(/\r/g, "").trim();
  if (!normalized) return [];

  const limit = Math.max(200, Math.floor(maxChars || 1800));
  const paragraphUnits = normalized.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const sentenceUnits = normalized.match(/[^。！？!?；;]+[。！？!?；;]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const wordUnits = normalized.split(/\s+/).map((s) => s.trim()).filter(Boolean);

  let units = [normalized];
  let joiner = "";
  if (paragraphUnits.length > 1) {
    units = paragraphUnits;
    joiner = "\n\n";
  } else if (sentenceUnits.length > 1) {
    units = sentenceUnits;
    joiner = "";
  } else if (wordUnits.length > 1) {
    units = wordUnits;
    joiner = " ";
  }

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const text = current.trim();
    if (text) chunks.push(text);
    current = "";
  };

  for (const unit of units) {
    const clean = unit.trim();
    if (!clean) continue;

    if (clean.length > limit) {
      flush();
      for (let i = 0; i < clean.length; i += limit) {
        const slice = clean.slice(i, i + limit).trim();
        if (slice) chunks.push(slice);
      }
      continue;
    }

    const candidate = current ? `${current}${joiner}${clean}` : clean;
    if (current && candidate.length > limit) {
      flush();
      current = clean;
    } else {
      current = candidate;
    }
  }

  flush();
  return chunks;
}
