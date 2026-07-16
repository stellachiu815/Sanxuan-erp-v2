"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "@/components/system/ConfirmDialog";
import Toast from "@/components/ritual/Toast";
import { inputClass, labelClass, secondaryButtonClass } from "@/components/household/formStyles";
import type { RecordVersionActionValue } from "@/lib/recordVersion";

// action 直接沿用 @/lib/recordVersion.ts 的權威型別（之前這裡自己重複宣告了
// 一份只有 5 種舊值的字面聯集，V11.1 收據中心新增 PRINT/VOID/REISSUE 之後
// 沒有同步更新，會讓收據的列印/作廢/換開紀錄在這個共用面板顯示成
// undefined）。

type VersionRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: RecordVersionActionValue;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  operatorName: string | null;
  changeNote: string | null;
  createdAt: string;
};

const actionLabel: Record<RecordVersionActionValue, string> = {
  CREATE: "新增",
  UPDATE: "修改",
  DELETE: "移入回收區",
  RESTORE: "還原／回復",
  PURGE: "永久刪除",
  PRINT: "列印",
  VOID: "作廢",
  REISSUE: "換開",
};

const actionTone: Record<RecordVersionActionValue, string> = {
  CREATE: "bg-sage-100",
  UPDATE: "bg-mist-100",
  DELETE: "bg-blossom-100",
  RESTORE: "bg-yolk-100",
  PURGE: "bg-blossom-200",
  PRINT: "bg-mist-100",
  VOID: "bg-blossom-100",
  REISSUE: "bg-yolk-100",
};

// 只在這個清單裡的欄位會拿來比較顯示差異；id／建立修改時間／關聯外鍵這些
// 欄位不是行政人員關心的「內容」，故意不顯示，避免版面被雜訊淹沒。
const IGNORED_DIFF_KEYS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "householdId",
  "ritualRecordId",
  "universalSalvationId",
  "memberId",
  "worshipRecordId",
  "deletedAt",
  "deletedByName",
]);

const fieldLabel: Record<string, string> = {
  contactName: "主要聯絡人",
  phone: "電話",
  address: "地址",
  companyName: "公司名稱",
  notes: "備註",
  name: "姓名",
  gender: "性別",
  role: "身份",
  isPrimaryContact: "主要聯絡人",
  isDeceased: "是否辭世",
  isRegistered: "是否報名普渡",
  yangshangName: "陽上姓名",
  enshrinementLocation: "安奉位置",
  isSponsor: "是否贊普",
  sponsorQuantity: "贊普數量",
  sponsorUnitPrice: "贊普單價",
  sponsorAmount: "贊普金額",
  sponsorNotes: "贊普備註",
  tableNumber: "普渡桌",
  displayName: "名稱",
  category: "類別",
  sortOrder: "排序",
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "（空白）";
  if (typeof v === "boolean") return v ? "是" : "否";
  return String(v);
}

function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): { key: string; label: string; before: string; after: string }[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const rows: { key: string; label: string; before: string; after: string }[] = [];
  for (const key of keys) {
    if (IGNORED_DIFF_KEYS.has(key)) continue;
    const b = before ? before[key] : undefined;
    const a = after ? after[key] : undefined;
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    rows.push({ key, label: fieldLabel[key] ?? key, before: formatValue(b), after: formatValue(a) });
  }
  return rows;
}

type Props = {
  entityType: string;
  entityId: string;
  /** 顯示在面板頂端的標題，例如「王家（F00009）」。 */
  title: string;
};

/**
 * V8.0「資料版本紀錄」的共用檢視面板：查看某一筆資料的完整修改歷史，
 * 可以展開看修改前/修改後的欄位差異，也可以回復到指定版本。
 */
