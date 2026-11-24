import type {
  DisclosureParty,
  DisclosureSection,
} from "../electronic-records-disclosure.ts";

/**
 * PetskySign: o termo que o signatário lê e aceita antes de assinar, em
 * português. Escrito com base na MP 2.200-2/2001 (art. 10, § 2º: a
 * assinatura eletrônica fora da ICP-Brasil vale quando as partes a admitem)
 * e na LGPD (Lei 13.709/2018). A Lei 14.063/2020 não entra: o art. 2º,
 * parágrafo único, II, "a", tira dela a relação entre particulares.
 *
 * PRECISA DE REVISÃO JURÍDICA antes de ir para produção (Fase 0 do plano).
 * Mude a versão sempre que mudar o texto: ela fica gravada com o aceite de
 * cada signatário.
 */

export const PORTUGUESE_DISCLOSURE_VERSION = "2026-11-24-pt-BR";

export const PORTUGUESE_CONSENT_STATEMENT =
  "Li o termo acima, consigo abrir e salvar arquivos PDF neste aparelho e concordo em usar documentos e assinatura eletrônicos para este contrato.";

export function buildPortugueseDisclosure(
  party: DisclosureParty,
): DisclosureSection[] {
  const contact = party.contactAddress
    ? `${party.senderName} (${party.contactAddress})`
    : party.senderName;

  return [
    {
      heading: "Assinatura eletrônica",
      text: `${party.senderName} pede que você receba e assine este documento de forma eletrônica, em vez de em papel. Ao concordar, você admite esta assinatura eletrônica como válida entre você e ${party.senderName}, nos termos do art. 10, § 2º, da MP 2.200-2/2001, e ela terá o mesmo efeito de uma assinatura à mão.`,
    },
    {
      heading: "Como sua assinatura é comprovada",
      text: "Registramos a data e a hora de cada passo (abertura, aceite deste termo e assinatura), o endereço IP, o navegador e a localização aproximada pelo IP usados e, se você permitir no momento de assinar, a localização do aparelho, além das confirmações de identidade pedidas, em um histórico encadeado que não pode ser alterado sem deixar sinal. Ao final, o documento assinado e o certificado com esse histórico são selados digitalmente.",
    },
    {
      heading: "Você pode preferir papel",
      text: `Você não é obrigado a concordar. Para assinar em papel, ou pedir uma cópia em papel depois de assinar, fale com ${contact}.`,
    },
    {
      heading: "Desistir antes de assinar",
      text: `Você pode desistir a qualquer momento antes de assinar, recusando a assinatura nesta página ou avisando ${contact}. Desistir não desfaz uma assinatura já feita.`,
    },
    {
      heading: "Seus dados (LGPD)",
      text: `Usamos seu nome, os dados de acesso e de localização acima e o que você preencher apenas para formalizar este contrato e provar a sua assinatura, com base na execução do contrato e no cumprimento de obrigação legal (art. 7º, II e V, da LGPD). Os registros são guardados enquanto forem necessários como prova. Para exercer seus direitos de titular, fale com ${contact}.`,
    },
    {
      heading: "O que você precisa",
      text: "Um navegador atualizado e um aparelho que abra e salve arquivos PDF. Guarde a cópia assinada: ela é o seu comprovante.",
    },
  ];
}
