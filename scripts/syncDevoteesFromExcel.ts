/**
 * 正式信眾資料權威同步工具（ERP 永久維護工具，非一次性 script）。
 *
 * ★ 永久用途：這是 ERP 長期的正式信眾資料維護工具。**未來正式信眾 Excel 更新時，
 *   不需要改任何程式**，只要重新執行本工具即可把地址／電話／生日／Email／備註
 *   等個人欄位同步到 ERP。工具可重複執行、冪等（沒有變更時不寫入），永遠以
 *   「正式信眾 Excel」為個人資料的唯一權威來源（Source of Truth）。
 *
 * ★ 欄位為資料驅動：同步的個人欄位集中定義在下方，日後正式 Excel 若新增／調整
 *   個人欄位，只需在 parsePersonSheet（欄位解析）與本工具的欄位比對區擴充，
 *   不需重寫流程；配對／安全規則／dry-run／commit 骨架維持不變。
 *
 * 目的：以正式信眾 Excel 校正每位已配對信眾的**個人**欄位為 Excel 值，
 * 修正先前「個人地址等資料被家戶地址覆蓋／錯配」的既有資料（例如邱雅玲的地址），
 * 之後每次 Excel 更新都以同一個工具持續維護。
 *
 * ── 只寫入這些「個人」欄位（Excel 有值才覆蓋；Excel 空白保留 ERP 現值） ──
 *   Member.address        個人通訊地址（正式信眾 Excel「通訊地址」）
 *   Member.gender         性別
 *   Member.solarBirthDate 國曆生日（連帶重算生肖／歲數，無需另存）
 *   Member.lunarBirth*    農曆生日
 *   DevoteeProfile.mobile 手機（延遲建立）
 *   DevoteeProfile.email  Email
 *
 * ── 絕不做 ──
 *   不建立新 Member、不刪除任何 Member、不改 Household（含家戶地址）、
 *   不改歷代祖先／乙位正魂、不改報名／收款／收據／列印／活動／稽核歷史、
 *   不用家戶地址或別人的地址補個人地址、不因同名就自動覆蓋（同名多筆一律待確認）。
 *
 * ── 配對規則（保守，禁止 index／列序／findMany 順序配對） ──
 *   1. Excel 有家戶編號 → 只在該家戶內以「姓名」比對；該戶同名多筆 → AMBIGUOUS。
 *   2. Excel 無家戶編號 → 以「姓名」在全體信眾比對：
 *        唯一 → MATCHED；多筆 → 嘗試以（生日／手機）保守縮小；仍多筆 → AMBIGUOUS。
 *   3. 找不到 → UNMATCHED。
 *   AMBIGUOUS／UNMATCHED 一律不猜測、不寫入。
 *
 * 用法（需資料庫連線的環境，例如本機）：
 *   Dry-run（預設，不寫入）：
 *     npx tsx scripts/syncDevoteesFromExcel.ts --file "/path/to/正式信眾.xlsx"
 *   正式同步（實際寫入，需先看過 dry-run）：
 *     npx tsx scripts/syncDevoteesFromExcel.ts --file "/path/to/正式信眾.xlsx" --commit
 *   額外可加 --verify "邱雅玲" 指定要重點列印的信眾姓名（預設含邱雅玲）。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readFileSync } from "node:fs";
import { parseSpreadsheetBuffer } from "@/lib/smartImport";
import { parsePersonSheet, type PersonSheetRow } from "@/lib/devoteeImportPersonSheet";
import { toJsonSnapshot } from "@/lib/recordVersion";

type Args = { file: string | null; commit: boolean; verify: string[]; reportRemaining: boolean; resolveFile: string | null };
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = { file: null, commit: false, verify: ["邱雅玲"], reportRemaining: false, resolveFile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") out.file = argv[++i] ?? null;
    else if (argv[i] === "--commit") out.commit = true;
    else if (argv[i] === "--verify") out.verify.push(argv[++i] ?? "");
    // V25.1：唯讀報表模式——逐筆列出目前仍有差異的欄位＋重複配對偵測。永不寫入。
    else if (argv[i] === "--report-remaining") out.reportRemaining = true;
    // V25.2：一次性人工決議（外部 JSON，非永久程式規則）。用來解 CONFLICT／指定合併採用值。
    else if (argv[i] === "--resolve") out.resolveFile = argv[++i] ?? null;
  }
  return out;
}

/**
 * V25.2：載入「本次同步的人工決議」（外部資料，不是寫死在程式裡的規則）。
 * 格式：{ "resolutions": [ { "name": "○○○", "gender": "女", "address": "…", "notes"?, "mobile"?, "email"? }, ... ] }
 * 依姓名對應到已合併的信眾群組；提供的欄位＝該欄位一律採用此值（可用來解 CONFLICT）。
 * 同名對應到多位時不套用（避免猜測），請改用其他方式縮小或人工個別處理。
 */
