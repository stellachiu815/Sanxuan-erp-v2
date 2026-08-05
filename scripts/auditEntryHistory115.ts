/**
 * V36.12 牌位 Entry「身世」對帳（唯讀）：查某家戶本年度每一筆祖先/正魂/冤親/無緣 Entry
 * （含已封存）是誰、何時、透過什麼流程建立與修改的——直接回答「是不是系統自己新增/改的」。
 *
 * 資料來源＝record_versions（每次 CREATE/UPDATE/DELETE 都留操作人 operatorName＋說明 changeNote＋時間）。
 *   operatorName 以「系統：…」開頭＝程式連動；其餘＝人工輸入的操作人姓名。
 *   changeNote 例：Excel 匯入／沿用去年／重新報名：恢復…／自家戶永久名單補入陽上人…／（空）＝一般新增。
 *
 *   npx tsx scripts/auditEntryHistory115.ts                       # 預設 F00005,F00481
 *   npx tsx scripts/auditEntryHistory115.ts --household=F00005     # 指定單一家戶
 */
import { prisma } from "../src/lib/prisma";

const YEAR = 115;

async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }
const inList = (xs: string[]) => xs.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
const ts = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 19).replace("T", " ") : "—");

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--household="))?.slice(12);
  const households = arg ? [arg] : ["F00005", "F00481"];
  console.log(`=== V36.12 Entry 身世對帳（${YEAR} 普渡；家戶 ${households.join("、")}）唯讀 ===\n`);

  for (const hh of households) {
    const entries = await q<{ id: string; cat: string; disp: string; ta: string | null; ya: string[] | null; wrid: string | null; ca: Date; ua: Date; del: Date | null; src: string | null }>(
      `SELECT e."id", e."category"::text cat, e."displayName" disp, e."tabletAddress" ta, e."yangshangNames" ya, e."worshipRecordId" wrid,
              e."createdAt" ca, e."updatedAt" ua, e."deletedAt" del, rr."registrationSource"::text src
       FROM "universal_salvation_entries" e
       JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
       JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId"
       WHERE rr."householdId"=$1 AND rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'
       ORDER BY e."createdAt" ASC`, hh);

    console.log(`━━━━━━━ 家戶 ${hh}：Entry ${entries.length} 筆（含已封存）━━━━━━━`);
    if (!entries.length) { console.log("（無）\n"); continue; }

    for (const e of entries) {
      console.log(`\n▸ ${e.cat}｜${e.disp}｜entryId=${e.id}${e.del ? "｜⚠已封存" : ""}`);
      console.log(`   地址：${e.ta ?? "（空）"}｜陽上：[${(e.ya ?? []).join("、")}]｜worshipRecordId：${e.wrid ?? "（無）"}`);
      console.log(`   建立來源(record)：${e.src ?? "—"}｜createdAt=${ts(e.ca)}｜updatedAt=${ts(e.ua)}${e.del ? `｜deletedAt=${ts(e.del)}` : ""}`);

      const vers = await q<{ act: string; op: string | null; note: string | null; ca: Date }>(
        `SELECT "action"::text act, "operatorName" op, "changeNote" note, "createdAt" ca
         FROM "record_versions" WHERE "entityType"='UniversalSalvationEntry' AND "entityId"=$1 ORDER BY "createdAt" ASC`, e.id);
      if (!vers.length) { console.log(`   版本紀錄：（無——可能為早期資料，未留版本）`); continue; }
      console.log(`   版本紀錄（誰／何時／做了什麼）：`);
      for (const v of vers) {
        const who = v.op ? (v.op.startsWith("系統") ? `🤖 ${v.op}` : `👤 ${v.op}`) : "（未填操作人）";
        console.log(`     - ${ts(v.ca)}｜${v.act}｜${who}${v.note ? `｜${v.note}` : ""}`);
      }
    }

    // 同名重複偵測（同類別＋同核心名，地址不同）——點出「為什麼會有兩筆一樣的祖先」。
    const norm = (s: string) => s.replace(/[\s　]/g, "");
    const groups = new Map<string, typeof entries>();
    for (const e of entries.filter((x) => !x.del)) {
      const key = `${e.cat}|${norm(e.disp)}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
    }
    const dups = [...groups.entries()].filter(([, arr]) => arr.length > 1);
    if (dups.length) {
      console.log(`\n   ⚠ 同名重複（同類別同核心名、地址不同 → 系統以「名稱＋地址」判為不同牌位而並存）：`);
      for (const [key, arr] of dups) {
        console.log(`     ${key}：${arr.length} 筆`);
        for (const e of arr) console.log(`        · entryId=${e.id}｜地址「${e.ta ?? "空"}」｜陽上[${(e.ya ?? []).join("、")}]｜建立 ${ts(e.ca)}`);
      }
    }
    console.log("");
  }
  console.log(`（唯讀，未修改任何資料。判讀：CREATE 那一列的操作人＋說明＋時間，即為此 Entry 真正的建立來源。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
