import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { PublicDocumentShell } from "@/components/layout/public-document-shell";
import { getSettings } from "@/lib/settings";
import { STALE_DRAFT_RETENTION_DAYS } from "@/lib/retention";

export const metadata: Metadata = {
  description:
    "Como seus dados são usados quando você assina um documento aqui.",
  title: "Privacidade de quem assina",
};

// PetskySign: aviso de privacidade (LGPD, art. 9º) para quem assina, montado
// com as configurações da instalação. Aparece no rodapé quando a empresa não
// ligou a própria política. A empresa continua sendo a controladora e deve
// revisar o texto.
export default async function SignerPrivacyPage() {
  await connection();

  const settings = await getSettings();

  if (settings.hosted) {
    redirect("/privacy");
  }

  if (settings.privacyUrl) {
    redirect(settings.privacyUrl);
  }

  const organization =
    settings.organizationName?.trim() || "A empresa que usa este site";
  const contact = settings.supportAddress;
  const retention = settings.retentionDays
    ? `Os documentos concluídos e o histórico deles são apagados ${String(settings.retentionDays)} dias depois da conclusão.`
    : "Os documentos concluídos e o histórico deles ficam guardados até a empresa apagá-los, porque provam o acordo e muitos precisam ser guardados por anos, por lei.";

  return (
    <PublicDocumentShell
      description={`${organization} usa este site para enviar documentos para assinatura eletrônica. Este aviso explica quais dados seus são coletados quando você assina, para quê, e o que você pode fazer.`}
      lastUpdated="2026-11-27"
      title="Privacidade de quem assina"
    >
      <section className="space-y-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-(--fg)">
          Quem é responsável
        </h2>
        <p>
          {organization} é responsável pelos seus dados (a
          &ldquo;controladora&rdquo;, na LGPD).{" "}
          {contact ? (
            <>
              Fale com ela em{" "}
              <a className="underline" href={`mailto:${contact}`}>
                {contact}
              </a>
              .
            </>
          ) : (
            "Fale com ela pela mesma conversa em que recebeu o documento."
          )}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-(--fg)">
          O que é coletado
        </h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Seu nome e, quando a empresa informa, seu e-mail e seu celular.
          </li>
          <li>
            Seu CPF, quando a empresa pede a confirmação de identidade. Ele não
            fica guardado por inteiro: guardamos só uma impressão digital dele,
            para conferir o que você digita, e uma versão mascarada (como
            529.***.***-25) para o histórico.
          </li>
          <li>
            O que você preenche: assinatura ou rubrica (digitada ou desenhada),
            datas, textos e caixas marcadas, ou o motivo de recusar.
          </li>
          <li>
            A prova da assinatura: quando você abriu, concordou e assinou, o
            endereço IP, o navegador, a localização aproximada (e a exata, se
            você permitir) e as confirmações que você passou, como o código por
            WhatsApp.
          </li>
          <li>As mensagens enviadas a você sobre o documento.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-(--fg)">
          Para quê, e com que base
        </h2>
        <p>
          Para você ler e assinar o documento, receber sua cópia e para guardar
          a prova de quem assinou o quê e quando. As bases legais são a execução
          do contrato do qual você faz parte (LGPD, art. 7º, V), o cumprimento
          de obrigação legal de guardar registros (art. 7º, II) e o exercício de
          direitos em processo, caso o acordo precise ser provado (art. 7º, VI).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-(--fg)">
          Quem mais tem acesso
        </h2>
        <p>
          As outras pessoas que assinam o documento veem seu nome e sua
          assinatura. Os serviços que mantêm este site funcionando tratam os
          dados em nome de {organization}: o servidor e o banco de dados onde o
          site roda, o armazenamento dos arquivos e os serviços que enviam
          e-mail e WhatsApp. Eles só usam os dados para prestar esse serviço.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-(--fg)">
          Por quanto tempo
        </h2>
        <p>
          {retention} Rascunhos que não foram enviados são apagados depois de{" "}
          {String(STALE_DRAFT_RETENTION_DAYS)} dias sem alteração.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-(--fg)">
          Seus direitos
        </h2>
        <p>
          Você pode pedir a {organization} a confirmação de que seus dados são
          tratados, uma cópia deles, a correção, a anonimização ou a exclusão, e
          informações sobre com quem eles são compartilhados (LGPD, art. 18). Um
          documento assinado pode ser mantido mesmo com pedido de exclusão
          enquanto for necessário como prova ou por lei (art. 16). Você também
          pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
        </p>
      </section>
    </PublicDocumentShell>
  );
}