export default function VersionHistoryPanel({ entityType, entityId, title }: Props) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<VersionRow | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await fetch(
        `/api/version-history?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "載入失敗");
        return;
      }
      setVersions(data.versions);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  async function handleRestore() {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const res = await fetch("/api/version-history/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          versionId: restoreTarget.id,
          operatorName: operatorName || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "回復失敗，請稍後再試一次。");
        setRestoreTarget(null);
        return;
      }
      setRestoreTarget(null);
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 2000);
      await load();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-xs text-ink-faint">
          由新到舊列出每一次異動；只有「新增」「修改」可以回復到當時的欄位內容。
        </p>
      </div>

      <div>
        <label className={labelClass}>操作人姓名（選填，用於下方「回復到此版本」時記錄）</label>
        <input
          className={inputClass}
          value={operatorName}
          onChange={(e) => setOperatorName(e.target.value)}
          placeholder="例如：王小姐"
        />
        <p className="mt-1 text-xs text-ink-faint">
          ⚠️ 系統目前沒有登入功能，操作人姓名由自行輸入，尚無法自動驗證身份。
        </p>
      </div>

      {error && <p className="rounded-xl bg-blossom-50 px-4 py-2.5 text-sm text-ink-soft">{error}</p>}

      {versions === null && !error && <p className="text-sm text-ink-faint">載入中…</p>}
      {versions !== null && versions.length === 0 && (
        <p className="text-sm text-ink-faint">目前還沒有任何修改紀錄。</p>
      )}

      <div className="flex flex-col gap-2">
        {versions?.map((v) => {
          const rows = diffRows(v.beforeData, v.afterData);
          const expanded = expandedId === v.id;
          const canRestore = v.action === "CREATE" || v.action === "UPDATE";
          return (
            <div key={v.id} className="rounded-2xl border border-cream-200 bg-white/70 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs text-ink ${actionTone[v.action]}`}>
                  {actionLabel[v.action]}
                </span>
                <span className="text-xs text-ink-faint">
                  {new Date(v.createdAt).toLocaleString("zh-TW")}
                </span>
                <span className="text-xs text-ink-faint">
                  操作人：{v.operatorName || "（未填寫）"}
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-ink-soft underline-offset-2 hover:underline"
                    onClick={() => setExpandedId(expanded ? null : v.id)}
                  >
                    {expanded ? "收合內容" : "查看內容"}
                  </button>
                  {canRestore && (
                    <button
                      type="button"
                      className="text-xs text-ink-soft underline-offset-2 hover:underline"
                      onClick={() => setRestoreTarget(v)}
                    >
                      回復到此版本
                    </button>
                  )}
                </div>
              </div>
              {v.changeNote && <p className="mt-1 text-xs text-ink-faint">備註：{v.changeNote}</p>}
              {expanded && (
                <div className="mt-3 overflow-x-auto rounded-xl bg-cream-50">
                  {rows.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-ink-faint">（沒有可比較的欄位差異）</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-ink-faint">
                          <th className="px-3 py-1.5 text-left">欄位</th>
                          <th className="px-3 py-1.5 text-left">修改前</th>
                          <th className="px-3 py-1.5 text-left">修改後</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.key} className="border-t border-cream-200">
                            <td className="px-3 py-1.5 text-ink-soft">{r.label}</td>
                            <td className="px-3 py-1.5 text-ink">{r.before}</td>
                            <td className="px-3 py-1.5 text-ink">{r.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button type="button" className={secondaryButtonClass} onClick={load}>
          重新整理
        </button>
      </div>

      {restoreTarget && (
        <ConfirmDialog
          title="回復到指定版本"
          message={
            <>
              確定要把資料回復到
              <span className="font-medium">
                　{new Date(restoreTarget.createdAt).toLocaleString("zh-TW")}
              </span>
              當時的內容嗎？這個動作本身也會留下一筆新的版本紀錄。
            </>
          }
          confirmLabel={restoring ? "處理中…" : "確定回復"}
          onCancel={() => setRestoreTarget(null)}
          onConfirm={handleRestore}
        />
      )}

      <Toast visible={toastVisible} message="已回復" />
    </div>
  );
}
