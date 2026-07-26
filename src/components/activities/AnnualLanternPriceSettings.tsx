"use client";

import { useCallback, useEffect, useState } from "react";
import { inputClass, primaryButtonClass, errorTextClass } from "@/components/household/formStyles";
import { useStoredOperatorUserId } from "@/lib/operatorClient";

/**
 * V15R5.1：年度燈活動設定——**四個報名項目**各自年度單價（光明燈／太歲燈／全家燈／祭改）。
 *
 * 查看／修改／儲存皆透過 /api/temple-events/[id]/annual-lantern-prices（GET/PATCH），四項一次編輯、
 * 共用一顆「儲存單價」。報名時**伺服器一律以該年度單價重算應收**（前端不傳、不信任金額）：
 * 光明/太歲/全家燈→RitualRegistrationItem 自身計價；祭改→PurificationEntry，皆不重複應收。
 */

type FieldKey = "brightLightUnitPrice" | "taisuiLightUnitPrice" | "familyLanternUnitPrice" | "purificationUnitPrice";

const ROWS: { key: FieldKey; name: string; unit: string }[] = [
  { key: "brightLightUnitPrice", name: "光明燈", unit: "元／每份" },
  { key: "taisuiLightUnitPrice", name: "太歲燈", unit: "元／每份" },
  { key: "familyLanternUnitPrice", name: "全家燈", unit: "元／每戶" },
  { key: "purificationUnitPrice", name: "祭改", unit: "元／每份" },
];

type Values = Record<FieldKey, string>;
const EMPTY: Values = { brightLightUnitPrice: "", taisuiLightUnitPrice: "", familyLanternUnitPrice: "", purificationUnitPrice: "" };

