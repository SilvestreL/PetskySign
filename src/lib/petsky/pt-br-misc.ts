/**
 * PetskySign: Brazilian Portuguese for the remaining shared screens (auth pages, errors, verify, download, signing states, contact, navigation), keyed by the
 * English text SignuDoc wrote. Same rules as pt-br.ts.
 */
export const PT_BR_MISC: Readonly<Record<string, string>> = {
  // Error and loading screens
  "Something went wrong while loading this page. Please try again.":
    "Algo deu errado ao carregar esta página. Tente novamente.",
  "Try again": "Tentar novamente",
  "We couldn't load this page.": "Não foi possível carregar esta página.",
  "Loading page": "Carregando a página",
  "This page hit an unexpected error. Please try again.":
    "Esta página encontrou um erro inesperado. Tente novamente.",
  "Something went wrong.": "Algo deu errado.",
  "Loading authentication page": "Carregando a página de acesso",
  "Something went wrong while opening this document. Please try again.":
    "Algo deu errado ao abrir este documento. Tente novamente.",
  "Reload canvas": "Recarregar editor",
  "We couldn't open this document.": "Não foi possível abrir este documento.",
  "Loading document": "Carregando o documento",

  // Not found
  "Go to Dashboard": "Ir para o painel",
  "Go to Home": "Ir para o início",
  "Page not found": "Página não encontrada",
  "The page you're looking for doesn't exist or has been moved.":
    "A página que você procura não existe ou foi movida.",

  // Expired download link
  "Download link expired": "Link de download expirado",
  "Download links work for a limited time. You can have new ones sent to the email address this document was sent to.":
    "Os links de download valem por tempo limitado. Você pode pedir novos links, que serão enviados para o e-mail que recebeu este documento.",
  "This download link has expired": "Este link de download expirou",
  "New links could not be sent right now.":
    "Não foi possível enviar novos links agora.",
  "New links are on their way to {email}.":
    "Os novos links estão a caminho de {email}.",
  "Email me new download links": "Enviar novos links de download por e-mail",

  // Verify
  "Check that a signed PDF or audit certificate is exactly the file this site produced.":
    "Confira se um PDF assinado ou certificado de auditoria é exatamente o arquivo gerado por este site.",
  "Verify a document": "Verificar um documento",
  "Check that a signed PDF or audit certificate is exactly the file this site produced when signing finished. Any change to the file, however small, gives a different fingerprint.":
    "Confira se um PDF assinado ou certificado de auditoria é exatamente o arquivo que este site gerou ao final da assinatura. Qualquer alteração no arquivo, por menor que seja, gera uma impressão digital diferente.",
  "Checking the seal in a PDF reader": "Conferindo o selo em um leitor de PDF",
  "Finished documents and certificates also carry a digital seal. Open the file in Adobe Acrobat Reader or another PDF reader and look at its signature panel. The reader says whether the document has been changed since it was sealed. Unless the organization has installed a certificate from a certificate authority, the reader will also say the signer's identity is unknown; that is expected and does not affect the check for changes.":
    "Documentos finalizados e certificados também têm um selo digital. Abra o arquivo no Adobe Acrobat Reader ou em outro leitor de PDF e veja o painel de assinaturas. O leitor informa se o documento foi alterado depois de selado. A menos que a organização tenha instalado um certificado de uma autoridade certificadora, o leitor também dirá que a identidade do signatário é desconhecida; isso é esperado e não afeta a verificação de alterações.",
  completed: "concluído",
  declined: "recusado",
  voided: "cancelado",
  "The file could not be checked right now.":
    "Não foi possível verificar o arquivo agora.",
  "The file could not be read.": "Não foi possível ler o arquivo.",
  "Choose a signed PDF or audit certificate":
    "Escolha um PDF assinado ou certificado de auditoria",
  "The file stays on your device. Only its SHA-256 fingerprint is sent.":
    "O arquivo fica no seu dispositivo. Só a impressão digital SHA-256 dele é enviada.",
  "PDF to verify": "PDF a verificar",
  "Checking {file}...": "Verificando {file}...",
  "This file is unchanged. It is the signed document this site produced for “{title}”.":
    "Este arquivo não foi alterado. É o documento assinado que este site gerou para “{title}”.",
  "This file is unchanged. It is the audit certificate this site produced for “{title}”.":
    "Este arquivo não foi alterado. É o certificado de auditoria que este site gerou para “{title}”.",
  "The envelope was {status}": "O envelope foi {status}",
  " on {date} UTC": " em {date} UTC",
  "with 1 signer.": "com 1 signatário.",
  "with {count} signers.": "com {count} signatários.",
  "Envelope ID {id}.": "ID do envelope: {id}.",
  "No match.": "Nenhuma correspondência.",
  "This site did not produce this exact file. It may have been changed, saved again by another program, or come from somewhere else. Ask the sender for the copy kept on this site.":
    "Este site não gerou exatamente este arquivo. Ele pode ter sido alterado, salvo de novo por outro programa ou vindo de outro lugar. Peça ao remetente a cópia guardada neste site.",

  // Contact
  "Get in touch with SignuDoc for support, privacy questions, accessibility requests, or legal inquiries.":
    "Fale com a Petsky para suporte, dúvidas sobre privacidade, pedidos de acessibilidade ou questões jurídicas.",
  "Contact | SignuDoc": "Contato | Petsky",
  "Use the form below for product support, privacy requests, accessibility accommodations, legal notices, or questions about a document sent through SignuDoc.":
    "Use o formulário abaixo para suporte, pedidos de privacidade, adaptações de acessibilidade, notificações jurídicas ou dúvidas sobre um documento enviado pela Petsky.",
  "March 23, 2026": "23 de março de 2026",
  Contact: "Contato",
  "Enter your name": "Informe seu nome",
  "Message must be 5000 characters or fewer":
    "A mensagem deve ter no máximo 5000 caracteres",
  "Enter a message": "Escreva uma mensagem",
  "Your message was sent. We’ll follow up at {email} if we need more detail.":
    "Sua mensagem foi enviada. Se precisarmos de mais detalhes, responderemos em {email}.",
  Company: "Empresa",
  "you@example.com": "voce@exemplo.com",
  Message: "Mensagem",
  "Tell us what you need, and include any account email, sender name, document title, or link that helps us identify the request.":
    "Conte o que você precisa e inclua o e-mail da conta, o nome do remetente, o título do documento ou o link que nos ajude a identificar o pedido.",
  "Send message": "Enviar mensagem",

  // Navigation and landing
  "Go to dashboard": "Ir para o painel",
  "Start free": "Comece grátis",
};
