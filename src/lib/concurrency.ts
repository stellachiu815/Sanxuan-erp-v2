/**
 * V13.4 驗收（P2024 修正）：資料庫查詢的並行數控制。
 *
 * ── 為什麼需要這一支 ──────────────────────────────────────
 * 正式站 Prisma 連線池上限是 9（Render 免費／低方案）。信眾 360° 總覽與
 * 收款中心過去用一次 `Promise.all([...十幾個查詢])` 同時啟動，冷啟動
 * （部署剛完成、連線池尚未暖）時瞬間要 12～20 條連線，直接超過上限，
 * 於是大量 `P2024 Timed out fetching a new connection from the pool`。
 *
 * 這支把「一次啟動一大票查詢」改成「最多同時 N 個，做完一個補一個」，
 * 在不提高連線數、不升級方案的前提下把尖峰並行壓在池子容量以內。
 * 完全不改查詢內容與結果，只改「同時間有幾個在跑」。
 */

/**
 * 以最多 `limit` 個並行，對 items 逐一套用 async fn，回傳與輸入等長、
 * 順序一致的結果陣列。任一個 reject 會讓整體 reject（不吞錯，維持既有
 * 錯誤傳遞行為——絕不把失敗默默當成 0）。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency: limit 必須是 >= 1 的整數，收到 ${limit}`);
  }
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * 對一組「無參數的 async task」以最多 `limit` 個並行執行，回傳等長結果。
 * 適合把原本 `Promise.all([taskA(), taskB(), ...])` 換成受控並行版本。
 */
export async function runWithConcurrency<R>(
  tasks: readonly (() => Promise<R>)[],
  limit: number
): Promise<R[]> {
  return mapWithConcurrency(tasks, limit, (task) => task());
}
