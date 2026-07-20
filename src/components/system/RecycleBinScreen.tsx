"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/system/ConfirmDialog";
import Toast from "@/components/ritual/Toast";
import { inputClass, labelClass } from "@/components/household/formStyles";
import type { RecycleBinEntityType } from "@/lib/recycleBin";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { canSystem } from "@/lib/permissions";

// entityType 直接沿用 @/lib/recycleBin.ts 的權威定義（之前這裡自己重複宣告了
// 一份只有 4 種舊類型的字面聯集，跟後來新增的 AdditionalPrintItem／
// OfferingClaim 兩種類型不同步）。deletedAt 這裡維持 string，因為伺服器端
// page.tsx 會先把 Date 序列化成字串才傳進這個 Client Component。
type RecycleBinItem = {
  entityType: RecycleBinEntityType;
  entityId: string;
  entityTypeLabel: string;
  displayName: string;
  context: string | null;
  deletedAt: string;
  deletedByName: string | null;
  daysRemaining: number;
  canPurge: boolean;
};

type PendingAction = { kind: "restore" | "purge"; item: RecycleBinItem };

/**
 * V12.1 一次性修正指令「二之4」：永久刪除（POST /api/recycle-bin/purge）
 * 這次補上了後端權限檢查（SystemAction "purgeRecycleBin"，僅 SUPER_ADMIN），
 * 所以這個畫面必須改成能取得真正的操作人員身分，否則永久刪除會對所有人
 * 回 401。沿用既有的 <OperatorProvider>／<OperatorBar/>（同
 * QuickActionsPanel／系統管理中心的作法），不另做一套身分選擇。
 *
 * 原本那個自由文字「操作人姓名」欄位保留給「還原」使用——還原 API
 * （/api/recycle-bin/restore）這次沒有修改，仍然吃 operatorName 字串，
 * 不在本次指令範圍內，避免動到未被要求的既有行為。
 */
export default function RecycleBinScreen({ initialItems }: { initialItems: RecycleBinItem[] }) {
  return (
    <OperatorProvider>
      <RecycleBinScreenInner initialItems={initialItems} />
    </OperatorProvider>
  );
}

function RecycleBinScreenInner({ initialItems }: { initialItems: RecycleBinItem[] }) {
  const router = useRouter();
  const { operatorUserId, operatorUser } = useOperator();
  const canPurgeByRole = operatorUser?.role ? canSystem(operatorUser.role, "purgeRecycleBin") : false;
  const [items, setItems] = useState(initialItems);
  const [operatorName, setOperatorName] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("已完成");

  async function refresh() {
    const res = await fetch("/api/recycle-bin");
    const data = await res.json();
    if (res.ok) setItems(data.items);
    router.refresh();
  }

  function showToast(message: string) {
    setToastMessage(message);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  }

  async function handleConfirm() {
    if (!pending) return;
    setProcessing(true);
    setError(null);
    try {
      if (pending.kind === "restore") {
        const res = await fetch("/api/recycle-bin/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityType: pending.item.entityType,
            entityId: pending.item.entityId,
            operatorName: operatorName || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "還原失敗，請稍後再試一次。");
          return;
        }
        showToast("已還原");
      } else {
        const res = await fetch("/api/recycle-bin/purge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operatorUserId,
            entityType: pending.item.entityType,
            entityId: pending.item.entityId,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "永久刪除失敗，請稍後再試一次。");
          return;
        }
        showToast("已永久刪除");
      }
      setPending(null);
      await refresh();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-medium text-ink">🗑 回收區</h1>
        <p className="mt-1 text-sm text-ink-soft">
          被移入回收區的資料至少保留 30 天，管理者可以還原；超過保留期限才能永久刪除。
        </p>
        <p className="mt-2 rounded-xl bg-mist-50 px-4 py-2.5 text-xs text-ink-soft">
          ⚠️ 永久刪除只有最高管理員可以操作（後端會再次驗證）。「還原」目前仍未做
          後端權限檢查，等系統做出登入功能後會一併補上。
        </p>
      </div>

      <OperatorBar />

      <div>
        <label className={labelClass}>操作人姓名（選填，用於下方「還原」時記錄）</label>
        <input
          className={inputClass}
          value={operatorName}
          onChange={(e) => setOperatorName(e.target.value)}
          placeholder="例如：王小姐"
        />
      </div>

      {error && <p className="rounded-xl bg-blossom-50 px-4 py-2.5 text-sm text-ink-soft">{error}</p>}

      {items.length === 0 ? (
        <p className="rounded-3xl bg-white/70 px-6 py-8 text-center text-sm text-ink-faint shadow-card">
          回收區目前是空的。
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div
              key={`${item.entityType}:${item.entityId}`}
              className="rounded-2xl bg-white/70 px-5 py-4 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-xs text-ink-soft">
                      {item.entityTypeLabel}
                    </span>
                    <span className="text-base text-ink">{item.displayName}</span>
                  </div>
                  {item.context && <p className="mt-1 text-sm text-ink-soft">{item.context}</p>}
                  <p className="mt-1 text-xs text-ink-faint">
                    刪除時間：{new Date(item.deletedAt).toLocaleString("zh-TW")}　刪除人：
                    {item.deletedByName || "（未填寫）"}
                  </p>
                  <p className="mt-1 text-xs">
                    {item.canPurge ? (
                      <span className="text-ink-soft">已超過保留期限，可以永久刪除</span>
                    ) : (
                      <span className="text-ink-faint">
                        還剩 {item.daysRemaining} 天保留期限才能永久刪除
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-full bg-sage-100 px-4 py-2 text-xs text-ink transition hover:bg-sage-200"
                    onClick={() => setPending({ kind: "restore", item })}
                  >
                    還原
                  </button>
                  {/* V12.1 一次性修正指令「二之4」：永久刪除現在有兩道獨立的
                      關卡——保留期限（item.canPurge，滿 30 天）與角色權限
                      （canPurgeByRole，僅 SUPER_ADMIN）。前端停用只是體驗
                      優化，真正的把關在 API。 */}
                  <button
                    type="button"
                    disabled={!item.canPurge || !canPurgeByRole}
                    title={
                      !item.canPurge
                        ? "還沒超過 30 天保留期限"
                        : !canPurgeByRole
                          ? "只有最高管理員可以永久刪除"
                          : undefined
                    }
                    className="rounded-full bg-blossom-100 px-4 py-2 text-xs text-ink transition
                               hover:bg-blossom-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => setPending({ kind: "purge", item })}
                  >
                    永久刪除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.kind === "restore" ? "還原這筆資料" : "永久刪除這筆資料"}
          danger={pending.kind === "purge"}
          confirmLabel={processing ? "處理中…" : pending.kind === "restore" ? "確定還原" : "確定永久刪除"}
          message={
            pending.kind === "restore" ? (
              <>
                確定要把「{pending.item.displayName}」還原嗎？還原後會重新出現在正常畫面上。
              </>
            ) : (
              <>
                確定要永久刪除「{pending.item.displayName}」嗎？
                <br />
                <span className="font-medium text-ink">這個動作無法復原。</span>
              </>
            )
          }
          onCancel={() => setPending(null)}
          onConfirm={handleConfirm}
        />
      )}

      <Toast visible={toastVisible} message={toastMessage} />
    </div>
  );
}