type Resolution = { name?: string; memberId?: string; address?: string; gender?: string; notes?: string; mobile?: string; email?: string };
function loadResolutions(path: string | null): { byName: Map<string, Resolution>; all: Resolution[] } {
  if (!path) return { byName: new Map(), all: [] };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { resolutions?: Resolution[] };
  const all = parsed.resolutions ?? [];
  const byName = new Map<string, Resolution>();
  for (const r of all) if (r.name) byName.set(r.name.trim(), r);
  return { byName, all };
}

const clean = (s: string | null | undefined): string | null => {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/^[\s　]+|[\s　]+$/g, "");
  return t.length > 0 ? t : null;
};
const isoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

type MatchResult =
  | { status: "MATCHED"; memberId: string; basis: string }
  | { status: "UNMATCHED" }
  | { status: "AMBIGUOUS"; candidates: number };

type MemberLite = {
  id: string;
  householdId: string;
  name: string;
  gender: string | null;
  address: string | null;
  solarBirthDate: Date | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
  mobile: string | null;
  email: string | null;
};

function birthdayKey(m: { solarBirthDate: Date | null; lunarBirthYear: number | null; lunarBirthMonth: number | null; lunarBirthDay: number | null }): string | null {
  if (m.solarBirthDate) return `s:${isoDate(m.solarBirthDate)}`;
  if (m.lunarBirthYear && m.lunarBirthMonth && m.lunarBirthDay) return `l:${m.lunarBirthYear}-${m.lunarBirthMonth}-${m.lunarBirthDay}`;
  return null;
}
function personBirthdayKey(p: PersonSheetRow): string | null {
  if (p.solarBirthDate) return `s:${p.solarBirthDate}`;
  if (p.lunarBirthYear && p.lunarBirthMonth && p.lunarBirthDay) return `l:${p.lunarBirthYear}-${p.lunarBirthMonth}-${p.lunarBirthDay}`;
  return null;
}

