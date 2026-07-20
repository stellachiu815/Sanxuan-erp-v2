import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseFlexibleDate,
  parseExcelSerial,
  formatMinguoDate,
  minguoToAD,
  adToMinguo,
} from "../src/lib/minguoDate";
import {
  normalizeNationalId,
  validateNationalId,
  maskNationalId,
} from "../src/lib/nationalId";
import {
  normalizeYangshangName,
  splitYangshangNames,
  printYangshangName,
  printAddress,
  printMinguoDateText,
  printAge,
  detectKinshipTerms,
} from "../src/lib/printChinese";
import {
  getZodiacAnimal,
  getSexagenaryYear,
  getSexagenaryByMinguoYear,
  resolveTaisui,
  getConstellation,
  resolveNominalAgeForActivityYear,
  resolveActualAgeAt,
  buildActivityYearPrintProfile,
} from "../src/lib/zodiacSexagenary";
import {
  canAcceptRegistration,
  canPrint,
  pickDefaultActivityYear,
  type ActivityYearCandidate,
} from "../src/lib/activityYear";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const parsed = (raw: unknown) => {
  const r = parseFlexibleDate(raw);
  return r.ok ? iso(r.date) : null;
};

// ============================================================
// 指令二／十三：民國日期輸入
// ============================================================

test("民國日期：三種輸入格式都解析成同一天", () => {
  assert.equal(parsed("1140721"), "2025-07-21");
  assert.equal(parsed("114/7/21"), "2025-07-21");
  assert.equal(parsed("114-7-21"), "2025-07-21");
  assert.equal(parsed("民國114年7月21日"), "2025-07-21");
});

test("民國日期：西元格式仍然支援", () => {
  assert.equal(parsed("2025-07-21"), "2025-07-21");
  assert.equal(parsed("2025/7/21"), "2025-07-21");
  assert.equal(parsed("20250721"), "2025-07-21");
});

test("民國日期：全形數字", () => {
  assert.equal(parsed("１１４/７/２１"), "2025-07-21");
});

test("Excel 原生日期與 Serial Number", () => {
  assert.equal(parsed(new Date(Date.UTC(2025, 6, 21))), "2025-07-21");
  assert.equal(parsed(45859), "2025-07-21");

  const serial = parseExcelSerial(45859);
  assert.equal(serial.ok, true);
  if (serial.ok) assert.equal(iso(serial.date), "2025-07-21");
});

test("指令十三：空白一律 null，絕不補今天日期", () => {
  assert.equal(parsed(""), null);
  assert.equal(parsed("   "), null);
  assert.equal(parsed(null), null);
  assert.equal(parsed(undefined), null);
});

test("V12.9 回歸：Invalid Date 物件不得通過", () => {
  assert.equal(parsed(new Date("Invalid Date")), null);
  assert.equal(parsed(new Date(NaN)), null);
  assert.equal(parsed(NaN), null);
});

test("不存在的日期一律拒絕（含閏年邊界）", () => {
  assert.equal(parsed("114-2-30"), null);
  assert.equal(parsed("114-13-01"), null);
  assert.equal(parsed("0000-00-00"), null);
  // 民國114 = 西元2025，平年，沒有 2/29
  assert.equal(parsed("114-2-29"), null);
  // 民國113 = 西元2024，閏年，有 2/29
  assert.equal(parsed("113-2-29"), "2024-02-29");
});

test("民國顯示格式統一為 114/07/21", () => {
  assert.equal(formatMinguoDate(new Date(Date.UTC(2025, 6, 21))), "114/07/21");
  assert.equal(formatMinguoDate(new Date(Date.UTC(2025, 0, 5))), "114/01/05");
  assert.equal(formatMinguoDate(null), "");
  assert.equal(formatMinguoDate(new Date("Invalid Date")), "");
});

test("民國／西元換算方向一致", () => {
  assert.equal(minguoToAD(114), 2025);
  assert.equal(adToMinguo(2025), 114);
});

// ============================================================
// 指令一：身分證字號
// ============================================================

test("身分證：有效號碼通過驗證", () => {
  assert.equal(validateNationalId("A123456789").ok, true);
  assert.equal(validateNationalId("F131104093").ok, true);
});

test("身分證：檢核碼錯誤要擋下", () => {
  assert.equal(validateNationalId("A123456788").ok, false);
});

test("指令一：可空白——空值視為合法", () => {
  assert.equal(validateNationalId(null).ok, true);
  assert.equal(validateNationalId("").ok, true);
  assert.equal(validateNationalId("   ").ok, true);
  assert.equal(normalizeNationalId(""), null);
  assert.equal(normalizeNationalId("   "), null);
});

