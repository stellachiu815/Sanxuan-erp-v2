"use client";

import { useEffect, useState } from "react";
import { useOperator } from "@/lib/operatorClient";

type VersionResponse = {
  version: string;
  name: string;
  description?: string;
  migrations: { migration_name: string; finished_at: string | null }[];
};

/** 需求「系統版本」子頁面：目前版本號＋已套用的 migration 清單。 */
export default function VersionScreen() {
  const { operatorUserId } = useOperator();
  const [data, setData] = useState<VersionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorUserId) return;
    setLoading(true);
    fetch(`/api/system-center/version?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setError(d.error ?? "載入失敗");
          return;
        }
        setData(d);
      })
      .catch(() => setError("無法連線到伺服器"))
      .finally(() => setLoading(false));
  }, [operatorUserId]);

  return (
    <div className="flex flex-col gap-6">
      {loading && <p className="text-sm text-ink-faint">載入中…</p>}
      {error && <p className="text-sm text-blossom-600">{error}</p>}

      {data && (
        <>
          <div className="rounded-3xl bg-white/70 p-6 shadow-card">
            <h2 className="text-sm text-ink">目前版本</h2>
            <p className="mt-2 text-2xl text-ink">V{data.version}</p>
            {data.description && <p className="mt-1 text-xs text-ink-faint">{data.description}</p>}
          </div>

          <div className="rounded-3xl bg-white/70 p-6 shadow-card">
            <h2 className="text-sm text-ink">已套用的資料庫 Migration</h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-cream-200 text-xs text-ink-faint">
                  <th className="py-2">Migration 名稱</th>
                  <th className="py-2">完成時間</th>
                </tr>
              </thead>
              <tbody>
                {data.migrations.map((m) => (
                  <tr key={m.migration_name} className="border-b border-cream-100">
                    <td className="py-2 text-xs">{m.migration_name}</td>
                    <td className="py-2 text-xs text-ink-faint">
                      {m.finished_at ? new Date(m.finished_at).toLocaleString("zh-Hant") : "尚未完成"}
                    </td>
                  </tr>
                ))}
                {!data.migrations.length && (
                  <tr>
                    <td colSpan={2} className="py-4 text-center text-ink-faint">
                      查無 Migration 紀錄
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
