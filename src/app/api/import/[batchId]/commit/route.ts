/**
 * Excel 批次匯入 — 第二步：確認匯入。
 *
 * 只會處理上一步（preview）標記為 OK 的列：
 * - 依家戶編號分組，重新從 rawData 解析出完整的家戶/成員/祭祀資料
 *   （不用重新上傳檔案）。
 * - 匯入前「再檢查一次」家戶編號是否已存在（避免兩個人前後上傳造成的
 *   競爭情形），如果這時候才發現已存在，一樣不覆蓋、改標記成
 *   DUPLICATE_PENDING，不會寫入。
 * - 其餘 OK 的家戶才會真正建立 Household + Member + WorshipRecord。
 *
 * ERROR 與 DUPLICATE_PENDING 的列，這一步完全不會處理：
 * - ERROR：本來就不該匯入，要回去修正 Excel 重新上傳。
 * - DUPLICATE_PENDING：保留在資料庫的匯入紀錄裡，供之後人工查看
 *   （見 /api/import/pending），本輪不處理覆蓋/合併。
 *
 * 每個批次只能確認匯入一次（COMMITTED 之後重複呼叫會回錯誤，避免重複建立資料）。
 *
 * V11.3 補上原本沒有的權限管控（見 manageDataImport 說明）：body 必須帶
 * operatorUserId，一樣經過 assertSystemPermissionForOperator 驗證。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseImportRow, type ImportRawRow } from "@/lib/importRules";
import type { MemberRole } from "@prisma/client";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { addHouseholdYangshangBatch } from "@/lib/householdYangshang";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const body = await request.json().catch(() => ({}));
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "manageDataImport");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { batchId } = await params;

  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { rows: true },
  });
  if (!batch) {
    return NextResponse.json({ error: "找不到這個匯入批次" }, { status: 404 });
  }
  if (batch.status === "COMMITTED") {
    return NextResponse.json({ error: "這個批次已經確認匯入過了，不會重複匯入" }, { status: 409 });
  }

  const okRows = batch.rows.filter((r) => r.status === "OK");
  if (okRows.length === 0) {
    return NextResponse.json({ error: "這個批次沒有可以匯入的資料列" }, { status: 400 });
  }

  const rowsByHousehold = new Map<string, typeof okRows>();
  for (const row of okRows) {
    if (!rowsByHousehold.has(row.householdId)) rowsByHousehold.set(row.householdId, []);
    rowsByHousehold.get(row.householdId)!.push(row);
  }

  const result = await prisma.$transaction(async (tx) => {
    let householdsCreated = 0;
    let membersCreated = 0;
    let worshipCreated = 0;
    const importedRowIds: string[] = [];
    const skippedNowDuplicate: string[] = [];

    for (const [householdId, rows] of rowsByHousehold) {
      // 匯入當下再檢查一次，避免兩份匯入或手動新增造成的競爭情形
      const existing = await tx.household.findUnique({ where: { id: householdId } });
      if (existing) {
        skippedNowDuplicate.push(householdId);
        await tx.importRow.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { status: "DUPLICATE_PENDING" },
        });
        continue;
      }

      const parsed = rows.map((r) => parseImportRow(r.rawData as ImportRawRow, r.rowNumber));
      // 防禦性檢查：理論上 preview 時已經驗證過不會有錯誤，若真的有，跳過整戶並保留錯誤
      const stillHasErrors = parsed.some((p) => p.errors.length > 0);
      if (stillHasErrors) {
        continue;
      }

      const first = parsed[0];
      await tx.household.create({
        data: {
          id: householdId,
          name: first.household.name,
          contactName: first.household.contactName,
          phone: first.household.phone,
          address: first.household.address,
          companyName: first.household.companyName,
        },
      });
      householdsCreated++;

      // V14.2：本戶固定陽上人字庫——匯入時把成員與祭祀資料上的「陽上姓名」
      // 一併收進 household_yangshang（去重、含「、」自動拆多位）。日後建牌位
      // 時 YangshangEditor 可一鍵帶入，免得每年重打。純附加，不影響既有匯入結果。
      const importedYangshang: string[] = [];

      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i];
        if (!p.member) continue;
        const createdMember = await tx.member.create({
          data: {
            householdId,
            name: p.member.name,
            role: "OTHER" as MemberRole,
            isPrimaryContact: false,
            solarBirthDate: p.member.solarBirthDate,
            lunarBirthYear: p.member.lunarBirthYear,
            lunarBirthMonth: p.member.lunarBirthMonth,
            lunarBirthDay: p.member.lunarBirthDay,
            lunarIsLeapMonth: p.member.lunarIsLeapMonth,
            isDeceased: p.member.isDeceased,
            yangshangName: p.member.yangshangName,
            notes: p.member.notes,
          },
        });
        membersCreated++;
        if (p.member.yangshangName) importedYangshang.push(p.member.yangshangName);

        for (const w of p.worshipRecords) {
          await tx.worshipRecord.create({
            data: {
              householdId,
              type: w.type,
              displayName: w.displayName,
              location: w.location,
              yangshangName: w.yangshangName,
              memberId: createdMember.id,
            },
          });
          worshipCreated++;
          if (w.yangshangName) importedYangshang.push(w.yangshangName);
        }

        importedRowIds.push(rows[i].id);
      }

      // 建立本戶固定陽上人字庫（同一交易內；去重由唯一鍵保證）。
      if (importedYangshang.length > 0) {
        await addHouseholdYangshangBatch(householdId, importedYangshang, "IMPORT", tx);
      }
    }

    if (importedRowIds.length > 0) {
      await tx.importRow.updateMany({
        where: { id: { in: importedRowIds } },
        data: { status: "IMPORTED" },
      });
    }

    await tx.importBatch.update({
      where: { id: batchId },
      data: {
        status: "COMMITTED",
        committedAt: new Date(),
        importedRowCount: importedRowIds.length,
      },
    });

    return { householdsCreated, membersCreated, worshipCreated, skippedNowDuplicate };
  });

  return NextResponse.json({ batchId, ...result });
}
