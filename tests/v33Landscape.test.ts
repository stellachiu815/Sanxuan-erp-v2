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

test("陽上人 1~3 人 → 主文上下組合（主文與陽上人同欄，主文在上；地址獨立左欄）", () => {
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", [sample[0]]); // 2 名
  const b = l.allBlocks.filter((x) => x.recordIndex === 0);
  const main = b.find((x) => x.blockType === "main")!;
  const addr = b.find((x) => x.blockType === "address")!;
  const yang = b.find((x) => x.blockType === "yangshang")!;
  assert.equal(Math.round(main.xMm), Math.round(yang.xMm), "主文與陽上人同欄（上下組合）");
  assert.ok(main.yMm < yang.yMm, "主文在上、陽上人在下");
  assert.ok(addr.xMm < main.xMm, "地址獨立於左側直欄");
});

test("陽上人 4+ 人 → 三欄，右→左＝主文｜陽上人｜地址（各自獨立滿高直欄）", () => {
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", [sample[2]]); // 6 名
  const b = l.allBlocks.filter((x) => x.recordIndex === 0);
  const main = b.find((x) => x.blockType === "main")!;
  const addr = b.find((x) => x.blockType === "address")!;
  const yang = b.find((x) => x.blockType === "yangshang")!;
  assert.ok(main.xMm > yang.xMm && yang.xMm > addr.xMm, "右→左：主文/陽上人/地址");
  // 陽上人為獨立直欄（與主文不同 x、滿高）
  assert.notEqual(Math.round(main.xMm), Math.round(yang.xMm));
  assert.ok(yang.heightMm > l.pageHeightMm! * 0.6, "陽上人為滿高獨立欄，容多位不裁字");
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

test("多筆不重疊（不同筆的區塊無交疊）", () => {
  const many = Array.from({ length: 8 }, (_, i) => rec("周姓歷代祖先", "台北市中山區民權東路二段一五二巷二十二弄十一號二樓", ["周財寶", "陳秀珍"], i + 1));
  const l = buildLandscapeTabletLayout("ANCESTOR_LINE", many);
  assert.deepEqual(l.violations, [], JSON.stringify(l.violations));
});
