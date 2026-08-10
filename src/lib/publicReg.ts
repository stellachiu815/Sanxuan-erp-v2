import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { quickRegister, type QuickRegInput } from "@/lib/quickRegistration";
import { rosterRegister } from "@/lib/rosterRegister";
import type { Role } from "@/lib/permissions";

/**
 * V38 信眾公開報名（/join/[slug]）資料層＋確認轉正式。
 *
 * 表 public_reg_forms／public_registrations 由「一鍵建表」建立（ensurePublicRegTables）。
 * 沙盒無法 prisma generate，故一律以 raw SQL 存取（與 workOrderRepo 同做法）。
 *
 * 規則（Stella 定案）：
 *  - 每個活動一張報名表，網址 /join/[slug]（slug 可自訂，如「普渡115」）。
 *  - 信眾填 → 進「待確認（PENDING）」，**絕不自動變正式牌位**。
 *  - 廟方核對手寫本後按「確認」→ **直接自動轉正式**（重用 quickRegister，confirm:true）。
 *  - 生日等敏感欄位為選填。
 */

export type PublicRegFieldKey = "phone" | "address" | "birthday";
export type PublicFormPrices = { tablet: number; ricePerJin: number; sponsorPerUnit: number; pocket: number };
export type PublicFormConfig = { fields: PublicRegFieldKey[]; prices: PublicFormPrices };

// V38：寶袋單價可編輯，今年（115）預設 300／份；每年可在後台改。
export const DEFAULT_PRICES: PublicFormPrices = { tablet: 2500, ricePerJin: 32, sponsorPerUnit: 800, pocket: 300 };

export type PublicFormView = {
  id: string;
  slug: string;
  templeEventId: string;
  year: number | null;
  activityName: string;
  isOpen: boolean;
  headerNote: string | null;
  config: PublicFormConfig;
};

/** 信眾自填的內容（送出時的 payload；核對後才由 quickRegister 轉正式）。 */
export type PublicNamedTablet = { displayName: string; yangshang: string; tabletAddress: string };
export type PublicPayload = {
  registrant: { name: string; phone?: string | null; address?: string | null; birthday?: string | null };
  ancestors: PublicNamedTablet[];
  souls: PublicNamedTablet[];
  creditor: boolean;
  creditorYangshang?: string | null;
  unborn: { mainText: "無緣子女" | "本宅地基主"; yangshang?: string | null }[];
  riceKg?: number | null;
  sponsorQty?: number | null;
  sponsorName?: string | null;
  donationAmount?: number | null;
  donationName?: string | null;
  /** V38：整戶寶袋份數。 */
  pocketQty?: number | null;
  /** V38：供師（不進財務）姓名＋金額（自填）。 */
  masterName?: string | null;
  masterAmount?: number | null;
};

function normConfig(raw: unknown): PublicFormConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fields = Array.isArray(obj.fields)
    ? (obj.fields.filter((f) => f === "phone" || f === "address" || f === "birthday") as PublicRegFieldKey[])
    : [];
  const p = (obj.prices && typeof obj.prices === "object" ? obj.prices : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    fields,
    prices: {
      tablet: num(p.tablet, DEFAULT_PRICES.tablet),
      ricePerJin: num(p.ricePerJin, DEFAULT_PRICES.ricePerJin),
      sponsorPerUnit: num(p.sponsorPerUnit, DEFAULT_PRICES.sponsorPerUnit),
      pocket: num(p.pocket, DEFAULT_PRICES.pocket),
    },
  };
}

type FormRow = { id: string; slug: string; templeEventId: string; fieldsConfig: unknown; isOpen: boolean; headerNote: string | null };

async function eventInfo(templeEventId: string): Promise<{ year: number | null; name: string }> {
  const rows = await prisma.$queryRaw<{ year: number | null; name: string }[]>`
    SELECT "year", "name" FROM "temple_events" WHERE "id" = ${templeEventId} LIMIT 1`;
  return rows[0] ?? { year: null, name: "活動" };
}