test("身分證：正規化（去空白、去連字號、轉大寫）", () => {
  assert.equal(normalizeNationalId(" a123456789 "), "A123456789");
  assert.equal(normalizeNationalId("A-123456789"), "A123456789");
});

test("身分證：格式錯誤各種情況", () => {
  assert.equal(validateNationalId("A12345").ok, false); // 長度不足
  assert.equal(validateNationalId("1123456789").ok, false); // 首碼非字母
  assert.equal(validateNationalId("A923456789").ok, false); // 第2碼非 1/2/A-D
  assert.equal(validateNationalId("A12345678X").ok, false); // 尾碼非數字
});

test("指令一：名單頁遮罩", () => {
  assert.equal(maskNationalId("A123456789"), "A12****789");
  assert.equal(maskNationalId(null), "");
  assert.equal(maskNationalId("壞資料"), "****");
});

// ============================================================
// 指令六：陽上人
// ============================================================

test("陽上人：多種分隔符號統一正規化成頓號", () => {
  assert.equal(normalizeYangshangName("王大明、陳小美"), "王大明、陳小美");
  assert.equal(normalizeYangshangName("王大明,陳小美"), "王大明、陳小美");
  assert.equal(normalizeYangshangName("王大明，陳小美"), "王大明、陳小美");
  assert.equal(normalizeYangshangName("王大明\n陳小美"), "王大明、陳小美");
  assert.equal(normalizeYangshangName("王大明; 陳小美"), "王大明、陳小美");
});

test("陽上人：去空白、去重複、空值為 null", () => {
  assert.equal(normalizeYangshangName("  王大明  "), "王大明");
  assert.equal(normalizeYangshangName("王大明、王大明"), "王大明");
  assert.equal(normalizeYangshangName(""), null);
  assert.equal(normalizeYangshangName("、、"), null);
  assert.equal(normalizeYangshangName(null), null);
});

test("指令六：資料庫值絕不含「叩薦」", () => {
  const stored = normalizeYangshangName("王大明、陳小美");
  assert.equal(stored, "王大明、陳小美");
  assert.equal(stored!.includes("叩薦"), false);
});

test("指令六：列印時在全部姓名後加一次「叩薦」", () => {
  assert.equal(printYangshangName("王大明"), "王大明叩薦");
  assert.equal(printYangshangName("王大明、陳小美"), "王大明、陳小美叩薦");
  // 是整串後面加一次，不是每個名字各加一次
  assert.equal(printYangshangName("王大明、陳小美").match(/叩薦/g)?.length, 1);
});

test("指令六：姓名前不得自動增加任何文字", () => {
  assert.equal(printYangshangName("王大明").startsWith("王大明"), true);
});

test("陽上人：空值列印為空字串（不印孤零零的「叩薦」）", () => {
  assert.equal(printYangshangName(null), "");
  assert.equal(printYangshangName(""), "");
});

test("陽上人：拆分成陣列供畫面使用", () => {
  assert.deepEqual(splitYangshangNames("王大明、陳小美"), ["王大明", "陳小美"]);
  assert.deepEqual(splitYangshangNames(null), []);
});

test("指令六：偵測不該出現的關係稱謂", () => {
  assert.deepEqual(detectKinshipTerms("孝男王大明"), ["孝男"]);
  assert.deepEqual(detectKinshipTerms("王大明"), []);
});

// ============================================================
// 指令十二：列印國字化
// ============================================================

test("地址國字化（逐字讀法，維持既有祭改貼紙慣例）", () => {
  assert.equal(printAddress("中山北路7段88巷3弄12號5樓"), "中山北路七段八八巷三弄一二號五樓");
  assert.equal(printAddress(null), "");
  assert.equal(printAddress(""), "");
});

test("地址國字化：進位讀法（預留切換）", () => {
  assert.equal(printAddress("中山北路7段88巷", "grouped"), "中山北路七段八十八巷");
});

test("民國日期國字化", () => {
  assert.equal(printMinguoDateText(116, 7, 18), "民國一百一十六年七月十八日");
  assert.equal(printMinguoDateText(114, 1, 1), "民國一百一十四年一月一日");
});

test("歲數國字化", () => {
  assert.equal(printAge(54), "五十四歲");
  assert.equal(printAge(8), "八歲");
});

// ============================================================
// 指令三／十一：生肖、干支、太歲、歲數
// ============================================================

