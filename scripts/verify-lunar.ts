/**
 * 農曆換算「人工核對」小工具。
 *
 * 這台雲端開發環境沒有對外網路，無法安裝 lunar-javascript 實際執行測試，
 * 所以請在你的 Mac 上、`npm install` 完成之後，執行：
 *
 *     npx tsx scripts/verify-lunar.ts
 *
 * 對照下面列出的「已知正確答案」，確認每一行輸出都符合預期。
 * 如果任何一行不對，代表 lunar-javascript 的 API 用法需要調整，
 * 請只修改 src/lib/lunar.ts 這一個檔案即可，不影響其他程式。
 */

import {
  solarToLunar,
  lunarToSolar,
  getZodiacByLunarYear,
  getNominalAge,
  getActualAge,
  formatLunarDate,
  formatSolarDate,
} from "../src/lib/lunar";

function check(label: string, expected: string, actual: string) {
  const ok = expected === actual ? "✅" : "❌";
  console.log(`${ok} ${label}\n   預期: ${expected}\n   實際: ${actual}\n`);
}

console.log("=== 農曆新年（正月初一）已知日期核對 ===\n");

check(
  "2024 年農曆新年（甲辰年）",
  "2024/02/10",
  formatSolarDate(lunarToSolar(2024, 1, 1))
);

check(
  "2025 年農曆新年（乙巳年）",
  "2025/01/29",
  formatSolarDate(lunarToSolar(2025, 1, 1))
);

check(
  "2026 年農曆新年（丙午年）",
  "2026/02/17",
  formatSolarDate(lunarToSolar(2026, 1, 1))
);

console.log("=== 生肖核對 ===\n");
check("2024 年（甲辰）生肖", "龍", getZodiacByLunarYear(2024));
check("2025 年（乙巳）生肖", "蛇", getZodiacByLunarYear(2025));
check("2026 年（丙午）生肖", "馬", getZodiacByLunarYear(2026));

console.log("=== 閏月換算（2023 年閏二月）===\n");
// 2023 年農曆閏二月初一，換算成國曆應為 2023/03/22
check(
  "2023 年閏二月初一",
  "2023/03/22",
  formatSolarDate(lunarToSolar(2023, 2, 1, true))
);

console.log("=== 國曆轉農曆往返測試 ===\n");
const roundTrip = solarToLunar(new Date(Date.UTC(2000, 0, 1))); // 2000/01/01
console.log(`2000/01/01 → ${formatLunarDate(roundTrip)}（人工可對照萬年曆確認）`);

console.log("\n=== 虛歲計算邏輯測試（用今天日期執行，數字會隨執行日期改變）===\n");
console.log(`農曆出生年 1990，今天的虛歲 = ${getNominalAge(1990)}`);
console.log(`國曆生日 1990/06/15，今天的實歲 = ${getActualAge(new Date(Date.UTC(1990, 5, 15)))}`);
