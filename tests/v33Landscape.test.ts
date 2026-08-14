import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLandscapeTabletLayout } from "../src/components/ritual/tablets/landscapeLayout";

/**
 * V33 橫式 A4 直書版型：297×210、由右至左、每筆獨立、陽上人 1~3 三欄／4+ 主文下方整欄、
 * 字體最大化、in-bounds、不重疊。
 */

const rec = (main: string, addr: string, names: string[], wn: number | null) => ({
  entryId: `e${wn ?? "x"}`, registrationId: null, addressText: addr, mainText: main, yangshangNames: names, yangshangText: names.join("、"), workNumber: wn,
});

const sample = [
  rec("周姓歷代祖先", "台北市中山區民權東路二段一五二巷二十二弄十一號二樓", ["周財寶", "陳秀珍"], 1),
  rec("王姓歷代祖先", "台北市中山區民權東路二段一五二巷", ["王昆郎", "覺美玲"], 2),
  rec("邱姓歷代祖先", "新北市永和區林森路廿九巷十八號一樓", ["邱泰翰", "邱泰碩", "邱柏翰", "邱雅玲", "邱雅靖", "邱雅琦"], 3),
];

test("橫式頁面 297×210，違規為空", () => {
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", sample);
  assert.equal(l.pageWidthMm, 297);
  assert.equal(l.pageHeightMm, 210);
  assert.deepEqual(l.violations, [], JSON.stringify(l.violations));
});

test("所有直書欄位一律頂端對齊（vAlign=start，且主文/地址從內容頂端開始）", () => {
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", sample);
  for (const b of l.allBlocks) assert.equal(b.vAlign, "start", `${b.blockType} 應頂端對齊`);
  // 主文、地址皆從內容頂端（同一 y）開始
  const r0 = l.allBlocks.filter((b) => b.recordIndex === 0);
  const main = r0.find((b) => b.blockType === "main")!;
  const addr = r0.find((b) => b.blockType === "address")!;
  assert.equal(Math.round(main.yMm), Math.round(addr.yMm), "主文與地址同一頂端 y");
});

test("陽上人 1~3 人 → 主文上下組合，主文↔陽上人固定 4mm 垂直安全間距", () => {
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", [sample[0]]); // 2 名
  const b = l.allBlocks.filter((x) => x.recordIndex === 0);
  const main = b.find((x) => x.blockType === "main")!;
  const addr = b.find((x) => x.blockType === "address")!;
  const yang = b.find((x) => x.blockType === "yangshang")!;
  // V40：陽上人縮成「一直行」並置中於主文欄正下方（原本佔滿主文欄寬會排成多欄/兩排）。
  assert.ok(Math.abs((yang.xMm + yang.widthMm / 2) - (main.xMm + main.widthMm / 2)) < 0.5, "陽上人置中於主文欄下方（上下組合）");
  assert.ok(yang.widthMm <= main.widthMm + 0.01, "陽上人為一直行，寬度不超過主文欄");
  assert.ok(main.yMm < yang.yMm, "主文在上、陽上人在下");
  assert.ok(Math.abs((yang.yMm - (main.yMm + main.heightMm)) - 4) < 0.01, "主文↔陽上人固定 4mm");
  assert.ok(addr.xMm < main.xMm, "地址獨立於左側直欄");
});

test("陽上人 4+ 人 → 三欄，右→左＝主文｜陽上人｜地址，欄間 ≥4mm 水平安全間距", () => {
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", [sample[2]]); // 6 名
  const b = l.allBlocks.filter((x) => x.recordIndex === 0);
  const main = b.find((x) => x.blockType === "main")!;
  const addr = b.find((x) => x.blockType === "address")!;
  const yang = b.find((x) => x.blockType === "yangshang")!;
  assert.ok(main.xMm > yang.xMm && yang.xMm > addr.xMm, "右→左：主文/陽上人/地址");
  assert.ok(main.xMm - (yang.xMm + yang.widthMm) >= 4 - 0.01, "主文↔陽上人 ≥4mm");
  assert.ok(yang.xMm - (addr.xMm + addr.widthMm) >= 4 - 0.01, "陽上人↔地址 ≥4mm");
  assert.ok(yang.heightMm > l.pageHeightMm! * 0.6, "陽上人為滿高獨立欄，容多位不裁字");
});

