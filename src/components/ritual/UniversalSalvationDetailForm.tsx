"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  inputClass,
  labelClass,
  checkboxRowClass,
  primaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import { ritualRecordStatusLabel } from "@/lib/labels";
import type { DetailJSON, RecordJSON } from "./types";

import { fetchUniversalSalvation } from "@/lib/universalSalvationFetch";
import { fetchRegistration } from "@/lib/registrationFetch";
type Props = {
  householdId: string;
  year: number;
  status: string;
  detail: DetailJSON;
  /** V15R2：用來回填既有贊普／隨喜贊普 item 的實際姓名／數量／單價（讀取，不寫入）。 */
  ritualRecordId?: string;
  onSaved: (record: RecordJSON) => void;
};

/**
 * 普渡登記明細表單。
 *
 * V3.1「行政流程優化」調整欄位順序，符合實際填寫流程：
 * 陽上姓名 → 安奉位置 → 贊普 → 普渡桌 → 備註。
 * 「已報名普渡」不在這個排序清單裡，改放到標題列（跟狀態標籤放一起），
 * 不影響其餘欄位的填寫順序。
 * V3.2「大量登記優化」：整個表單包在 <form> 裡，在任何一般輸入欄位按 Enter
 * 就會直接儲存（瀏覽器原生行為，備註是多行 textarea，Enter 維持換行、不會
 * 誤觸儲存）；完成後的提示改成畫面右上角的提示（見 UniversalSalvationScreen）。
 */
