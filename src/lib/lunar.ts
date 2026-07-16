/**
 * 農曆 / 國曆轉換與生肖、年齡計算
 *
 * 所有跟農曆有關的計算「都集中在這一個檔案」，之後如果要更換底層農曆函式庫，
 * 或發現某個 API 名稱在新版本改了，只需要修改這裡，不會影響其他程式。
 *
 * 底層使用 lunar-javascript（支援閏月、干支、生肖等，長期維護中）。
 *
 * ⚠️ 這個檔案在雲端撰寫環境中「無法連線安裝套件」，因此尚未實際執行測試。
 * 第一次在 Mac 上 `npm install` 完成後，請務必執行：
 *     npx tsx scripts/verify-lunar.ts
 * 核對幾組已知的農曆新年日期，確認換算正確（見該檔案內的說明）。
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Solar, Lunar, LunarYear } = require("lunar-javascript");

export type LunarDate = {
  year: number;
  month: number; // 1-12（正數，是否閏月另外看 isLeapMonth）
  day: number;
  isLeapMonth: boolean;
};

export type BirthdayFields = {
  solarBirthDate?: Date | null;
  lunarBirthYear?: number | null;
  lunarBirthMonth?: number | null;
  lunarBirthDay?: number | null;
  lunarIsLeapMonth?: boolean | null;
};

export type BirthdayInfo = {
  solarDate: Date;
  lunar: LunarDate;
  zodiac: string; // 生肖，例如「虎」
  actualAge: number; // 實歲（周歲）
  nominalAge: number; // 虛歲（農曆，正月初一自動加一歲）
};

/**
 * 農曆（年,月,日,是否閏月）→ 國曆 Date
 *
 * 這裡回傳的 Date「一律用 UTC 午夜代表純日期」（不含時區）。生日是單純的日曆日期，
 * 不應該因為伺服器主機的時區設定不同，就在存進資料庫或换算時被誤差成前一天或後一天，
 * 所以全部生日相關的 Date 都用 Date.UTC 建立、也都用 getUTC* 讀取，維持一致。
 */
export function lunarToSolar(
  year: number,
  month: number,
  day: number,
  isLeapMonth = false
): Date {
  const lunarMonth = isLeapMonth ? -month : month;
  const lunar = Lunar.fromYmd(year, lunarMonth, day);
  const solar = lunar.getSolar();
  return new Date(Date.UTC(solar.getYear(), solar.getMonth() - 1, solar.getDay()));
}

/** 國曆 Date → 農曆資料（date 必須是「代表純日期」的 Date，見上方說明） */
export function solarToLunar(date: Date): LunarDate {
  const solar = Solar.fromYmd(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate()
  );
  const lunar = solar.getLunar();
  const rawMonth = lunar.getMonth();
  return {
    year: lunar.getYear(),
    month: Math.abs(rawMonth),
    day: lunar.getDay(),
    isLeapMonth: rawMonth < 0,
  };
}

/** 某農曆年的閏月是幾月；回傳 0 代表當年沒有閏月。用於新增資料時驗證「閏月」勾選是否合法。 */
export function getLeapMonthOfYear(year: number): number {
  return LunarYear.fromYear(year).getLeapMonth();
}

/** 生肖（以農曆年為準） */
export function getZodiacByLunarYear(lunarYear: number): string {
  const lunar = Lunar.fromYmd(lunarYear, 1, 1);
  return lunar.getYearShengXiao();
}

/**
 * 實歲（周歲）：以國曆生日計算，尚未過生日則少一歲。
 * solarBirthDate 用 getUTC*（純日期），today 是「現在這個當下」用本地時間的年月日即可。
 */
export function getActualAge(solarBirthDate: Date, today: Date = new Date()): number {
  const bY = solarBirthDate.getUTCFullYear();
  const bM = solarBirthDate.getUTCMonth();
  const bD = solarBirthDate.getUTCDate();

  let age = today.getFullYear() - bY;
  const hasHadBirthdayThisYear =
    today.getMonth() > bM || (today.getMonth() === bM && today.getDate() >= bD);
  if (!hasHadBirthdayThisYear) age -= 1;
  return Math.max(age, 0);
}

/**
 * 虛歲：目前農曆年 - 出生農曆年 + 1。
 * 因為「目前農曆年」是用今天日期換算出的農曆年份，農曆正月初一一過，
 * 換算結果自動變成新的一年，虛歲就會自動加一，不需要額外排程。
 */
export function getNominalAge(birthLunarYear: number, today: Date = new Date()): number {
  const currentLunar = Solar.fromDate(today).getLunar();
  return currentLunar.getYear() - birthLunarYear + 1;
}

