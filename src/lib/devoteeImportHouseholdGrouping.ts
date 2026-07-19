/**
 * V11.3「信眾資料匯入預檢中心」——家戶判斷（需求「第七步」）。
 *
 * 這裡只處理「同一份 Excel 檔案內」的分組線索，完全不查資料庫（跟資料庫
 * 既有家戶的比對是 devoteeImportDuplicateCheck.ts 的責任，兩者刻意分開，
 * 這支維持純函式方便測試）。
 *
 * ⚠️ 核心原則（逐字對應需求）：不得只因地址相同就百分之百自動合併——這裡
 * 「不會」自動幫任何一列決定它一定屬於哪一戶，只會回傳「這一列目前看起來
 * 屬於哪個戶號」以及「有沒有不確定/衝突的地方」，最終是否可以匯入交給
 * 呼叫端（devoteeImportBatch.ts）依這個結果決定狀態。
 */

export type RowHouseholdSignals = {
  rowNumber: number;
  code: string; // 空字串代表這一列沒有填戶號
  address: string | null;
  contactName: string | null;
  phone: string | null;
};

export type HouseholdGroupResolution = {
  rowNumber: number;
  /** 這一列目前可以使用的戶號；null 代表還無法確定，需要人工補上或指定既有家戶。 */
  resolvedCode: string | null;
  /** 家戶歸屬是否需要人工確認（戶號衝突、或完全沒有戶號且線索不足/衝突）。 */
  uncertain: boolean;
  reason: string | null;
};

/**
 * 依「戶號、地址、主要聯絡人、電話、原系統家庭編號」判斷檔案內同一份上傳
 * 裡，哪些列可能屬於同一戶（需求「第七步」）。
 */
export function resolveHouseholdGroups(rows: RowHouseholdSignals[]): HouseholdGroupResolution[] {
  const results = new Map<number, HouseholdGroupResolution>();

  // ---- 第一階段：有填戶號的列，直接依戶號分組，並檢查同一戶號在檔案內的
  // 家戶層級欄位（地址／主要聯絡人／電話）是否一致（比照既有 importRules.ts
  // checkHouseholdConsistency() 的同一種一致性檢查精神）。----
  const byCode = new Map<string, RowHouseholdSignals[]>();
  for (const r of rows) {
    if (!r.code) continue;
    if (!byCode.has(r.code)) byCode.set(r.code, []);
    byCode.get(r.code)!.push(r);
  }
  for (const [code, group] of byCode) {
    const addresses = new Set(group.map((g) => g.address).filter((v): v is string => !!v));
    const contacts = new Set(group.map((g) => g.contactName).filter((v): v is string => !!v));
    const phones = new Set(group.map((g) => g.phone).filter((v): v is string => !!v));
    const conflict = addresses.size > 1 || contacts.size > 1 || phones.size > 1;
    for (const r of group) {
      results.set(r.rowNumber, {
        rowNumber: r.rowNumber,
        resolvedCode: code,
        uncertain: conflict,
        reason: conflict
          ? `戶號「${code}」在檔案裡對應到不只一種地址／主要聯絡人／電話，請確認是否為同一戶`
          : null,
      });
    }
  }

  // ---- 第二階段：沒有填戶號的列，嘗試用「地址＋主要聯絡人」或「地址＋電話」
  // 找檔案內其他同樣沒有戶號的列聚類——只是提示「這幾列可能同戶」，不會
  // 自動生成戶號，一律標記為待確認。----
  const codelessRows = rows.filter((r) => !r.code);
  const clusterKeyOf = (r: RowHouseholdSignals): string | null => {
    if (r.address && r.contactName) return `A|${r.address}|${r.contactName}`;
    if (r.address && r.phone) return `P|${r.address}|${r.phone}`;
    return null;
  };
  const clusters = new Map<string, RowHouseholdSignals[]>();
  for (const r of codelessRows) {
    const key = clusterKeyOf(r);
    if (!key) continue;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(r);
  }
  for (const r of codelessRows) {
    const key = clusterKeyOf(r);
    const clusterSize = key ? clusters.get(key)!.length : 1;
    results.set(r.rowNumber, {
      rowNumber: r.rowNumber,
      resolvedCode: null,
      uncertain: true,
      reason:
        clusterSize > 1
          ? `這一列沒有填「戶號或原系統編號」，依地址／聯絡人／電話比對到檔案內其他 ${clusterSize - 1} 列疑似同一戶，請人工確認後補上戶號，或指定歸屬既有家戶`
          : `這一列沒有填「戶號或原系統編號」，也沒有足夠線索判斷同戶，請人工確認後補上戶號，或指定歸屬既有家戶`,
    });
  }

  return rows.map((r) => results.get(r.rowNumber)!);
}
