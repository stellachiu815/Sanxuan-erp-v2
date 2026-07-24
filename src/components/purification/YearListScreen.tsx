"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import Toast from "@/components/ritual/Toast";
import {
  errorTextClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/household/formStyles";
import type { PurificationYearListItemJson } from "./types";
import { useCurrentUser } from "@/lib/permissionClient";
import { canPurification } from "@/lib/permissions";

type DiffItem = {
  kind: "ADDED" | "CANCELLED_LAST_YEAR" | "ADDRESS_CHANGED" | "BIRTHDAY_CHANGED" | "GENDER_NEEDS_CONFIRM";
  displayName: string;
  detail?: string;
};

const DIFF_KIND_LABEL: Record<DiffItem["kind"], string> = {
  ADDED: "新增（沿用去年）",
  CANCELLED_LAST_YEAR: "去年已取消",
  ADDRESS_CHANGED: "地址可能異動",
  BIRTHDAY_CHANGED: "生日／性別可能異動",
  GENDER_NEEDS_CONFIRM: "性別待確認",
};

type Props = {
  initialYears: PurificationYearListItemJson[];
};

export default function YearListScreen({ initialYears }: Props) {
  const router = useRouter();
  // V14.3：年度建立／沿用去年屬 manageYears（SUPER_ADMIN／ADMIN）。STAFF 可查看
  // 年度清單與報名，但不顯示年度管理入口；READONLY 只讀。API 為最終防線。
  const { role } = useCurrentUser();
  const canManageYears = role ? canPurification(role, "manageYears") : false;
  const [years, setYears] = useState(initialYears);
  const [showCreate, setShowCreate] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [toast, setToast] = useState(false);
  const [diffs, setDiffs] = useState<DiffItem[] | null>(null);

  function refreshList(newYear: PurificationYearListItemJson) {
    setYears((prev) => [newYear, ...prev].sort((a, b) => b.year - a.year));
  }

  function showToast() {
    setToast(true);
    setTimeout(() => setToast(false), 2000);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {canManageYears && (
          <>
            <button type="button" className={primaryButtonClass} onClick={() => setShowCreate(true)}>
              ＋ 建立新年度（空白開始）
            </button>
            <button
              type="button"
              className={secondaryButtonClass + " border border-cream-300"}
              onClick={() => setShowCopy(true)}
              disabled={years.length === 0}
            >
              沿用去年祭改資料
            </button>
          </>
        )}
        {canManageYears && (
          <Link
            href="/purification/settings/banned-numbers"
            className="ml-auto text-sm text-ink-faint underline-offset-4 hover:underline"
          >
            禁用編號設定 →
          </Link>
        )}
      </div>

      {years.length === 0 ? (
        <p className="rounded-2xl bg-white/70 p-8 text-center text-sm text-ink-soft shadow-soft">
          目前還沒有任何祭改年度，請先建立第一個年度。
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {years.map((y) => (
            <li key={y.id}>
              <Link
                href={`/purification/${y.id}`}
                className="block rounded-2xl bg-white/70 p-6 shadow-soft transition hover:shadow-card"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-ink">{y.name}</h3>
                  {y.isLocked ? (
                    <span className="rounded-full bg-yolk-100 px-3 py-1 text-xs text-ink-soft">已鎖定編號</span>
                  ) : (
                    <span className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink-soft">可編輯</span>
                  )}
                </div>
                <p className="mt-2 text-xs text-ink-faint">民國 {y.year} 年度</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateYearModal
          onClose={() => setShowCreate(false)}
          onCreated={(y) => {
            refreshList(y);
            setShowCreate(false);
            showToast();
            router.refresh();
          }}
        />
      )}

      {showCopy && (
        <CopyYearModal
          years={years}
          onClose={() => setShowCopy(false)}
          onCreated={(y, newDiffs) => {
            refreshList(y);
            setShowCopy(false);
            setDiffs(newDiffs);
            showToast();
            router.refresh();
          }}
        />
      )}

      {diffs && diffs.length > 0 && (
        <Modal title="去年與今年差異比對" onClose={() => setDiffs(null)}>
          <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto text-sm text-ink">
            {diffs.map((d, i) => (
              <li key={i} className="rounded-xl bg-cream-100 px-4 py-2.5">
                <span className="mr-2 rounded-full bg-mist-100 px-2 py-0.5 text-xs text-ink-soft">
                  {DIFF_KIND_LABEL[d.kind]}
                </span>
                <span className="font-medium">{d.displayName}</span>
                {d.detail && <p className="mt-1 text-xs text-ink-soft">{d.detail}</p>}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-end">
            <button type="button" className={primaryButtonClass} onClick={() => setDiffs(null)}>
              我知道了
            </button>
          </div>
        </Modal>
      )}

      <Toast visible={toast} message="已完成" />
    </div>
  );
}

function CreateYearModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (y: PurificationYearListItemJson) => void;
}) {
  const [year, setYear] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum < 1) {
      setError("請輸入正確的民國年度");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/purification/years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: yearNum, operatorName: operatorName || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "建立失敗");
        return;
      }
      onCreated({
        id: data.id,
        year: yearNum,
        name: `民國${toChineseDigitsPreview(yearNum)}年度祭改`,
        isLocked: false,
        copiedFromYearId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="建立新年度祭改（空白開始）" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div>
          <label className={labelClass}>民國年度</label>
          <input
            className={inputClass}
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="例如 115"
            autoFocus
          />
        </div>
        <div>
          <label className={labelClass}>操作人姓名（選填）</label>
          <input className={inputClass} value={operatorName} onChange={(e) => setOperatorName(e.target.value)} />
        </div>
        {error && <p className={errorTextClass}>{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={primaryButtonClass} disabled={submitting}>
            {submitting ? "建立中…" : "建立"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CopyYearModal({
  years,
  onClose,
  onCreated,
}: {
  years: PurificationYearListItemJson[];
  onClose: () => void;
  onCreated: (y: PurificationYearListItemJson, diffs: DiffItem[]) => void;
}) {
  const [newYear, setNewYear] = useState("");
  const [sourceYearId, setSourceYearId] = useState(years[0]?.id ?? "");
  const [operatorName, setOperatorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const yearNum = Number(newYear);
    if (!Number.isInteger(yearNum) || yearNum < 1) {
      setError("請輸入正確的新年度");
      return;
    }
    if (!sourceYearId) {
      setError("請選擇來源年度");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/purification/years/copy-from-previous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newYear: yearNum, sourceYearId, operatorName: operatorName || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "建立失敗");
        return;
      }
      onCreated(
        {
          id: data.id,
          year: yearNum,
          name: `民國${toChineseDigitsPreview(yearNum)}年度祭改`,
          isLocked: false,
          copiedFromYearId: sourceYearId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        data.diffs ?? []
      );
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="沿用去年祭改資料" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <p className="text-xs text-ink-soft">
          會複製來源年度仍然有效的參加者、個人地址、備註、家戶關係；不會沿用歲數、編號、收款狀態、列印紀錄
          ——這些會在新年度重新計算/重新編列/重設。
        </p>
        <div>
          <label className={labelClass}>來源年度</label>
          <select className={inputClass} value={sourceYearId} onChange={(e) => setSourceYearId(e.target.value)}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>新年度（民國年）</label>
          <input
            className={inputClass}
            type="number"
            value={newYear}
            onChange={(e) => setNewYear(e.target.value)}
            placeholder="例如 116"
          />
        </div>
        <div>
          <label className={labelClass}>操作人姓名（選填）</label>
          <input className={inputClass} value={operatorName} onChange={(e) => setOperatorName(e.target.value)} />
        </div>
        {error && <p className={errorTextClass}>{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={primaryButtonClass} disabled={submitting}>
            {submitting ? "建立中…" : "沿用並建立"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 畫面上「剛建立完成」時先顯示的年度名稱預覽（逐字讀法），跟後端 formatPurificationYearName 邏輯一致。 */
function toChineseDigitsPreview(year: number): string {
  const digitMap = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  return String(year)
    .split("")
    .map((d) => digitMap[Number(d)] ?? d)
    .join("");
}
