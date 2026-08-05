/**
 * V36.12 唯讀診斷：牌位地址「張冠李戴」（抓到別戶地址）追查。全程唯讀、不寫入。
 *
 * 規則：地址＝牌位自身 tabletAddress；為空才退回該列印物件 memberId 對應信眾 Member.address。
 * 本腳本逐筆列出祖先／乙位正魂／冤親牌位的：
 *   - 牌位所屬家戶（tablet household）
 *   - entry.tabletAddress（牌位自身地址；空＝依賴 member 退回）
 *   - 列印物件 memberId → 該信眾所屬家戶＋地址
 *   - 實際列印地址（resolved）與其「來源」（entry 自身／member 退回）
 * 並標出 ⚠ 張冠李戴：地址來自 member 退回、且該 member 家戶 ≠ 牌位家戶。
 *
 *   npx tsx scripts/diagnoseTabletAddress115.ts
 *   npx tsx scripts/diagnoseTabletAddress115.ts --all   # 連同「地址正常」的也印
 */
import { prisma } from "../src/lib/prisma";
import { listPrintItemsForPrintCenter } from "../src/lib/additionalPrintItems";

const YEAR = 115;
const TABLET_CATS = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR"]);

async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }

async function main() {
  const showAll = process.argv.includes("--all");
  const views = (await listPrintItemsForPrintCenter(YEAR, {})).filter(
    (v) => v.itemType === "TABLET" && TABLET_CATS.has(v.sourceCategory)
  );
  console.log(`=== 牌位地址張冠李戴診斷（${YEAR} 普渡；牌位 ${views.length} 筆；唯讀）===\n`);

  // 每個列印物件的 memberId。
  const ids = views.map((v) => v.id);
  const objRows = ids.length
    ? await q<{ id: string; mid: string | null }>(
        `SELECT "id","memberId" AS mid FROM "additional_print_items" WHERE "id" IN (${ids.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")})`)
    : [];
  const memberIdByObj = new Map(objRows.map((r) => [r.id, r.mid]));

  // 相關 member → 家戶＋地址。
  const memberIds = [...new Set(objRows.map((r) => r.mid).filter((x): x is string => !!x))];
  const memRows = memberIds.length
    ? await q<{ id: string; hh: string; addr: string | null; name: string }>(
        `SELECT m."id", m."householdId" AS hh, m."address" AS addr, m."name" FROM "members" m WHERE m."id" IN (${memberIds.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")})`)
    : [];
  const memById = new Map(memRows.map((r) => [r.id, r]));

  let flagged = 0;
  for (const v of views) {
    const tabletAddr = (v.sourceTabletAddress ?? "").trim();
    const memberId = memberIdByObj.get(v.id) ?? null;
    const mem = memberId ? memById.get(memberId) : null;
    const resolved = (v.sourceLocation ?? "").trim();
    const fromEntry = tabletAddr.length > 0;                 // 地址來源＝牌位自身
    const fromMember = !fromEntry && resolved.length > 0;    // 地址來源＝member 退回
    const crossHousehold = fromMember && mem != null && mem.hh !== v.household.id; // ⚠ 別戶

    if (!showAll && !crossHousehold && tabletAddr && resolved) continue; // 只印可疑（除非 --all）

    const tag = crossHousehold ? "⚠ 張冠李戴" : (!resolved ? "· 地址空白" : fromMember ? "· member 退回" : "· 正常(牌位自身)");
    console.log(`${tag}｜${v.sourceCategory}｜${v.sourceDisplayName}`);
    console.log(`   牌位家戶：${v.household.id}（${v.household.name}）`);
    console.log(`   entry.tabletAddress：${tabletAddr || "（空）"}`);
    console.log(`   列印物件 memberId：${memberId ?? "（無）"}${mem ? `｜信眾「${mem.name}」家戶 ${mem.hh}｜地址「${mem.addr ?? "（空）"}」` : (memberId ? "｜⚠ 查無此信眾" : "")}`);
    console.log(`   實際列印地址：${resolved || "（空）"}（來源：${fromEntry ? "牌位自身" : fromMember ? "member 退回" : "無"}）\n`);
    if (crossHousehold) flagged++;
  }

  console.log(`── 結果：張冠李戴 ${flagged} 筆 ──`);
  console.log(flagged > 0
    ? `根因＝這些牌位 tabletAddress 為空，退回的 memberId 指到「別戶」信眾（合併搬移／補地址重複未更新 memberId 所致）。修法方向（待確認）：列印地址退回改「只用同戶信眾」或「家戶地址」，不得跨戶；或回填正確 tabletAddress。`
    : `未發現跨戶退回；若仍見錯址，可能為 tabletAddress 本身被存成別戶地址（補地址階段誤帶），我再加一支比對 tabletAddress 與家戶地址的檢查。`);
  console.log(`（唯讀，未修改任何資料。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
