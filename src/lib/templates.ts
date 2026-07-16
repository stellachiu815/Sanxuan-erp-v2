import { ActivityType, TemplateCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * V8.1「台北三玄宮模板中心」核心邏輯（需求「五、六、七」）。
 *
 * 這裡管理所有列印/Excel/CSV/Word/PDF 模板的「分類資料」——即使目前還沒有
 * 真的上傳 Word/PDF 原始檔，也先把模板分類（TemplateDefinition）建立好；
 * 之後檔案送到，只要新增一筆 TemplateVersion 並標記 isActive，前端/列印
 * 引擎不需要重新開發，只是多了一個可以套用的版本。
 *
 * fileUrl 本輪先留欄位：沙盒環境無法真的儲存/上傳二進位檔案，見交付說明
 * 的誠實限制章節；真正上線後接檔案儲存服務（例如物件儲存）即可，不影響
 * 這裡的資料模型。
 */

type TemplateSeed = { key: string; name: string; description?: string; activityType: ActivityType | null };

// 需求「六、官方列印模板」清單——同時套用在 PRINT／WORD／PDF 三個分類
// （同一份官方文件，可能會有列印版型、Word 原始檔、PDF 檔三種形式）。
const OFFICIAL_DOCUMENT_TEMPLATES: TemplateSeed[] = [
  { key: "GUANGMING_LANTERN_TABLET", name: "光明燈燈牌", activityType: "GUANGMING_LANTERN" },
  { key: "TAISUI_LANTERN_TABLET", name: "太歲燈燈牌", activityType: "TAISUI_LANTERN" },
  { key: "FAMILY_LANTERN_TABLET", name: "全家燈燈牌", activityType: "FAMILY_LANTERN" },
  { key: "GUANGMING_LANTERN_PETITION", name: "光明燈疏文", activityType: "GUANGMING_LANTERN" },
  { key: "TAISUI_LANTERN_PETITION", name: "太歲燈疏文", activityType: "TAISUI_LANTERN" },
  { key: "FAMILY_LANTERN_PETITION", name: "全家燈疏文", activityType: "FAMILY_LANTERN" },
  { key: "PURIFICATION_STICKER", name: "祭改小人頭", activityType: "PURIFICATION" },
  { key: "ANCESTOR_LINE_TABLET", name: "歷代祖先", activityType: "UNIVERSAL_SALVATION" },
  { key: "INDIVIDUAL_SOUL_TABLET", name: "個人乙位正魂", activityType: "UNIVERSAL_SALVATION" },
  { key: "DEBT_CREDITOR_TABLET", name: "冤親債主", activityType: "UNIVERSAL_SALVATION" },
  { key: "UNBORN_CHILD_TABLET", name: "無緣子女", activityType: "UNIVERSAL_SALVATION" },
  { key: "UNIVERSAL_SALVATION_BAG", name: "普渡寶袋", activityType: "UNIVERSAL_SALVATION" },
  { key: "ANCESTOR_BAG", name: "祖先寶袋", activityType: "UNIVERSAL_SALVATION" },
  { key: "MERIT_ROSTER", name: "功德名錄", activityType: null },
  { key: "RECEIPT", name: "收據", activityType: null },
  { key: "FINANCE_REPORT", name: "財務報表", activityType: null },
];

// 需求「七、官方Excel模板」清單——同時套用在 EXCEL／CSV 兩個分類。
const OFFICIAL_DATA_TEMPLATES: TemplateSeed[] = [
  { key: "MEMBER_DATA", name: "信眾資料", activityType: null },
  { key: "HOUSEHOLD_DATA", name: "家戶資料", activityType: null },
  { key: "UNIVERSAL_SALVATION_IMPORT", name: "普渡", activityType: "UNIVERSAL_SALVATION" },
  { key: "PURIFICATION_IMPORT", name: "祭改", activityType: "PURIFICATION" },
  { key: "GUANGMING_LANTERN_IMPORT", name: "光明燈", activityType: "GUANGMING_LANTERN" },
  { key: "TAISUI_LANTERN_IMPORT", name: "太歲燈", activityType: "TAISUI_LANTERN" },
  { key: "FAMILY_LANTERN_IMPORT", name: "全家燈", activityType: "FAMILY_LANTERN" },
  { key: "PAYMENT_IMPORT", name: "收款", activityType: null },
  { key: "EXPENSE_IMPORT", name: "支出", activityType: null },
  { key: "FINANCE_IMPORT", name: "財務", activityType: null },
  // V9.1「附加列印項目」Excel 匯入方式二（明細工作表），欄位定義見
  // src/lib/importFieldSuggestion.ts 的 ADDITIONAL_PRINT_ITEM_FIELDS。
  { key: "ADDITIONAL_PRINT_ITEM_IMPORT", name: "附加列印項目（寶袋等）", activityType: "UNIVERSAL_SALVATION" },
  // V10.1「供品認捐中心」Excel 匯入（需求「八」方式一/方式二共用欄位），
  // 欄位定義見 src/lib/importFieldSuggestion.ts 的 OFFERING_CLAIM_FIELDS。
  { key: "OFFERING_CLAIM_IMPORT", name: "供品認捐（壽龜/麵塔/花果供品等）", activityType: "TEMPLE_CELEBRATION" },
];

const SEED_BY_CATEGORY: Record<TemplateCategory, TemplateSeed[]> = {
  PRINT: OFFICIAL_DOCUMENT_TEMPLATES,
  WORD: OFFICIAL_DOCUMENT_TEMPLATES,
  PDF: OFFICIAL_DOCUMENT_TEMPLATES,
  EXCEL: OFFICIAL_DATA_TEMPLATES,
  CSV: OFFICIAL_DATA_TEMPLATES,
};

/**
 * 預先建立官方模板分類資料（需求「六、七」：即使還沒有上傳原始檔，也先
 * 建立模板分類）。用 upsert 逐筆處理，可以安全地重複呼叫（例如之後補上
 * 新的模板分類清單），不會產生重複資料，也不會覆蓋掉已經上傳的版本
 * （versions 不受影響，只更新分類本身的 name/description/sortOrder）。
 */
export async function seedOfficialTemplates(): Promise<{ createdCount: number }> {
  let createdCount = 0;
  for (const category of Object.keys(SEED_BY_CATEGORY) as TemplateCategory[]) {
    const seeds = SEED_BY_CATEGORY[category];
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const result = await prisma.templateDefinition.upsert({
        where: { category_key: { category, key: seed.key } },
        update: { name: seed.name, activityType: seed.activityType, sortOrder: i },
        create: {
          category,
          key: seed.key,
          name: seed.name,
          activityType: seed.activityType,
          sortOrder: i,
        },
      });
      if (result.createdAt.getTime() === result.updatedAt.getTime()) createdCount++;
    }
  }
  return { createdCount };
}

