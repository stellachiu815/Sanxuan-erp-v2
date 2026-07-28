import type { Prisma } from "@prisma/client";
import { toCalendarDateKey } from "@/lib/devoteeDuplicates";

/**
 * V12.6「Excel 匯入中心正式版」指令三＋四：家戶成員的多欄比對。
 *
 * ── 問題背景 ──
 * V12.6 之前，匯入時判斷「這位成員是不是已經存在」只用了姓名，而且只在
 * 目標家戶內比對（devoteeImportBatch.ts 舊版 `existingNames = new Set(m.name)`）。
 * 兩個後果：
 *   1. 同一戶內同名的兩個人會被當成同一人，第二位永遠不會被建立。
 *   2. 已經在別戶的同名成員完全偵測不到，會在新戶再建一個同名的人。
 *
 * ── 本檔案的角色 ──
 * 依指令三提供「保守的多欄比對」，並把結果分成三種可信度，讓呼叫端決定
 * 自動處理或交給人工確認。**只回傳判斷結果，不寫入任何資料、不自動合併。**
 *
 * ⚠️ 沒有第二套比對演算法：這裡的欄位定義（電話取個人手機優先、生日 key
 * 的正規化）與既有的 src/lib/devoteeDuplicates.ts／devoteeDuplicateMatcher.ts
 * 完全一致，生日 key 直接呼叫既有的 toCalendarDateKey()（V12.2 修過時區
 * 差一天的那一支），不重寫。
 */

/** 從 Excel（家戶檔＋個人檔合併後）得到的一位待匯入成員。 */
export type IncomingMember = {
  name: string;
  mobile: string | null;
  phone: string | null;
  solarBirthDate: string | null; // yyyy-MM-dd
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
  address: string | null;
  /**
   * V13.2：性別（已正規化為「男」／「女」／null）。
   *
   * ⚠️ 這個欄位是 V13.2 修復的核心：個人資料工作表明明有性別，
   * 但 IncomingMember 原本**沒有這個欄位**，導致性別在「個人 Excel 解析
   * 完成 → 組成 IncomingMember」這一步被整個丟掉，永遠寫不進 Member.gender。
   *
   * 家戶 Excel 七欄沒有性別欄位，所以合併時一律以個人資料為準；
   * 家戶端沒有性別**不代表要清空**（V13.2 第三節之 4）。
   */
  gender: string | null;
  /** V24：身份 → Member.role（MemberRole 字串；對不上/空白為 null，不覆蓋既有）。 */
  role: string | null;
  /** V13.1 指令一：身分證字號（已正規化，空白為 null） */
  nationalId: string | null;
  /**
   * V13.1 指令八：牌位地址。只有當這一列的資料型態是歷代祖先／乙位正魂時
   * 才會有值；一般家戶成員一律為 null。
   * ⚠️ 絕不可與 address 互相覆蓋。
   */
  tabletAddress: string | null;
};

/** 資料庫既有成員（比對用的精簡投影）。 */
export type ExistingMemberForMatch = {
  id: string;
  name: string;
  householdId: string;
  /** V13.2：資料庫既有性別，用來在預檢階段偵測與 Excel 的衝突 */
  gender: string | null;
  householdName: string;
  mobile: string | null; // DevoteeProfile.mobile
  householdPhone: string | null;
  householdAddress: string | null;
  solarBirthDate: Date | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
};

export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW";

export type MemberMatchCandidate = {
  memberId: string;
  name: string;
  householdId: string;
  householdName: string;
  confidence: MatchConfidence;
  /** 命中的比對欄位，供預檢畫面說明「為什麼認為是同一人」 */
  matchedFields: string[];
  /** 這位既有成員是否在「別的家戶」——決定要不要問人工要不要轉戶 */
  inOtherHousehold: boolean;
};

