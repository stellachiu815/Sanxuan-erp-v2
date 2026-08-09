"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import {
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import ParticipantSelector from "./ParticipantSelector";
import LanternRegistrationEditor from "./LanternRegistrationEditor";
import RegisteredItemsPanel from "./RegisteredItemsPanel";
import UniversalSalvationScreen from "@/components/ritual/UniversalSalvationScreen";

/**
 * V13.4：**全系統唯一的報名內容編輯器**。
 *
 * 依 TempleEvent.registrationFormType 分派到對應的既有元件——
 * 不複製任何一份表單，普渡直接重用既有的 UniversalSalvationScreen。
 *
 * ── 分派規則（後端受控，指令四／五）─────────────────────────
 *   UNIVERSAL_SALVATION → 既有普渡登記畫面
 *   LANTERN             → 年度燈編輯器
 *   PURIFICATION        → 導向既有祭改中心（該模組有自己的編號與貼紙流程）
 *   GENERIC             → 只有成員選擇
 *   null / 不支援        → 明確擋住，**不降級成通用**
 *
 * ── 草稿與確認 ──────────────────────────────────────────
 * 進入編輯器時報名已經存在（DRAFT），使用者可隨時儲存、離開、再回來續編。
 * 內容完整後按「確認報名」，伺服器驗證通過才切成 CONFIRMED，
 * 此時才進入待收款與正式列印。
 */

type RegistrationOverview = {
  ritualRecordId: string;
  activityType: string;
  activityName: string;
  year: number;
  status: string;
  householdId: string;
  householdName: string;
  formType: string | null;
  formSupported: boolean;
  formUnsupportedReason: string | null;
  householdMembers: { id: string; name: string; role: string; isDeceased: boolean }[];
  /** 從信眾詳情頁進入時的返回目標 */
  returnMemberId: string | null;
};

type Props = { overview: RegistrationOverview };

export default function RegistrationEditor(props: Props) {
  return (
    <OperatorProvider>
      <RegistrationEditorInner {...props} />
    </OperatorProvider>
  );
}