async function main() {
  const args = parseArgs();
  if (!args.file) {
    console.error('請以 --file "<正式信眾 Excel 路徑>" 指定檔案。');
    process.exit(1);
  }
  console.log(`\n=== V25 正式信眾資料權威同步（${args.commit ? "COMMIT 正式寫入" : "DRY-RUN 預覽，不寫入"}）===`);
  console.log(`檔案：${args.file}\n`);

  const buffer = readFileSync(args.file);
  const { rows } = parseSpreadsheetBuffer(buffer);
  const persons = parsePersonSheet(rows);
  console.log(`Excel 解析出信眾列：${persons.length}`);

  // V25.2：本次人工決議（外部 JSON；非永久程式規則）。用來解合併 CONFLICT／指定採用值。
  const { byName: resolveByName, all: resolveAll } = loadResolutions(args.resolveFile);
  if (resolveAll.length > 0) console.log(`已載入人工決議：${resolveAll.length} 筆（來源：${args.resolveFile}）`);
  const appliedResolutionNames = new Set<string>();

  // 一次撈回全體在世信眾（含個資延伸），記憶體內配對——不依 findMany 順序做任何配對。
  const members = await prisma.member.findMany({
    where: { deletedAt: null },
    select: {
      id: true, householdId: true, name: true, gender: true,
      // address 為 V25 新欄位；用 select 明確取出（Mac 上 prisma generate 後為原生欄位）。
      ...( { address: true } as Record<string, boolean> ),
      notes: true,
      solarBirthDate: true, lunarBirthYear: true, lunarBirthMonth: true, lunarBirthDay: true, lunarIsLeapMonth: true,
      devoteeProfile: { select: { mobile: true, email: true } },
    },
  }) as unknown as (Omit<MemberLite, "mobile" | "email"> & { devoteeProfile: { mobile: string | null; email: string | null } | null })[];

  const byHouseholdName = new Map<string, MemberLite[]>();
  const byName = new Map<string, MemberLite[]>();
  for (const raw of members) {
    const m: MemberLite = {
      id: raw.id, householdId: raw.householdId, name: raw.name, gender: raw.gender,
      address: (raw as unknown as { address: string | null }).address ?? null,
      solarBirthDate: raw.solarBirthDate, lunarBirthYear: raw.lunarBirthYear, lunarBirthMonth: raw.lunarBirthMonth,
      lunarBirthDay: raw.lunarBirthDay, lunarIsLeapMonth: raw.lunarIsLeapMonth,
      mobile: raw.devoteeProfile?.mobile ?? null, email: raw.devoteeProfile?.email ?? null,
    };
    const hk = `${m.householdId}::${m.name}`;
    (byHouseholdName.get(hk) ?? byHouseholdName.set(hk, []).get(hk)!).push(m);
    (byName.get(m.name) ?? byName.set(m.name, []).get(m.name)!).push(m);
  }

  function match(p: PersonSheetRow): MatchResult {
    const code = clean(p.householdCode);
    if (code) {
      const cands = byHouseholdName.get(`${code}::${p.name}`) ?? [];
      if (cands.length === 1) return { status: "MATCHED", memberId: cands[0].id, basis: "家戶編號＋姓名" };
      if (cands.length > 1) return { status: "AMBIGUOUS", candidates: cands.length };
      return { status: "UNMATCHED" };
    }
    const cands = byName.get(p.name) ?? [];
    if (cands.length === 1) return { status: "MATCHED", memberId: cands[0].id, basis: "姓名唯一" };
    if (cands.length > 1) {
      const pbk = personBirthdayKey(p);
      const pMobile = clean(p.mobile);
      const narrowed = cands.filter((c) => {
        const bMatch = pbk && birthdayKey(c) === pbk;
        const mMatch = pMobile && c.mobile && clean(c.mobile) === pMobile;
        return bMatch || mMatch;
      });
      if (narrowed.length === 1) return { status: "MATCHED", memberId: narrowed[0].id, basis: "姓名＋生日/手機" };
      return { status: "AMBIGUOUS", candidates: cands.length };
    }
    return { status: "UNMATCHED" };
  }

  const memberById = new Map(members.map((m) => [m.id, m]));
  const stats = { matched: 0, unmatched: 0, ambiguous: 0 };
  const diffCount = { address: 0, gender: 0, solar: 0, lunar: 0, mobile: 0, email: 0, notes: 0 };
  const updates: { memberId: string; member: Prisma_MemberUpdate; profile: { mobile?: string; email?: string } }[] = [];
  const verifyRows: string[] = [];

  type Prisma_MemberUpdate = { address?: string; gender?: string; notes?: string; solarBirthDate?: Date; lunarBirthYear?: number; lunarBirthMonth?: number; lunarBirthDay?: number; lunarIsLeapMonth?: boolean };

  type CurMember = {
    address: string | null; gender: string | null; notes: string | null;
    solarBirthDate: Date | null; lunarBirthYear: number | null; lunarBirthMonth: number | null; lunarBirthDay: number | null;
    devoteeProfile: { mobile: string | null; email: string | null } | null;
  };

  // ── 規則二：名稱含「歷代祖先」的列完全排除於真人信眾同步／合併之外（不配對、不合併、不寫入）。 ──
  const isAncestorRow = (name: string) => (clean(name) ?? "").includes("歷代祖先");
  let ancestorExcluded = 0;
  const realPersons = persons.filter((p) => {
    if (isAncestorRow(p.name)) { ancestorExcluded++; return false; }
    return true;
  });

  // ── 配對並依 memberId 分組：同一 memberId 的多列＝重複來源，稍後「合併」而非最後一列覆蓋。 ──
  const matchedGroups = new Map<string, { basis: string; rows: PersonSheetRow[] }>();
  for (const p of realPersons) {
    const r = match(p);
    if (r.status === "UNMATCHED") { stats.unmatched++; continue; }
    if (r.status === "AMBIGUOUS") { stats.ambiguous++; continue; }
    stats.matched++;
    const g = matchedGroups.get(r.memberId) ?? { basis: r.basis, rows: [] };
    g.rows.push(p);
    matchedGroups.set(r.memberId, g);
  }

  // ── 合併規則（安全、不覆蓋）：同欄位跨多列的非空值——唯一值→採用；多個不同非空值→CONFLICT，不採用、不寫入。 ──
  type FieldKey = "address" | "gender" | "solar" | "lunar" | "notes" | "mobile" | "email";
  const FIELD_KEYS: FieldKey[] = ["address", "gender", "solar", "lunar", "notes", "mobile", "email"];
  const FIELD_LABEL: Record<FieldKey, string> = { address: "個人地址", gender: "性別", solar: "國曆生日", lunar: "農曆生日", notes: "備註", mobile: "手機", email: "Email" };
  const extract = (p: PersonSheetRow, key: FieldKey): { norm: string | null; raw: unknown } => {
    switch (key) {
      case "address": return { norm: clean(p.address), raw: clean(p.address) };
      case "gender": return { norm: clean(p.gender), raw: clean(p.gender) };
      case "solar": return { norm: p.solarBirthDate ?? null, raw: p.solarBirthDate ?? null };
      case "lunar":
        if (!p.lunarBirthYear) return { norm: null, raw: null };
        return { norm: `${p.lunarBirthYear}-${p.lunarBirthMonth ?? ""}-${p.lunarBirthDay ?? ""}${p.lunarIsLeapMonth ? "(閏)" : ""}`, raw: { y: p.lunarBirthYear, m: p.lunarBirthMonth, d: p.lunarBirthDay, leap: p.lunarIsLeapMonth } };
      case "notes": return { norm: clean(p.notes), raw: clean(p.notes) };
      case "mobile": return { norm: clean(p.mobile), raw: clean(p.mobile) };
      case "email": return { norm: clean(p.email), raw: clean(p.email) };
    }
  };

  let mergedPersons = 0; // 由多列合併成一筆的人數
  const mergeReports: {
    memberId: string; name: string; sourceRows: number[];
    adopted: { field: string; value: string; fromRows: number[] }[];
    conflicts: { field: string; values: { value: string; rows: number[] }[] }[];
  }[] = [];

  for (const [memberId, g] of matchedGroups) {
    const cur = memberById.get(memberId) as unknown as CurMember | undefined;
    if (!cur) continue; // 成員已不存在 → 跳過，不猜測、不新建
    const sourceRows = g.rows.map((p) => p.rowNumber).sort((a, b) => a - b);
    const displayName = g.rows[0].name;
    const isMultiRow = g.rows.length > 1;
    if (isMultiRow) mergedPersons++;

    // V25.2：本次人工決議（外部 JSON），依姓名對應；提供的欄位＝一律採用此值（可解 CONFLICT）。非永久規則。
    const res = resolveByName.get(displayName);
    const overrideFor = (key: FieldKey): string | undefined => {
      if (!res) return undefined;
      const v = (res as unknown as Record<string, unknown>)[key];
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };

    // 逐欄位跨列合併（唯一非空值→採用；多個不同非空值→CONFLICT；有人工決議→採用決議值）。
    const mergedRaw: Partial<Record<FieldKey, unknown>> = {};
    const adopted: { field: string; value: string; fromRows: number[] }[] = [];
    const conflicts: { field: string; values: { value: string; rows: number[] }[] }[] = [];
    for (const key of FIELD_KEYS) {
      const byValue = new Map<string, { raw: unknown; rows: number[] }>();
      for (const p of g.rows) {
        const { norm, raw } = extract(p, key);
        if (norm === null || norm === "") continue;
        const e = byValue.get(norm) ?? { raw, rows: [] };
        e.rows.push(p.rowNumber);
        byValue.set(norm, e);
      }
      const override = overrideFor(key);
      if (override !== undefined) {
        // 人工決議：直接採用此值（即使原本是 CONFLICT，也視為已解決，不再標 CONFLICT）。
        mergedRaw[key] = override;
        adopted.push({ field: `${FIELD_LABEL[key]}（人工決議）`, value: override, fromRows: [] });
        appliedResolutionNames.add(displayName);
        continue;
      }
      if (byValue.size === 0) continue;
      if (byValue.size === 1) {
        const [norm, e] = [...byValue.entries()][0];
        mergedRaw[key] = e.raw;
        if (isMultiRow) adopted.push({ field: FIELD_LABEL[key], value: norm, fromRows: e.rows });
      } else {
        conflicts.push({ field: FIELD_LABEL[key], values: [...byValue.entries()].map(([value, e]) => ({ value, rows: e.rows })) });
      }
    }
    if (isMultiRow || res) mergeReports.push({ memberId, name: displayName, sourceRows, adopted, conflicts });

    // 用「合併後」的值 diff 現值 → 只寫「有採用且與現值不同」的欄位（CONFLICT 欄位一律不寫）。
    const curAddress = cur.address ?? null;
    const curMobile = cur.devoteeProfile?.mobile ?? null;
    const curEmail = cur.devoteeProfile?.email ?? null;
    const memberUpdate: Prisma_MemberUpdate = {};
    const profileUpdate: { mobile?: string; email?: string } = {};

    if (mergedRaw.address !== undefined && (mergedRaw.address as string) !== clean(curAddress)) { memberUpdate.address = mergedRaw.address as string; diffCount.address++; }
    if (mergedRaw.gender !== undefined && (mergedRaw.gender as string) !== clean(cur.gender)) { memberUpdate.gender = mergedRaw.gender as string; diffCount.gender++; }
    if (mergedRaw.solar !== undefined && (mergedRaw.solar as string) !== isoDate(cur.solarBirthDate)) { memberUpdate.solarBirthDate = new Date(`${mergedRaw.solar as string}T00:00:00.000Z`); diffCount.solar++; }
    if (mergedRaw.lunar !== undefined) {
      const l = mergedRaw.lunar as { y: number; m: number | null; d: number | null; leap: boolean };
      if (l.y !== cur.lunarBirthYear || l.m !== cur.lunarBirthMonth || l.d !== cur.lunarBirthDay) {
        memberUpdate.lunarBirthYear = l.y; memberUpdate.lunarBirthMonth = l.m ?? undefined; memberUpdate.lunarBirthDay = l.d ?? undefined; memberUpdate.lunarIsLeapMonth = l.leap; diffCount.lunar++;
      }
    }
    if (mergedRaw.notes !== undefined && (mergedRaw.notes as string) !== clean(cur.notes)) { memberUpdate.notes = mergedRaw.notes as string; diffCount.notes++; }
    if (mergedRaw.mobile !== undefined && (mergedRaw.mobile as string) !== clean(curMobile)) { profileUpdate.mobile = mergedRaw.mobile as string; diffCount.mobile++; }
    if (mergedRaw.email !== undefined && (mergedRaw.email as string) !== clean(curEmail)) { profileUpdate.email = mergedRaw.email as string; diffCount.email++; }

    if (args.verify.includes(displayName)) {
      verifyRows.push(`  ${displayName}｜配對：${g.basis}｜ERP 個人地址：${curAddress ?? "（空）"} → Excel（合併後）：${(mergedRaw.address as string) ?? "（空）"}${memberUpdate.address ? "（將更新）" : "（無變更）"}`);
    }

    if (Object.keys(memberUpdate).length > 0 || Object.keys(profileUpdate).length > 0) {
      updates.push({ memberId, member: memberUpdate, profile: profileUpdate });
    }
  }

  console.log("\n── 配對統計 ──");
  console.log(`  MATCHED（可安全同步）：${stats.matched}`);
  console.log(`  UNMATCHED（找不到，保留待確認）：${stats.unmatched}`);
  console.log(`  AMBIGUOUS（多筆候選，保留待確認）：${stats.ambiguous}`);
  console.log("\n── 各欄位預計更新筆數（Excel 有值且與 ERP 不同） ──");
  console.log(`  個人地址：${diffCount.address}`);
  console.log(`  性別：${diffCount.gender}`);
  console.log(`  國曆生日：${diffCount.solar}`);
  console.log(`  農曆生日：${diffCount.lunar}`);
  console.log(`  備註：${diffCount.notes}`);
  console.log(`  手機：${diffCount.mobile}`);
  console.log(`  Email：${diffCount.email}`);
  console.log(`  生肖：由生日換算（同步國曆/農曆生日後即自動修正，不另存欄位）`);
  console.log(`  信仰：ERP schema 與正式信眾 Excel 皆無此欄位，故不同步（如需請先於 schema 新增欄位）`);
  console.log(`  需寫入的信眾數（合併後、每人一筆）：${updates.length}`);

  // ── 重複來源合併報告（規則：唯一/相等→採用；空白+有值→採用有值；多個不同非空值→CONFLICT 不寫） ──
  console.log("\n── 重複來源合併 ──");
  console.log(`  歷代祖先排除筆數（名稱含「歷代祖先」，完全不動）：${ancestorExcluded}`);
  console.log(`  合併成功人數（同一 memberId 由多列合併成一筆）：${mergedPersons}`);
  const withConflicts = mergeReports.filter((m) => m.conflicts.length > 0).length;
  console.log(`  其中含欄位衝突（不自動寫入、需人工確認）人數：${withConflicts}`);
  if (resolveAll.length > 0) {
    console.log(`  已套用人工決議：${appliedResolutionNames.size}／${resolveAll.length} 筆`);
    const unused = resolveAll.map((r) => (r.name ?? "").trim()).filter((n) => n && !appliedResolutionNames.has(n));
    if (unused.length > 0) console.log(`  ⚠️ 未套用的人工決議（姓名對不到任何合併信眾，請檢查是否打錯）：${unused.join("、")}`);
  }
  if (mergeReports.length > 0) {
    console.log("\n  ── 各合併人明細 ──");
    mergeReports.forEach((m, idx) => {
      console.log(`\n  #${idx + 1} ${m.name}（memberId=${m.memberId}）`);
      console.log(`     由 Excel 列合併：${m.sourceRows.join("、")}`);
      if (m.adopted.length > 0) {
        console.log(`     採用欄位：`);
        m.adopted.forEach((a) => console.log(`       - ${a.field}＝「${a.value}」（來源列 ${a.fromRows.join("、")}）`));
      } else {
        console.log(`     採用欄位：（無新增採用；現值已一致或各列皆空）`);
      }
      if (m.conflicts.length > 0) {
        console.log(`     ⚠️ 欄位衝突（不自動寫入）：`);
        m.conflicts.forEach((c) =>
          console.log(`       - ${c.field}：${c.values.map((v) => `「${v.value}」(列 ${v.rows.join("、")})`).join(" ／ ")}`)
        );
      } else {
        console.log(`     欄位衝突：無`);
      }
    });
  }

  if (verifyRows.length > 0) {
    console.log("\n── 重點驗證 ──");
    verifyRows.forEach((r) => console.log(r));
  }

  /**
   * V25.1 唯讀報表模式（--report-remaining）：逐筆列出「目前仍與 Excel 有差異」的欄位，
   * 並偵測「同一 memberId 被多列 Excel 配對」。**完全不寫入、不修改任何資料與規則**，
   * 只是把既有的配對（match）與欄位比對結果，以人可讀清單印出來供人工判斷。
   */
  if (args.reportRemaining) {
    type Line = { name: string; row: number; memberId: string; field: string; erp: string; excel: string; basis: string };
    const lines: Line[] = [];
    // memberId → 配對到它的 Excel 列（用來偵測重複配對：同一人被多列 Excel 指到）
    const targetedBy = new Map<string, { row: number; name: string }[]>();

    const cell = (v: unknown): string => {
      if (v === null || v === undefined || v === "") return "（空）";
      if (v instanceof Date) return isoDate(v) ?? "（空）";
      return String(v);
    };

    for (const p of persons) {
      const r = match(p);
      if (r.status !== "MATCHED") continue;
      const arr = targetedBy.get(r.memberId) ?? [];
      arr.push({ row: p.rowNumber, name: p.name });
      targetedBy.set(r.memberId, arr);

      const cur = memberById.get(r.memberId) as unknown as Record<string, unknown> | undefined;
      if (!cur) continue;
      const curProfile = (cur.devoteeProfile ?? null) as { mobile: string | null; email: string | null } | null;
      const push = (field: string, erp: unknown, excel: unknown) =>
        lines.push({ name: p.name, row: p.rowNumber, memberId: r.memberId, field, erp: cell(erp), excel: cell(excel), basis: r.basis });

      // 逐欄比對（與 dry-run 完全相同的規則；此處只讀不寫）：Excel 有值且與 ERP 現值不同 → 列為剩餘差異。
      const exAddr = clean(p.address);
      if (exAddr && exAddr !== clean(cur.address as string | null)) push("個人地址 address", cur.address, p.address);
      const exGender = clean(p.gender);
      if (exGender && exGender !== clean(cur.gender as string | null)) push("性別 gender", cur.gender, p.gender);
      if (p.solarBirthDate && p.solarBirthDate !== isoDate(cur.solarBirthDate as Date | null)) push("國曆生日 solarBirthDate", cur.solarBirthDate, p.solarBirthDate);
      if (p.lunarBirthYear && (p.lunarBirthYear !== cur.lunarBirthYear || p.lunarBirthMonth !== cur.lunarBirthMonth || p.lunarBirthDay !== cur.lunarBirthDay)) {
        push("農曆生日 lunar", `${cur.lunarBirthYear ?? "?"}-${cur.lunarBirthMonth ?? "?"}-${cur.lunarBirthDay ?? "?"}`, `${p.lunarBirthYear}-${p.lunarBirthMonth}-${p.lunarBirthDay}`);
      }
      const exNotes = clean(p.notes);
      if (exNotes && exNotes !== clean(cur.notes as string | null)) push("備註 notes", cur.notes, p.notes);
      const exMobile = clean(p.mobile);
      if (exMobile && exMobile !== clean(curProfile?.mobile ?? null)) push("手機 mobile", curProfile?.mobile ?? null, p.mobile);
      const exEmail = clean(p.email);
      if (exEmail && exEmail !== clean(curProfile?.email ?? null)) push("Email email", curProfile?.email ?? null, p.email);
    }

    const dupMemberIds = new Set([...targetedBy.entries()].filter(([, rows]) => rows.length > 1).map(([id]) => id));

    console.log(`\n=== 目前仍有差異的欄位清單（唯讀，未寫入）：共 ${lines.length} 筆 ===`);
    lines.forEach((l, idx) => {
      const dup = dupMemberIds.has(l.memberId);
      console.log(
        `\n#${idx + 1}` +
        `\n  姓名        ：${l.name}` +
        `\n  Excel 列號  ：${l.row}` +
        `\n  memberId    ：${l.memberId}` +
        `\n  欄位        ：${l.field}` +
        `\n  ERP 現值    ：${l.erp}` +
        `\n  Excel 值    ：${l.excel}` +
        `\n  配對依據    ：${l.basis}` +
        `\n  重複配對    ：${dup ? `⚠️ 是（此 memberId 被 ${targetedBy.get(l.memberId)!.length} 列 Excel 配對：${targetedBy.get(l.memberId)!.map((x) => `列${x.row} ${x.name}`).join("、")}）` : "否"}`
      );
    });

    if (dupMemberIds.size > 0) {
      console.log(`\n=== ⚠️ 同一 memberId 被多列 Excel 配對（可能是重複配對規則問題）：${dupMemberIds.size} 個 memberId ===`);
      for (const id of dupMemberIds) {
        const rows = targetedBy.get(id)!;
        console.log(`  ${id} ← ${rows.map((x) => `列${x.row} ${x.name}`).join("、")}`);
      }
    } else {
      console.log("\n（沒有任何 memberId 被多列 Excel 配對；剩餘差異應為單筆資料差異，非重複配對問題。）");
    }

    console.log("\n[REPORT] 唯讀完成，未寫入、未修改任何資料。");
    await prisma.$disconnect();
    return;
  }

  if (!args.commit) {
    console.log("\n[DRY-RUN] 未寫入任何資料。確認以上統計無誤後，加 --commit 正式執行。");
    await prisma.$disconnect();
    return;
  }

  /**
   * V25.1 P2028 修正：**不再**把 1500+ 筆更新包在單一 interactive transaction
   * （`prisma.$transaction(async tx => { for ... })`）裡——遠端資料庫下逐筆序列查詢
   * 會超過互動式交易上限，之後的 update 落在已關閉的交易 → P2028
   * "Transaction not found / old closed transaction"。
   *
   * 改為「短時間、小批次」寫入：
   *   - 每批 CHUNK 筆，讀取（現值再確認冪等）在交易外先做，
   *   - 只把該批的 update/create 以 **`prisma.$transaction([...])` 陣列型交易** 一次送出並提交，
   *     交易存活時間極短、不長時間持有連線。
   *   - 每批各自獨立提交；任一批失敗 → 印出範圍與錯誤、印出目前統計、以非 0 結束，
   *     **不回滾前面已成功的批次**，重跑時因冪等（現值已相同）會自動略過。
   */
  const CHUNK = 50;
  let processed = 0;
  let UPDATED = 0;
  let SKIPPED_NO_CHANGE = 0;
  let FAILED = 0;
  const total = updates.length;
  console.log(`\n[COMMIT] 開始正式同步：共 ${total} 筆，每批 ${CHUNK} 筆（短交易、冪等、可中斷重跑）…`);

  const equalField = (current: unknown, key: string, intended: unknown): boolean => {
    if (key === "solarBirthDate") return isoDate(current as Date | null) === isoDate(intended as Date | null);
    if (typeof intended === "number" || typeof intended === "boolean") return current === intended;
    return clean(current as string | null) === clean(intended as string | null);
  };

  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = updates.slice(i, i + CHUNK);
    const rangeLabel = `[${i + 1}–${Math.min(i + CHUNK, total)}/${total}]`;
    const ids = batch.map((u) => u.memberId);

    // ── 交易外先讀現值：重跑時已寫入且相同者，這裡就會被判為「無變更」而略過（冪等）。 ──
    const curMembers = await prisma.member.findMany({ where: { id: { in: ids } } });
    const curById = new Map(curMembers.map((m) => [m.id, m as unknown as Record<string, unknown>]));
    const curProfiles = await prisma.devoteeProfile.findMany({ where: { memberId: { in: ids } } });
    const curProfById = new Map(curProfiles.map((p) => [p.memberId, p]));

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    let batchUpdated = 0;
    let batchSkipped = 0;
    let batchFailed = 0;

    for (const u of batch) {
      const cur = curById.get(u.memberId);
      if (!cur) {
        // 成員在 dry-run 之後被刪除/消失——不猜測、不新建，計入 FAILED 並略過該筆。
        batchFailed++;
        console.warn(`  ${rangeLabel} 略過：找不到成員 ${u.memberId}（可能已刪除）`);
        continue;
      }

      const memberDiff: Record<string, unknown> = {};
      for (const [key, intended] of Object.entries(u.member)) {
        if (!equalField(cur[key], key, intended)) memberDiff[key] = intended;
      }
      const curProfile = curProfById.get(u.memberId);
      const profileDiff: Record<string, unknown> = {};
      if (u.profile.mobile !== undefined && clean(curProfile?.mobile ?? null) !== clean(u.profile.mobile)) {
        profileDiff.mobile = u.profile.mobile;
      }
      if (u.profile.email !== undefined && clean(curProfile?.email ?? null) !== clean(u.profile.email)) {
        profileDiff.email = u.profile.email;
      }

      if (Object.keys(memberDiff).length === 0 && Object.keys(profileDiff).length === 0) {
        batchSkipped++; // 冪等：現值已與 Excel 一致（含中途失敗後重跑已寫入的部分）。
        continue;
      }

      if (Object.keys(memberDiff).length > 0) {
        ops.push(prisma.member.update({ where: { id: u.memberId }, data: memberDiff }));
        ops.push(
          prisma.recordVersion.create({
            data: {
              entityType: "Member",
              entityId: u.memberId,
              action: "UPDATE",
              beforeData: toJsonSnapshot(cur),
              afterData: toJsonSnapshot({ ...cur, ...memberDiff }),
              operatorName: "V25 正式信眾資料權威同步",
              changeNote: "以正式信眾 Excel 校正個人欄位（地址/性別/生日/備註/電話/Email）",
            },
          })
        );
      }
      if (Object.keys(profileDiff).length > 0) {
        if (curProfile) {
          ops.push(prisma.devoteeProfile.update({ where: { memberId: u.memberId }, data: profileDiff }));
        } else {
          ops.push(prisma.devoteeProfile.create({ data: { memberId: u.memberId, ...profileDiff } }));
        }
      }
      batchUpdated++;
    }

    // ── 只把「寫入」以短交易一次送出並提交（陣列型交易，非長時間 interactive）。 ──
    if (ops.length > 0) {
      try {
        await prisma.$transaction(ops);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n❌ 批次 ${rangeLabel} 寫入失敗：${message}`);
        console.error(`   已成功批次維持不變（不回滾）。修正後重跑本工具即可自動略過已完成者、從此批續做。`);
        UPDATED += 0; // 本批未提交，不計入 UPDATED
        FAILED += batch.length;
        console.error(`\n[COMMIT 中止統計] UPDATED=${UPDATED}、SKIPPED_NO_CHANGE=${SKIPPED_NO_CHANGE}、FAILED=${FAILED}`);
        await prisma.$disconnect();
        process.exit(1);
      }
    }

    UPDATED += batchUpdated;
    SKIPPED_NO_CHANGE += batchSkipped;
    FAILED += batchFailed;
    processed += batch.length;
    console.log(`  ${rangeLabel} 已完成（本批 更新 ${batchUpdated}／略過 ${batchSkipped}／失敗 ${batchFailed}）`);
  }

  console.log("\n[COMMIT] 完成。");
  console.log("── 本次寫入統計 ──");
  console.log(`  UPDATED（實際更新）：${UPDATED}`);
  console.log(`  SKIPPED_NO_CHANGE（現值已一致，未更新）：${SKIPPED_NO_CHANGE}`);
  console.log(`  FAILED（找不到成員等，未更新）：${FAILED}`);
  console.log(`  已處理：${processed}/${total}`);
  console.log("\n重跑本工具（dry-run 或 commit）應顯示需寫入筆數為 0（冪等驗證）。");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