export type MemberMatchResult = {
  incoming: IncomingMember;
  /** 依可信度排序（HIGH 在前） */
  candidates: MemberMatchCandidate[];
  /**
   * 建議動作（V25.1：家戶編號 HouseholdCode 優先權最高）：
   *   CREATE            沒有任何候選 → 直接新增
   *   SKIP_SAME_PERSON  同一家戶編號內、姓名相同且唯一 → 視為同一人，直接更新（不需人工確認）
   *   NEEDS_REVIEW      只在其他家戶找到同名（跨戶不自動轉戶），或同戶內多位同名 → 交人工確認
   */
  suggestion: "CREATE" | "SKIP_SAME_PERSON" | "NEEDS_REVIEW";
  reason: string;
};

/** 電話正規化：只留數字，讓 0912-345-678 與 0912345678 視為相同。 */
function digits(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length >= 7 ? d : null;
}

function normText(v: string | null): string | null {
  if (!v) return null;
  const t = v.replace(/[\s　]/g, "");
  return t.length > 0 ? t : null;
}

/** 生日 key：沿用既有 toCalendarDateKey()（已處理 UTC/本地午夜差一天）。 */
function birthdayKeyOfIncoming(m: IncomingMember): string | null {
  if (m.solarBirthDate) return `solar:${m.solarBirthDate}`;
  if (m.lunarBirthYear && m.lunarBirthMonth && m.lunarBirthDay) {
    return `lunar:${m.lunarBirthYear}-${m.lunarBirthMonth}-${m.lunarBirthDay}-${m.lunarIsLeapMonth}`;
  }
  return null;
}

function birthdayKeyOfExisting(m: ExistingMemberForMatch): string | null {
  if (m.solarBirthDate) return `solar:${toCalendarDateKey(m.solarBirthDate)}`;
  if (m.lunarBirthYear && m.lunarBirthMonth && m.lunarBirthDay) {
    return `lunar:${m.lunarBirthYear}-${m.lunarBirthMonth}-${m.lunarBirthDay}-${m.lunarIsLeapMonth}`;
  }
  return null;
}

/**
 * 比對一位待匯入成員與候選既有成員。
 *
 * 可信度規則（保守，指令三／四：只有高可信度才可自動處理）：
 *
 *   HIGH    姓名相同 ＋（電話相同 或 生日相同）
 *           → 兩個獨立欄位同時吻合，足以認定同一人
 *   MEDIUM  姓名相同 ＋ 地址相同（但電話與生日都沒有可比的資料）
 *           → 同住同名很可能是同一人，但也可能是父子同名，交人工
 *   LOW     只有姓名相同，其餘欄位無資料可比
 *           → 指令三明訂「只有姓名相同但其他資料不足時，列為疑似重複」
 *
 * ⚠️ 姓名不同一律不視為候選——匯入情境下姓名是唯一穩定的錨點，
 *    只靠電話相同就跨姓名合併風險過高（家用電話全家共用）。
 */
