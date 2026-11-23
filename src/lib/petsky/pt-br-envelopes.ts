/**
 * PetskySign: Brazilian Portuguese for the envelope screens (upload, signers, field placement, review, envelope detail), keyed by the
 * English text SignuDoc wrote. Same rules as pt-br.ts.
 */
export const PT_BR_ENVELOPES: Readonly<Record<string, string>> = {
  " (a code is set; type a new one to change it)":
    " (já há um código; digite outro para trocar)",
  '"{title}" will be sent to 1 signer.':
    '"{title}" será enviado para 1 signatário.',
  '"{title}" will be sent to {count} signers.':
    '"{title}" será enviado para {count} signatários.',
  "(optional)": "(opcional)",
  "({count} field)": "({count} campo)",
  "({count} fields)": "({count} campos)",
  "+ Add a button to this group": "+ Adicionar botão a este grupo",
  "+ Add a copy recipient": "+ Adicionar destinatário de cópia",
  "+ Add another signer": "+ Adicionar signatário",
  "A qualified signature needs a qualified certificate, which not every signer has.":
    "A assinatura qualificada exige um certificado qualificado, que nem todo signatário tem.",
  "A radio button needs at least one more in its group.":
    "Uma opção única precisa de pelo menos mais uma no grupo.",
  "A reminder goes to the signer whose turn it is when they have not heard from you for this long. Reminders stop once everyone has signed or the deadline passes.":
    "Um lembrete vai para o signatário da vez quando ele passa esse tempo sem notícias suas. Os lembretes param quando todos assinam ou o prazo vence.",
  "a signer": "um signatário",
  "Access code you will give them yourself, for example by phone":
    "Código de acesso que você mesmo vai passar, por exemplo por telefone",
  "Access codes are not copied: they are stored hashed, so they cannot be brought across. You can set new ones before sending.":
    "Os códigos de acesso não são copiados: ficam guardados como hash e não dá para trazê-los. Você pode definir novos antes de enviar.",
  "Add signers and place fields before you review the final summary for this envelope.":
    "Adicione signatários e posicione os campos antes de revisar o resumo final deste envelope.",
  "Advanced electronic signatures through {provider}":
    "Assinatura eletrônica avançada por {provider}",
  "After you send, Signer 1 will receive an email with a link to sign. Each signer is notified in order after the previous signer completes.":
    "Depois do envio, o Signatário 1 recebe um e-mail com o link para assinar. Cada signatário é avisado na ordem, depois que o anterior conclui.",
  "Alex Jones": "João Souza",
  "alex@company.com": "joao@empresa.com.br",
  "Ask for an access code you give them yourself":
    "Pedir um código de acesso que você mesmo passa",
  "Assigned to": "Atribuído a",
  "At least 4 characters": "Pelo menos 4 caracteres",
  "Automatic reminders": "Lembretes automáticos",
  "Automatic reminders are off.": "Lembretes automáticos desligados.",
  "Automatic reminders: {interval}.": "Lembretes automáticos: {interval}.",
  "Back to documents": "Voltar para documentos",
  "Back to prepare": "Voltar para os campos",
  "By default anyone holding the emailed link can sign. Pick a check when the signer's identity matters.":
    "Por padrão, quem tiver o link enviado consegue assinar. Escolha uma verificação quando a identidade do signatário importar.",
  "By sending, you confirm this document is an ordinary business agreement and not a will, court order, legally required consumer disclosure, or other":
    "Ao enviar, você confirma que este documento é um acordo comercial comum, e não um testamento, ordem judicial, aviso ao consumidor exigido por lei ou outro",
  Change: "Alterar",
  "Change deadline": "Alterar prazo",
  "Change reminders": "Alterar lembretes",
  "Change the deadline": "Alterar o prazo",
  Choices: "Opções",
  "Choose a meaning": "Escolha um significado",
  "Click the document to place {field} for {name}.":
    "Clique no documento para posicionar {field} para {name}.",
  "click to browse": "clique para escolher",
  "Close field tools": "Fechar ferramentas de campo",
  "Continue editing": "Continuar editando",
  "Copies when everyone has signed": "Cópias quando todos assinarem",
  "Copy recipient {position} email":
    "E-mail do destinatário de cópia {position}",
  "Copy recipient {position} name": "Nome do destinatário de cópia {position}",
  "Copy to a new draft": "Copiar para um novo rascunho",
  "Copy to new draft": "Copiar para novo rascunho",
  "Copy {position}": "Cópia {position}",
  "Copying...": "Copiando...",
  "Correct this signer": "Corrigir este signatário",
  "Couldn't load signer setup": "Não foi possível carregar os signatários",
  "Couldn't load the review summary": "Não foi possível carregar o resumo",
  "Couldn't load this document": "Não foi possível carregar este documento",
  "Couldn't load this envelope": "Não foi possível carregar este envelope",
  "Couldn't load this envelope. Please try again.":
    "Não foi possível carregar este envelope. Tente de novo.",
  "Created {date}": "Criado em {date}",
  Delete: "Excluir",
  "Delete draft": "Excluir rascunho",
  "Delete this draft?": "Excluir este rascunho?",
  "Deleting it will permanently remove the draft and its placed fields.":
    "Excluir remove de vez o rascunho e os campos posicionados.",
  Document: "Documento",
  "document that cannot be signed electronically":
    "documento que não pode ser assinado eletronicamente",
  "Document upload dropzone": "Área para soltar o documento",
  Done: "Concluído",
  "Download certificate": "Baixar certificado",
  "Download signed PDF": "Baixar PDF assinado",
  "Drag and drop your PDF here": "Arraste e solte o PDF aqui",
  "e.g., NDA - Client Bravo": "ex.: Contrato - Cliente Bravo",
  "Each signer proves who they are at {provider} and signs with a certificate in their own name.":
    "Cada signatário comprova quem é em {provider} e assina com um certificado em seu nome.",
  Earlier: "Antes",
  "Email them a one-time code when they open the link":
    "Mandar um código por e-mail quando abrir o link",
  "Envelope sent. {name} has been notified.":
    "Envelope enviado. {name} foi avisado(a).",
  "Envelope title": "Título do envelope",
  Error: "Erro",
  "Every day": "Todo dia",
  "Every week": "Toda semana",
  "Every {count} days": "A cada {count} dias",
  "Expired {time}. Nobody can sign until you set a new deadline.":
    "Venceu {time}. Ninguém consegue assinar até você definir um novo prazo.",
  "Expires {time}.": "Vence {time}.",
  "Export audit trail": "Exportar trilha de auditoria",
  "Extra check before signing": "Verificação extra antes de assinar",
  "Failed to send. Please try again.":
    "Não foi possível enviar. Tente de novo.",
  "Field settings": "Configurações do campo",
  "Field tools": "Ferramentas de campo",
  "First page of {title}": "Primeira página de {title}",
  "Gets the finished document once everyone has signed.":
    "Recebe o documento concluído quando todos assinarem.",
  "Incomplete draft": "Rascunho incompleto",
  "jane@company.com": "maria@empresa.com.br",
  "Kept in the envelope's audit trail.":
    "Fica registrado na trilha de auditoria do envelope.",
  Later: "Depois",
  Loading: "Carregando",
  "Maximum reached": "Limite atingido",
  "Move signer {order} earlier": "Mover signatário {order} para antes",
  "Move signer {order} later": "Mover signatário {order} para depois",
  "Name is required": "Informe o nome",
  "New fields will be assigned here":
    "Os novos campos ficam com este signatário",
  "Next ->": "Próximo ->",
  "Next →": "Próximo →",
  "No deadline. Each signing link lasts seven days.":
    "Sem prazo. Cada link de assinatura vale por sete dias.",
  "No extra check": "Sem verificação extra",
  "No field selected": "Nenhum campo selecionado",
  "No fields placed yet": "Nenhum campo posicionado ainda",
  "No fields placed yet (0 fields)": "Nenhum campo posicionado (0 campos)",
  "Nobody is emailed, and this envelope is left as it is.":
    "Ninguém recebe e-mail, e este envelope fica como está.",
  "Nothing to review yet": "Nada para revisar ainda",
  "Notified signers will be informed that the envelope has been voided.":
    "Os signatários já avisados serão informados de que o envelope foi cancelado.",
  Off: "Desligado",
  "One choice per line. Add at least two.":
    "Uma opção por linha. Adicione pelo menos duas.",
  "One choice per line. {count} of up to {max}. The signer picks one.":
    "Uma opção por linha. {count} de até {max}. O signatário escolhe uma.",
  "Only PDF files are supported. Please upload a valid PDF.":
    "Só aceitamos PDF. Envie um PDF válido.",
  "Open field tools": "Abrir ferramentas de campo",
  "Opening the envelope detail view...": "Abrindo os detalhes do envelope...",
  "Option {number}": "Opção {number}",
  "Part 11 mode is on. The meaning is printed beside the signature with the signer's name and the time. The signer needs an account here with a confirmed email address, and an administrator must have confirmed who they are.":
    "O modo Part 11 está ligado. O significado sai impresso ao lado da assinatura, com o nome do signatário e o horário. O signatário precisa de uma conta aqui com e-mail confirmado, e um administrador precisa ter confirmado quem ele é.",
  "PDF only - 20 MB max": "Só PDF - até 20 MB",
  Pending: "Pendente",
  "Petsky signatures": "Assinatura Petsky",
  "Pick a field, then click the page to place it for the selected signer.":
    "Escolha um campo e clique na página para posicioná-lo para o signatário selecionado.",
  Place: "Posicionar",
  "Place fields": "Posicionar campos",
  "Place {field} on page {page}": "Posicionar {field} na página {page}",
  "Place {field} on the document page":
    "Posicionar {field} na página do documento",
  Placing: "Posicionando",
  "Placing {field}": "Posicionando {field}",
  Progress: "Progresso",
  "Qualified electronic signatures through {provider}":
    "Assinatura eletrônica qualificada por {provider}",
  "Radio button": "Opção única",
  "Radio button: {label}": "Opção única: {label}",
  Ready: "Pronto",
  "Ready to place": "Pronto para posicionar",
  "Reason (required)": "Motivo (obrigatório)",
  "Receives a copy": "Recebe uma cópia",
  "Receives the document after Signer {previous} finishes.":
    "Recebe o documento depois que o Signatário {previous} concluir.",
  "Receives the invitation immediately after send.":
    "Recebe o convite logo após o envio.",
  Remove: "Remover",
  "Remove copy recipient {position}":
    "Remover destinatário de cópia {position}",
  "Remove signer {order}": "Remover signatário {order}",
  "Rendered PDF page {page}": "Página {page} do PDF",
  "Required (whole group)": "Obrigatório (grupo inteiro)",
  "Resize {label} field from {corner}":
    "Redimensionar o campo {label} pelo canto {corner}",
  Review: "Revisão",
  Save: "Salvar",
  "Save as template": "Salvar como modelo",
  "Save deadline": "Salvar prazo",
  "Save failed": "Não foi possível salvar",
  "Save reminders": "Salvar lembretes",
  Saved: "Salvo",
  "Saved as the template “{name}”.": "Salvo como o modelo “{name}”.",
  "Saving...": "Salvando...",
  "Select a field on the page to edit its settings, or choose a field tool on the left to place a new one.":
    "Selecione um campo na página para editar, ou escolha uma ferramenta à esquerda para posicionar um novo.",
  "Selected signer": "Signatário selecionado",
  "Send a copy to": "Enviar cópia para",
  "Send a reminder": "Enviar um lembrete",
  "Send envelope": "Enviar envelope",
  "Send now": "Enviar agora",
  "Send reminder": "Enviar lembrete",
  "Send this envelope?": "Enviar este envelope?",
  "Send this kind of document often? Keep its fields and signing order as a template.":
    "Envia esse tipo de documento com frequência? Guarde os campos e a ordem de assinatura como modelo.",
  "Sent the finished document and its certificate.":
    "Recebeu o documento concluído e o certificado.",
  "Set a new deadline": "Definir novo prazo",
  "Signature needed": "Falta a assinatura",
  "Signature ready": "Assinatura posicionada",
  "Signature type": "Tipo de assinatura",
  "Signature type: {type}. It cannot be changed once the envelope is sent.":
    "Tipo de assinatura: {type}. Não dá para mudar depois que o envelope é enviado.",
  Signed: "Assinado",
  "Signer {order}": "Signatário {order}",
  "Signer {order} access code": "Código de acesso do signatário {order}",
  "Signer {order} check: {check}": "Verificação do signatário {order}: {check}",
  "Signer {order} email": "E-mail do signatário {order}",
  "Signer {order} name": "Nome do signatário {order}",
  "Signer {order} signature meaning":
    "Significado da assinatura do signatário {order}",
  "Signers sign here, and the finished PDF is sealed by this install.":
    "Os signatários assinam aqui, e o PDF concluído é selado por este sistema.",
  "Signers will receive the document in this order.":
    "Os signatários recebem o documento nesta ordem.",
  "Signing deadline": "Prazo para assinar",
  "Signing links stop working at the deadline. Reminders go to the signer whose turn it is until they sign. You can change both later from the envelope.":
    "Os links de assinatura param de funcionar no prazo. Os lembretes vão para o signatário da vez até ele assinar. Dá para mudar os dois depois, no envelope.",
  "Signing order": "Ordem de assinatura",
  "Start from a template": "Começar de um modelo",
  "Step 1 of 4 - Upload document": "Etapa 1 de 4 - Enviar documento",
  "Step 2 of 4 - Add signers": "Etapa 2 de 4 - Adicionar signatários",
  "Step 3 of 4": "Etapa 3 de 4",
  "Step 4 of 4 - Review and send": "Etapa 4 de 4 - Revisar e enviar",
  "The first signer ({name}) will be notified immediately.":
    "O primeiro signatário ({name}) será avisado na hora.",
  "The new deadline counts from now.": "O novo prazo conta a partir de agora.",
  "The request expires in {count} days.": "O pedido vence em {count} dias.",
  "The signing link already sent to this person will stop working. If it is their turn, a new invitation goes to the corrected address.":
    "O link de assinatura já enviado para essa pessoa deixa de funcionar. Se for a vez dela, um novo convite vai para o endereço corrigido.",
  "The signing link that was already sent keeps working until then.":
    "O link de assinatura já enviado continua funcionando até lá.",
  "The signing link that was already sent will work again.":
    "O link de assinatura já enviado volta a funcionar.",
  "These people do not sign. They receive the finished document and its certificate once everyone has signed.":
    "Estas pessoas não assinam. Recebem o documento concluído e o certificado quando todos assinarem.",
  "This action cannot be undone.": "Não dá para desfazer.",
  "This draft has not been sent yet.": "Este rascunho ainda não foi enviado.",
  "This envelope is unavailable": "Este envelope está indisponível",
  "This file exceeds the 20 MB limit.":
    "Este arquivo passa do limite de 20 MB.",
  "This signer has both an emailed code and an access code, so they must pass both. Picking one option below removes the other.":
    "Este signatário tem código por e-mail e código de acesso, então precisa passar pelos dois. Escolher uma opção abaixo remove a outra.",
  "This starts a new draft with the same document, the same people and the same fields. Nothing that was filled in is copied.":
    "Cria um novo rascunho com o mesmo documento, as mesmas pessoas e os mesmos campos. Nada do que foi preenchido é copiado.",
  "This will cancel the signing process.":
    "Isso cancela o processo de assinatura.",
  Timeline: "Linha do tempo",
  "Type the code you will give them": "Digite o código que você vai passar",
  "Unable to change the deadline.": "Não foi possível alterar o prazo.",
  "Unable to change the reminders.": "Não foi possível alterar os lembretes.",
  "Unable to copy this envelope.": "Não foi possível copiar este envelope.",
  "Unable to correct this signer.":
    "Não foi possível corrigir este signatário.",
  "Unable to delete this draft.": "Não foi possível excluir este rascunho.",
  "Unable to send a reminder right now.":
    "Não foi possível enviar um lembrete agora.",
  "Unable to void this envelope.": "Não foi possível cancelar este envelope.",
  Unavailable: "Indisponível",
  "Up to 10 signers per document.": "Até 10 signatários por documento.",
  Upload: "Envio do arquivo",
  "Upload PDF": "Enviar PDF",
  "Upload progress": "Progresso do envio",
  "Uploading...": "Enviando...",
  "Use 4 to 64 characters": "Use de 4 a 64 caracteres",
  "Validating the PDF before you continue to signer setup.":
    "Validando o PDF antes de seguir para os signatários.",
  "View templates": "Ver modelos",
  "Void envelope": "Cancelar envelope",
  "Void this envelope?": "Cancelar este envelope?",
  Waiting: "Aguardando",
  "We couldn't find this envelope, or you no longer have access to it.":
    "Não encontramos este envelope, ou você não tem mais acesso a ele.",
  "We couldn't load this draft summary. Try again after checking the earlier steps.":
    "Não foi possível carregar o resumo deste rascunho. Confira as etapas anteriores e tente de novo.",
  "We couldn't load this draft's signer list. Try again and confirm the upload step completed successfully.":
    "Não foi possível carregar os signatários deste rascunho. Tente de novo e confira se o envio do arquivo terminou.",
  "What this button means": "O que este botão significa",
  "What this signature means": "O que esta assinatura significa",
  "Which type a document needs is a legal question; this is not legal advice.":
    "O tipo que cada documento exige é uma questão jurídica; isto não é orientação jurídica.",
  Yes: "Sim",
  "Yes\nNo\nNot sure": "Sim\nNão\nNão sei",
  "You can send another reminder after {time}.":
    "Você pode enviar outro lembrete depois de {time}.",
  "{count} buttons in this group. The signer picks one.":
    "{count} botões neste grupo. O signatário escolhe um.",
  "{count} days": "{count} dias",
  "{count} days from now": "Daqui a {count} dias",
  "{count} events": "{count} eventos",
  "{count} pages": "{count} páginas",
  "{count} signer": "{count} signatário",
  "{count} signers": "{count} signatários",
  "{count} total": "{count} no total",
  "{field} ready to place": "{field} pronto para posicionar",
  "{name} will be notified immediately.": "{name} será avisado(a) na hora.",
  "← Back": "← Voltar",
  "← Documents": "← Documentos",
};
