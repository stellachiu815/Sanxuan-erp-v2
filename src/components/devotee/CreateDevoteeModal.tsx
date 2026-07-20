"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { useOperator } from "@/lib/operatorClient";
import DuplicateConfirmDialog, { type DuplicateView } from "@/components/devotee/DuplicateConfirmDialog";
import { memberRoleOptions } from "@/lib/labels";
import BirthdayField, { createEmptyBirthdayValue, type BirthdayValue } from "@/components/birthday/BirthdayField";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";

/**
 * V12.2「信眾建立與查詢中心」指令「一、統一建立信眾流程」。
 *
 * 這是**全系統唯一的「新增信眾」入口元件**，同時掛在首頁與信眾名單頁。
 * 在此之前系統沒有任何「新增信眾」按鈕——要新增一位信眾，行政人員必須先
 * 找到或建立家戶、進入家戶詳情頁、再按「新增家人」，而且建立當下填不了
 * 電話與地址。這個元件把整段流程收成一個對話框。
 *
 * ⚠️ 這裡**沒有任何自己的建立邏輯**：送出後一律呼叫
 * POST /api/devotee-center/create，該 API 內部再呼叫既有的
 * householdManagement.createHousehold()（家戶＋自動編號）與
 * memberCreate.createMemberInTransaction()（成員＋DevoteeProfile.mobile）。
 * 對應指令「不可建立第二套新增信眾功能」「不可複製另一套建立家戶邏輯」。
 *
 * ⚠️ 疑似重複只提醒：API 回 409 ＋ 候選清單時，這裡顯示對照資訊，操作者
 * 可以「查看現有信眾」或「確認仍要建立」。**不會自動合併，也不會只因為
 * 同名就阻止建立。**
 *
 * 手機版（指令「八」）：所有輸入欄位與主要按鈕都套用 min-h-11（約 44px，
 * 符合觸控目標建議尺寸），欄位在小螢幕單欄、sm 以上才並排，對話框內不需要
 * 任何水平捲動就能完成新增。
 */

type Mode = "existing" | "new";

type HouseholdOption = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  memberCount: number;
};

type Props = {
  onClose: () => void;
  /** 建立成功後通知外層重新整理列表（首頁不需要時可不傳）。 */
  onCreated?: () => void;
};

// 觸控友善的共用尺寸（指令「八」）。
const touchInputClass = `${inputClass} min-h-11`;
const touchPrimaryClass = `${primaryButtonClass} min-h-11 w-full sm:w-auto`;
const touchSecondaryClass = `${secondaryButtonClass} min-h-11 w-full sm:w-auto`;

