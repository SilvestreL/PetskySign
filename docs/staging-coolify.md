# Staging do PetskySign (Coolify) + petsky (Preview da Vercel)

Roteiro para testar o PetskySign de ponta a ponta com o app petsky antes de qualquer casa usar. O PetskySign sobe na VPS da Petsky, pelo Coolify, em `assinar-staging.petsky.com.br`. O petsky usa o Preview da branch `staging` (`https://petsky-git-staging-silvestrels-projects.vercel.app`), depois que o PR de contratos (`feat/contratos-petskysign`) entrar nela.

Só a `staging` tem Preview funcionando: as chaves do Clerk de Preview estão restritas a ela, e o Preview de qualquer outra branch responde 500 em `/app` (`docs/environments.md` do `petsky`). Por isso o código precisa entrar na `staging`, e as variáveis abaixo valem para ela.

Decisão do lado da infra: **DEC-025** do `petsky-infra`. Vale só para staging, com **dados de teste**. Contrato de tutor de verdade na VPS pede outra decisão (ver "Saída" no fim).

Tempo estimado: 1h a 2h, a maior parte esperando build e DNS.

---

## 0. Antes de começar

Separe:

- Acesso ao painel do Coolify (`coolify.petsky.com.br` ou pela tailnet).
- Acesso ao DNS da zona `petsky.com.br` no Cloudflare.
- Acesso ao projeto do petsky na Vercel.
- Uma chave da Resend (pode ser a do onboarding). O PetskySign exige e-mail de verdade fora de localhost, mesmo que no canal `link` o tutor não receba nenhum: a conta de integração recebe os avisos de conclusão. Sem domínio verificado, a Resend só entrega para o e-mail dono da conta Resend. Para staging isso basta, desde que a conta de integração use esse e-mail.

Gere os segredos numa máquina sua (nunca cole em chat):

```bash
openssl rand -hex 32   # BETTER_AUTH_SECRET
```

```bash
openssl rand -hex 24   # RETENTION_JOB_SECRET
```

```bash
openssl rand -hex 16   # SETUP_TOKEN
```

---

## 1. Banco (Coolify)

1. Crie o projeto **PetskySign (staging)**.
2. Em **New Resource → Database → PostgreSQL**, use a imagem `postgres:17-alpine` (tem ARM) e o nome `petskysign-db`.
3. Não publique porta. Anote a **Postgres URL (internal)**: ela vira o `DATABASE_URL` do app.

## 2. App (Coolify)

1. Em **New Resource → Application**, aponte para o repositório `SilvestreL/PetskySign` (pela GitHub App do Coolify, se o repo for privado).
   - Branch: `feat/api-v1`, até o PR ser mergeado. Depois, `main`.
   - **Build Pack: Dockerfile.** Usa o `Dockerfile` da raiz, com Node 24, migrations ao subir e app rodando como usuário sem privilégio.
2. **Domínio:** `https://assinar-staging.petsky.com.br`. **Porta:** `3000`.
3. **Persistent Storage:** volume montado em `/app/.data`. É onde ficam os PDFs, os assinados e os certificados. Sem volume, a prova some a cada deploy.
4. **Limites:** 1 CPU e 1,5 GB de RAM bastam para staging.
5. **Variáveis:**

   | Variável                     | Valor                                   | Observação                                                              |
   | ---------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
   | `NEXT_PUBLIC_APP_LOCALE`     | `pt-BR`                                 | Marque **Build Variable**: é lida no build                              |
   | `APP_URL`                    | `https://assinar-staging.petsky.com.br` |                                                                         |
   | `DATABASE_URL`               | a URL interna do passo 1                |                                                                         |
   | `BETTER_AUTH_SECRET`         | o `openssl rand -hex 32`                | **Obrigatória.** Sem ela, o selo dos PDFs falha                         |
   | `RESEND_API_KEY`             | a chave da Resend                       |                                                                         |
   | `RETENTION_JOB_SECRET`       | o `openssl rand -hex 24`                | Fecha `/api/internal/retention` e `/api/internal/webhooks`              |
   | `SETUP_TOKEN`                | o `openssl rand -hex 16`                | Protege o `/setup` da primeira vez                                      |
   | `TRUSTED_CLIENT_IP_HEADER`   | `cf-connecting-ip`                      | Atrás do Cloudflare, o único IP confiável para o histórico e os limites |
   | `PETSKY_COMPANY_DAILY_LIMIT` | `50`                                    | Opcional                                                                |

   Sem `SEAL_P12_*`, o selo é autogerado. Para staging isso basta; o e-CNPJ entra na produção.