test("主文字級一致：同主文不因陽上人人數（上下 vs 三欄）而改變", () => {
  const two = buildLandscapeTabletLayout("ANCESTOR_LINE", [rec("周姓歷代祖先", "北市", ["甲", "乙"], 1)]);
  const six = buildLandscapeTabletLayout("ANCESTOR_LINE", [rec("周姓歷代祖先", "北市", ["甲", "乙", "丙", "丁", "戊", "己"], 1)]);
  const m2 = two.allBlocks.find((b) => b.blockType === "main")!.fontPx;
  const m6 = six.allBlocks.find((b) => b.blockType === "main")!.fontPx;
  assert.equal(m2, m6, "主文字級不受陽上人人數影響");
});

test("主文字級一致：同類型不同姓、不同地址長度→字級相同", () => {
  const a = buildLandscapeTabletLayout("ANCESTOR_LINE", [rec("周姓歷代祖先", "北市", ["甲"], 1)]);
  const b = buildLandscapeTabletLayout("ANCESTOR_LINE", [rec("邱姓歷代祖先", "新北市永和區林森路廿九巷十八號一樓", ["甲"], 1)]);
  const ma = a.allBlocks.find((x) => x.blockType === "main")!.fontPx;
  const mb = b.allBlocks.find((x) => x.blockType === "main")!.fontPx;
  assert.equal(ma, mb, "同字數主文字級一致，不受地址長度影響");
});

test("由右至左：record 0 在最右", () => {
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", sample);
  const x0 = Math.max(...l.allBlocks.filter((b) => b.recordIndex === 0).map((b) => b.xMm));
  const x1 = Math.max(...l.allBlocks.filter((b) => b.recordIndex === 1).map((b) => b.xMm));
  assert.ok(x0 > x1, "第一筆在右側");
});

test("字體最大化：主文字級 > 地址字級，且皆 > 0", () => {
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", [sample[0]]);
  const main = l.allBlocks.find((x) => x.blockType === "main")!;
  const addr = l.allBlocks.find((x) => x.blockType === "address")!;
  assert.ok((main.fontPx ?? 0) > 0 && (addr.fontPx ?? 0) > 0);
  assert.ok((main.fontPx ?? 0) > (addr.fontPx ?? 0), "主文比地址大");
});

test("無緣子女主文可獨立放大（字級 ≥ 祖先主文）", () => {
  const a = buildLandscapeTabletLayout("ANCESTOR_LINE", [rec("周姓歷代祖先", "北市", ["周大明"], 1)]);
  const u = buildLandscapeTabletLayout("UNBORN_CHILD", [rec("無緣子女", "北市", ["周大明"], 1)]);
  const am = a.allBlocks.find((x) => x.blockType === "main")!.fontPx ?? 0;
  const um = u.allBlocks.find((x) => x.blockType === "main")!.fontPx ?? 0;
  assert.ok(um >= am, `無緣 ${um} ≥ 祖先 ${am}`);
});

test("省紙密度每頁筆數 > 標準密度", () => {
  const std = buildLandscapeTabletLayout("ANCESTOR_LINE", sample, { density: "standard" });
  const eco = buildLandscapeTabletLayout("ANCESTOR_LINE", sample, { density: "economy" });
  assert.ok(eco.slotsPerPage > std.slotsPerPage, `${eco.slotsPerPage} > ${std.slotsPerPage}`);
});

test("叩薦緊接最後一位姓名、同一組文字、單一區塊（1~3 與 4+ 皆同）", () => {
  for (const r of [sample[0], sample[2]]) { // 2 名（上下）與 6 名（三欄）
    const l = buildLandscapeTabletLayout("ANCESTOR_LINE", [r]);
    const yb = l.allBlocks.filter((b) => b.recordIndex === 0 && b.blockType === "yangshang");
    assert.equal(yb.length, 1, "陽上人只有一個區塊（叩薦不獨立成塊）");
    const t = yb[0].text;
    assert.ok(t.endsWith("叩薦"), "以叩薦結尾");
    assert.ok(!t.includes("　叩薦"), "叩薦前無全形空格（緊接姓名）");
    const beforeKou = t[t.length - 3]; // 叩 前一字＝最後一位姓名末字
    assert.ok(beforeKou !== "　" && beforeKou !== " " && beforeKou !== "、", "叩薦緊接最後一位姓名");
  }
});