/** 綜合換算：只要有國曆或農曆其中一種生日資料，算出完整資訊 */
export function deriveBirthdayInfo(fields: BirthdayFields): BirthdayInfo | null {
  let solarDate: Date;

  if (fields.solarBirthDate) {
    solarDate = fields.solarBirthDate;
  } else if (fields.lunarBirthYear && fields.lunarBirthMonth && fields.lunarBirthDay) {
    solarDate = lunarToSolar(
      fields.lunarBirthYear,
      fields.lunarBirthMonth,
      fields.lunarBirthDay,
      !!fields.lunarIsLeapMonth
    );
  } else {
    return null;
  }

  const lunar = solarToLunar(solarDate);

  return {
    solarDate,
    lunar,
    zodiac: getZodiacByLunarYear(lunar.year),
    actualAge: getActualAge(solarDate),
    nominalAge: getNominalAge(lunar.year),
  };
}

/** 格式化農曆日期成中文字串，例如「農曆 1990 年 三月 初五（閏）」 */
export function formatLunarDate(lunar: LunarDate): string {
  const monthNames = [
    "正月",
    "二月",
    "三月",
    "四月",
    "五月",
    "六月",
    "七月",
    "八月",
    "九月",
    "十月",
    "十一月",
    "十二月",
  ];
  const dayNames = [
    "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
  ];
  const leapTag = lunar.isLeapMonth ? "閏" : "";
  return `農曆 ${lunar.year} 年 ${leapTag}${monthNames[lunar.month - 1]}${dayNames[lunar.day - 1]}`;
}

/**
 * 驗證「新增家人」表單填的農曆生日是否合理（年份範圍、月份、日期、閏月是否存在）。
 * 回傳 null 代表沒問題；有問題回傳中文錯誤訊息，給 API 直接回覆給前端顯示。
 */
export function validateLunarBirthdayInput(
  year: number,
  month: number,
  day: number,
  isLeapMonth: boolean
): string | null {
  if (year < 1900 || year > 2100) return "農曆年份請輸入 1900 到 2100 之間";
  if (month < 1 || month > 12) return "農曆月份請輸入 1 到 12 之間";
  if (day < 1 || day > 30) return "農曆日期請輸入 1 到 30 之間";
  if (isLeapMonth) {
    const leapMonth = getLeapMonthOfYear(year);
    if (leapMonth !== month) {
      return leapMonth === 0
        ? `農曆 ${year} 年沒有閏月，請確認輸入是否正確`
        : `農曆 ${year} 年的閏月是閏${leapMonth}月，不是閏${month}月，請確認輸入是否正確`;
    }
  }
  return null;
}

/** 格式化國曆日期成 yyyy/MM/dd（date 是「代表純日期」的 Date，用 getUTC*） */
export function formatSolarDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

/**
 * 解析 "yyyy-MM-dd" 格式的國曆日期字串成「代表純日期」的 Date（用 Date.UTC 建立）。
 * 格式不對或日期不存在（例如 2/30）回傳 null。給 API route 共用，不用每個地方各自
 * 重寫一次正則跟驗證。
 */
export function parseSolarDateString(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, yStr, mStr, dStr] = match;
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC 對超出範圍的月/日會自動進位（例如 2/30 變成 3/2），用回讀確認沒有跑掉，
  // 才是真正合法存在的日期。
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

/**
 * 12 生肖清單（V5.0 新增，供「生日與農曆中心」的生肖下拉選單使用）。
 *
 * 刻意不寫死固定的中文字串陣列，而是直接用 getZodiacByLunarYear 實際換算
 * 今年往前 12 個農曆年份取得——這樣不管 lunar-javascript 版本用字是傳統或
 * 簡體、順序為何，都保證跟系統其他地方顯示的生肖字串完全一致。
 */
export function getZodiacOptions(referenceDate: Date = new Date()): string[] {
  const currentLunarYear = Solar.fromDate(referenceDate).getLunar().getYear();
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (let y = currentLunarYear; ordered.length < 12; y--) {
    const z = getZodiacByLunarYear(y);
    if (!seen.has(z)) {
      seen.add(z);
      ordered.push(z);
    }
  }
  return ordered;
}

/**
 * 只知道生肖時，列出候選出生年（農曆年，V5.0 新增）。
 *
 * 從今年（農曆）往前找 yearsBack 年內，所有符合這個生肖的農曆年份，附上虛歲——
 * 虛歲只需要年份就能精確算出（不需要月日），實歲則因為不知道確切月日無法精確
 * 判斷是否已過生日，所以候選清單只顯示虛歲；行政人員選定年份後，如果之後補得到
 * 確切月日，再用農曆模式輸入即可看到完整換算（含實歲）。
 */
export function getCandidateBirthYearsByZodiac(
  zodiac: string,
  referenceDate: Date = new Date(),
  yearsBack = 100
): { lunarYear: number; nominalAge: number }[] {
  const currentLunarYear = Solar.fromDate(referenceDate).getLunar().getYear();
  const results: { lunarYear: number; nominalAge: number }[] = [];
  for (let y = currentLunarYear; y >= currentLunarYear - yearsBack; y--) {
    if (getZodiacByLunarYear(y) === zodiac) {
      results.push({ lunarYear: y, nominalAge: currentLunarYear - y + 1 });
    }
  }
  return results;
}
