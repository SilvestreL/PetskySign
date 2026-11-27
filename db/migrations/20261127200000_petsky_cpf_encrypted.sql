-- PetskySign: the full CPF, encrypted with a key outside the database
-- (AES-256-GCM, cpf.ts), so the signed contract's certificate can show it, as
-- D4Sign's does: many contracts name the tutor only "by the name and CPF on
-- the signatures page". The hash and the masked hint stay for the check and
-- the screens.

alter table public.signers
  add column if not exists identity_cpf_encrypted text;