export function matchIncomingMember(
  incoming: IncomingMember,
  targetHouseholdId: string,
  existingCandidates: ExistingMemberForMatch[]
): MemberMatchResult {
  const inName = normText(incoming.name);
  const inPhones = new Set([digits(incoming.mobile), digits(incoming.phone)].filter(Boolean) as string[]);
  const inAddr = normText(incoming.address);
  const inBirthday = birthdayKeyOfIncoming(incoming);

  const candidates: MemberMatchCandidate[] = [];

  for (const ex of existingCandidates) {
    if (normText(ex.name) !== inName) continue;

    const exPhones = new Set(
      [digits(ex.mobile), digits(ex.householdPhone)].filter(Boolean) as string[]
    );
    const samePhone = [...inPhones].some((p) => exPhones.has(p));
    const exBirthday = birthdayKeyOfExisting(ex);
    const sameBirthday = Boolean(inBirthday && exBirthday && inBirthday === exBirthday);
    const sameAddress = Boolean(inAddr && normText(ex.householdAddress) === inAddr);

    const matchedFields = ["姓名"];
    if (samePhone) matchedFields.push("電話");
    if (sameBirthday) matchedFields.push("生日");
    if (sameAddress) matchedFields.push("地址");

    let confidence: MatchConfidence;
    if (samePhone || sameBirthday) confidence = "HIGH";
    else if (sameAddress) confidence = "MEDIUM";
    else confidence = "LOW";

    candidates.push({
      memberId: ex.id,
      name: ex.name,
      householdId: ex.householdId,
      householdName: ex.householdName,
      confidence,
      matchedFields,
      inOtherHousehold: ex.householdId !== targetHouseholdId,
    });
  }

  const order: Record<MatchConfidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  candidates.sort((a, b) => order[a.confidence] - order[b.confidence]);

  if (candidates.length === 0) {
    return { incoming, candidates, suggestion: "CREATE", reason: "資料庫沒有相似的既有信眾" };
  }

  /**
   * V25.1 預檢修正：**家戶編號（HouseholdCode）是家戶的唯一識別，優先權最高。**
   *
   * 匯入的家戶編號若對應到既有家戶（targetHouseholdId），代表這一列就是「更新
   * 這一戶」。因此在**同一家戶編號內**、姓名相同的成員，就是既有成員本人——
   * 直接更新即可，不得再進入疑似重複／人工確認／Merge 流程。
   *
   * 舊做法的問題：家戶檔沒有電話/生日可比，同戶同名只會命中「地址相同」（因為
   * 同一戶地址本來就相同）→ 判為 MEDIUM → NEEDS_REVIEW，導致 727 戶重匯時
   * 幾乎每一戶都被要求人工確認。這在「同 HouseholdCode」前提下是不必要的。
   *
   * 仍需人工確認者只剩真正的模糊情況：
   *   - 同一戶內有「多位同名」（不知道要更新哪一位）；
   *   - 只在「其他家戶」找到同名成員（跨戶，不可自動轉戶，指令三）。
   */
  const sameHousehold = candidates.filter((c) => !c.inOtherHousehold);
  const otherHousehold = candidates.filter((c) => c.inOtherHousehold);

  // 同一家戶編號內、姓名相同且唯一 → 視為同一人，直接更新，不需人工確認。
  if (sameHousehold.length === 1) {
    const m = sameHousehold[0];
    return {
      incoming,
      candidates,
      suggestion: "SKIP_SAME_PERSON",
      reason: `本戶（家戶編號相同）已有「${m.name}」，家戶編號為家戶唯一識別，視為同一人直接更新（比對依據：家戶編號＋${m.matchedFields.join("＋")}），不需人工確認。`,
    };
  }

  // 同一家戶編號內有「多位同名」→ 無法自動判定要更新哪一位（多個候選）→ 交人工。
  if (sameHousehold.length > 1) {
    return {
      incoming,
      candidates,
      suggestion: "NEEDS_REVIEW",
      reason: `本戶（家戶編號相同）有多位同名的「${incoming.name}」，無法自動判定要更新哪一位，請人工確認。`,
    };
  }

  // 到這裡：沒有任何同戶候選，只有「其他家戶」的同名成員 → 不可自動轉戶（指令三），交人工。
  const best = otherHousehold[0];
  return {
    incoming,
    candidates,
    suggestion: "NEEDS_REVIEW",
    reason: `「${best.name}」已存在於其他家戶 ${best.householdName}（${best.householdId}），比對依據：${best.matchedFields.join("＋")}。家戶編號不同，不會自動轉戶，請人工確認。`,
  };
}

/**
 * 依待匯入成員組出「要從資料庫撈哪些既有成員來比對」的 where 條件。
 *
 * 為什麼要縮小範圍：匯入可能一次數百列，不能把整張 members 撈出來。
 * 條件是「姓名相同」——上面所有可信度規則都以姓名相同為前提，所以用姓名
 * 縮小範圍不會漏掉任何會被判定為候選的資料。
 */
export function buildMemberMatchWhere(names: string[]): Prisma.MemberWhereInput {
  return {
    deletedAt: null,
    household: { deletedAt: null },
    name: { in: Array.from(new Set(names)) },
  };
}
