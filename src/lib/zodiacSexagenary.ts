/**
 * V13.1 指令三／十一：生肖、天干地支、星座、太歲，以及**依活動年度**計算的
 * 歲數。
 *
 * 純函式、零相依（不 import lunar-javascript、不 import Prisma），
 * 可以直接用 node 執行測試。
 *
 * ── 這支存在的理由（指令十一的核心）─────────────────────────
 * 專案既有的 src/lib/lunar.ts 提供 getZodiacByLunarYear / getActualAge /
 * getNominalAge，但後兩者的預設基準是 **today**：
 *
 *     getNominalAge(birthLunarYear, today = new Date())
 *
 * 對「年度燈」這種**年底受理、隔年度適用**的活動，用 today 會算錯一整歲。
 * 指令十一寫得很明確：民國 115 年底受理 116 年度點燈，即使列印當天仍是
 * 115 年、尚未過農曆年，虛歲／生肖／太歲全部要依 **116 年度** 計算。
 *
 * 所以這支的每一個函式都**強制要求傳入活動年度**，沒有 today 預設值。
 * 這是刻意的設計：讓「忘記傳年度」變成 TypeScript 編譯錯誤，而不是
 * 上線後才發現燈牌上的歲數少一歲。
 *
 * ⚠️ 也刻意**不提供**「目前歲數 +1」這種捷徑函式——指令十一明令
 * 「不得簡單將畫面目前年齡直接加一」。所有歲數一律由「出生年 + 活動年度」
 * 重新計算，這樣補印、重印、跨多年度都會得到同一個正確答案。
 */

/** 民國年 → 西元年（與全專案一致的換算方向）。 */
export function minguoToAD(minguoYear: number): number {
  return minguoYear + 1911;
}

// ────────────────────────────────────────────────────────────
// 生肖與天干地支
// ────────────────────────────────────────────────────────────

const HEAVENLY_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"] as const;
const EARTHLY_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;
const ZODIAC_ANIMALS = ["鼠", "牛", "虎", "兔", "龍", "蛇", "馬", "羊", "猴", "雞", "狗", "豬"] as const;

/**
 * 農曆年（西元）→ 地支索引。
 *
 * 基準：西元 4 年為甲子年。用 ((year - 4) % 12 + 12) % 12 取得地支索引，
 * 兩次取模是為了讓西元前／異常小的年份也不會得到負索引。
 */
function branchIndex(lunarYearAD: number): number {
  return (((lunarYearAD - 4) % 12) + 12) % 12;
}

function stemIndex(lunarYearAD: number): number {
  return (((lunarYearAD - 4) % 10) + 10) % 10;
}

/** 農曆年（西元）→ 生肖。例：1990 → 「馬」。 */
export function getZodiacAnimal(lunarYearAD: number): string {
  return ZODIAC_ANIMALS[branchIndex(lunarYearAD)];
}

/** 農曆年（西元）→ 天干地支。例：1990 → 「庚午」。 */
export function getSexagenaryYear(lunarYearAD: number): string {
  return `${HEAVENLY_STEMS[stemIndex(lunarYearAD)]}${EARTHLY_BRANCHES[branchIndex(lunarYearAD)]}`;
}

/** 民國年 → 天干地支（列印疏文用「歲次○○年」）。 */
export function getSexagenaryByMinguoYear(minguoYear: number): string {
  return getSexagenaryYear(minguoToAD(minguoYear));
}

// ────────────────────────────────────────────────────────────
// 太歲（指令十一）
// ────────────────────────────────────────────────────────────