export default function AnnualLanternPriceSettings({ templeEventId }: { templeEventId: string }) {
  const operatorUserId = useStoredOperatorUserId();
  const [values, setValues] = useState<Values>(EMPTY);
  const [loaded, setLoaded] = useState<Values>(EMPTY); // 已寫入 DB 的實際值（空＝未設定），供「未修改不送出」判斷
  const [suggested, setSuggested] = useState<Record<FieldKey, boolean>>({
    brightLightUnitPrice: false,
    taisuiLightUnitPrice: false,
    familyLanternUnitPrice: false,
    purificationUnitPrice: false,
  }); // 該欄目前顯示的是「建議預設值」（DB 尚未寫入，按儲存才寫入）
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = operatorUserId ? `?operatorUserId=${encodeURIComponent(operatorUserId)}` : "";
      const res = await fetch(`/api/temple-events/${templeEventId}/annual-lantern-prices${q}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "載入失敗");
        return;
      }
      // DB 實際值（未設定＝空字串，作為 dirty 判斷基準與「已儲存」真值）。
      const db: Values = { ...EMPTY };
      // 顯示值：DB 有值就用 DB 值；DB 為 NULL 時**預帶** defaults（RegistrationItemType.defaultUnitPrice）
      //         作為建議值顯示（此時尚未寫入 DB，按「儲存單價」才寫入）。
      const disp: Values = { ...EMPTY };
      const sug: Record<FieldKey, boolean> = { ...suggested };
      const defaults = (data?.defaults ?? {}) as Partial<Record<FieldKey, number | null>>;
      for (const r of ROWS) {
        const dbVal = data[r.key] != null ? String(data[r.key]) : "";
        db[r.key] = dbVal;
        if (dbVal !== "") {
          disp[r.key] = dbVal;
          sug[r.key] = false;
        } else {
          const d = defaults[r.key];
          disp[r.key] = d != null ? String(d) : "";
          sug[r.key] = d != null; // 顯示的是建議值、DB 尚未寫入
        }
      }
      setValues(disp);
      setLoaded(db);
      setSuggested(sug);
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setLoading(false);
    }
    // suggested 只在 load 內重建，不放進依賴避免迴圈。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templeEventId, operatorUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  function setField(key: FieldKey, raw: string) {
    setMessage(null);
    // 只允許 0 以上整數（或空＝未設定）；擋掉負號、小數、非數字。
    const cleaned = raw.replace(/[^\d]/g, "");
    setValues((v) => ({ ...v, [key]: cleaned }));
  }

  const dirty = ROWS.some((r) => values[r.key] !== loaded[r.key]);

  async function save() {
    setError(null);
    setMessage(null);
    if (!dirty) {
      setMessage("目前沒有修改，不需儲存。");
      return;
    }
    // 前端整數驗證（伺服器仍會再驗）；空＝null（未設定）。
    const body: Record<string, unknown> = { operatorUserId };
    for (const r of ROWS) {
      const t = values[r.key].trim();
      if (t === "") {
        body[r.key] = null;
        continue;
      }
      const n = Number(t);
      if (!Number.isInteger(n) || n < 0) {
        setError(`${r.name}單價必須是 0 以上的整數（0＝尚未設定／不收費）`);
        return;
      }
      body[r.key] = n;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/annual-lantern-prices`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        // API 失敗一律顯示錯誤，不假裝成功。
        setError(data?.error ?? "儲存失敗，請稍後再試。");
        return;
      }
      setMessage("已儲存年度燈四項單價。報名時系統會自動以此單價計算應收。");
      await load(); // 重新載入 → 更新快照，dirty 歸零
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white/70 p-6 shadow-soft">
      <h2 className="text-lg font-medium text-ink">年度燈單價設定</h2>
      <p className="mt-1 text-xs text-ink-faint">
        每年度設定一次，四項各自獨立。留空或 0＝尚未設定／不收費（該項報名應收為 0）。報名時伺服器一律以此單價重算應收，不重複計價。
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-ink-soft">載入中…</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {/* 表頭（手機也不橫向溢出：用 flex，欄寬自適應） */}
          <div className="flex items-center gap-3 px-1 text-xs text-ink-faint">
            <span className="w-20 shrink-0">活動項目</span>
            <span className="flex-1">單價</span>
          </div>
          {ROWS.map((r) => {
            const v = values[r.key];
            const isZeroOrEmpty = v.trim() === "" || Number(v) === 0;
            const isSuggested = suggested[r.key] && v.trim() !== ""; // DB 尚未寫入、目前顯示建議值
            return (
              <div key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-cream-50 px-3 py-2">
                <span className="w-20 shrink-0 text-sm text-ink">{r.name}</span>
                <div className="flex flex-1 items-center gap-2">
                  <input
                    className={`${inputClass} w-24 min-w-0`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={v}
                    onChange={(e) => setField(r.key, e.target.value)}
                    placeholder="未設定"
                    aria-label={`${r.name}單價`}
                  />
                  <span className="whitespace-nowrap text-xs text-ink-faint">{r.unit}</span>
                </div>
                {/* 提示置於獨立一行（手機不擠壓輸入框、不橫向溢出）。 */}
                <div className="basis-full pl-20 text-xs">
                  {isSuggested ? (
                    <span className="text-mist-500">已預帶預設值，尚未儲存——請確認後按「儲存單價」才會寫入本年度。</span>
                  ) : isZeroOrEmpty ? (
                    <span className="text-blossom-400">尚未設定／不收費（該項報名應收為 0）。</span>
                  ) : null}
                </div>
              </div>
            );
          })}

          <div className="mt-2 flex items-center gap-3">
            <button type="button" className={primaryButtonClass} onClick={save} disabled={saving || !dirty}>
              {saving ? "儲存中…" : "儲存單價"}
            </button>
            {!dirty && <span className="text-xs text-ink-faint">尚未修改</span>}
          </div>
        </div>
      )}

      {error && <p className={`${errorTextClass} mt-2`}>{error}</p>}
      {message && <p className="mt-2 text-sm text-sage-400">{message}</p>}
    </section>
  );
}
