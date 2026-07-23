-- V14.2：新增收費來源列舉值 UNIVERSAL_SALVATION_TABLET（普渡四類牌位年度單價收費）。
--
-- ⚠️ 純附加、向下相容：只在既有 enum 追加一個值，不動任何資料表與資料。
-- 先前普渡四類牌位（超拔祖先／乙位正魂／累世冤親債主／無緣子女）雖有年度單價
-- 與 RitualRegistrationItem.amountDue，卻沒有對應的收款 adapter／來源列舉值，
-- 導致應收不進待收款、收款中心、首頁統計。此值補上，收款/收據沿用同一套流程。
ALTER TYPE "ReceivableSourceType" ADD VALUE IF NOT EXISTS 'UNIVERSAL_SALVATION_TABLET';