/**
 * 太歲判斷：某個生肖在某個活動年度是否犯太歲，以及犯的是哪一種。
 *
 * 以年支為準，實作民間通行的五種關係：
 *
 *   值太歲（本命年）：生肖與年支相同
 *   沖太歲：相差 6（子午、丑未、寅申、卯酉、辰戌、巳亥）
 *   刑太歲：**三刑**組合，不是單純的距離——
 *           無恩之刑 寅巳申、恃勢之刑 丑戌未、無禮之刑 子卯、
 *           自刑 辰午酉亥（自刑與值太歲重疊時，值太歲優先）
 *   害太歲：六害（子未、丑午、寅巳、卯辰、申亥、酉戌）
 *   破太歲：相差 3（子酉、丑辰、寅亥、卯午、巳申、未戌）
 *
 * ⚠️ 誠實說明兩件事：
 * 1. 刑與破容易被混為一談。「相差 3」是**破**不是刑；刑是上面列出的固定
 *    三刑組合。這裡分開實作，不用距離近似。
 * 2. 各宮廟採用的太歲流派略有差異（有些只認值／沖，有些不列破）。
 *    若三玄宮的認定方式不同，請告知——調整只需要改這一支的對照表，
 *    不需要動任何呼叫端。
 */
export type TaisuiRelation = "值太歲" | "沖太歲" | "刑太歲" | "害太歲" | "破太歲" | null;

/** 六害對照（地支索引配對）。 */
const HARM_PAIRS: Record<number, number> = {
  0: 7, 7: 0,   // 子未
  1: 6, 6: 1,   // 丑午
  2: 5, 5: 2,   // 寅巳
  3: 4, 4: 3,   // 卯辰
  8: 11, 11: 8, // 申亥
  9: 10, 10: 9, // 酉戌
};

/** 三刑組合（含自刑）。每一組內任兩支互刑。 */
const PUNISHMENT_GROUPS: number[][] = [
  [2, 5, 8],   // 寅巳申 無恩之刑
  [1, 10, 7],  // 丑戌未 恃勢之刑
  [0, 3],      // 子卯   無禮之刑
];
/** 自刑：辰、午、酉、亥 與自身相刑（但同支優先判定為值太歲）。 */
const SELF_PUNISHMENT = new Set([4, 6, 9, 11]);

