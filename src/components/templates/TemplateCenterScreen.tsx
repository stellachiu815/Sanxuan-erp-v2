"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import Toast from "@/components/ritual/Toast";
import { errorTextClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass, checkboxRowClass } from "@/components/household/formStyles";
import { activityTypeLabel } from "@/lib/labels";
import { useCurrentUser } from "@/lib/permissionClient";
import { canTemplate } from "@/lib/permissions";

type Version = {
  id: string;
  versionLabel: string;
  fileName: string | null;
  isActive: boolean;
  uploadedAt: string | null;
  note: string | null;
};

type TemplateItem = {
  id: string;
  category: string;
  key: string;
  name: string;
  activityType: string | null;
  versions: Version[];
};

const CATEGORY_LABEL: Record<string, string> = {
  PRINT: "① 列印模板",
  EXCEL: "② Excel模板",
  CSV: "③ CSV模板",
  WORD: "④ Word模板",
  PDF: "⑤ PDF模板",
};

const CATEGORY_ORDER = ["PRINT", "EXCEL", "CSV", "WORD", "PDF"];

export default function TemplateCenterScreen({ initialTemplates }: { initialTemplates: TemplateItem[] }) {
  // V14.3：模板頁本身開放檢視（view 級，全角色），但「新增版本」「設為使用中」
  // 屬 create／activate（SUPER_ADMIN／ADMIN），STAFF／READONLY 不顯示這些寫入
  // 按鈕。沿用共用 canTemplate，真正把關仍在 API。
  const { role } = useCurrentUser();
  const canCreateVersion = role ? canTemplate(role, "create") : false;
  const canActivateVersion = role ? canTemplate(role, "activate") : false;
  const [templates, setTemplates] = useState(initialTemplates);
  const [category, setCategory] = useState("PRINT");
  const [versionModalFor, setVersionModalFor] = useState<TemplateItem | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("已完成");

  function showToast(message: string) {
    setToastMessage(message);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  }

  async function refresh() {
    const res = await fetch("/api/templates");
    if (res.ok) {
      const data = await res.json();
      setTemplates(data.templates);
    }
  }

  async function handleActivate(templateId: string, versionId: string) {
    await fetch(`/api/templates/${templateId}/versions/${versionId}/activate`, { method: "POST" });
    showToast("已設為使用中版本");
    await refresh();
  }

  async function handleDownloadBlank(templateId: string, name: string) {
    const res = await fetch(`/api/templates/${templateId}/download-blank`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error ?? "這個模板目前還沒有提供空白範本下載");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}_範本.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const visible = templates.filter((t) => t.category === category);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {CATEGORY_ORDER.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full px-4 py-2 text-sm transition ${
              category === c ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
            }`}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visible.map((t) => {
          const activeVersion = t.versions.find((v) => v.isActive);
          return (
            <li key={t.id} className="rounded-2xl bg-white/70 p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-medium text-ink">{t.name}</h3>
                {t.activityType && (
                  <span className="rounded-full bg-mist-100 px-3 py-1 text-xs text-ink-soft">
                    {activityTypeLabel[t.activityType] ?? t.activityType}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-faint">
                {activeVersion ? `使用中版本：${activeVersion.versionLabel}` : "尚未上傳正式版本（先建立分類，之後上傳即可套用）"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {canCreateVersion && (
                  <button
                    type="button"
                    className="text-xs text-ink-soft underline-offset-4 hover:underline"
                    onClick={() => setVersionModalFor(t)}
                  >
                    新增版本
                  </button>
                )}
                {category === "EXCEL" && (
                  <button
                    type="button"
                    className="text-xs text-ink-soft underline-offset-4 hover:underline"
                    onClick={() => handleDownloadBlank(t.id, t.name)}
                  >
                    下載空白範本
                  </button>
                )}
              </div>
              {t.versions.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 text-xs text-ink-faint">
                  {t.versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between">
                      <span>
                        {v.versionLabel}
                        {v.fileName && `（${v.fileName}）`}
                      </span>
                      {v.isActive ? (
                        <span className="text-sage-300">使用中</span>
                      ) : canActivateVersion ? (
                        <button type="button" className="underline-offset-4 hover:underline" onClick={() => handleActivate(t.id, v.id)}>
                          設為使用中
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {versionModalFor && (
        <AddVersionModal
          template={versionModalFor}
          onClose={() => setVersionModalFor(null)}
          onAdded={async () => {
            setVersionModalFor(null);
            showToast("已新增版本");
            await refresh();
          }}
        />
      )}

      <Toast visible={toastVisible} message={toastMessage} />
    </div>
  );
}

function AddVersionModal({
  template,
  onClose,
  onAdded,
}: {
  template: TemplateItem;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [versionLabel, setVersionLabel] = useState("");
  const [fileName, setFileName] = useState("");
  const [note, setNote] = useState("");
  const [activate, setActivate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!versionLabel.trim()) {
      setError("請輸入版本標籤");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${template.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionLabel: versionLabel.trim(), fileName: fileName || null, note: note || null, activate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "新增失敗");
        return;
      }
      onAdded();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`新增版本：${template.name}`} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <p className="text-xs text-ink-soft">
          沙盒環境無法真的上傳/儲存二進位檔案，這裡先記錄版本標籤／檔名／備註；真正上線後接檔案儲存服務即可，資料模型不用改。
        </p>
        <div>
          <label className={labelClass}>版本標籤</label>
          <input className={inputClass} value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="例如 2026-07-16" autoFocus />
        </div>
        <div>
          <label className={labelClass}>檔名（選填）</label>
          <input className={inputClass} value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="例如 光明燈燈牌.docx" />
        </div>
        <div>
          <label className={labelClass}>備註（選填）</label>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <label className={checkboxRowClass}>
          <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
          設為使用中版本
        </label>
        {error && <p className={errorTextClass}>{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={primaryButtonClass} disabled={submitting}>
            {submitting ? "新增中…" : "新增"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
