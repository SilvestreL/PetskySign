import { PublicDocumentShell } from "@/components/layout/public-document-shell";

// PetskySign: the "what this is for" page in Brazilian terms (see
// app/electronic-signatures/page.tsx). General information, to be checked
// by a lawyer before going live, like the consent text.

const PARA_QUE_SERVE = [
  "Contratos de prestação de serviço entre a empresa e o tutor: creche, hotel, banho e tosa, adestramento, transporte e serviços parecidos.",
  "Autorizações e termos ligados a esses serviços, como autorização de passeio, de medicação ou de atendimento veterinário de emergência.",
  "Aditivos, renovações e cancelamentos desses contratos.",
];

const PARA_QUE_NAO_SERVE = [
  "Documentos que a lei exige que sejam feitos em cartório ou por escritura pública, como compra e venda de imóveis.",
  "Atos que exigem assinatura eletrônica qualificada (com certificado ICP-Brasil), como os listados no art. 5º, § 2º, da Lei 14.063/2020 e outros que a lei ou o órgão público exijam.",
  "Testamentos, procurações públicas e documentos de família ou sucessão.",
  "Qualquer documento que a outra parte não aceite assinar eletronicamente.",
];

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-6">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function ElectronicSignaturesPtBrPage({
  lastUpdated,
  productName,
}: {
  lastUpdated: string;
  productName: string;
}) {
  return (
    <PublicDocumentShell
      description={`${productName} usa este site para colher assinaturas eletrônicas. Esta página diz para quais documentos ele serve e para quais não serve.`}
      lastUpdated={lastUpdated}
      title="Para que serve"
    >
      <section className="space-y-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-(--fg)">
          Que assinatura é esta
        </h2>
        <p>
          É uma assinatura eletrônica sem certificado ICP-Brasil, comprovada
          pelo histórico do que aconteceu (abertura, aceite do termo,
          assinatura, com data, hora, IP, navegador e localização) e por um selo
          digital no documento final. Ela vale entre as partes que a aceitam,
          conforme o art. 10, § 2º, da MP 2.200-2/2001.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-(--fg)">
          Para que serve
        </h2>
        <List items={PARA_QUE_SERVE} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-(--fg)">
          Para que não serve
        </h2>
        <List items={PARA_QUE_NAO_SERVE} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-(--fg)">
          Quem decide
        </h2>
        <p>
          {productName} mantém este site e decide para que ele é usado. Antes de
          cada envio, quem envia confirma que o documento não é de um dos tipos
          acima. Esta página é informativa e não é orientação jurídica.
        </p>
      </section>
    </PublicDocumentShell>
  );
}