test("生肖對照", () => {
  assert.equal(getZodiacAnimal(1984), "鼠");
  assert.equal(getZodiacAnimal(1990), "馬");
  assert.equal(getZodiacAnimal(2024), "龍");
});

test("天干地支", () => {
  assert.equal(getSexagenaryYear(1990), "庚午");
  assert.equal(getSexagenaryYear(1984), "甲子");
  assert.equal(getSexagenaryByMinguoYear(116), "丁未");
});

test("太歲：五種關係（以 1990 年生／午馬為例）", () => {
  // 民國103 = 2014 午年
  assert.equal(resolveTaisui(1990, 103), "值太歲");
  // 民國109 = 2020 子年（子午相沖）
  assert.equal(resolveTaisui(1990, 109), "沖太歲");
  // 民國110 = 2021 丑年（丑午相害）
  assert.equal(resolveTaisui(1990, 110), "害太歲");
  // 民國100 = 2011 卯年（卯午相破）
  assert.equal(resolveTaisui(1990, 100), "破太歲");
  // 民國104 = 2015 未年（午未相合，不犯）
  assert.equal(resolveTaisui(1990, 104), null);
});

test("太歲：三刑是固定組合，不是距離", () => {
  // 寅巳申三刑：1986 寅虎，民國102 = 2013 巳年
  assert.equal(resolveTaisui(1986, 102), "刑太歲");
  // 丑戌未三刑：1985 丑牛，民國107 = 2018 戌年
  assert.equal(resolveTaisui(1985, 107), "刑太歲");
  // 子卯相刑：1984 子鼠，民國112 = 2023 卯年
  assert.equal(resolveTaisui(1984, 112), "刑太歲");
});

test("太歲：本命年優先於自刑", () => {
  // 1988 辰龍，民國101 = 2012 辰年。辰是自刑支，但同支一律稱值太歲
  assert.equal(resolveTaisui(1988, 101), "值太歲");
});

test("星座依國曆生日", () => {
  assert.equal(getConstellation(new Date(Date.UTC(1990, 6, 21))), "巨蟹座");
  assert.equal(getConstellation(new Date(Date.UTC(1990, 6, 25))), "獅子座");
  assert.equal(getConstellation(new Date(Date.UTC(1990, 0, 5))), "摩羯座");
});

test("指令三：生日空白時衍生欄位為空，不得猜測", () => {
  assert.equal(getConstellation(null), null);
  assert.equal(getConstellation(new Date("Invalid Date")), null);
});

test("指令十一：虛歲依活動年度，不是今天", () => {
  const r115 = resolveNominalAgeForActivityYear(1990, 115);
  const r116 = resolveNominalAgeForActivityYear(1990, 116);
  assert.equal(r115.ok && r115.age, 37);
  assert.equal(r116.ok && r116.age, 38);
});

test("指令十一：補印／重印結果恆等（同資料同年度）", () => {
  const a = resolveNominalAgeForActivityYear(1990, 116);
  const b = resolveNominalAgeForActivityYear(1990, 116);
  assert.deepEqual(a, b);
  // 跨多年度也正確，不是「目前年齡 +1」
  const r118 = resolveNominalAgeForActivityYear(1990, 118);
  assert.equal(r118.ok && r118.age, 40);
});

test("虛歲：資料不完整或不合理一律回報，不猜測", () => {
  assert.equal(resolveNominalAgeForActivityYear(null, 116).ok, false);
  assert.equal(resolveNominalAgeForActivityYear(undefined, 116).ok, false);
  assert.equal(resolveNominalAgeForActivityYear(1700, 116).ok, false);
});

test("實歲依指定基準日計算", () => {
  const birth = new Date(Date.UTC(1990, 6, 21));
  // 基準日生日當天 → 已過生日
  const onBirthday = resolveActualAgeAt(birth, new Date(Date.UTC(2025, 6, 21)));
  assert.equal(onBirthday.ok && onBirthday.age, 35);
  // 基準日生日前一天 → 尚未過生日
  const before = resolveActualAgeAt(birth, new Date(Date.UTC(2025, 6, 20)));
  assert.equal(before.ok && before.age, 34);
});

test("指令十一：列印預檢彙整（活動年度／歲數／生肖／太歲／建生瑞生）", () => {
  const p = buildActivityYearPrintProfile({
    activityMinguoYear: 116,
    birthLunarYearAD: 1990,
    solarBirthDate: new Date(Date.UTC(1990, 6, 21)),
    gender: "男",
    referenceDate: new Date(Date.UTC(2027, 1, 15)),
  });
  assert.equal(p.activityMinguoYear, 116);
  assert.equal(p.nominalAge, 38);
  assert.equal(p.zodiac, "馬");
  assert.equal(p.activitySexagenary, "丁未");
  assert.equal(p.jishi, "建生");
  assert.equal(p.issues.length, 0);
});

