"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { useOperator } from "@/lib/operatorClient";
import {
  inputClass,
  labelClass,
  checkboxRowClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "./formStyles";

type Props = {
  householdId: string;
  members: { id: string; name: string; role: string }[];
  worshipRecords: { id: string; type: "ANCESTOR_LINE" | "INDIVIDUAL"; displayName: string }[];
  onClose: () => void;
  onSuccess: () => void;
};

type WorshipHandling = "KEEP" | "MOVE" | "COPY";

type Preview = {
  membersToMove: { id: string; name: string; role: string }[];
  remainingMembers: { id: string; name: string; role: string }[];
  originalHeadWillMove: boolean;
  willBecomeEmpty: boolean;
};

/**
 * V12.1「家戶管理中心」指令「十二、家戶拆分」。
 * 把目前這一戶的部分成員移出，建立成新家戶；歷代祖先/乙位正魂依使用者
 * 選擇保留在原家戶／移至新家戶／複製到兩戶，一般成員不會被複製成兩筆
 * 人物資料（見 src/lib/householdManagement.ts splitHousehold() 說明）。
 */
export default function SplitHouseholdWizard({ householdId, members, worshipRecords, onClose, onSuccess }: Props) {
  const { operatorUserId } = useOperator();
  const [step, setStep] = useState<"select" | "preview" | "done">("select");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newHeadMemberId, setNewHeadMemberId] = useState("");
  const [originalNewHeadMemberId, setOriginalNewHeadMemberId] = useState("");
  const [worshipHandling, setWorshipHandling] = useState<Record<string, WorshipHandling>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const currentHead = members.find((m) => m.role === "HOUSEHOLD_HEAD");
  const originalHeadMoving = !!currentHead && selected[currentHead.id];
  const remainingMembers = members.filter((m) => !selected[m.id]);

  async function loadPreview() {
    if (selectedIds.length === 0 || loading) return;
    if (originalHeadMoving && remainingMembers.length > 0 && !originalNewHeadMemberId) {
      setError("原戶長將被移出，請先指定原家戶的新戶長。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/households/split/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, householdId, memberIds: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "查詢失敗，請稍後再試一次。");
        return;
      }
      setPreview(data.data as Preview);
      setStep("preview");
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    if (loading || !newCode.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/households/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          householdId,
          memberIds: selectedIds,
          newHousehold: {
            householdCode: newCode.trim(),
            householdName: newName,
            primaryContact: newContact,
            address: newAddress,
          },
          newHeadMemberId: newHeadMemberId || undefined,
          originalNewHeadMemberId: originalNewHeadMemberId || undefined,
          ancestorHandling: worshipHandling,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "拆分失敗，請稍後再試一次。");
        return;
      }
      setResult(`拆分完成：已建立新家戶 ${newCode.trim()}（${newName || "未命名"}）。`);
      setStep("done");
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="拆分家戶" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {step === "select" && (
          <>
            <div>
              <label className={labelClass}>選擇要移出成立新家戶的成員</label>
              <div className="flex flex-col gap-2">
                {members.map((m) => (
                  <label key={m.id} className={checkboxRowClass}>
                    <input
                      type="checkbox"
                      checked={!!selected[m.id]}
                      onChange={(e) => setSelected((s) => ({ ...s, [m.id]: e.target.checked }))}
                    />
                    {m.name}
                    {m.role === "HOUSEHOLD_HEAD" && (
                      <span className="rounded-full bg-yolk-100 px-2 py-0.5 text-xs text-ink-soft">目前戶長</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            {selectedIds.length > 0 && (
              <>
                <div>
                  <label className={labelClass}>新家戶編號</label>
                  <input className={inputClass} value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="例如 F00020" />
                </div>
                <div>
                  <label className={labelClass}>新家戶戶名</label>
                  <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>新家戶主要聯絡人</label>
                  <input className={inputClass} value={newContact} onChange={(e) => setNewContact(e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>新家戶地址</label>
                  <input className={inputClass} value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>新家戶戶長（選填，必須是移出的成員）</label>
                  <select className={inputClass} value={newHeadMemberId} onChange={(e) => setNewHeadMemberId(e.target.value)}>
                    <option value="">（不指定）</option>
                    {members.filter((m) => selected[m.id]).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                {originalHeadMoving && remainingMembers.length > 0 && (
                  <div>
                    <label className={labelClass}>原戶長即將被移出，請指定原家戶新戶長</label>
                    <select
                      className={inputClass}
                      value={originalNewHeadMemberId}
                      onChange={(e) => setOriginalNewHeadMemberId(e.target.value)}
                    >
                      <option value="">請選擇</option>
                      {remainingMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {originalHeadMoving && remainingMembers.length === 0 && (
                  <p className="rounded-2xl bg-yolk-50 px-4 py-3 text-sm text-ink-soft">
                    ⚠️ 全部成員都將移出，原家戶將成為沒有成員的空家戶。
                  </p>
                )}

                {worshipRecords.length > 0 && (
                  <div>
                    <label className={labelClass}>歷代祖先／乙位正魂處理方式</label>
                    <div className="flex flex-col gap-2">
                      {worshipRecords.map((w) => (
                        <div key={w.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-ink-soft">{w.displayName}</span>
                          <select
                            className="rounded-full border border-cream-300 bg-white px-3 py-1 text-xs"
                            value={worshipHandling[w.id] ?? "KEEP"}
                            onChange={(e) =>
                              setWorshipHandling((wh) => ({ ...wh, [w.id]: e.target.value as WorshipHandling }))
                            }
                          >
                            <option value="KEEP">保留在原家戶</option>
                            <option value="MOVE">移至新家戶</option>
                            <option value="COPY">複製到兩戶</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {error && <p className={errorTextClass}>{error}</p>}

            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className={secondaryButtonClass} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className={primaryButtonClass}
                onClick={loadPreview}
                disabled={loading || selectedIds.length === 0 || !newCode.trim()}
              >
                {loading ? "查詢中…" : "查看拆分預覽"}
              </button>
            </div>
          </>
        )}

        {step === "preview" && preview && (
          <>
            <div className="text-sm text-ink-soft">
              <p>將移出 {preview.membersToMove.length} 位成員：{preview.membersToMove.map((m) => m.name).join("、")}</p>
              <p className="mt-1">原家戶留下 {preview.remainingMembers.length} 位成員</p>
              {preview.willBecomeEmpty && <p className="mt-1 text-ink">⚠️ 原家戶將成為空家戶。</p>}
              <p className="mt-1">新家戶編號：{newCode.trim()}（{newName || "未命名"}）</p>
            </div>

            {error && <p className={errorTextClass}>{error}</p>}

            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => setStep("select")} disabled={loading}>
                返回
              </button>
              <button
                type="button"
                className="rounded-full bg-blossom-200 px-5 py-2.5 text-sm text-ink transition hover:bg-blossom-300 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleExecute}
                disabled={loading}
              >
                {loading ? "處理中…" : "確認拆分家戶"}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <p className="rounded-2xl bg-sage-50 px-4 py-3 text-sm text-ink">{result}</p>
            <div className="flex justify-end">
              <button
                type="button"
                className={primaryButtonClass}
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
              >
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
