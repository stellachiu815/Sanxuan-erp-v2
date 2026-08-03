/**
 * V32 §一 printMainText 重載回填——純函式（無 Prisma，便於單元測試）。
 * 把 entryId → printMainText 併入 entries；map 未含者維持自身既有值。
 */
export function mergePrintMainText<T extends { id: string }>(
  entries: T[],
  byId: Map<string, string | null>
): (T & { printMainText: string | null })[] {
  return entries.map((e) => ({
    ...e,
    printMainText: byId.has(e.id)
      ? byId.get(e.id) ?? null
      : (e as { printMainText?: string | null }).printMainText ?? null,
  }));
}
