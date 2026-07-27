-- V16：普渡白米——年度「允許超量認購」開關（純新增、預設關閉、不改既有年度語意、不建新表）。
ALTER TABLE "temple_events" ADD COLUMN "riceAllowOverbook" BOOLEAN NOT NULL DEFAULT false;
