-- V40：補上兩個 ReceivableSourceType enum 值。
--
-- 新式贊普（US_SPONSOR／US_SPONSOR_DONATION）與新式增加寶袋（US_POCKET_EXTRA）的收費 adapter
-- 早已用這兩個 sourceType 產生應收、進待收款/收款中心，但 enum 先前漏加 → 一旦要對它們收款，
-- 建 PaymentAllocation 就會噴「Invalid value for argument sourceType. Expected ReceivableSourceType」。
-- 只加不刪、不動既有資料，比照既有 ADD VALUE 慣例，單獨成一支。
ALTER TYPE "ReceivableSourceType" ADD VALUE IF NOT EXISTS 'UNIVERSAL_SALVATION_SPONSOR_ITEM';
ALTER TYPE "ReceivableSourceType" ADD VALUE IF NOT EXISTS 'UNIVERSAL_SALVATION_POCKET_ITEM';
