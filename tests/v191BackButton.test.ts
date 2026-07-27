import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * V19.1「全系統統一返回上一頁」——結構驗證（沙盒可執行）。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

test("BackButton 共用元件：use client、router.back()、fallbackHref、預設 label 返回上一頁", () => {
  const src = read("src/components/navigation/BackButton.tsx");
  assert.ok(src.includes('"use client"'), "需為 client 元件");
  assert.ok(src.includes("router.back()"), "使用 router.back() 返回上一頁");
  assert.ok(/fallbackHref/.test(src), "支援 fallbackHref");
  assert.ok(/label\s*=\s*"返回上一頁"/.test(src), "預設 label 為 返回上一頁");
  assert.ok(/className/.test(src), "支援 className");
  assert.ok(/router\.push\(fallbackHref\)/.test(src), "無站內上一頁時走 fallbackHref");
});

test("站內安全返回判斷：以 erpNavDepth 判斷，且不會導向外部網域", () => {
  const src = read("src/components/navigation/BackButton.tsx");
  assert.ok(src.includes("erpNavDepth"), "以本分頁 ERP 導覽深度判斷");
  // 只有 router.back()（站內）與 router.push(fallbackHref)（站內模組首頁）兩條路；
  // 不含任何 window.location = 外部網址或 http 外連。
  assert.doesNotMatch(src, /window\.location\.href\s*=/);
  assert.doesNotMatch(src, /https?:\/\//);
});

test("全站內頁不再把主要返回按鈕寫死回固定模組（← 系統管理／收款中心／…）", () => {
  const files = walk(join(process.cwd(), "src/app"));
  const banned = ["← 系統管理", "← 收款中心", "← 收據中心", "← 信眾關係中心", "← 供品認捐中心", "← 宮務活動中心", "← 祭改年度清單", "← 活動管理", "← 信眾名單", "← 收款紀錄", "← 收據查詢", "← 返回家戶頁", "← 返回普渡登記", "← 返回活動中心"];
  const offenders: string[] = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    for (const b of banned) if (s.includes(b)) offenders.push(`${f} :: ${b}`);
  }
  assert.deepEqual(offenders, [], `仍有寫死的主要返回按鈕：\n${offenders.join("\n")}`);
});

test("代表性內頁改用 BackButton（活動管理／信眾詳情／驗收／收款明細）", () => {
  for (const p of [
    "src/app/activities/[id]/page.tsx",
    "src/app/devotee-center/[memberId]/page.tsx",
    "src/app/system-center/acceptance/page.tsx",
    "src/app/collection-center/payments/[id]/page.tsx",
  ]) {
    const s = read(p);
    assert.ok(s.includes("<BackButton"), `${p} 應使用 BackButton`);
    assert.ok(s.includes("navigation/BackButton"), `${p} 應 import BackButton`);
  }
});