export async function listTemplates(category?: TemplateCategory) {
  return prisma.templateDefinition.findMany({
    where: category ? { category } : undefined,
    include: { versions: { orderBy: { createdAt: "desc" } } },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });
}

export async function getTemplateDefinition(id: string) {
  return prisma.templateDefinition.findUnique({
    where: { id },
    include: { versions: { orderBy: { createdAt: "desc" } } },
  });
}

export type AddTemplateVersionInput = {
  versionLabel: string;
  fileName?: string | null;
  fileUrl?: string | null;
  note?: string | null;
  activate?: boolean;
};

/**
 * 新增一個模板版本（實際上傳 Word/Excel/PDF 原始檔後呼叫這支）。activate=true
 * 時會把這個分類底下其他版本的 isActive 都設回 false，確保永遠只有一個
 * 正式使用中的版本。
 */
export async function addTemplateVersion(
  templateDefinitionId: string,
  input: AddTemplateVersionInput
): Promise<{ ok: true; data: { id: string } } | { ok: false; status: number; error: string }> {
  const definition = await prisma.templateDefinition.findUnique({ where: { id: templateDefinitionId } });
  if (!definition) {
    return { ok: false, status: 404, error: "找不到這個模板分類" };
  }

  const created = await prisma.$transaction(async (tx) => {
    if (input.activate) {
      await tx.templateVersion.updateMany({
        where: { templateDefinitionId, isActive: true },
        data: { isActive: false },
      });
    }
    return tx.templateVersion.create({
      data: {
        templateDefinitionId,
        versionLabel: input.versionLabel,
        fileName: input.fileName ?? null,
        fileUrl: input.fileUrl ?? null,
        note: input.note ?? null,
        isActive: Boolean(input.activate),
        uploadedAt: new Date(),
      },
    });
  });

  return { ok: true, data: { id: created.id } };
}

