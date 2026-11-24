-- PetskySign: the identity check before signing. The caller (petsky) sends
-- the signer's CPF; the signer must type their full name and the same CPF
-- before the document opens. The CPF is kept only as a keyed hash, so a
-- leaked database cannot be searched for it by trying every CPF, plus a
-- masked hint for the audit trail ("078.***.***-89").

alter table public.signers
  add column if not exists identity_cpf_hash text
    check (identity_cpf_hash is null or length(identity_cpf_hash) = 64),
  add column if not exists identity_cpf_hint text
    check (identity_cpf_hint is null or length(identity_cpf_hint) = 14),
  add column if not exists identity_attempts integer not null default 0
    check (identity_attempts >= 0);
