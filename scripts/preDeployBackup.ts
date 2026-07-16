/**
 * V11.2「更新前備份」（對應指令「八」），V11.2.1 補強「真正的新版本
 * 部署」與「單純服務重新啟動」的辨識（對應指令「十三」）。
 *
 * 每次系統更新／Migration／版本升級／Schema變更／重大匯入之前，必須先
 * 自動建立一份 Before_Update 備份；如果備份失敗，禁止開始更新。
 *
 * 用法（見 render.yaml 的 startCommand，已經串進部署流程）：
 *   npx tsx scripts/preDeployBackup.ts
 * 或
 *   npm run backup:before-update
 *
 * 這支腳本會用目前 package.json 的 version 當作檔名版本標籤（例如
 * version 是 "11.1.0"，產生 V11.1.0_Before_Update.zip），呼叫
 * src/lib/backup.ts 的 createBackup()。備份失敗時會回傳非 0 的
 * process.exit code，讓呼叫端（`npm run migrate:deploy` 之前的這一步）
 * 因為指令失敗而中止，不會繼續往下跑 migrate deploy／啟動系統
 * ——這就是「若備份失敗：禁止開始更新」的實際落實方式（用 shell 指令鏈
 * `&&` 天生的「前一個指令失敗就不執行下一個」語意，不需要額外寫判斷式）。
 *
 * 【V11.2.1 新增：辨識「真正的新版本部署」vs「單純服務重新啟動」】
 * `render.yaml` 的 `startCommand` 在 Render 免費方案上，不只在「推送新
 * 程式碼觸發重新部署」時執行，服務從休眠中被喚醒、或管理員手動按
 * 「Restart」，也會重新跑一次同一個 startCommand——如果每次都無條件
 * 執行一次完整備份，會在沒有任何程式碼變更的情況下，一天內產生好幾份
 * 內容完全相同的 Before_Update 備份，浪費 Google Drive 空間。
 *
 * Render 官方會在每一次「真正的部署」（build 階段重新執行）時把當次的
 * git commit SHA 寫入環境變數 `RENDER_GIT_COMMIT`；單純重啟／喚醒服務
 * 不會重新跑 build 階段，這個值維持不變。這裡把「上一次成功執行更新前
 * 備份時的 commit」記錄在 `SystemSetting.lastBeforeUpdateCommit`，下次
 * 啟動時比對：
 *   - RENDER_GIT_COMMIT 存在，且跟上次記錄的相同 → 判定為單純重啟，
 *     跳過備份（不是「假裝安全」，是有具體證據支持的判斷）。
 *   - RENDER_GIT_COMMIT 存在，且跟上次不同（或第一次執行、沒有記錄）
 *     → 判定為真正的新版本部署，執行備份，成功後更新記錄。
 *   - RENDER_GIT_COMMIT 完全不存在（例如部署平台不是 Render，或
 *     Render 方案/設定沒有提供這個變數）→ **無法可靠判斷**，依指令
 *     「十三、7. 若現有機制無法可靠判斷，先提出最安全的可行方案並
 *     實作，不得假裝已安全」，安全的預設是「不確定就備份」而不是
 *     「不確定就跳過」——每次都執行備份（維持 V11.2 原本行為），並且
 *     在 console 印出清楚的警告，說明這個環境無法辨識重啟與部署的差異。
 *
 * ⚠️ 如果目前還沒有連結 Google Drive（例如全新環境第一次部署，管理員
 * 還沒有機會登入系統完成 Google Drive 授權），這裡會讓更新流程失敗、
 * 卡住部署——這是刻意的設計（需求原文「若備份失敗：禁止開始更新」沒有
 * 例外），但也代表：**第一次部署這個系統時，必須先手動用
 * SKIP_PRE_DEPLOY_BACKUP=1 環境變數跳過這一步**（僅限首次部署、資料庫
 * 還是空的情況），部署成功、管理員完成 Google Drive 連結之後，之後的
 * 每一次更新才會真的執行備份。這個例外情況已經在下面的程式碼裡處理，
 * 並且會在 console 印出清楚的警告，不會悄悄略過又不說明。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createBackup } from "../src/lib/backup";
import { prisma } from "../src/lib/prisma";

async function main() {
  if (process.env.SKIP_PRE_DEPLOY_BACKUP === "1") {
    console.warn(
      "⚠️ SKIP_PRE_DEPLOY_BACKUP=1，本次跳過更新前備份（僅限首次部署、尚未連結 Google Drive 時使用，" +
        "正常情況下不應該設定這個環境變數）。"
    );
    return;
  }

  const currentCommit = process.env.RENDER_GIT_COMMIT ?? null;
  if (currentCommit) {
    const settings = await prisma.systemSetting.findUnique({ where: { id: "SINGLETON" } });
    if (settings?.lastBeforeUpdateCommit === currentCommit) {
      console.log(
        `目前 Git commit（${currentCommit.slice(0, 12)}）跟上次成功執行更新前備份時相同，` +
          "判定這次啟動是服務重新啟動／喚醒，不是新版本部署，跳過重複備份。"
      );
      return;
    }
  } else {
    console.warn(
      "⚠️ 找不到環境變數 RENDER_GIT_COMMIT，這個環境無法可靠分辨「真正的新版本部署」" +
        "與「單純服務重新啟動」——依安全原則，無法判斷時一律執行備份（可能因此在重啟時" +
        "產生多餘的 Before_Update 備份，但不會有漏備份的風險）。"
    );
  }

  // 用 fs 直接讀取 package.json（避免 `import ... with { type: "json" }`
  // 這種較新語法在不同 Node 版本間的相容性疑慮，跟 restore.ts 讀取版本號
  // 的方式一致）。
  const versionLabel: string = await readFile(path.join(process.cwd(), "package.json"), "utf8")
    .then((content) => JSON.parse(content).version ?? "unknown")
    .catch(() => "unknown");

  console.log(`開始執行「更新前備份」（Before_Update），版本標籤：${versionLabel}`);
  const result = await createBackup({
    type: "BEFORE_UPDATE",
    executedByName: "系統排程（更新前自動備份）",
    isAutomatic: true,
    versionLabel,
  });

  if (!result.ok) {
    console.error(`❌ 更新前備份失敗，依需求「八」禁止開始更新：${result.error}`);
    process.exit(1);
    return; // 這裡的 process.exit() 一定會終止 process；多這一行 return
    // 只是為了在沒有 @types/node（因而 process.exit 型別不是 never）的
    // 環境下，也能讓 TypeScript 正確做型別窄化，不影響實際執行邏輯。
  }

  console.log(
    `✅ 更新前備份成功：${result.fileName}（${result.fileSizeBytes} bytes），` +
      `已上傳 Google Drive「${result.googleDriveFolder}」資料夾`
  );

  if (currentCommit) {
    await prisma.systemSetting.upsert({
      where: { id: "SINGLETON" },
      create: { id: "SINGLETON", lastBeforeUpdateCommit: currentCommit },
      update: { lastBeforeUpdateCommit: currentCommit },
    });
  }
}

main()
  .catch((err) => {
    console.error("❌ 更新前備份腳本發生未預期錯誤，依需求「八」禁止開始更新：", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
