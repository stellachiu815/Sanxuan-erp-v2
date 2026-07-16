"use client";

import { useOperator, roleLabel } from "@/lib/operatorClient";

/**
 * 「目前操作人員」選擇列（V11.1.1 新增）。
 *
 * 放在收據中心各頁面最上方（不含正式列印頁，列印頁需要維持乾淨版面，
 * 詳見交付報告）。使用者從下拉選單選出自己是誰之後，這個 userId 會存進
 * localStorage，畫面上的開立/列印/作廢/換開等按鈕都會帶上這個 userId 呼叫
 * API，由伺服器端真正驗證權限（見 src/lib/operator.ts）。
 */
export default function OperatorBar() {
  const { operatorUserId, operatorUser, users, loading, error, setOperatorUserId } = useOperator();

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-white/70 px-4 py-3 text-sm shadow-soft">
      <span className="text-ink-faint">目前操作人員：</span>
      {loading ? (
        <span className="text-ink-faint">載入中…</span>
      ) : error ? (
        <span className="text-blossom-300">{error}</span>
      ) : (
        <select
          value={operatorUserId ?? ""}
          onChange={(e) => setOperatorUserId(e.target.value || null)}
          className="min-h-9 rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink"
        >
          <option value="">－ 請選擇 －</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}（{roleLabel[u.role] ?? u.role}）
            </option>
          ))}
        </select>
      )}
      {operatorUser && (
        <span className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink-soft">
          角色：{roleLabel[operatorUser.role] ?? operatorUser.role}
        </span>
      )}
      {!loading && !operatorUserId && (
        <span className="text-xs text-blossom-300">尚未選擇操作人員，開立/列印/作廢等操作都會被伺服器拒絕</span>
      )}
    </div>
  );
}