test("指令三：性別空白不得產生建生／瑞生，必須列入待處理", () => {
  const p = buildActivityYearPrintProfile({
    activityMinguoYear: 116,
    birthLunarYearAD: 1990,
    solarBirthDate: new Date(Date.UTC(1990, 6, 21)),
    gender: null,
    referenceDate: new Date(Date.UTC(2027, 1, 15)),
  });
  assert.equal(p.jishi, null);
  assert.equal(p.issues.some((i) => i.includes("性別")), true);
});

test("生日缺漏時列印預檢要擋下並說明原因", () => {
  const p = buildActivityYearPrintProfile({
    activityMinguoYear: 116,
    birthLunarYearAD: null,
    solarBirthDate: null,
    gender: "女",
    referenceDate: new Date(Date.UTC(2027, 1, 15)),
  });
  assert.equal(p.nominalAge, null);
  assert.equal(p.zodiac, null);
  assert.equal(p.jishi, "瑞生");
  assert.equal(p.issues.length > 0, true);
});

// ============================================================
// 指令九／十：活動年度
// ============================================================

function candidate(over: Partial<ActivityYearCandidate>): ActivityYearCandidate {
  return {
    templeEventId: `e-${over.year}`,
    activityType: "UNIVERSAL_SALVATION",
    year: 115,
    name: "中元普渡",
    registrationStartAt: null,
    registrationEndAt: null,
    eventDate: null,
    isRegistrationOpen: true,
    isPrintOpen: true,
    isCompleted: false,
    isArchived: false,
    status: "PREPARING",
    ...over,
  };
}

const today = new Date(Date.UTC(2026, 6, 21));

test("活動年度：開放報名時可接受", () => {
  assert.equal(canAcceptRegistration(candidate({}), today).ok, true);
});

test("活動年度：管理者關閉報名優先於日期", () => {
  const c = candidate({ isRegistrationOpen: false, registrationEndAt: new Date(Date.UTC(2099, 0, 1)) });
  assert.equal(canAcceptRegistration(c, today).ok, false);
});

test("活動年度：已完成／已封存／已取消都不可報名", () => {
  assert.equal(canAcceptRegistration(candidate({ isCompleted: true }), today).ok, false);
  assert.equal(canAcceptRegistration(candidate({ isArchived: true }), today).ok, false);
  assert.equal(canAcceptRegistration(candidate({ status: "CANCELLED" }), today).ok, false);
});

test("活動年度：超過截止日不可報名", () => {
  const c = candidate({ registrationEndAt: new Date(Date.UTC(2026, 0, 1)) });
  assert.equal(canAcceptRegistration(c, today).ok, false);
});

test("活動年度：報名與列印分開判斷（截止後仍可補印）", () => {
  const c = candidate({ isRegistrationOpen: false, isPrintOpen: true });
  assert.equal(canAcceptRegistration(c, today).ok, false);
  assert.equal(canPrint(c).ok, true);
});

test("指令九：本年度仍開放 → 預設本年度", () => {
  const d = pickDefaultActivityYear(
    [candidate({ year: 115 }), candidate({ year: 116 })],
    today,
    115
  );
  assert.equal(d.ok, true);
  assert.equal(d.ok && d.candidate.year, 115);
});

test("指令九：本年度已完成 → 預設下一個已建立的年度", () => {
  const d = pickDefaultActivityYear(
    [
      candidate({ year: 115, isCompleted: true }),
      candidate({ year: 116, isRegistrationOpen: false }),
    ],
    today,
    115
  );
  assert.equal(d.ok, true);
  assert.equal(d.ok && d.candidate.year, 116);
});

test("指令九：完全沒有可用年度時不得偷偷建立活動", () => {
  const d = pickDefaultActivityYear([], today, 115);
  assert.equal(d.ok, false);
  assert.equal(d.ok === false && d.reason.includes("請先"), true);
});

test("指令九：允許修改年度——alternatives 一定帶回其他年度", () => {
  const d = pickDefaultActivityYear(
    [candidate({ year: 115 }), candidate({ year: 116 }), candidate({ year: 117 })],
    today,
    115
  );
  assert.equal(d.ok, true);
  assert.equal(d.ok && d.alternatives.length, 2);
});