function isPunishment(a: number, b: number): boolean {
  if (a === b) return SELF_PUNISHMENT.has(a);
  return PUNISHMENT_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

/**
 * 判斷太歲關係。
 *
 * 判定順序（同時成立時取較重者）：值 → 沖 → 刑 → 害 → 破
 *
 * @param birthLunarYearAD 出生農曆年（西元）
 * @param targetMinguoYear **活動使用年度**（民國）——不是今年
 */
export function resolveTaisui(
  birthLunarYearAD: number,
  targetMinguoYear: number
): TaisuiRelation {
  const birth = branchIndex(birthLunarYearAD);
  const target = branchIndex(minguoToAD(targetMinguoYear));

  // 值太歲優先於自刑：本命年一律稱值太歲
  if (birth === target) return "值太歲";

  const diff = Math.abs(birth - target);
  const circularDiff = Math.min(diff, 12 - diff);

  if (circularDiff === 6) return "沖太歲";
  if (isPunishment(birth, target)) return "刑太歲";
  if (HARM_PAIRS[birth] === target) return "害太歲";
  if (circularDiff === 3) return "破太歲";

  return null;
}

// ────────────────────────────────────────────────────────────
// 星座（指令三）
// ────────────────────────────────────────────────────────────

/** 星座起始日對照：[月, 起始日, 名稱]。 */
const CONSTELLATIONS: [number, number, string][] = [
  [1, 20, "水瓶座"], [2, 19, "雙魚座"], [3, 21, "牡羊座"], [4, 20, "金牛座"],
  [5, 21, "雙子座"], [6, 22, "巨蟹座"], [7, 23, "獅子座"], [8, 23, "處女座"],
  [9, 23, "天秤座"], [10, 24, "天蠍座"], [11, 22, "射手座"], [12, 22, "摩羯座"],
];

/**
 * 國曆生日 → 星座。**以國曆為準**（星座本來就是依國曆日期劃分，
 * 不可用農曆生日計算）。
 *
 * 生日為 null 回 null——指令三：「若生日空白，以上欄位顯示空白，不得猜測」。
 */
export function getConstellation(solarBirthDate: Date | null | undefined): string | null {
  if (!solarBirthDate || Number.isNaN(solarBirthDate.getTime())) return null;
  const m = solarBirthDate.getUTCMonth() + 1;
  const d = solarBirthDate.getUTCDate();

  const entry = CONSTELLATIONS.find(([cm, cd]) => cm === m && d >= cd);
  if (entry) return entry[2];
  // 未達本月起始日 → 屬於上一個月的星座
  const prevMonth = m === 1 ? 12 : m - 1;
  const prev = CONSTELLATIONS.find(([cm]) => cm === prevMonth);
  return prev ? prev[2] : null;
}

// ────────────────────────────────────────────────────────────
// 歲數（指令三、十一）
// ────────────────────────────────────────────────────────────

export type AgeResult =
  | { ok: true; age: number }
  | { ok: false; reason: string };

/** 超過這個虛歲視為資料異常（例如出生年打錯），列入待確認、不列印。 */
const MAX_REASONABLE_AGE = 130;

/**
 * **依活動年度**計算虛歲（指令十一的核心）。
 *
 * 虛歲 = 活動年度的農曆年 − 出生農曆年 + 1
 *
 * 沒有 today 參數，也沒有預設值——活動年度是必填。這確保民國 115 年
 * 列印 116 年度燈牌時，算出來的是 116 年度的虛歲。
 *
 * @param birthLunarYearAD 出生農曆年（西元）。null/undefined → 無法計算
 * @param targetMinguoYear 活動使用年度（民國）
 */
export function resolveNominalAgeForActivityYear(
  birthLunarYearAD: number | null | undefined,
  targetMinguoYear: number
): AgeResult {
  if (birthLunarYearAD === null || birthLunarYearAD === undefined) {
    return { ok: false, reason: "出生年份不完整，無法計算虛歲" };
  }
  if (!Number.isInteger(birthLunarYearAD) || birthLunarYearAD < 1800) {
    return { ok: false, reason: "出生年份資料異常，無法計算虛歲" };
  }
  if (!Number.isInteger(targetMinguoYear) || targetMinguoYear < 1) {
    return { ok: false, reason: "活動年度不合法，無法計算虛歲" };
  }
  const age = minguoToAD(targetMinguoYear) - birthLunarYearAD + 1;
  if (age < 1 || age > MAX_REASONABLE_AGE) {
    return { ok: false, reason: `計算出的虛歲不合理（${age}），請確認出生年份` };
  }
  return { ok: true, age };
}

/**
 * **依指定基準日**計算實歲（指令三：「實歲依指定基準日期計算」）。
 *
 * 基準日是必填參數——年度活動要算的是「活動當天的實歲」，
 * 不是「今天的實歲」。
 */
export function resolveActualAgeAt(
  solarBirthDate: Date | null | undefined,
  referenceDate: Date
): AgeResult {
  if (!solarBirthDate || Number.isNaN(solarBirthDate.getTime())) {
    return { ok: false, reason: "國曆生日不完整，無法計算實歲" };
  }
  if (!referenceDate || Number.isNaN(referenceDate.getTime())) {
    return { ok: false, reason: "基準日期不合法，無法計算實歲" };
  }
  const bY = solarBirthDate.getUTCFullYear();
  const bM = solarBirthDate.getUTCMonth();
  const bD = solarBirthDate.getUTCDate();

  let age = referenceDate.getUTCFullYear() - bY;
  const passed =
    referenceDate.getUTCMonth() > bM ||
    (referenceDate.getUTCMonth() === bM && referenceDate.getUTCDate() >= bD);
  if (!passed) age -= 1;

  if (age < 0 || age > MAX_REASONABLE_AGE) {
    return { ok: false, reason: `計算出的實歲不合理（${age}），請確認出生日期` };
  }
  return { ok: true, age };
}

// ────────────────────────────────────────────────────────────
// 年度活動列印預檢（指令十一）
// ────────────────────────────────────────────────────────────

/**
 * 一筆信眾在某個活動年度的完整列印屬性。
 *
 * 指令十一要求列印預覽必須清楚顯示：活動使用年度／歲數／生肖／太歲／
 * 建生瑞生。這個型別就是那張預覽表的資料來源。
 */
export type ActivityYearPrintProfile = {
  /** 活動使用年度（民國）——一定會有，因為它是輸入參數 */
  activityMinguoYear: number;
  /** 虛歲；資料不足時為 null，並在 issues 說明原因 */
  nominalAge: number | null;
  /** 實歲（以活動日期為基準）；資料不足時為 null */
  actualAge: number | null;
  /** 信眾生肖（依出生農曆年）；資料不足時為 null */
  zodiac: string | null;
  /** 該活動年度的天干地支（歲次） */
  activitySexagenary: string;
  /** 太歲關係；無資料或不犯太歲皆為 null，用 hasTaisuiData 區分 */
  taisui: TaisuiRelation;
  /** 是否有足夠資料做太歲判斷 */
  hasTaisuiData: boolean;
  /** 建生／瑞生；性別空白時為 null（指令三：不得自行產生） */
  jishi: string | null;
  /** 星座 */
  constellation: string | null;
  /** 待處理事項；非空代表這一筆需要人工確認後才可列印 */
  issues: string[];
};

export type ActivityYearProfileInput = {
  activityMinguoYear: number;
  /** 出生農曆年（西元） */
  birthLunarYearAD: number | null | undefined;
  /** 國曆生日 */
  solarBirthDate: Date | null | undefined;
  /** 性別原始值（自由文字「男」／「女」／null） */
  gender: string | null | undefined;
  /** 實歲的計算基準日。通常是活動日期；未設定時傳 null，實歲即無法計算 */
  referenceDate: Date | null | undefined;
};

/**
 * 組出一筆信眾在指定活動年度的列印屬性。
 *
 * **所有計算都以 activityMinguoYear 為準，完全不讀今天日期。**
 * 這是指令十一「補印、重印、跨多年度仍正確」的保證：同一筆資料在任何
 * 一天執行這個函式，只要活動年度相同，結果就完全相同。
 */
export function buildActivityYearPrintProfile(
  input: ActivityYearProfileInput
): ActivityYearPrintProfile {
  const issues: string[] = [];

  const nominal = resolveNominalAgeForActivityYear(input.birthLunarYearAD, input.activityMinguoYear);
  if (!nominal.ok) issues.push(nominal.reason);

  let actualAge: number | null = null;
  if (input.referenceDate) {
    const actual = resolveActualAgeAt(input.solarBirthDate, input.referenceDate);
    if (actual.ok) actualAge = actual.age;
    else issues.push(actual.reason);
  } else {
    issues.push("活動日期未設定，無法計算實歲");
  }

  const hasBirthYear =
    input.birthLunarYearAD !== null &&
    input.birthLunarYearAD !== undefined &&
    Number.isInteger(input.birthLunarYearAD);

  const zodiac = hasBirthYear ? getZodiacAnimal(input.birthLunarYearAD as number) : null;
  if (!zodiac) issues.push("出生年份不完整，無法判斷生肖");

  const taisui = hasBirthYear
    ? resolveTaisui(input.birthLunarYearAD as number, input.activityMinguoYear)
    : null;
  if (!hasBirthYear) issues.push("出生年份不完整，無法判斷太歲");

  // 建生／瑞生：性別空白時一律 null，並列入待確認清單。
  // 指令三：「性別空白時不得自行產生建生或瑞生，必須在列印預檢中提示處理」
  const genderNorm = normalizeGenderText(input.gender);
  const jishi = genderNorm === "MALE" ? "建生" : genderNorm === "FEMALE" ? "瑞生" : null;
  if (jishi === null) issues.push("性別未填寫，無法決定建生／瑞生，請先補齊性別");

  return {
    activityMinguoYear: input.activityMinguoYear,
    nominalAge: nominal.ok ? nominal.age : null,
    actualAge,
    zodiac,
    activitySexagenary: getSexagenaryByMinguoYear(input.activityMinguoYear),
    taisui,
    hasTaisuiData: hasBirthYear,
    jishi,
    constellation: getConstellation(input.solarBirthDate),
    issues,
  };
}

/** 性別自由文字 → 三態。與 chineseNumerals.normalizeGender 同語意，這裡零相依重寫。 */
function normalizeGenderText(raw: string | null | undefined): "MALE" | "FEMALE" | "UNKNOWN" {
  if (raw === "男") return "MALE";
  if (raw === "女") return "FEMALE";
  return "UNKNOWN";
}
