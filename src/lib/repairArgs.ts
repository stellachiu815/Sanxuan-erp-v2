/**
 * V30.7 修復腳本參數解析（純函式，無 Prisma／dotenv，便於單元測試）。
 *
 * 規則：
 *  - 預設 dry-run；只有 --commit 才可能寫入。
 *  - 可單獨指定階段：--restore-orphans / --confirm-safe-drafts / --assign-missing-orders。
 *  - **未指定任何階段時：只預覽全部三階段，一律不寫入**（即使加了 --commit）。
 *  - 指定階段 + --commit：只寫入該（些）指定階段；指定階段但無 --commit：只預覽該階段。
 */
export type RepairStages = {
  restoreOrphans: boolean;
  confirmSafeDrafts: boolean;
  assignMissingOrders: boolean;
};

export type RepairArgs = {
  year: number;
  commit: boolean;
  stages: RepairStages; // 本次要「處理（預覽/可能寫入）」的階段
  writeEnabled: boolean; // 是否真的寫入（＝commit && 有明確指定階段）
  explicitStages: boolean; // 是否有指定任一階段
};

export function parseRepairArgs(argv: string[]): RepairArgs {
  const commit = argv.includes("--commit");
  const year = Number(argv.find((a) => /^\d+$/.test(a)) ?? 115);
  const explicit: RepairStages = {
    restoreOrphans: argv.includes("--restore-orphans"),
    confirmSafeDrafts: argv.includes("--confirm-safe-drafts"),
    assignMissingOrders: argv.includes("--assign-missing-orders"),
  };
  const explicitStages = explicit.restoreOrphans || explicit.confirmSafeDrafts || explicit.assignMissingOrders;
  // 未指定階段 → 預覽全部三階段；指定 → 只處理指定階段。
  const stages: RepairStages = explicitStages
    ? explicit
    : { restoreOrphans: true, confirmSafeDrafts: true, assignMissingOrders: true };
  // 未指定階段一律不寫入（安全預設）；指定階段且 --commit 才寫入。
  const writeEnabled = commit && explicitStages;
  return { year, commit, stages, writeEnabled, explicitStages };
}
