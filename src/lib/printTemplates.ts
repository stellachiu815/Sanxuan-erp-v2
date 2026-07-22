import { prisma } from "@/lib/prisma";
import type { ActivityType, Prisma } from "@prisma/client";
import { REGISTRATION_ITEM_SEED } from "@/lib/registrationItems";

/**
 * V14：列印模板種子（TemplateDefinition + TemplateVersion）。
 *
 * ── 定位 ────────────────────────────────────────────────────
 * 為所有報名項目 printDocumentKeys 建立對應的預設列印模板，冪等、可重跑，
 * 不覆蓋既有模板、同一 (category,key) 不重複建立。TemplateVersion 保留
 * paperSize / orientation / marginsJson / layoutJson（可編輯版型結構），
 * 本輪先給可用的預設值，視覺化編輯留待後續。
 *
 * ⚠️ 唯一權威來源：模板 key 直接來自 REGISTRATION_ITEM_SEED 的 printDocumentKeys，
 * 不另外手抄一份 → 種子與項目設定不會不一致。
 */

/** 每個列印品 key 的顯示名稱與所屬活動類型。 */
const TEMPLATE_META: Record<string, { name: string; activityType: ActivityType }> = {
  US_ANCESTOR_TABLET: { name: "超拔祖先牌位", activityType: "UNIVERSAL_SALVATION" },
  US_ZHENGHUN_TABLET: { name: "乙位正魂牌位", activityType: "UNIVERSAL_SALVATION" },
  US_YUANQIN_TABLET: { name: "冤親債主牌位", activityType: "UNIVERSAL_SALVATION" },
  US_WUYUAN_TABLET: { name: "無緣子女牌位", activityType: "UNIVERSAL_SALVATION" },
  US_BASIC_POCKET: { name: "基本寶袋", activityType: "UNIVERSAL_SALVATION" },
  US_EXTRA_POCKET: { name: "額外寶袋", activityType: "UNIVERSAL_SALVATION" },
  US_RICE_ROSTER: { name: "白米登記名單", activityType: "UNIVERSAL_SALVATION" },
  US_SPONSOR_ROSTER: { name: "贊普名單", activityType: "UNIVERSAL_SALVATION" },
  GUANGMING_LANTERN_TABLET: { name: "光明燈牌", activityType: "GUANGMING_LANTERN" },
  GUANGMING_LANTERN_PETITION: { name: "光明燈疏文", activityType: "GUANGMING_LANTERN" },
  TAISUI_LANTERN_TABLET: { name: "太歲燈牌", activityType: "TAISUI_LANTERN" },
  TAISUI_LANTERN_PETITION: { name: "太歲燈疏文", activityType: "TAISUI_LANTERN" },
  FAMILY_LANTERN_TABLET: { name: "全家燈牌", activityType: "FAMILY_LANTERN" },
  FAMILY_LANTERN_PETITION: { name: "全家燈疏文", activityType: "FAMILY_LANTERN" },
  PURIFICATION_STICKER: { name: "祭改小人頭貼紙", activityType: "PURIFICATION" },
  CELEBRATION_TABLE_ROSTER: { name: "宮慶訂桌名單", activityType: "TEMPLE_CELEBRATION" },
  CELEBRATION_TURTLE_ROSTER: { name: "福壽龜名單", activityType: "TEMPLE_CELEBRATION" },
  CELEBRATION_STOVE_ROSTER: { name: "爐主／副爐主名單", activityType: "TEMPLE_CELEBRATION" },
  STORAGE_TROUSERS_ROSTER: { name: "補褲報名總名單", activityType: "STORAGE_REPAYMENT" },
  DRAGON_PHOENIX_LANTERN_TABLET: { name: "龍鳳燈牌", activityType: "DRAGON_PHOENIX_LANTERN" },
  DRAGON_PHOENIX_LANTERN_ROSTER: { name: "龍鳳燈報名總名單", activityType: "DRAGON_PHOENIX_LANTERN" },
};

export type PrintTemplateSeed = { key: string; name: string; activityType: ActivityType };

/** 從報名項目 printDocumentKeys 推導出的模板種子（唯一來源，去重）。 */
export const PRINT_TEMPLATE_SEED: readonly PrintTemplateSeed[] = (() => {
  const keys = new Set<string>();
  for (const item of REGISTRATION_ITEM_SEED) {
    for (const k of item.printDocumentKeys) keys.add(k);
  }
  return Array.from(keys)
    .sort()
    .map((key) => {
      const meta = TEMPLATE_META[key];
      return { key, name: meta?.name ?? key, activityType: meta?.activityType ?? ("OTHER" as ActivityType) };
    });
})();

/** 預設版型（保留紙張、方向、邊界、版面結構欄位；供後續編輯）。 */
const DEFAULT_MARGINS: Prisma.InputJsonValue = { top: 10, right: 10, bottom: 10, left: 10, unit: "mm" };
const DEFAULT_LAYOUT: Prisma.InputJsonValue = {
  version: 1,
  fields: [],
  note: "預設空白版型，待上傳舊格式或視覺化編輯",
};

/**
 * 冪等建立所有列印品的預設模板。已存在（依 category+key）者略過，不覆蓋、
 * 不重複建立。回傳這次新建數。
 */
export async function ensurePrintTemplatesSeeded(): Promise<{ createdDefinitions: number; createdVersions: number }> {
  let createdDefinitions = 0;
  let createdVersions = 0;

  for (let i = 0; i < PRINT_TEMPLATE_SEED.length; i++) {
    const t = PRINT_TEMPLATE_SEED[i];
    const existing = await prisma.templateDefinition.findUnique({
      where: { category_key: { category: "PRINT", key: t.key } },
      include: { versions: true },
    });

    if (!existing) {
      await prisma.templateDefinition.create({
        data: {
          category: "PRINT",
          key: t.key,
          name: t.name,
          activityType: t.activityType,
          sortOrder: i,
          versions: {
            create: {
              versionLabel: "v1",
              isActive: true,
              paperSize: "A4",
              orientation: "portrait",
              marginsJson: DEFAULT_MARGINS,
              layoutJson: DEFAULT_LAYOUT,
            },
          },
        },
      });
      createdDefinitions += 1;
      createdVersions += 1;
      continue;
    }

    // 定義已存在但沒有任何版本 → 補一個預設 active 版本（不動既有版本）。
    if (existing.versions.length === 0) {
      await prisma.templateVersion.create({
        data: {
          templateDefinitionId: existing.id,
          versionLabel: "v1",
          isActive: true,
          paperSize: "A4",
          orientation: "portrait",
          marginsJson: DEFAULT_MARGINS,
          layoutJson: DEFAULT_LAYOUT,
        },
      });
      createdVersions += 1;
    }
  }

  return { createdDefinitions, createdVersions };
}