6. Faça o **Deploy**. O healthcheck do Dockerfile (`/icon.svg`) precisa ficar verde. O primeiro build leva alguns minutos no ARM.

## 3. Domínio (Cloudflare)

Registro **A** `assinar-staging` → `129.80.168.107`, com **proxy laranja**. O SSL continua **Full (strict)**: o Traefik emite o certificado Let's Encrypt sozinho.

Não crie regra de desafio para esse domínio. O petsky (servidor da Vercel) chama a API dele, e um desafio barraria essas chamadas. A proteção vem da chave de API e dos limites do próprio app.

## 4. Tarefas agendadas (Coolify → app → Scheduled Tasks)

| Nome       | Frequência (UTC) | Comando                                                                                                                                                                                                        |
| ---------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhooks` | `* * * * *`      | `node -e "fetch('http://127.0.0.1:3000/api/internal/webhooks',{method:'POST',headers:{authorization:'Bearer '+process.env.RETENTION_JOB_SECRET}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"` |
| `retencao` | `0 9 * * *`      | o mesmo comando, com `/api/internal/retention`                                                                                                                                                                 |

A de webhooks refaz as entregas que falharam. A de retenção expira prazos (aviso `document.expired`) e limpa rascunhos. A falha de uma tarefa já gera alerta no WhatsApp, pelo Coolify → n8n.

## 5. Backup (Coolify, mesmo dia em que sobe)

Configure a **retenção antes** de ligar o S3, porque editar depois desliga o toggle do S3. Use 3 cópias locais e 30 dias no R2, como os outros serviços.

| Hora (Maceió) | Cron (UTC)  | O quê                                                   |
| ------------- | ----------- | ------------------------------------------------------- |
| 04:00         | `0 7 * * *` | Postgres `petskysign-db` (`pg_dump`) → R2 `vps-backups` |
| 04:05         | `5 7 * * *` | Volume `/app/.data` → R2 `vps-backups`                  |

Depois do primeiro backup, **teste a restauração** do banco num Postgres descartável. A prova de uma assinatura é o banco **e** o volume juntos.

## 6. Primeira configuração do PetskySign

1. Abra `https://assinar-staging.petsky.com.br/setup` e informe o `SETUP_TOKEN`.
   - Organização: `Petsky (staging)`.
   - Administrador: a **conta de integração**, com o e-mail que recebe os avisos (veja a nota da Resend no passo 0).
2. Em **Settings → Organization**, coloque a URL da política de privacidade do petsky. O link "Privacidade" da tela do tutor passa a apontar para ela.
3. No **Terminal** do app no Coolify, crie a chave:

   ```bash
   npm run api-key -- create --email <conta-de-integracao> --name "petsky preview"
   ```

   Guarde o `psk_...` e o id da chave. A chave não é mostrada de novo.

## 7. Preview do petsky (Vercel, branch `staging`)

0. Faça o merge, na `staging`, do PR de contratos do `petsky` (`feat/contratos-petskysign` → `staging`). O push na `staging` gera o Preview.
1. Em **Settings → Deployment Protection → Protection Bypass for Automation**, gere o segredo de bypass. Sem ele, o webhook do PetskySign leva 401 da proteção da Vercel.
2. Ainda no Terminal do Coolify, cadastre o webhook na **URL fixa da `staging`**, não na de um deploy:

   ```bash
   npm run api-key -- webhook <id-da-chave> --url "https://petsky-git-staging-silvestrels-projects.vercel.app/api/webhooks/petskysign?x-vercel-protection-bypass=<segredo-do-bypass>"
   ```

   Guarde o `whsec_...`.

