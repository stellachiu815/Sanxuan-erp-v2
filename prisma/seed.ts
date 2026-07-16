/**
 * 種子資料：用來讓「姓名搜尋 → 開啟家戶頁」這個第一個功能可以馬上測試。
 * 可重複執行（用 upsert），不會產生重複資料。
 *
 * 執行方式： npm run seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const household = await prisma.household.upsert({
    where: { id: "F00009" },
    update: {
      // 用 update 補上 V1.1 新增的 companyName 欄位（就算這戶已經存在也會補上）
      companyName: "王記工程行",
    },
    create: {
      id: "F00009",
      name: "王家",
      contactName: "王昆郎",
      phone: "0912-345-678",
      address: "台北市大同區某某路 12 號",
      companyName: "王記工程行", // 範例：用來測試「用公司名稱搜尋」
      notes: "測試用種子資料，可自行修改或刪除。",
    },
  });

  // 生日一律用 Date.UTC 建立（代表純日期，不含時區），避免存進 PostgreSQL 的
  // DATE 欄位時，因為主機時區設定不同而被誤差成前一天或後一天。
  const members = [
    {
      name: "王昆郎",
      gender: "男",
      role: "HOUSEHOLD_HEAD" as const,
      isPrimaryContact: true,
      solarBirthDate: new Date(Date.UTC(1958, 2, 12)), // 1958/03/12
    },
    {
      name: "覺美玲",
      gender: "女",
      role: "SPOUSE" as const,
      isPrimaryContact: false,
      solarBirthDate: new Date(Date.UTC(1961, 6, 8)), // 1961/07/08
    },
    {
      name: "王小明",
      gender: "男",
      role: "SON" as const,
      isPrimaryContact: false,
      solarBirthDate: new Date(Date.UTC(1985, 10, 2)), // 1985/11/02
    },
    {
      name: "王小華",
      gender: "女",
      role: "DAUGHTER" as const,
      isPrimaryContact: false,
      solarBirthDate: new Date(Date.UTC(1988, 4, 20)), // 1988/05/20
    },
  ];

  for (const m of members) {
    const existing = await prisma.member.findFirst({
      where: { householdId: household.id, name: m.name },
    });
    if (existing) {
      await prisma.member.update({ where: { id: existing.id }, data: m });
    } else {
      await prisma.member.create({ data: { householdId: household.id, ...m } });
    }
  }

  const existingWorship = await prisma.worshipRecord.findFirst({
    where: { householdId: household.id, displayName: "王姓歷代祖先" },
  });
  if (!existingWorship) {
    await prisma.worshipRecord.create({
      data: {
        householdId: household.id,
        type: "ANCESTOR_LINE",
        displayName: "王姓歷代祖先",
        location: "本宮祖先牌位區",
      },
    });
  }

  // V2.0 祭祀資料核心：範例種子資料，方便本機測試「複製去年資料」與「列印格式」
  // 這兩支 API，不會影響上面既有的家戶/成員/歷代祖先牌位資料。
  // 可重複執行（用 findUnique 檢查過才 create，不會產生重複資料）。
  const ancestorLineWorshipRecord = await prisma.worshipRecord.findFirst({
    where: { householdId: household.id, displayName: "王姓歷代祖先" },
  });

  const existingRitual114 = await prisma.ritualRecord.findUnique({
    where: {
      householdId_year_activityType: {
        householdId: household.id,
        year: 114,
        activityType: "UNIVERSAL_SALVATION",
      },
    },
  });

  if (!existingRitual114) {
    await prisma.ritualRecord.create({
      data: {
        householdId: household.id,
        year: 114,
        activityType: "UNIVERSAL_SALVATION",
        status: "CONFIRMED",
        universalSalvation: {
          create: {
            isRegistered: true,
            yangshangName: "王昆郎",
            enshrinementLocation: "本宮普渡壇 A 區",
            isSponsor: true,
            sponsorQuantity: 2,
            sponsorUnitPrice: 1000,
            sponsorAmount: 2000,
            sponsorNotes: "現金",
            tableNumber: "A-12",
            entries: {
              create: [
                {
                  category: "ANCESTOR_LINE",
                  displayName: "王姓歷代祖先",
                  worshipRecordId: ancestorLineWorshipRecord?.id,
                  sortOrder: 1,
                },
                {
                  category: "INDIVIDUAL_SOUL",
                  displayName: "王小明 乙位正魂",
                  yangshangName: "王昆郎",
                  sortOrder: 1,
                },
                {
                  category: "DEBT_CREDITOR",
                  displayName: "冤親債主一位",
                  sortOrder: 1,
                },
                {
                  category: "UNBORN_CHILD",
                  displayName: "無緣子女一位",
                  sortOrder: 1,
                },
              ],
            },
          },
        },
      },
    });
    console.log("✅ 種子資料完成（V2.0）：F00009 王家 114 年普渡登記範例資料");
  }

  // 財務模組架構預留：先建立一個 SUPER_ADMIN 帳號，方便之後接上登入系統時測試。
  await prisma.user.upsert({
    where: { email: "admin@sanxuan.local" },
    update: {},
    create: {
      name: "系統管理員",
      email: "admin@sanxuan.local",
      role: "SUPER_ADMIN",
    },
  });

  // V11.1.1「全專案建置、權限與正式封版指令」：收據中心的伺服器端權限
  // 檢查開始真的查詢這張表（見 src/lib/operator.ts），所以種子資料裡
  // 補上四級操作人員各一位範例帳號，方便畫面上的「目前操作人員」選單
  // 一開始就有東西可以選、也方便手動驗收「未授權時應該被拒絕」的情境。
  // 系統仍然沒有密碼登入機制，這裡只是讓每個角色都至少有一筆可查詢的
  // User 資料。
  await prisma.user.upsert({
    where: { email: "manager@sanxuan.local" },
    update: {},
    create: { name: "林管理員", email: "manager@sanxuan.local", role: "ADMIN" },
  });
  await prisma.user.upsert({
    where: { email: "staff@sanxuan.local" },
    update: {},
    create: { name: "陳工作人員", email: "staff@sanxuan.local", role: "STAFF" },
  });
  await prisma.user.upsert({
    where: { email: "readonly@sanxuan.local" },
    update: {},
    create: { name: "唯讀觀察", email: "readonly@sanxuan.local", role: "READONLY" },
  });

  console.log("✅ 種子資料完成：F00009 王家（王昆郎、覺美玲、王小明、王小華）");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