test("4 人可完整放入 → 陽上人使用正常字級（非最小、無 overflow）", () => {
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", [rec("周姓歷代祖先", "北市", ["甲", "乙", "丙", "丁"], 1)]);
  const y = l.allBlocks.find((b) => b.blockType === "yangshang")!;
  assert.equal(y.overflow, false, "4 人不 overflow");
  assert.ok((y.fontPx ?? 0) > 11, "使用正常（非最小）字級");
});

test("陽上人過多只縮陽上人：主文/地址字級不變、4mm 間距不變、陽上人字級變小", () => {
  const few = buildLandscapeTabletLayout("ANCESTOR_LINE", [rec("周姓歷代祖先", "台北市中山區民權東路二段一五二巷", ["甲", "乙", "丙", "丁"], 1)]);
  const many = buildLandscapeTabletLayout("ANCESTOR_LINE", [rec("周姓歷代祖先", "台北市中山區民權東路二段一五二巷", ["甲一", "乙二", "丙三", "丁四", "戊五", "己六", "庚七", "辛八", "壬九", "癸十", "甲十一", "乙十二"], 1)]);
  const mainFew = few.allBlocks.find((b) => b.blockType === "main")!;
  const mainMany = many.allBlocks.find((b) => b.blockType === "main")!;
  const addrFew = few.allBlocks.find((b) => b.blockType === "address")!;
  const addrMany = many.allBlocks.find((b) => b.blockType === "address")!;
  const yFew = few.allBlocks.find((b) => b.blockType === "yangshang")!;
  const yMany = many.allBlocks.find((b) => b.blockType === "yangshang")!;
  assert.equal(mainFew.fontPx, mainMany.fontPx, "主文字級不因陽上人多而變");
  assert.equal(addrFew.fontPx, addrMany.fontPx, "地址字級不變");
  assert.ok((yMany.fontPx ?? 0) <= (yFew.fontPx ?? 0), "只縮陽上人字級");
  // 4mm 水平安全間距不變（陽上人↔地址）
  const gap = (b: typeof yFew, a: typeof addrFew) => b.xMm - (a.xMm + a.widthMm);
  assert.ok(Math.abs(gap(yFew, addrFew) - gap(yMany, addrMany)) < 0.01, "欄間 4mm 間距不變");
  assert.ok(gap(yFew, addrFew) >= 4 - 0.01, "≥4mm");
});

test("陽上人縮字後仍在自己欄內（不跨欄、不裁切到相鄰）", () => {
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", [rec("周姓歷代祖先", "北市", ["甲一", "乙二", "丙三", "丁四", "戊五", "己六", "庚七", "辛八"], 1)]);
  assert.deepEqual(l.violations, [], "無 OUT_OF_BOUNDS / COLLISION（陽上人不跨欄/跨牌位）");
});

test("最右/最左群組完整在可列印範圍內（不裁切、不靠裁切邊）", () => {
  const many = Array.from({ length: 8 }, (_, i) => rec("周姓歷代祖先", "台北市中山區民權東路二段一五二巷二十二弄十一號二樓", ["甲", "乙"], i + 1));
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", many);
  const p0 = l.pages[0].blocks;
  const maxRight = Math.max(...p0.map((b) => b.xMm + b.widthMm));
  const minLeft = Math.min(...p0.map((b) => b.xMm));
  assert.ok(maxRight <= 297 - 3 + 0.01, `最右緣 ${maxRight.toFixed(1)} 未超出可列印右界 294`);
  assert.ok(maxRight <= 291 + 0.5, "最右群組收在 edgePad 內（rightBound≈291）");
  assert.ok(minLeft >= 6 - 0.01, `最左緣 ${minLeft.toFixed(1)} ≥ leftBound 6`);
  assert.deepEqual(l.violations, [], "無 OUT_OF_BOUNDS/COLLISION");
});

test("寶袋共用同一橫式群組引擎，版面合法（單一 Single Source）", () => {
  const l = buildLandscapeTabletLayout("POCKET", [rec("周府歷代祖先", "台北市中山區民權東路二段一五二巷", ["周大明"], 1)]);
  assert.equal(l.pageWidthMm, 297);
  assert.deepEqual(l.violations, []);
  assert.ok(l.allBlocks.some((b) => b.blockType === "main"));
});

test("多筆不重疊（不同筆的區塊無交疊）", () => {
  const many = Array.from({ length: 8 }, (_, i) => rec("周姓歷代祖先", "台北市中山區民權東路二段一五二巷二十二弄十一號二樓", ["周財寶", "陳秀珍"], i + 1));
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", many);
  assert.deepEqual(l.violations, [], JSON.stringify(l.violations));
});