export default function CreateDevoteeModal({ onClose, onCreated }: Props) {
  const router = useRouter();
  const { operatorUserId } = useOperator();

  const [mode, setMode] = useState<Mode>("existing");

  // ---- 信眾本人欄位 ----
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [role, setRole] = useState("OTHER");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  /**
   * V12.4 指令三：輸入時的即時疑似重複提示。
   *
   * 只是提示，不阻擋建立——送出時 POST /api/devotee-center/create 仍會再檢查
   * 一次並回 409，那才是真正的把關。兩者共用同一份比對實作
   * （findPreCreateDuplicates → findDuplicateMatches），不會出現
   * 「打字時說沒有、送出卻被擋」的矛盾。
   */
  const [liveDuplicates, setLiveDuplicates] = useState<DuplicateView[]>([]);
  const [liveDupDismissed, setLiveDupDismissed] = useState(false);
  const [birthday, setBirthday] = useState<BirthdayValue>(createEmptyBirthdayValue());

  // ---- 模式 A：既有家戶 ----
  const [householdQuery, setHouseholdQuery] = useState("");
  const [householdOptions, setHouseholdOptions] = useState<HouseholdOption[]>([]);
  const [searchingHousehold, setSearchingHousehold] = useState(false);
  const [selectedHousehold, setSelectedHousehold] = useState<HouseholdOption | null>(null);

  // ---- 家戶電話／地址（兩種模式共用）----
  const [householdPhone, setHouseholdPhone] = useState("");
  const [householdAddress, setHouseholdAddress] = useState("");
  const [overwriteHousehold, setOverwriteHousehold] = useState(false);

  // ---- 模式 B：新家戶 ----
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const [newHouseholdContact, setNewHouseholdContact] = useState("");

  // ---- 送出狀態 ----
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateView[] | null>(null);
  /**
   * 只有「確認仍要建立」那顆按鈕會設成 true，見 submit() 的說明。
   *
   * ⚠️ 用 useRef 而不是 useState：按鈕的 onClick 會「設定旗標後**立刻**呼叫
   * submit()」，而 setState 是非同步的，同一個 tick 內 submit() 讀到的仍會是
   * 舊值 false，會被自己的保險擋下來、永遠建立不了。ref 是同步寫入，才能在
   * 同一個 tick 內正確反映使用者剛剛按下的確認。
   */
  const duplicatesAcknowledgedRef = useRef(false);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  // 家戶搜尋（模式 A）：沿用既有的 debounce 作法，跟 SearchBar 一致。
  useEffect(() => {
    if (mode !== "existing") return;
    const q = householdQuery.trim();
    if (!q) {
      setHouseholdOptions([]);
      return;
    }
    setSearchingHousehold(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (operatorUserId) params.set("operatorUserId", operatorUserId);
        const res = await fetch(`/api/devotee-center/household-options?${params.toString()}`);
        const json = await res.json();
        if (res.ok) setHouseholdOptions(json.data?.households ?? []);
        else setHouseholdOptions([]);
      } catch {
        setHouseholdOptions([]);
      } finally {
        setSearchingHousehold(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [householdQuery, mode, operatorUserId]);

  /**
   * V12.4 指令三：姓名／手機／市話／地址任一變動時，debounce 後即時查詢。
   * 250ms 跟既有 SearchBar／家戶搜尋一致，維持全站一致的輸入手感。
   */
  useEffect(() => {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setLiveDuplicates([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/devotee-center/duplicate-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operatorUserId,
            name: trimmedName,
            mobile: mobile.trim() || null,
            phone: householdPhone.trim() || null,
            address: householdAddress.trim() || null,
            householdId: mode === "existing" ? selectedHousehold?.id ?? null : null,
            birthdayType: birthday.birthdayType,
            solarBirthDate: birthday.solarBirthDate,
            lunarBirthYear: Number(birthday.lunarBirthYear) || null,
            lunarBirthMonth: Number(birthday.lunarBirthMonth) || null,
            lunarBirthDay: Number(birthday.lunarBirthDay) || null,
            lunarIsLeapMonth: birthday.lunarIsLeapMonth,
          }),
        });
        const json = await res.json();
        const found: DuplicateView[] = json.data?.duplicates ?? [];
        setLiveDuplicates(found);
        // 條件改變後重新出現提示，不沿用上一次的「知道了」。
        if (found.length > 0) setLiveDupDismissed(false);
      } catch {
        // 即時提示失敗不干擾建立流程，送出時仍會把關。
        setLiveDuplicates([]);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [
    name,
    mobile,
    householdPhone,
    householdAddress,
    mode,
    selectedHousehold,
    birthday,
    operatorUserId,
  ]);

  function selectHousehold(h: HouseholdOption) {
    setSelectedHousehold(h);
    setHouseholdOptions([]);
    setHouseholdQuery("");
    // 顯示目前值，讓操作者看得到既有資料，避免無提示覆蓋（指令「一.A」）。
    setHouseholdPhone(h.phone ?? "");
    setHouseholdAddress(h.address ?? "");
    setOverwriteHousehold(false);
  }

  /** 只清掉「這一位信眾」的欄位，保留家戶選擇，方便連續新增同一戶的家人。 */
  function resetForNextDevotee() {
    setName("");
    setGender("");
    setRole("OTHER");
    setMobile("");
    setEmail("");
    setNotes("");
    setLiveDuplicates([]);
    setLiveDupDismissed(false);
    setBirthday(createEmptyBirthdayValue());
    setDuplicates(null);
    setError(null);
    // 下一位信眾是全新的一筆，之前那次的「已確認」不得沿用。
    duplicatesAcknowledgedRef.current = false;
  }

  function buildPayload(confirmedDuplicates: boolean) {
    const payload: Record<string, unknown> = {
      operatorUserId,
      mode,
      name: name.trim(),
      gender: gender || null,
      role,
      mobile: mobile.trim() || null,
      email: email.trim() || null,
      notes: notes.trim() || null,
      birthdayType: birthday.birthdayType,
      // ⚠️ 一律送出明確的布林值。後端用 `=== true` 嚴格比較，送出字串
      // （例如 "false"）會被判定為已確認而跳過比對。
      confirmedDuplicates: confirmedDuplicates === true,
      overwriteHousehold,
    };

    if (birthday.birthdayType === "solar") {
      payload.solarBirthDate = birthday.solarBirthDate;
    } else if (birthday.birthdayType === "lunar") {
      payload.lunarBirthYear = Number(birthday.lunarBirthYear);
      payload.lunarBirthMonth = Number(birthday.lunarBirthMonth);
      payload.lunarBirthDay = Number(birthday.lunarBirthDay);
      payload.lunarIsLeapMonth = birthday.lunarIsLeapMonth;
    }

    if (mode === "existing") {
      payload.householdId = selectedHousehold?.id;
      payload.household = {
        phone: householdPhone.trim() || null,
        address: householdAddress.trim() || null,
      };
    } else {
      payload.household = {
        name: newHouseholdName.trim() || null,
        contactName: newHouseholdContact.trim() || null,
        phone: householdPhone.trim() || null,
        address: householdAddress.trim() || null,
      };
    }

    return payload;
  }

  async function submit(confirmedDuplicates: boolean, thenContinue: boolean) {
    if (submitting) return;
    if (!name.trim()) {
      setError("請輸入姓名");
      return;
    }
    if (mode === "existing" && !selectedHousehold) {
      setError("請先選擇要加入的家戶");
      return;
    }

    /**
     * ⚠️ 前端側的硬性保險：`confirmedDuplicates = true` 只有在使用者**真的
     * 看過疑似重複清單並按下「確認仍要建立」**之後才允許送出。
     *
     * `duplicatesAcknowledged` 這個 state 只有那一顆按鈕會設成 true，其他
     * 任何路徑（表單 submit、儲存並繼續新增、重試）都不會。萬一之後有人
     * 改動流程、不小心讓 confirmedDuplicates 在沒有經過確認畫面時變成
     * true，這裡會直接把它降回 false，讓後端重新跑一次比對，不會靜默略過。
     */
    const reallyConfirmed = confirmedDuplicates === true && duplicatesAcknowledgedRef.current;
    if (confirmedDuplicates && !duplicatesAcknowledgedRef.current) {
      setError("請先確認疑似重複清單後再建立");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessNote(null);

    try {
      const res = await fetch("/api/devotee-center/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(reallyConfirmed)),
      });
      const json = await res.json();

      if (res.status === 409 && json.needsDuplicateConfirmation) {
        // 命中疑似重複：後端此時尚未寫入任何資料。先把清單顯示出來，
        // 並確保「已確認」旗標是 false，使用者一定要再按一次才會建立。
        setDuplicates(json.duplicates ?? []);
        duplicatesAcknowledgedRef.current = false;
        return;
      }
      if (!res.ok) {
        setError(json.error ?? "建立失敗，請稍後再試一次。");
        return;
      }

      const createdName = name.trim();
      onCreated?.();

      if (thenContinue) {
        // 「儲存並繼續新增」：留在對話框，保留家戶選擇。
        resetForNextDevotee();
        setSuccessNote(`已建立「${createdName}」，可以接著新增下一位。`);
        // 模式 B 建立完新家戶後，後續應該是加入剛建立的那一戶，
        // 但為了避免誤解，這裡不自動切模式，只提示操作者。
        return;
      }

      // 預設：直接進入新信眾的詳細頁（指令「一」）。
      const memberId = json.data?.member?.id;
      if (memberId) router.push(`/devotee-center/${memberId}`);
      onClose();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(false, false);
  }

  // ---- 疑似重複確認畫面 ----
  // 改用與 AddMemberModal 共用的 <DuplicateConfirmDialog/>，兩個建立流程
  // 的確認 UI 只有一份，不會再各自分歧。
  if (duplicates) {
    return (
      <DuplicateConfirmDialog
        duplicates={duplicates}
        submitting={submitting}
        error={error}
        onBack={() => {
          // 返回修改＝取消這次確認，旗標必須歸零。
          setDuplicates(null);
          duplicatesAcknowledgedRef.current = false;
        }}
        onViewExisting={(memberId) => {
          duplicatesAcknowledgedRef.current = false;
          onClose();
          router.push(`/devotee-center/${memberId}`);
        }}
        onConfirm={() => {
          // 這是唯一一個會把「已確認」旗標設成 true 的地方。
          duplicatesAcknowledgedRef.current = true;
          submit(true, false);
        }}
      />
    );
  }

  // ---- 主表單 ----
  return (
    <Modal title="新增信眾" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* 模式切換 */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("existing")}
            className={`min-h-11 rounded-2xl px-4 py-2.5 text-sm transition ${
              mode === "existing" ? "bg-mist-100 text-ink shadow-soft" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
            }`}
          >
            加入既有家戶
          </button>
          <button
            type="button"
            onClick={() => setMode("new")}
            className={`min-h-11 rounded-2xl px-4 py-2.5 text-sm transition ${
              mode === "new" ? "bg-mist-100 text-ink shadow-soft" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
            }`}
          >
            同時建立新家戶
          </button>
        </div>

        {successNote && (
          <p className="rounded-2xl bg-sage-50 px-4 py-2.5 text-xs text-ink-soft">{successNote}</p>
        )}

        {/* ---- 模式 A：選既有家戶 ---- */}
        {mode === "existing" && (
          <div className="rounded-2xl bg-cream-50 px-4 py-3">
            {selectedHousehold ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-ink">
                    {selectedHousehold.name}（{selectedHousehold.id}）
                  </p>
                  <p className="text-xs text-ink-faint">
                    目前 {selectedHousehold.memberCount} 位成員
                    {selectedHousehold.contactName ? `・主要聯絡人：${selectedHousehold.contactName}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="min-h-11 text-xs text-ink-soft underline-offset-4 hover:underline"
                  onClick={() => setSelectedHousehold(null)}
                >
                  換一戶
                </button>
              </div>
            ) : (
              <>
                <label className={labelClass}>搜尋家戶（編號／戶名／主要聯絡人／電話／地址）</label>
                <input
                  className={touchInputClass}
                  value={householdQuery}
                  onChange={(e) => setHouseholdQuery(e.target.value)}
                  placeholder="例如 F00009、王家、0912…"
                />
                {searchingHousehold && <p className="mt-1 text-xs text-ink-faint">搜尋中…</p>}
                {householdOptions.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {householdOptions.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => selectHousehold(h)}
                          className="min-h-11 w-full rounded-xl bg-white px-3 py-2 text-left text-sm text-ink
                                     shadow-soft transition hover:bg-yolk-50"
                        >
                          <span>{h.name}</span>
                          <span className="ml-2 text-xs text-ink-faint">
                            {h.id}・{h.memberCount} 位成員
                          </span>
                          {h.address && (
                            <span className="block text-xs text-ink-faint">{h.address}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!searchingHousehold && householdQuery.trim() && householdOptions.length === 0 && (
                  <p className="mt-1 text-xs text-ink-faint">
                    找不到符合的家戶，可改用上方「同時建立新家戶」。
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ---- 模式 B：新家戶欄位 ---- */}
        {mode === "new" && (
          <div className="flex flex-col gap-3 rounded-2xl bg-cream-50 px-4 py-3">
            <p className="text-xs text-ink-faint">家戶編號會自動產生（例如 F00021），不需要自行輸入。</p>
            <div>
              <label className={labelClass}>戶名</label>
              <input
                className={touchInputClass}
                value={newHouseholdName}
                onChange={(e) => setNewHouseholdName(e.target.value)}
                placeholder="留空會使用信眾姓名"
              />
            </div>
            <div>
              <label className={labelClass}>主要聯絡人</label>
              <input
                className={touchInputClass}
                value={newHouseholdContact}
                onChange={(e) => setNewHouseholdContact(e.target.value)}
                placeholder="留空會使用信眾姓名"
              />
            </div>
          </div>
        )}

        {/* ---- 信眾本人 ---- */}
        <div>
          <label className={labelClass}>姓名（必填）</label>
          <input
            className={touchInputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {/* V12.4 指令三：即時疑似重複提示。只提示、不阻擋，可以直接忽略繼續建立。 */}
        {liveDuplicates.length > 0 && !liveDupDismissed && (
          <div className="rounded-2xl bg-yolk-50 px-4 py-3">
            <p className="text-xs leading-relaxed text-ink-soft">
              已有相似信眾（{liveDuplicates.length} 位），是否查看？
              <span className="ml-1 text-ink-faint">系統不會阻止你繼續建立。</span>
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {liveDuplicates.slice(0, 3).map((d) => (
                <li key={d.memberId}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push(`/devotee-center/${d.memberId}`);
                    }}
                    className="min-h-11 w-full rounded-xl bg-white/80 px-3 py-2 text-left text-xs
                               text-ink-soft shadow-soft transition hover:bg-white"
                  >
                    <span className="text-sm text-ink">{d.name}</span>
                    <span className="ml-2">
                      {d.householdName}（{d.householdId}）
                    </span>
                    <span className="block text-ink-faint">
                      {[d.phone, d.birthdayDisplay, d.address].filter(Boolean).join("・") || "無聯絡資料"}
                      {d.reasons.length > 0 && `　—　${d.reasons.join("、")}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {liveDuplicates.length > 3 && (
              <p className="mt-1 text-xs text-ink-faint">另有 {liveDuplicates.length - 3} 位未顯示。</p>
            )}
            <button
              type="button"
              onClick={() => setLiveDupDismissed(true)}
              className="mt-2 min-h-11 text-xs text-ink-faint underline-offset-4 hover:text-ink hover:underline"
            >
              知道了，繼續建立
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>手機（主要聯絡方式）</label>
            <input
              className={touchInputClass}
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="例如 0912345678"
            />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input
              className={touchInputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              autoComplete="email"
              placeholder="例如 abc@example.com"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>性別</label>
            <select className={touchInputClass} value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">未填寫</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>身份</label>
            <select className={touchInputClass} value={role} onChange={(e) => setRole(e.target.value)}>
              {memberRoleOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <BirthdayField value={birthday} onChange={setBirthday} />

        {/* ---- 家戶電話／地址 ---- */}
        <div className="flex flex-col gap-3 rounded-2xl bg-mist-50 px-4 py-3">
          <p className="text-xs text-ink-soft">
            家戶電話與地址（選填）
            {mode === "existing" && selectedHousehold && (selectedHousehold.phone || selectedHousehold.address) && (
              <span className="mt-1 block text-ink-faint">
                這一戶目前：電話 {selectedHousehold.phone || "—"}／地址 {selectedHousehold.address || "—"}
              </span>
            )}
          </p>
          <div>
            <label className={labelClass}>市話（家戶電話）</label>
            <input
              className={touchInputClass}
              value={householdPhone}
              onChange={(e) => setHouseholdPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel-local"
              placeholder="例如 02-12345678"
            />
          </div>
          <div>
            <label className={labelClass}>地址</label>
            <input
              className={touchInputClass}
              value={householdAddress}
              onChange={(e) => setHouseholdAddress(e.target.value)}
            />
          </div>

          {/* 指令「一.A」：不可無提示覆蓋既有非空資料 */}
          {mode === "existing" &&
            selectedHousehold &&
            ((selectedHousehold.phone && householdPhone.trim() !== (selectedHousehold.phone ?? "")) ||
              (selectedHousehold.address && householdAddress.trim() !== (selectedHousehold.address ?? ""))) && (
              <label className="flex items-start gap-2 rounded-xl bg-yolk-50 px-3 py-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={overwriteHousehold}
                  onChange={(e) => setOverwriteHousehold(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  這一戶原本已經有電話／地址，你修改了內容。勾選才會更新家戶既有資料；
                  不勾選則只會補上原本空白的欄位，既有資料保持不變。
                </span>
              </label>
            )}
        </div>

        <div>
          <label className={labelClass}>備註</label>
          <textarea
            className={touchInputClass}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && <p className={errorTextClass}>{error}</p>}

        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={touchSecondaryClass} onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            type="button"
            className={touchSecondaryClass}
            onClick={() => submit(false, true)}
            disabled={submitting}
          >
            儲存並繼續新增
          </button>
          <button type="submit" className={touchPrimaryClass} disabled={submitting}>
            {submitting ? "建立中…" : "建立並查看"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