function toView(row: FormRow, ev: { year: number | null; name: string }): PublicFormView {
  return {
    id: row.id,
    slug: row.slug,
    templeEventId: row.templeEventId,
    year: ev.year,
    activityName: ev.name,
    isOpen: row.isOpen,
    headerNote: row.headerNote,
    config: normConfig(row.fieldsConfig),
  };
}

/** 建立／更新某活動的報名表（一活動一張；slug 可自訂）。 */
export async function upsertPublicRegForm(input: {
  templeEventId: string;
  slug: string;
  config: PublicFormConfig;
  headerNote?: string | null;
  isOpen?: boolean;
  createdByName?: string | null;
}): Promise<{ ok: true; form: PublicFormView } | { ok: false; error: string }> {
  const slug = input.slug.trim();
  if (!slug) return { ok: false, error: "請輸入網址代碼（slug）" };
  if (!/^[\w一-龥-]{2,40}$/.test(slug)) return { ok: false, error: "網址代碼只能用中英文、數字、- 且 2~40 字" };

  // slug 不可與「別的活動」的表重複。
  const clash = await prisma.$queryRaw<{ id: string; templeEventId: string }[]>`
    SELECT "id", "templeEventId" FROM "public_reg_forms" WHERE "slug" = ${slug} LIMIT 1`;
  if (clash[0] && clash[0].templeEventId !== input.templeEventId) {
    return { ok: false, error: `網址代碼「${slug}」已被其他活動使用，請換一個` };
  }

  const configJson = JSON.stringify(input.config);
  const existing = await prisma.$queryRaw<FormRow[]>`
    SELECT "id","slug","templeEventId","fieldsConfig","isOpen","headerNote"
    FROM "public_reg_forms" WHERE "templeEventId" = ${input.templeEventId} LIMIT 1`;

  if (existing[0]) {
    await prisma.$executeRawUnsafe(
      `UPDATE "public_reg_forms" SET "slug"=$1, "fieldsConfig"=$2::jsonb, "headerNote"=$3, "isOpen"=$4, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$5`,
      slug, configJson, input.headerNote ?? null, input.isOpen ?? true, existing[0].id
    );
    const ev = await eventInfo(input.templeEventId);
    return { ok: true, form: toView({ ...existing[0], slug, isOpen: input.isOpen ?? true, headerNote: input.headerNote ?? null, fieldsConfig: input.config }, ev) };
  }

  const id = `prf_${randomUUID()}`;
  // 明確帶 createdAt／updatedAt：這兩張表由 Prisma 建立，updatedAt 為 @updatedAt（無 DB 預設），
  //   raw SQL 不補會踩 NOT NULL（23502）。
  await prisma.$executeRawUnsafe(
    `INSERT INTO "public_reg_forms" ("id","templeEventId","slug","fieldsConfig","isOpen","headerNote","createdByName","createdAt","updatedAt") VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id, input.templeEventId, slug, configJson, input.isOpen ?? true, input.headerNote ?? null, input.createdByName ?? null
  );
  const ev = await eventInfo(input.templeEventId);
  return { ok: true, form: toView({ id, slug, templeEventId: input.templeEventId, fieldsConfig: input.config, isOpen: input.isOpen ?? true, headerNote: input.headerNote ?? null }, ev) };
}

export async function getPublicFormBySlug(slug: string): Promise<PublicFormView | null> {
  const rows = await prisma.$queryRaw<FormRow[]>`
    SELECT "id","slug","templeEventId","fieldsConfig","isOpen","headerNote"
    FROM "public_reg_forms" WHERE "slug" = ${slug} LIMIT 1`;
  if (!rows[0]) return null;
  return toView(rows[0], await eventInfo(rows[0].templeEventId));
}

export async function getPublicFormByEvent(templeEventId: string): Promise<PublicFormView | null> {
  const rows = await prisma.$queryRaw<FormRow[]>`
    SELECT "id","slug","templeEventId","fieldsConfig","isOpen","headerNote"
    FROM "public_reg_forms" WHERE "templeEventId" = ${templeEventId} LIMIT 1`;
  if (!rows[0]) return null;
  return toView(rows[0], await eventInfo(rows[0].templeEventId));
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** 信眾送出報名（免登入）：驗證＋防重複＋寫入 PENDING。 */
export async function submitPublicRegistration(
  slug: string,
  payload: PublicPayload,
  submitterHash: string | null
): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const form = await getPublicFormBySlug(slug);
  if (!form) return { ok: false, status: 404, error: "找不到這個報名網址" };
  if (!form.isOpen) return { ok: false, status: 409, error: "這個活動目前未開放線上報名" };

  const name = s(payload?.registrant?.name);
  if (!name) return { ok: false, status: 400, error: "請填寫報名人姓名" };
  const anySelected =
    (payload.ancestors ?? []).some((a) => s(a.displayName)) ||
    (payload.souls ?? []).some((a) => s(a.displayName)) ||
    payload.creditor ||
    (payload.unborn ?? []).length > 0 ||
    Number(payload.riceKg) > 0 || Number(payload.sponsorQty) > 0 || Number(payload.donationAmount) > 0 ||
    Number(payload.pocketQty) > 0 || !!s(payload.masterName);
  if (!anySelected) return { ok: false, status: 400, error: "請至少選擇一項要報名的項目" };

  // 防重複送出：同一 form＋同 submitterHash，最近 30 秒內已送過 → 擋（避免連點重送）。
  if (submitterHash) {
    const dup = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "public_registrations"
      WHERE "formId" = ${form.id} AND "submitterHash" = ${submitterHash}
        AND "createdAt" > (CURRENT_TIMESTAMP - INTERVAL '30 seconds')`;
    if (Number(dup[0]?.n ?? 0) > 0) return { ok: false, status: 429, error: "剛剛已送出過，請稍候再試（避免重複報名）" };
  }

  const id = `prg_${randomUUID()}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "public_registrations" ("id","formId","status","payload","submitterHash","createdAt","updatedAt") VALUES ($1,$2,'PENDING',$3::jsonb,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id, form.id, JSON.stringify(payload), submitterHash
  );
  return { ok: true, id };
}

// ── 名單型（贊普型）公開報名：補庫／宮燈等。信眾自己填名單 → PENDING → 廟方一鍵建檔+確認。 ──
export type PublicRosterPerson = { name: string; phone?: string | null; address?: string | null; solarBirthDate?: string | null; quantity?: number | null };
export type PublicRosterPayload = { kind: "ROSTER"; people: PublicRosterPerson[] };

/** 名單型公開報名送出（免登入）：驗證＋防重複＋寫入 PENDING（payload.kind = "ROSTER"）。 */
export async function submitPublicRosterRegistration(
  slug: string,
  payload: PublicRosterPayload,
  submitterHash: string | null
): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const form = await getPublicFormBySlug(slug);
  if (!form) return { ok: false, status: 404, error: "找不到這個報名網址" };
  if (!form.isOpen) return { ok: false, status: 409, error: "這個活動目前未開放線上報名" };

  const people = (payload?.people ?? []).filter((p) => s(p.name));
  if (people.length === 0) return { ok: false, status: 400, error: "請至少填一位報名者姓名" };
  if (people.length > 20) return { ok: false, status: 400, error: "一次最多 20 位，請分批報名" };

  if (submitterHash) {
    const dup = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "public_registrations"
      WHERE "formId" = ${form.id} AND "submitterHash" = ${submitterHash}
        AND "createdAt" > (CURRENT_TIMESTAMP - INTERVAL '30 seconds')`;
    if (Number(dup[0]?.n ?? 0) > 0) return { ok: false, status: 429, error: "剛剛已送出過，請稍候再試（避免重複報名）" };
  }

  const stored: PublicRosterPayload = {
    kind: "ROSTER",
    people: people.map((p) => ({
      name: s(p.name) as string,
      phone: s(p.phone),
      address: s(p.address),
      solarBirthDate: s(p.solarBirthDate),
      quantity: Number(p.quantity) > 0 ? Math.floor(Number(p.quantity)) : 1,
    })),
  };
  const id = `prg_${randomUUID()}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "public_registrations" ("id","formId","status","payload","submitterHash","createdAt","updatedAt") VALUES ($1,$2,'PENDING',$3::jsonb,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id, form.id, JSON.stringify(stored), submitterHash
  );
  return { ok: true, id };
}

// ── 年度燈（光明／太歲燈）公開報名：信眾自己填 → PENDING → 廟方一鍵建檔+確認。 ──
export type PublicLanternPerson = {
  name: string; phone?: string | null; address?: string | null; solarBirthDate?: string | null;
  lanterns: { itemKey: "LANTERN_GUANGMING" | "LANTERN_TAISUI"; quantity?: number | null }[];
};
export type PublicLanternPayload = { kind: "LANTERN"; people: PublicLanternPerson[] };

/** 年度燈公開報名送出（免登入）：驗證＋防重複＋寫入 PENDING（payload.kind = "LANTERN"）。 */
export async function submitPublicLanternRegistration(
  slug: string,
  payload: PublicLanternPayload,
  submitterHash: string | null
): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const form = await getPublicFormBySlug(slug);
  if (!form) return { ok: false, status: 404, error: "找不到這個報名網址" };
  if (!form.isOpen) return { ok: false, status: 409, error: "這個活動目前未開放線上報名" };

  const validKeys = new Set(["LANTERN_GUANGMING", "LANTERN_TAISUI"]);
  const people = (payload?.people ?? [])
    .map((p) => ({
      ...p,
      lanterns: (p.lanterns ?? []).filter((l) => validKeys.has(l.itemKey)),
    }))
    // 點燈必填：姓名、生日、地址，且至少一種燈。
    .filter((p) => s(p.name) && s(p.address) && s(p.solarBirthDate) && p.lanterns.length > 0);
  if (people.length === 0) return { ok: false, status: 400, error: "每位都要填姓名、生日、地址，並至少選一種燈" };
  if (people.length > 20) return { ok: false, status: 400, error: "一次最多 20 位，請分批報名" };

  if (submitterHash) {
    const dup = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "public_registrations"
      WHERE "formId" = ${form.id} AND "submitterHash" = ${submitterHash}
        AND "createdAt" > (CURRENT_TIMESTAMP - INTERVAL '30 seconds')`;
    if (Number(dup[0]?.n ?? 0) > 0) return { ok: false, status: 429, error: "剛剛已送出過，請稍候再試（避免重複報名）" };
  }

  const stored: PublicLanternPayload = {
    kind: "LANTERN",
    people: people.map((p) => ({
      name: s(p.name) as string,
      phone: s(p.phone),
      address: s(p.address),
      solarBirthDate: s(p.solarBirthDate),
      lanterns: p.lanterns.map((l) => ({ itemKey: l.itemKey, quantity: Number(l.quantity) > 0 ? Math.floor(Number(l.quantity)) : 1 })),
    })),
  };
  const id = `prg_${randomUUID()}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "public_registrations" ("id","formId","status","payload","submitterHash","createdAt","updatedAt") VALUES ($1,$2,'PENDING',$3::jsonb,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    id, form.id, JSON.stringify(stored), submitterHash
  );
  return { ok: true, id };
}

export type PublicRegRow = {
  id: string;
  status: string;
  payload: PublicPayload;
  createdAt: string;
  confirmedAt: string | null;
  note: string | null;
};

/** 後台待確認清單（依 slug 或活動；預設只列 PENDING）。 */
export async function listPublicRegistrations(opts: { slug?: string; templeEventId?: string; status?: string }): Promise<{ form: PublicFormView | null; rows: PublicRegRow[] }> {
  const form = opts.slug ? await getPublicFormBySlug(opts.slug) : opts.templeEventId ? await getPublicFormByEvent(opts.templeEventId) : null;
  if (!form) return { form: null, rows: [] };
  const status = opts.status ?? "PENDING";
  const rows = await prisma.$queryRawUnsafe<{ id: string; status: string; payload: unknown; createdAt: Date; confirmedAt: Date | null; note: string | null }[]>(
    `SELECT "id","status","payload","createdAt","confirmedAt","note" FROM "public_registrations"
     WHERE "formId"=$1 ${status === "ALL" ? "" : `AND "status"=$2`} ORDER BY "createdAt" ASC`,
    ...(status === "ALL" ? [form.id] : [form.id, status])
  );
  return {
    form,
    rows: rows.map((r) => ({
      id: r.id,
      status: r.status,
      payload: (r.payload && typeof r.payload === "object" ? r.payload : {}) as PublicPayload,
      createdAt: r.createdAt.toISOString(),
      confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
      note: r.note,
    })),
  };
}

const splitYang = (v: string | null | undefined): string[] =>
  (v ?? "").split(/[,、，\s]+/).map((x) => x.trim()).filter(Boolean);

/** 廟方確認一筆 → 直接轉正式（重用 quickRegister，confirm:true）。 */
export async function confirmPublicRegistration(
  id: string,
  operator: { id: string; name: string; role: Role }
): Promise<{ ok: true; ritualRecordId: string } | { ok: false; status: number; error: string }> {
  const rows = await prisma.$queryRaw<{ id: string; status: string; payload: unknown; formId: string; templeEventId: string }[]>`
    SELECT pr."id", pr."status", pr."payload", pr."formId", f."templeEventId"
    FROM "public_registrations" pr JOIN "public_reg_forms" f ON f."id" = pr."formId"
    WHERE pr."id" = ${id} LIMIT 1`;
  const rec = rows[0];
  if (!rec) return { ok: false, status: 404, error: "找不到這筆報名" };
  if (rec.status === "CONFIRMED") return { ok: false, status: 409, error: "這筆已經確認過了" };
  const payloadObj = (rec.payload && typeof rec.payload === "object" ? rec.payload : {}) as Record<string, unknown>;

  // 名單型（補庫／宮燈）：走 rosterRegister（選人一人一份固定價、新信眾建檔、直接確認）。
  if (payloadObj.kind === "ROSTER") {
    const rp = payloadObj as unknown as PublicRosterPayload;
    const res = await rosterRegister(
      {
        templeEventId: rec.templeEventId,
        people: (rp.people ?? []).map((p) => ({
          name: p.name,
          phone: p.phone ?? null,
          address: p.address ?? null,
          birthdayType: p.solarBirthDate ? ("SOLAR" as const) : null,
          solarBirthDate: p.solarBirthDate ?? null,
          quantity: p.quantity ?? 1,
        })),
        confirm: true,
      },
      operator
    );
    if (!res.ok) return { ok: false, status: res.status, error: res.error };
    await prisma.$executeRawUnsafe(
      `UPDATE "public_registrations" SET "status"='CONFIRMED', "confirmedAt"=CURRENT_TIMESTAMP, "confirmedByName"=$1, "note"=$2, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3`,
      operator.name, `已轉正式報名（${res.ritualRecordIds.length} 戶）`, id
    );
    return { ok: true, ritualRecordId: res.ritualRecordIds[0] ?? "" };
  }

  // 年度燈（光明／太歲燈）：走 annualLanternRosterRegister（選人、每人選燈、新信眾建檔、直接確認）。
  if (payloadObj.kind === "LANTERN") {
    const { annualLanternRosterRegister } = await import("@/lib/annualLanternRegister");
    const lp = payloadObj as unknown as PublicLanternPayload;
    const res = await annualLanternRosterRegister(
      {
        templeEventId: rec.templeEventId,
        people: (lp.people ?? []).map((p) => ({
          name: p.name,
          phone: p.phone ?? null,
          address: p.address ?? null,
          solarBirthDate: p.solarBirthDate ?? null,
          lanterns: (p.lanterns ?? []).map((l) => ({ itemKey: l.itemKey, quantity: l.quantity ?? 1 })),
        })),
        confirm: true,
      },
      operator
    );
    if (!res.ok) return { ok: false, status: res.status, error: res.error };
    await prisma.$executeRawUnsafe(
      `UPDATE "public_registrations" SET "status"='CONFIRMED', "confirmedAt"=CURRENT_TIMESTAMP, "confirmedByName"=$1, "note"=$2, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3`,
      operator.name, `已轉正式點燈報名（${res.ritualRecordIds.length} 戶）`, id
    );
    return { ok: true, ritualRecordId: res.ritualRecordIds[0] ?? "" };
  }

  const payload = payloadObj as unknown as PublicPayload;

  const input: QuickRegInput = {
    templeEventId: rec.templeEventId,
    registrant: { name: s(payload.registrant?.name), address: s(payload.registrant?.address) },
    ancestors: (payload.ancestors ?? []).filter((a) => s(a.displayName)).map((a) => ({ displayName: a.displayName, yangshangNames: splitYang(a.yangshang), tabletAddress: s(a.tabletAddress) })),
    individualSouls: (payload.souls ?? []).filter((a) => s(a.displayName)).map((a) => ({ displayName: a.displayName, yangshangNames: splitYang(a.yangshang), tabletAddress: s(a.tabletAddress) })),
    creditor: payload.creditor ? { include: true, yangshangNames: splitYang(payload.creditorYangshang) } : null,
    unborn: (payload.unborn ?? []).map((u) => ({ mainText: u.mainText === "本宅地基主" ? "本宅地基主" : "無緣子女", yangshangNames: splitYang(u.yangshang) })),
    riceKg: Number(payload.riceKg) > 0 ? Number(payload.riceKg) : null,
    sponsorQty: Number(payload.sponsorQty) > 0 ? Math.floor(Number(payload.sponsorQty)) : null,
    sponsorName: s(payload.sponsorName),
    donationAmount: Number(payload.donationAmount) > 0 ? Math.round(Number(payload.donationAmount)) : null,
    donationName: s(payload.donationName),
    pocketQty: Number(payload.pocketQty) > 0 ? Math.floor(Number(payload.pocketQty)) : null,
    confirm: true,
  };
  const res = await quickRegister(input, operator);
  if (!res.ok) return { ok: false, status: res.status, error: res.error };

  // V38 供師（不進財務）：若公開填了供師姓名，轉正式時一併登入供師名單。
  const masterName = s(payload.masterName);
  if (masterName) {
    const ev = await eventInfo(rec.templeEventId);
    if (ev.year != null) {
      try {
        const { addMasterOffering } = await import("@/lib/masterOffering");
        await addMasterOffering({ year: ev.year, name: masterName, amount: Number(payload.masterAmount) || 0, operatorName: operator.name });
      } catch { /* 供師另存失敗不影響主報名 */ }
    }
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "public_registrations" SET "status"='CONFIRMED', "confirmedAt"=CURRENT_TIMESTAMP, "confirmedByName"=$1, "note"=$2, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3`,
    operator.name, `已轉正式報名（${res.ritualRecordId}）`, id
  );
  return { ok: true, ritualRecordId: res.ritualRecordId };
}

/** 廟方作廢一筆（不轉正式）。 */
export async function rejectPublicRegistration(id: string, operatorName: string): Promise<{ ok: boolean }> {
  await prisma.$executeRawUnsafe(
    `UPDATE "public_registrations" SET "status"='REJECTED', "confirmedByName"=$1, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2 AND "status"='PENDING'`,
    operatorName, id
  );
  return { ok: true };
}