export default function UniversalSalvationDetailForm({
  householdId,
  year,
  status,
  detail,
  onSaved,
  ritualRecordId,
}: Props) {
  const [isRegistered, setIsRegistered] = useState(detail.isRegistered);
  const [yangshangName, setYangshangName] = useState(detail.yangshangName ?? "");
  const [enshrinementLocation, setEnshrinementLocation] = useState(
    detail.enshrinementLocation ?? ""
  );
  const [isSponsor, setIsSponsor] = useState(detail.isSponsor);
  // V15R2：贊普實際姓名（保存於 US_SPONSOR.customName，不存「本人」）。
  const [sponsorName, setSponsorName] = useState("");
  const [sponsorQuantity, setSponsorQuantity] = useState(
    detail.sponsorQuantity !== null ? String(detail.sponsorQuantity) : "1"
  );
  // V15R2：一般贊普固定單價**唯讀**——新報名讀年度固定價、既有報名讀該筆鎖定價快照。
  // 使用者不可自由修改；後端亦不信任前端單價。
  const [sponsorFixedPrice, setSponsorFixedPrice] = useState<number | null>(null);
  // V15R2：贊普備註／普渡桌屬共用資料層欄位，前端不預設顯示，儲存時沿用既有值不清除。
  const [sponsorNotes] = useState(detail.sponsorNotes ?? "");
  const [tableNumber] = useState(detail.tableNumber ?? "");
  const [notes, setNotes] = useState(detail.notes ?? "");

  // V15R2：隨喜贊普（US_SPONSOR_DONATION）——與贊普各自獨立的一筆自身計價項目。
  // 讀回既有隨喜贊普請看下方「已報名項目」清單；此區為新增／更新／取消入口。
  // 只有實際操作過此區（donationDirty）才會送出 donation 欄位，未動則不影響既有隨喜贊普。
  const [isDonation, setIsDonation] = useState(false);
  const [donationName, setDonationName] = useState("");
  // V15R2：隨喜贊普＝大額自由金額（直接輸入總金額，不套用一般贊普固定價）。
  const [donationAmount, setDonationAmount] = useState("");
  const [donationDirty, setDonationDirty] = useState(false);
  const markDonationDirty = () => setDonationDirty(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * V15R2：回填既有贊普／隨喜贊普 item 的**實際姓名**／數量／單價（讀取，不寫入）。
   * subjectName 已在後端把舊「本人」解析為 member 實名、找不到則「姓名待補」；
   * 這裡以實名預填（待補則留空），避免把「本人」再寫回去。
   */
  useEffect(() => {
    if (!ritualRecordId) return;
    let cancelled = false;
    (async () => {
      try {
        // 年度固定單價（唯讀顯示；新報名用）。
        const priceRes = await fetchRegistration(`/api/universal-salvation/${year}/sponsor-price`);
        if (priceRes.ok && !cancelled) {
          const pd = await priceRes.json();
          if (typeof pd.sponsorUnitPrice === "number") setSponsorFixedPrice(pd.sponsorUnitPrice);
        }
        const res = await fetchRegistration(`/api/registrations/${ritualRecordId}/items`);
        if (!res.ok) return;
        const data = await res.json();
        const items: Array<{ itemKey: string; subjectName: string; quantity: number; unitPrice: number | null; amountDue: number; readOnlyLegacy?: boolean }> = data.items ?? [];
        if (cancelled) return;
        const sp = items.find((it) => it.itemKey === "US_SPONSOR");
        if (sp) {
          setSponsorName(sp.subjectName === "姓名待補" ? "" : sp.subjectName);
          setSponsorQuantity(String(sp.quantity));
          // 既有報名：顯示該筆鎖定單價快照（唯讀）。
          if (sp.unitPrice !== null) setSponsorFixedPrice(sp.unitPrice);
        }
        const dn = items.find((it) => it.itemKey === "US_SPONSOR_DONATION");
        if (dn) {
          setIsDonation(true);
          setDonationName(dn.subjectName === "姓名待補" ? "" : dn.subjectName);
          // 隨喜贊普＝自由總金額（回填 amountDue）。
          setDonationAmount(String(dn.amountDue));
        }
      } catch {
        /* 回填失敗不阻擋編輯 */
      }
    })();
    return () => { cancelled = true; };
  }, [ritualRecordId, year]);

  /**
   * V15R2：一般贊普金額＝數量 × **年度固定單價**（唯讀，前端不可改單價）；後端以固定價重算。
   * 隨喜贊普＝自由總金額（直接輸入）。皆即時計算、無 NaN。
   */
  const sponsorQtyNum = Math.floor(Number(sponsorQuantity));
  const sponsorQtyValid = Number.isFinite(sponsorQtyNum) && sponsorQtyNum >= 1;
  const sponsorPriceKnown = sponsorFixedPrice != null && Number.isFinite(sponsorFixedPrice);
  const sponsorComputedAmount =
    sponsorQtyValid && sponsorPriceKnown ? Math.round(sponsorQtyNum * (sponsorFixedPrice as number)) : 0;

  const donationAmountNum = Math.max(0, Math.round(Number(donationAmount) || 0));
  const donationAmountValid = donationAmount.trim() !== "" && Number.isFinite(Number(donationAmount)) && donationAmountNum >= 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    handleSave();
  }

  async function handleSave() {
    // 勾選贊普時的基本驗證（後端仍會依年度固定價重算金額）。
    if (isSponsor && !sponsorQtyValid) {
      setError("贊普數量必須是 1 以上的整數。");
      return;
    }
    if (isSponsor && !sponsorPriceKnown) {
      setError("尚未設定本年度贊普固定單價，請先於活動設定頁設定後再報名。");
      return;
    }
    if (donationDirty && isDonation && !donationAmountValid) {
      setError("隨喜贊普金額不可小於 0。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // 只有實際操作過隨喜贊普區才送出 donation 欄位（未動則不影響既有隨喜贊普）。
      // 隨喜贊普＝自由總金額（donationAmount），後端 quantity=1、lockedUnitPrice=金額。
      const donationBody = donationDirty
        ? {
            isDonation,
            donationName: isDonation ? donationName.trim() || null : null,
            donationAmount: isDonation ? donationAmountNum : null,
          }
        : {};
      const res = await fetchUniversalSalvation(
        `/api/households/${householdId}/rituals/universal-salvation/${year}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isRegistered,
            yangshangName: yangshangName.trim() || null,
            enshrinementLocation: enshrinementLocation.trim() || null,
            isSponsor,
            // 贊普實際姓名（保存於 US_SPONSOR.customName，不存「本人」）。
            sponsorName: isSponsor ? sponsorName.trim() || null : null,
            // 一般贊普只送姓名與數量；單價/金額由後端依年度固定價重算，不信任前端。
            sponsorQuantity: isSponsor ? sponsorQtyNum : null,
            sponsorNotes: sponsorNotes.trim() || null,
            tableNumber: tableNumber.trim() || null,
            notes: notes.trim() || null,
            ...donationBody,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "儲存失敗，請稍後再試一次。");
        return;
      }
      onSaved(data.record);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-8 shadow-card">
      <form onSubmit={handleSubmit}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-ink">{year} 年普渡登記資料</h2>
        <div className="flex items-center gap-3">
          <label className={checkboxRowClass}>
            <input
              type="checkbox"
              checked={isRegistered}
              onChange={(e) => setIsRegistered(e.target.checked)}
            />
            已報名普渡
          </label>
          <span className="rounded-full bg-cream-200/70 px-3 py-1 text-xs text-ink-soft">
            {ritualRecordStatusLabel[status] ?? status}
          </span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>陽上姓名</label>
          <input
            className={inputClass}
            value={yangshangName}
            onChange={(e) => setYangshangName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>安奉位置</label>
          <input
            className={inputClass}
            value={enshrinementLocation}
            onChange={(e) => setEnshrinementLocation(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-cream-100/60 p-5">
        <label className={checkboxRowClass}>
          <input
            type="checkbox"
            checked={isSponsor}
            onChange={(e) => setIsSponsor(e.target.checked)}
          />
          贊普
        </label>

        {isSponsor && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label className={labelClass}>姓名</label>
              <input
                className={inputClass}
                value={sponsorName}
                onChange={(e) => setSponsorName(e.target.value)}
                placeholder="贊普人姓名"
              />
            </div>
            <div>
              <label className={labelClass}>數量</label>
              <input
                className={inputClass}
                type="number"
                min={1}
                step={1}
                value={sponsorQuantity}
                onChange={(e) => setSponsorQuantity(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>固定單價（依年度設定）</label>
              <input
                className={`${inputClass} bg-cream-100 text-ink-soft`}
                type="text"
                readOnly
                value={sponsorPriceKnown ? `${(sponsorFixedPrice as number).toLocaleString("zh-Hant")} 元` : "尚未設定"}
              />
              <p className="mt-1 text-xs text-ink-faint">一般贊普單價由宮方年度設定，不可自行修改。</p>
            </div>
            <div>
              <label className={labelClass}>金額（自動計算）</label>
              <input
                className={`${inputClass} bg-cream-100 text-ink-soft`}
                type="text"
                readOnly
                value={`${sponsorComputedAmount.toLocaleString("zh-Hant")} 元`}
              />
              <p className="mt-1 text-xs text-ink-faint">金額 = 數量 × 固定單價（後端以固定價重算）。</p>
            </div>
          </div>
        )}
      </div>

      {/* V15R2：隨喜贊普——與一般贊普各自獨立的一筆自身計價項目（大額自由金額）。
          現有隨喜贊普顯示於下方「已報名項目」清單並可獨立取消；此區為新增／更新入口。 */}
      <div className="mt-6 rounded-2xl bg-cream-100/60 p-5">
        <label className={checkboxRowClass}>
          <input
            type="checkbox"
            checked={isDonation}
            onChange={(e) => { setIsDonation(e.target.checked); markDonationDirty(); }}
          />
          隨喜贊普（獨立項目・大額自由金額）
        </label>
        <p className="mt-1 text-xs text-ink-faint">與一般贊普各自獨立：姓名／金額分開，可同時存在、可分別取消；金額自由填寫，不套用固定單價。</p>

        {isDonation && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>姓名</label>
              <input
                className={inputClass}
                value={donationName}
                onChange={(e) => { setDonationName(e.target.value); markDonationDirty(); }}
                placeholder="隨喜贊普姓名／公司"
              />
            </div>
            <div>
              <label className={labelClass}>金額（自由填寫）</label>
              <input
                className={inputClass}
                type="number"
                min={0}
                value={donationAmount}
                onChange={(e) => { setDonationAmount(e.target.value); markDonationDirty(); }}
                placeholder="例如 5000、10000"
              />
              <p className="mt-1 text-xs text-ink-faint">大額自由贊助，直接輸入總金額（新臺幣整數）。</p>
            </div>
          </div>
        )}
      </div>

      {/* V15R2：普渡桌屬共用資料層欄位，前端不預設顯示（儲存時沿用既有值 tableNumber，不清除）。 */}

      <div className="mt-6">
        <label className={labelClass}>備註</label>
        <textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p className={`mt-4 ${errorTextClass}`}>{error}</p>}

      <div className="mt-6 flex items-center justify-end gap-3">
        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? "儲存中…" : "儲存（Enter）"}
        </button>
      </div>
      </form>
    </section>
  );
}