3. Em **Settings → Environment Variables**, escopo **Preview**, só na branch `staging`. Com `CONTRACT_PROVIDER=petskysign`, **todo envio de contrato no staging** passa pelo PetskySign. Avise quem mais testa no staging, ou tire a variável quando o teste acabar.

   | Variável                    | Valor                                             |
   | --------------------------- | ------------------------------------------------- |
   | `CONTRACT_PROVIDER`         | `petskysign`                                      |
   | `PETSKYSIGN_URL`            | `https://assinar-staging.petsky.com.br`           |
   | `PETSKYSIGN_API_KEY`        | o `psk_...`                                       |
   | `PETSKYSIGN_WEBHOOK_SECRET` | o `whsec_...`                                     |
   | `PETSKYSIGN_SANDBOX`        | `true` (os contratos saem marcados como de teste) |

4. Faça **Redeploy** do Preview da `staging` para as variáveis valerem.

## 8. Roteiro de teste

Use uma empresa de teste no Preview da `staging`. Ela precisa de logo e telefone no cadastro, para conferir a marca. Use também um tutor de teste com o seu celular.

| #   | Faça                                                          | Confira                                                                                          |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Contratos → enviar pelo canal **Link**                        | O contrato aparece como **Enviado**, com o link para copiar                                      |
| 2   | Abra o link no celular                                        | Nome e logo da casa, tudo em pt-BR, termo citando a MP 2.200-2, a Lei 14.063 e a LGPD            |
| 3   | Só abra, sem assinar                                          | Em até 1 min, o contrato vira **Visto** no petsky, sem clicar em Atualizar (webhook)             |
| 4   | Aceite o termo e assine desenhando                            | A tela final diz que a casa vai enviar o documento                                               |
| 5   | No petsky, abra o PDF assinado                                | O PDF é o selado. No Acrobat, o selo aparece como "validade desconhecida" (autogerado, esperado) |
| 6   | Envie outro e **Cancele** no petsky                           | O link no celular mostra "Este link expirou"                                                     |
| 7   | Envie pelo canal **WhatsApp**                                 | Recusado com "Escolha Link e mande pela conversa da casa"                                        |
| 8   | No Terminal do Coolify: `npm run api-key -- deliveries`       | Todas as entregas `delivered`, nenhuma `failed`                                                  |
| 9   | Copie um PDF assinado para o computador: `pdfsig arquivo.pdf` | `Signature is Valid`                                                                             |
| 10  | Pare o Preview (ou tire a variável do webhook) e assine outro | A entrega fica `pending`, e depois que o Preview volta, a tarefa `webhooks` entrega              |

Anote o que estranhar, principalmente no celular: textos, tempo de carregamento e o desenho da assinatura.

## 9. Depois que subir: documentar no `petsky-infra` (mesmo commit)

Conforme a skill `novo-servico-coolify`:

- **`ARCHITECTURE.md`:**
  - linha `assinar-staging.petsky.com.br` na tabela de domínios;
  - seção do serviço com o id do Coolify;
  - imagem `postgres:17-alpine` em "Versões";
  - linhas novas na tabela de backup.
- **`CURRENT_SCOPE.md`:** de "Pendente" para "No ar (staging)".
- **`painel/index.html`:** atalho para o PetskySign (staging).
- **Diagrama do `README.md`.**

## Saída

O staging sai quando o piloto acabar, por qualquer um dos dois caminhos:

- **Não seguir:** apague o app, o banco e os backups no Coolify, o registro DNS e as variáveis do Preview na Vercel. Mude o status da DEC-025 para encerrada.
- **Seguir para produção:** antes, registre uma decisão nova no `petsky-infra`. Hoje a VPS **não guarda dado de cliente do app como fonte de verdade**, e os contratos assinados seriam exatamente isso. A decisão precisa cobrir:
  - LGPD;
  - backup com restauração testada;
  - disponibilidade, com a D4Sign como reserva;
  - e-CNPJ no selo;
  - revisão jurídica do termo.
