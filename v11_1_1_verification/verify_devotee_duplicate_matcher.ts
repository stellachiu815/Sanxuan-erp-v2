// V12.0 真實執行驗證：src/lib/devoteeDuplicateMatcher.ts 不 import 任何
// @prisma/client／next 的模組，可以在這個沙盒用 tsx 直接載入真正的原始碼
// 執行，對應交付報告「十三、疑似重複信眾」「二十一、23」。
import { findDuplicateMatches, DUPLICATE_MATCH_REASON_LABEL, type DuplicateCandidate } from "../src/lib/devoteeDuplicateMatcher";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} - ${label} => actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (ok) pass++;
  else fail++;
}

// 五種比對條件，逐一用真實案例測試。
const candidates: DuplicateCandidate[] = [
  // 1: 姓名相同且電話相同（不同家戶）
  { memberId: "m1", name: "王小明", phone: "0911111111", address: "台北市中山區1號", birthdayKey: "solar:1990-01-01", householdId: "F1" },
  { memberId: "m2", name: "王小明", phone: "0911111111", address: "台北市大安區2號", birthdayKey: "solar:1985-05-05", householdId: "F2" },
  // 2: 姓名相同且地址相同
  { memberId: "m3", name: "陳美麗", phone: "0922222222", address: "台北市信義區3號", birthdayKey: "solar:1970-02-02", householdId: "F3" },
  { memberId: "m4", name: "陳美麗", phone: "0933333333", address: "台北市信義區3號", birthdayKey: "solar:1980-08-08", householdId: "F4" },
  // 3: 姓名相同且生日相同
  { memberId: "m5", name: "李大同", phone: "0944444444", address: "台北市松山區4號", birthdayKey: "lunar:1990-3-5-false", householdId: "F5" },
  { memberId: "m6", name: "李大同", phone: "0955555555", address: "台北市內湖區5號", birthdayKey: "lunar:1990-3-5-false", householdId: "F6" },
  // 4: 電話相同但姓名不同
  { memberId: "m7", name: "張三", phone: "0966666666", address: "台北市士林區6號", birthdayKey: "solar:1960-06-06", householdId: "F7" },
  { memberId: "m8", name: "李四", phone: "0966666666", address: "台北市北投區7號", birthdayKey: "solar:1965-07-07", householdId: "F8" },
  // 5: 同一家戶內同名成員
  { memberId: "m9", name: "黃小華", phone: "0977777777", address: "台北市萬華區8號", birthdayKey: "solar:1950-01-01", householdId: "F9" },
  { memberId: "m10", name: "黃小華", phone: null, address: null, birthdayKey: null, householdId: "F9" },
  // 對照組：完全不相關，不應該被誤判成任何一種重複
  { memberId: "m11", name: "獨立無關", phone: "0900000000", address: "沒有人跟我一樣", birthdayKey: "solar:1999-09-09", householdId: "F10" },
];

const matches = findDuplicateMatches(candidates);

function hasMatch(reason: string, id1: string, id2: string): boolean {
  return matches.some(
    (m) => m.reason === reason && ((m.a.memberId === id1 && m.b.memberId === id2) || (m.a.memberId === id2 && m.b.memberId === id1))
  );
}

check("姓名相同且電話相同（m1/m2）被偵測到", hasMatch("SAME_NAME_SAME_PHONE", "m1", "m2"), true);
check("姓名相同且地址相同（m3/m4）被偵測到", hasMatch("SAME_NAME_SAME_ADDRESS", "m3", "m4"), true);
check("姓名相同且生日相同（m5/m6）被偵測到", hasMatch("SAME_NAME_SAME_BIRTHDAY", "m5", "m6"), true);
check("電話相同但姓名不同（m7/m8）被偵測到", hasMatch("SAME_PHONE_DIFFERENT_NAME", "m7", "m8"), true);
check("同一家戶內同名成員（m9/m10）被偵測到", hasMatch("SAME_HOUSEHOLD_SAME_NAME", "m9", "m10"), true);

// 邊界案例：完全不相關的人（m11）不應該出現在任何一組配對裡。
const involvesM11 = matches.some((m) => m.a.memberId === "m11" || m.b.memberId === "m11");
check("完全不相關的信眾（m11）不應該被誤判為任何一種疑似重複", involvesM11, false);

// 邊界案例：同一人不應該跟自己比對（memberId 相同時應該被跳過）。
const selfCandidate: DuplicateCandidate = { memberId: "m1", name: "王小明", phone: "0911111111", address: "台北市中山區1號", birthdayKey: "solar:1990-01-01", householdId: "F1" };
const selfMatches = findDuplicateMatches([candidates[0], selfCandidate]);
check("同一 memberId 不應該跟自己比對出重複", selfMatches.length, 0);

// 邊界案例：兩筆資料都缺 phone/address/birthdayKey（皆為 null）不應該被誤判為相同。
const nullCandidates: DuplicateCandidate[] = [
  { memberId: "n1", name: "無資料甲", phone: null, address: null, birthdayKey: null, householdId: "FN1" },
  { memberId: "n2", name: "無資料乙", phone: null, address: null, birthdayKey: null, householdId: "FN2" },
];
check("兩筆都缺電話/地址/生日資料時，不應該誤判為相同（null 不等於 null）", findDuplicateMatches(nullCandidates).length, 0);

// 確認每一種 reason 都有對應的中文標籤（不得只顯示代碼）。
const allReasons: (keyof typeof DUPLICATE_MATCH_REASON_LABEL)[] = [
  "SAME_NAME_SAME_PHONE",
  "SAME_NAME_SAME_ADDRESS",
  "SAME_NAME_SAME_BIRTHDAY",
  "SAME_PHONE_DIFFERENT_NAME",
  "SAME_HOUSEHOLD_SAME_NAME",
];
for (const r of allReasons) {
  check(`「${r}」有對應的中文標籤`, typeof DUPLICATE_MATCH_REASON_LABEL[r] === "string" && DUPLICATE_MATCH_REASON_LABEL[r].length > 0, true);
}

console.log(`\n總結：${pass} 項通過，${fail} 項失敗。`);
if (fail > 0) process.exit(1);
