/**
 * V35 追查：找出「115 普渡但落在 V35 清除範圍外」的報名（唯讀，只 SELECT，不修改/刪除/commit）。
 *
 * 定義：ritual_records 中 activityType='UNIVERSAL_SALVATION' AND year=115，
 *       但 templeEventId 為 NULL 或不等於「115 普渡 TempleEvent」的那筆，即為範圍外。
 *
 *   npx tsx scripts/diagnoseOutOfScopeUS115.ts
 */
import { prisma } from "../src/lib/prisma";

const YEAR = 115;
const ACTIVITY = "UNIVERSAL_SALVATION";

async function q<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...params);
}

async function main() {
  // 標準範圍活動（可能不存在）。
  const events = await q<{ id: string; name: string; year: number; activityType: string }>(
    `SELECT "id","name","year","activityType" FROM "temple_events" WHERE "activityType"::text=$1 AND "year"=$2`,
    ACTIVITY, YEAR
  );
  const scopeEventId = events[0]?.id ?? null;
  console.log(`115 普渡標準 TempleEvent：${scopeEventId ? `${scopeEventId}｜${events[0].name}` : "（不存在）"}`);
  if (events.length > 1) console.log(`⚠️ 偵測到 ${events.length} 筆 115 普渡 TempleEvent（應唯一）：`, events.map((e) => e.id));

  // 範圍外報名：year=115、US，但 templeEventId 為 NULL 或 != 標準活動。
  const rows = scopeEventId
    ? await q<{ id: string; templeEventId: string | null; householdId: string; status: string; createdAt: Date; deletedAt: Date | null }>(
        `SELECT "id","templeEventId","householdId","status","createdAt","deletedAt"
         FROM "ritual_records"
         WHERE "activityType"::text=$1 AND "year"=$2 AND ("templeEventId" IS NULL OR "templeEventId" <> $3)
         ORDER BY "createdAt" ASC`,
        ACTIVITY, YEAR, scopeEventId
      )
    : await q<{ id: string; templeEventId: string | null; householdId: string; status: string; createdAt: Date; deletedAt: Date | null }>(
        `SELECT "id","templeEventId","householdId","status","createdAt","deletedAt"
         FROM "ritual_records"
         WHERE "activityType"::text=$1 AND "year"=$2
         ORDER BY "createdAt" ASC`,
        ACTIVITY, YEAR
      );

  console.log(`\n範圍外普渡報名：${rows.length} 筆\n`);

  for (const r of rows) {
    // 家戶
    const hh = (await q<{ id: string; name: string; contactName: string | null; deletedAt: Date | null }>(
      `SELECT "id","name","contactName","deletedAt" FROM "households" WHERE "id"=$1`, r.householdId
    ))[0];
    // 報名人（RitualParticipant 快照；可能多位）
    const parts = await q<{ nameSnapshot: string; deletedAt: Date | null }>(
      `SELECT "nameSnapshot","deletedAt" FROM "ritual_participants" WHERE "ritualRecordId"=$1 ORDER BY "createdAt" ASC`, r.id
    );
    const partNames = parts.map((p) => p.nameSnapshot + (p.deletedAt ? "（已移除）" : "")).join("、") || "（無 participant 快照）";
    // 掛到的 TempleEvent（若有）
    let linkedEvent: { id: string; name: string; year: number; activityType: string } | null = null;
    if (r.templeEventId) {
      linkedEvent = (await q<{ id: string; name: string; year: number; activityType: string }>(
        `SELECT "id","name","year","activityType" FROM "temple_events" WHERE "id"=$1`, r.templeEventId
      ))[0] ?? null;
    }
    // 判定原因
    let reason: string;
    if (r.templeEventId == null) {
      reason = "templeEventId 為 NULL——未綁定任何 TempleEvent（V10.0 前或未經活動精靈建立的普渡資料）。";
    } else if (!scopeEventId) {
      reason = "系統目前沒有 115 普渡標準 TempleEvent，故此筆無法歸入標準範圍。";
    } else if (!linkedEvent) {
      reason = `templeEventId=${r.templeEventId} 指向不存在的 TempleEvent（孤兒參照）。`;
    } else if (linkedEvent.year !== YEAR || linkedEvent.activityType !== ACTIVITY) {
      reason = `掛到其他活動/年度的 TempleEvent（${linkedEvent.activityType}／${linkedEvent.year}）。`;
    } else {
      reason = `掛到另一個 115 普渡 TempleEvent（${linkedEvent.id}，與標準活動 ${scopeEventId} 不同——重複活動）。`;
    }

    console.log("──────────────────────────────────────────");
    console.log(`ritualRecord.id     ：${r.id}`);
    console.log(`templeEventId       ：${r.templeEventId ?? "NULL"}`);
    console.log(`TempleEvent 名稱     ：${linkedEvent?.name ?? "（無）"}`);
    console.log(`TempleEvent 年度     ：${linkedEvent?.year ?? "（無）"}`);
    console.log(`TempleEvent 活動類型 ：${linkedEvent?.activityType ?? "（無）"}`);
    console.log(`Household           ：${hh ? `${hh.id}｜${hh.name}${hh.contactName ? `｜聯絡人 ${hh.contactName}` : ""}${hh.deletedAt ? "｜(家戶已軟刪)" : ""}` : `${r.householdId}（查無家戶）`}`);
    console.log(`報名人（快照）       ：${partNames}`);
    console.log(`RitualRecord 狀態    ：${r.status}${r.deletedAt ? "（已軟刪）" : ""}`);
    console.log(`建立時間            ：${r.createdAt.toISOString()}`);
    console.log(`未落入 V35 範圍原因   ：${reason}`);
  }
  console.log("──────────────────────────────────────────");
  console.log("\n（唯讀診斷結束，未修改任何資料。）");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