function RegistrationEditorInner({ overview }: Props) {
  const [status, setStatus] = useState(overview.status);
  const [canConfirm, setCanConfirm] = useState<boolean | null>(null);
  const [confirmReasons, setConfirmReasons] = useState<string[]>([]);
  // V15R5.4：完整度缺項（gender／address 等）——API 早已回傳，前端過去漏讀，
  // 造成「按鈕不能按卻沒有原因」。這裡補上顯示，不動任何資料計算。
  const [confirmMissingFields, setConfirmMissingFields] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // V27：普渡牌位／明細變動時遞增，觸發「已報名項目」重新載入（兩邊資料來源同步）。
  const [registeredItemsRefreshKey, setRegisteredItemsRefreshKey] = useState(0);

  const checkConfirmable = useCallback(async () => {
    try {
      const res = await fetchRegistration(
        `/api/registrations/${overview.ritualRecordId}/confirm`
      );
      const data = await res.json();
      if (!res.ok) return;
      setCanConfirm(data.canConfirm);
      setConfirmReasons(data.reasons ?? []);
      setConfirmMissingFields(data.missingFields ?? []);
    } catch {
      /* 預檢失敗不阻擋編輯 */
    }
  }, [overview.ritualRecordId]);

  useEffect(() => {
    void checkConfirmable();
  }, [checkConfirmable]);

  async function confirm() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetchRegistration(
        `/api/registrations/${overview.ritualRecordId}/confirm`,
        { method: "POST", body: "{}" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setStatus("CONFIRMED");
      setMessage(data.message ?? "已確認報名。");
      await checkConfirmable();
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetchRegistration(
        `/api/registrations/${overview.ritualRecordId}/print-profile`,
        { method: "POST", body: "{}" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setMessage(data.message);
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  // ── 重新對齊地址（依祭祀資料）：預覽差異 → 逐筆勾選 → 套用 ──
  const [addrPreview, setAddrPreview] = useState<
    | null
    | { changes: { entryId: string; displayName: string; category: string; oldAddress: string | null; newAddress: string }[]; noWorshipMatch: number }
  >(null);
  const [addrChecked, setAddrChecked] = useState<Set<string>>(new Set());
  const [addrBusy, setAddrBusy] = useState(false);

  async function previewAddressRealign() {
    setAddrBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetchRegistration(`/api/registrations/${overview.ritualRecordId}/address-realign`);
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setAddrPreview({ changes: data.changes ?? [], noWorshipMatch: data.noWorshipMatch ?? 0 });
      setAddrChecked(new Set((data.changes ?? []).map((c: { entryId: string }) => c.entryId)));
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setAddrBusy(false);
    }
  }

  async function applyAddressRealign() {
    setAddrBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetchRegistration(`/api/registrations/${overview.ritualRecordId}/address-realign`, {
        method: "POST",
        body: JSON.stringify({ entryIds: [...addrChecked] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setMessage(data.message);
      setAddrPreview(null);
      setAddrChecked(new Set());
      setRegisteredItemsRefreshKey((k) => k + 1);
    } catch {
      setError("網路連線問題，請稍後再試一次。");
    } finally {
      setAddrBusy(false);
    }
  }

  function toggleAddr(entryId: string) {
    setAddrChecked((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  const isConfirmed = status === "CONFIRMED";
  const isCancelled = status === "CANCELLED";

  return (
    <div className="flex flex-col gap-6">
      {/* ── 標題與狀態 ── */}
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg text-ink">{overview.activityName}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              民國 {overview.year} 年度・{overview.householdName}（{overview.householdId}）
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs ${
              isConfirmed
                ? "bg-sage-100 text-ink"
                : isCancelled
                  ? "bg-cream-300 text-ink-faint"
                  : "bg-yolk-100 text-ink"
            }`}
          >
            {isConfirmed ? "已確認報名" : isCancelled ? "已取消" : "草稿（編輯中）"}
          </span>
        </div>

        {!isConfirmed && !isCancelled && (
          <p className="mt-3 rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
            目前是草稿：可以隨時儲存、離開再回來繼續編輯。
            <span className="text-ink">草稿不會進入待收款，也不能正式列印</span>
            ——內容填寫完整後按下方「確認報名」才會正式成立。
          </p>
        )}

        {message && (
          <p className="mt-3 rounded-2xl bg-sage-100 px-4 py-3 text-sm text-ink">{message}</p>
        )}
        {error && <p className={`mt-3 ${errorTextClass}`}>{error}</p>}
      </section>

      {/* ── 報名表型態未設定：明確擋住，不降級 ── */}
      {!overview.formSupported ? (
        <section className="rounded-3xl bg-white/70 p-6 shadow-card">
          <p className="rounded-2xl bg-blossom-100 px-4 py-3 text-sm leading-relaxed text-ink">
            {overview.formUnsupportedReason}
          </p>
          <p className="mt-3 text-xs text-ink-faint">
            請先於活動設定選擇這個活動的報名表型態，才能繼續報名。
            系統不會自動把它當成一般參加活動處理，以免產生缺少必要資料的報名。
          </p>
        </section>
      ) : (
        <>
          {/* ── V14：已報名項目（多項目架構）── */}
          <RegisteredItemsPanel
            ritualRecordId={overview.ritualRecordId}
            refreshKey={registeredItemsRefreshKey}
          />

          {/* ── 成員（所有活動共用） ── */}
          <ParticipantSelector
            ritualRecordId={overview.ritualRecordId}
            householdMembers={overview.householdMembers}
            readOnly={isCancelled}
            onChanged={() => void checkConfirmable()}
          />

          {/* ── 活動專屬內容 ── */}
          {overview.formType === "UNIVERSAL_SALVATION" && (
            <UniversalSalvationScreen
              householdId={overview.householdId}
              householdName={overview.householdName}
              year={overview.year}
              /**
               * ⚠️ 傳入既有 ritualRecordId：報名已經建立，這裡只編輯內容。
               * 元件內不會再問一次「沿用去年／全新建立」——那個選擇在
               * 信眾詳情頁的新增報名對話框就做完了。
               */
              existingRitualRecordId={overview.ritualRecordId}
              /**
               * V14.2「全戶加入累世冤親債主」預設：從信眾詳情頁進入（有 returnMemberId）
               * 預設只本人；家戶入口（無 from、由家戶頁導入）預設全戶。
               */
              debtCreditorDefaultAll={!overview.returnMemberId}
              currentMemberId={overview.returnMemberId}
              /**
               * V27：牌位／明細任何變動 → 重新載入已報名項目＋重跑確認預檢，
               * 讓「已報名項目」「確認報名」與 tablet 編輯器三者資料一致。
               */
              onRecordChanged={() => {
                setRegisteredItemsRefreshKey((k) => k + 1);
                void checkConfirmable();
              }}
            />
          )}

          {overview.formType === "LANTERN" && (
            <LanternRegistrationEditor
              ritualRecordId={overview.ritualRecordId}
              readOnly={isCancelled}
              onChanged={() => void checkConfirmable()}
            />
          )}

          {overview.formType === "PURIFICATION" && (
            <section className="rounded-3xl bg-white/70 p-6 shadow-card">
              <h2 className="text-sm text-ink">祭改報名內容</h2>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                祭改有專屬的編號配發與小人頭貼紙流程，報名內容請於祭改中心填寫。
                上方選擇的成員已同步到這一筆報名。
              </p>
              <Link
                href="/purification"
                className={`mt-4 inline-flex ${secondaryButtonClass}`}
              >
                前往祭改中心填寫內容
              </Link>
            </section>
          )}

          {overview.formType === "GENERIC" && (
            <section className="rounded-3xl bg-white/70 p-6 shadow-card">
              <h2 className="text-sm text-ink">通用參加紀錄</h2>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                這個活動只需要記錄參加成員，沒有其他報名欄位。
                若這場活動有供品或認捐，請另外於供品認捐中心登記。
              </p>
            </section>
          )}

          {/* ── 確認報名 ── */}
          {!isCancelled && (
            <section className="rounded-3xl bg-white/70 p-6 shadow-card">
              {canConfirm === false &&
                (confirmReasons.length > 0 || confirmMissingFields.length > 0) && (
                  <div className="mb-3 rounded-2xl bg-yolk-100 px-4 py-3 text-xs leading-relaxed text-ink">
                    <p className="mb-1 font-medium">還不能確認報名，請先補齊以下項目：</p>
                    <ul className="list-disc pl-4">
                      {confirmReasons.map((r, i) => (
                        <li key={`r-${i}`}>{r}</li>
                      ))}
                      {confirmMissingFields.map((f, i) => (
                        <li key={`m-${i}`}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

              <div className="flex flex-wrap gap-3">
                {!isConfirmed && (
                  <button
                    type="button"
                    className={primaryButtonClass}
                    onClick={() => void confirm()}
                    disabled={busy || canConfirm === false}
                  >
                    {busy ? "處理中…" : "確認報名"}
                  </button>
                )}
                {isConfirmed && (
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => void regenerate()}
                    disabled={busy}
                  >
                    重新產生列印資料
                  </button>
                )}
                {overview.activityType === "UNIVERSAL_SALVATION" && (
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => void previewAddressRealign()}
                    disabled={addrBusy}
                  >
                    {addrBusy && !addrPreview ? "檢查地址中…" : "重新對齊地址（依祭祀資料）"}
                  </button>
                )}
                {overview.returnMemberId && (
                  <Link
                    href={`/devotee-center/${overview.returnMemberId}`}
                    className={secondaryButtonClass}
                  >
                    返回信眾資料
                  </Link>
                )}
                <Link href={`/household/${overview.householdId}`} className={secondaryButtonClass}>
                  返回家戶
                </Link>
              </div>

              {addrPreview && (
                <div className="mt-4 rounded-2xl bg-cream-100 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-ink">重新對齊地址（牌位地址以祭祀資料為準）</p>
                    <button type="button" onClick={() => setAddrPreview(null)} className="text-xs text-ink-faint hover:underline">
                      關閉
                    </button>
                  </div>
                  {addrPreview.changes.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-soft">
                      這筆報名的牌位地址都已跟祭祀資料一致，沒有需要對齊的項目。
                      {addrPreview.noWorshipMatch > 0 &&
                        `（另有 ${addrPreview.noWorshipMatch} 個牌位在祭祀資料找不到對應安奉地，未列入。）`}
                    </p>
                  ) : (
                    <>
                      <p className="mt-2 text-xs text-ink-soft">
                        勾選要更新的牌位，按「套用」才會改。你手動填過、不想動的請取消勾選。
                      </p>
                      <ul className="mt-3 flex flex-col gap-2">
                        {addrPreview.changes.map((c) => (
                          <li key={c.entryId} className="rounded-xl bg-white/80 px-4 py-3">
                            <label className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={addrChecked.has(c.entryId)}
                                onChange={() => toggleAddr(c.entryId)}
                                className="mt-1"
                              />
                              <span className="flex-1 text-sm">
                                <span className="text-ink">{c.displayName}</span>
                                <span className="mt-1 block text-ink-faint">目前：{c.oldAddress || "（空白）"}</span>
                                <span className="mt-0.5 block text-sage-300">祭祀資料：{c.newAddress}</span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      {addrPreview.noWorshipMatch > 0 && (
                        <p className="mt-2 text-xs text-ink-faint">
                          另有 {addrPreview.noWorshipMatch} 個牌位在祭祀資料找不到對應安奉地，未列入（不影響）。
                        </p>
                      )}
                      <div className="mt-3">
                        <button
                          type="button"
                          className={primaryButtonClass}
                          onClick={() => void applyAddressRealign()}
                          disabled={addrBusy || addrChecked.size === 0}
                        >
                          {addrBusy ? "套用中…" : `套用勾選（${addrChecked.size}）`}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {isConfirmed && (
                <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                  已確認的報名可以繼續編輯內容。若修改了成員或信眾生日，
                  需要按「重新產生列印資料」才會更新列印用的農曆生日與虛歲——
                  系統不會自動覆蓋已經列印過的內容。
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