export async function setActiveTemplateVersion(
  templateDefinitionId: string,
  versionId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const version = await prisma.templateVersion.findUnique({ where: { id: versionId } });
  if (!version || version.templateDefinitionId !== templateDefinitionId) {
    return { ok: false, status: 404, error: "找不到這個模板版本" };
  }
  await prisma.$transaction([
    prisma.templateVersion.updateMany({ where: { templateDefinitionId, isActive: true }, data: { isActive: false } }),
    prisma.templateVersion.update({ where: { id: versionId }, data: { isActive: true } }),
  ]);
  return { ok: true };
}

// ============================================================
// 官方Excel模板：管理者可下載空白模板（需求「七」）。這裡只先提供有明確
// 欄位定義的幾種（家戶/信眾資料沿用既有匯入欄位；祭改/光明燈/太歲燈/
// 全家燈沿用 smartImport.ts 的智慧匯入欄位定義），其餘（普渡/收款/支出/
// 財務）目前還沒有對應的匯入欄位規格，先不提供空白範本下載，避免自己
// 編造一份欄位規格——之後這些模組有正式的匯入欄位定義時，直接在這裡
// 補上對照表即可。
// ============================================================

const BLANK_TEMPLATE_COLUMNS: Record<string, string[]> = {
  HOUSEHOLD_DATA: [
    "家戶編號",
    "家戶名稱",
    "主要聯絡人",
    "電話",
    "地址",
    "公司名稱",
    "家戶成員姓名",
    "國曆生日",
    "農曆生日",
    "生肖",
    "是否已辭世",
    "歷代祖先",
    "個人乙位正魂",
    "陽上姓名",
    "安奉位置",
    "備註",
  ],
  MEMBER_DATA: ["家戶編號", "家戶成員姓名", "性別", "國曆生日", "農曆生日", "是否已辭世", "備註"],
  PURIFICATION_IMPORT: ["家戶編號", "姓名", "性別", "國曆生日", "農曆生日", "地址", "電話", "收款金額", "備註"],
  GUANGMING_LANTERN_IMPORT: ["家戶編號", "金額", "備註"],
  TAISUI_LANTERN_IMPORT: ["家戶編號", "金額", "備註"],
  FAMILY_LANTERN_IMPORT: ["家戶編號", "金額", "備註"],
  // 對應 importFieldSuggestion.ts 的 ADDITIONAL_PRINT_ITEM_FIELDS 欄位順序，
  // 「預設／額外」欄位空白時，匯入邏輯一律視為「額外」（見
  // additionalPrintItems.ts 的 resolveIsExtraInput 說明）。
  ADDITIONAL_PRINT_ITEM_IMPORT: [
    "家戶編號",
    "報名人",
    "原祭祀類型",
    "原祭祀名稱",
    "附加項目類型",
    "列印名稱",
    "數量",
    "預設／額外",
    "備註",
  ],
  // 對應 importFieldSuggestion.ts 的 OFFERING_CLAIM_FIELDS 欄位順序。
  // 花果供品農曆月/日只有認捐花果供品時才需要填寫，其他供品種類留空即可。
  OFFERING_CLAIM_IMPORT: [
    "家戶編號",
    "認捐人姓名",
    "供品名稱",
    "花果供品農曆月",
    "花果供品農曆日",
    "數量",
    "單價",
    "已收金額",
    "備註",
  ],
};

/** 這個模板 key 是否有提供空白範本下載；沒有的話回傳 null。 */
export function getBlankTemplateColumns(key: string): string[] | null {
  return BLANK_TEMPLATE_COLUMNS[key] ?? null;
}
