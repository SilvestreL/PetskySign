"use client";

import { DownloadIcon } from "lucide-react";
import Image from "next/image";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  PdfPageCanvas,
  type PdfPageRenderState,
} from "@/components/envelopes/pdf-page-canvas";
import { Brand } from "@/components/layout/brand";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@/components/layout/nav-items";
import { PublicLegalFooter } from "@/components/layout/public-legal-links";
import {
  beginDocumentPanGesture,
  clampDocumentZoomLevel,
  DEFAULT_DOCUMENT_ZOOM_LEVEL,
  DocumentZoomControls,
  endDocumentPanGesture,
  moveDocumentPanGesture,
  type DocumentPanGesture,
  DOCUMENT_ZOOM_STEP,
} from "@/components/shared/document-viewport";
import { FieldShell, ShellButton } from "@/components/shared/form-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SigningStateScreen } from "@/components/signing/signing-state-screen";
import {
  type SigningCurrentField,
  type SigningPayload,
  type SigningVisibleField,
} from "@/lib/schemas/signing";
import { type SigningSubmission } from "@/lib/schemas/field";
import {
  countAnswerableFields,
  isNumberEntry,
  NUMBER_ENTRY_MESSAGE,
} from "@/lib/field-choices";
import { intlLocale, tr } from "@/lib/petsky/locale";
import { displayEmail } from "@/lib/petsky/placeholder-email";

const typedSignatureFont =
  '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive';

type SignatureEntry = {
  imageDataUrl?: string | null;
  inputMethod: "drawn" | "typed";
  value: string;
};

type SignatureModalState = {
  fieldId: string;
  mode: "drawn" | "typed";
  type: "initials" | "signature";
};

type ReusableSignatureEntries = Record<
  SignatureModalState["type"],
  SignatureEntry | null
>;

type PositionedSigningField = {
  height: string;
  left: string;
  top: string;
  width: string;
};

const defaultSubmitErrorMessage = tr(
  "We couldn't finish signing right now. Reload the page or request a fresh signing link from the sender.",
);
const defaultDeclineErrorMessage = tr(
  "We couldn't record your decline right now. Reload the page or request a fresh signing link from the sender.",
);
/** What a signer sees once their decline is recorded. */
export const declinedConfirmation = {
  description: tr(
    "Your decline has been recorded. No further action is needed, and this link no longer opens the document.",
  ),
  title: tr("You declined to sign"),
};
const compactFieldHeightThreshold = 0.045;
const compactFieldWidthThreshold = 0.12;

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

function getFieldFrame(field: SigningCurrentField | SigningVisibleField) {
  return {
    height: `${field.height * 100}%`,
    left: `${field.x * 100}%`,
    top: `${field.y * 100}%`,
    width: `${field.width * 100}%`,
  } satisfies PositionedSigningField;
}

function shouldShowInlineFieldLabel(
  field: Pick<SigningCurrentField | SigningVisibleField, "height" | "width">,
) {
  return (
    field.width >= compactFieldWidthThreshold &&
    field.height >= compactFieldHeightThreshold
  );
}

function shouldShowInlineFieldValue(
  field: Pick<SigningCurrentField | SigningVisibleField, "height" | "width">,
) {
  return field.width >= 0.08 && field.height >= 0.03;
}

function getCanvasFieldLabel(
  field: Pick<SigningCurrentField | SigningVisibleField, "label" | "type">,
) {
  if (field.label?.trim()) {
    return field.label;
  }

  switch (field.type) {
    case "signature":
      return tr("Sign");
    case "initials":
      return tr("Initial");
    case "date":
      return tr("Date");
    case "name":
      return tr("Name");
    case "text":
      return tr("Text");
    case "checkbox":
      return tr("Checkbox");
    case "number":
      return tr("Number");
    case "dropdown":
      return tr("Choose");
    case "radio":
      return tr("Option");
    default:
      return tr("Field");
  }
}

function getSignatureFieldType(
  field: Pick<SigningCurrentField, "type">,
): SignatureModalState["type"] | null {
  if (field.type === "initials" || field.type === "signature") {
    return field.type;
  }

  return null;
}

function getFieldLabel(
  field: Pick<SigningCurrentField, "label" | "type">,
): string {
  if (field.label?.trim()) {
    return field.label;
  }

  switch (field.type) {
    case "signature":
      return tr("Sign here");
    case "initials":
      return tr("Initial here");
    case "date":
      return tr("Date");
    case "name":
      return tr("Name");
    case "text":
      return tr("Enter text");
    case "checkbox":
      return tr("Checkbox");
    case "number":
      return tr("Enter a number");
    case "dropdown":
      return tr("Choose one");
    case "radio":
      return tr("Option");
    default:
      return tr("Field");
  }
}

/** The values the signer has entered so far, by field. */
type EnteredValues = {
  /** Checkboxes and radio buttons. */
  checkboxValues: Record<string, boolean>;
  signatureValues: Record<string, SignatureEntry>;
  /** Text, number and dropdown fields. */
  textValues: Record<string, string>;
};

/** The radio buttons that are answered together with this one. */
function getRadioGroup(
  field: SigningCurrentField,
  fields: readonly SigningCurrentField[],
) {
  return fields.filter(
    (other) =>
      other.type === "radio" &&
      (other.id === field.id ||
        (field.groupId !== undefined && other.groupId === field.groupId)),
  );
}

/** A number field holding something that is not a number. */
function hasInvalidNumber(
  field: SigningCurrentField,
  textValues: Record<string, string>,
) {
  const value = (textValues[field.id] ?? "").trim();

  return field.type === "number" && value.length > 0 && !isNumberEntry(value);
}

function getSummaryLabel(field: SigningCurrentField) {
  switch (field.type) {
    case "signature":
      return tr("Signature");
    case "initials":
      return tr("Initials");
    case "date":
      return tr("Date");
    case "name":
      return tr("Name");
    case "text":
      return tr("Text input");
    case "checkbox":
      return tr("Checkbox");
    case "number":
      return tr("Number");
    case "dropdown":
      return tr("Dropdown");
    case "radio":
      return tr("Choice");
    default:
      return tr("Field");
  }
}

function isActionSummaryField(field: SigningCurrentField) {
  if (field.type === "signature" || field.type === "initials") {
    return true;
  }

  if (
    field.type === "text" ||
    field.type === "number" ||
    field.type === "dropdown"
  ) {
    return true;
  }

  if (field.type === "checkbox" || field.type === "radio") {
    return field.required;
  }

  return false;
}

function getCompletionValue(
  field: SigningCurrentField,
  fields: readonly SigningCurrentField[],
  {
    checkboxValues,
    localDateLabel,
    signatureValues,
    signerName,
    textValues,
  }: EnteredValues & { localDateLabel: string; signerName: string },
) {
  if (field.type === "signature" || field.type === "initials") {
    const entry = signatureValues[field.id];

    // A drawn mark is stored as "Drawn signature"; show it in the reader's language.
    if (entry?.inputMethod === "drawn") {
      return field.type === "initials"
        ? tr("Drawn initials")
        : tr("Drawn signature");
    }

    return entry?.value ?? tr("Tap to sign");
  }

  if (field.type === "name") {
    return signerName;
  }

  if (field.type === "text") {
    return textValues[field.id]?.trim() || tr("Enter text");
  }

  if (field.type === "number") {
    return hasInvalidNumber(field, textValues)
      ? tr("Not a number")
      : textValues[field.id]?.trim() || tr("Enter a number");
  }

  if (field.type === "dropdown") {
    return textValues[field.id]?.trim() || tr("Choose one");
  }

  if (field.type === "checkbox") {
    return checkboxValues[field.id] ? tr("Checked") : tr("Optional");
  }

  if (field.type === "radio") {
    const chosen = getRadioGroup(field, fields).find(
      (button) => checkboxValues[button.id],
    );

    return chosen ? getFieldLabel(chosen) : tr("Choose one");
  }

  return localDateLabel;
}

function isFieldComplete(
  field: SigningCurrentField,
  fields: readonly SigningCurrentField[],
  { checkboxValues, signatureValues, textValues }: EnteredValues,
) {
  if (field.type === "signature" || field.type === "initials") {
    return Boolean(signatureValues[field.id]?.value);
  }

  if (field.type === "number" && hasInvalidNumber(field, textValues)) {
    return false;
  }

  if (
    field.type === "text" ||
    field.type === "number" ||
    field.type === "dropdown"
  ) {
    if (!field.required) {
      return true;
    }

    return (textValues[field.id] ?? "").trim().length > 0;
  }

  if (field.type === "checkbox") {
    if (!field.required) {
      return true;
    }

    return Boolean(checkboxValues[field.id]);
  }

  if (field.type === "radio") {
    if (!field.required) {
      return true;
    }

    // One chosen button answers for the whole group.
    return getRadioGroup(field, fields).some(
      (button) => checkboxValues[button.id],
    );
  }

  return true;
}

function getVisibleFieldValue(field: SigningVisibleField) {
  if (field.type === "checkbox" || field.type === "radio") {
    return field.checked ? tr("Checked") : tr("Unchecked");
  }

  return field.value?.trim() || getFieldLabel(field);
}

function buildSigningSubmissionPayload(
  record: SigningPayload,
  { checkboxValues, signatureValues, textValues }: EnteredValues,
): SigningSubmission {
  const fields: SigningSubmission["fields"] = [];

  for (const field of record.currentSignerFields) {
    if (field.type === "signature" || field.type === "initials") {
      const entry = signatureValues[field.id];

      if (!entry) {
        continue;
      }

      if (entry.inputMethod === "drawn" && entry.imageDataUrl) {
        fields.push({
          fieldId: field.id,
          imageDataUrl: entry.imageDataUrl,
          inputMethod: "drawn",
          type: field.type,
        });
        continue;
      }

      fields.push({
        fieldId: field.id,
        inputMethod: "typed",
        type: field.type,
        value: entry.value,
      });
      continue;
    }

    if (
      field.type === "text" ||
      field.type === "number" ||
      field.type === "dropdown"
    ) {
      const value = textValues[field.id]?.trim();

      if (value) {
        fields.push({
          fieldId: field.id,
          type: field.type,
          value,
        });
      }

      continue;
    }

    if (field.type === "checkbox" || field.type === "radio") {
      fields.push({
        checked: Boolean(checkboxValues[field.id]),
        fieldId: field.id,
        type: field.type,
      });
    }
  }

  return {
    clientTimezoneOffsetMinutes: new Date().getTimezoneOffset(),
    fields,
  };
}

/**
 * PetskySign: asks the browser for the device's location, as optional
 * evidence for the certificate. Never blocks the signature: a refusal, an
 * error or no answer within a few seconds sends the status instead.
 */
async function readDeviceLocation(): Promise<
  | {
      deviceLocation: { accuracy: number; latitude: number; longitude: number };
    }
  | { deviceLocationStatus: "denied" | "unavailable" }
> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { deviceLocationStatus: "unavailable" };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      value:
        | {
            deviceLocation: {
              accuracy: number;
              latitude: number;
              longitude: number;
            };
          }
        | { deviceLocationStatus: "denied" | "unavailable" },
    ) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    // The permission prompt waits for the person; do not wait forever.
    const timer = window.setTimeout(
      () => finish({ deviceLocationStatus: "unavailable" }),
      10_000,
    );

    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer);
        finish({
          deviceLocation: {
            accuracy: Math.min(position.coords.accuracy, 100_000),
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
        });
      },
      (error) => {
        window.clearTimeout(timer);
        finish({
          deviceLocationStatus:
            error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        });
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 8_000 },
    );
  });
}

/** Why a signer came back from their signing provider without signing. */
export type ProviderSignatureProblem =
  "cancelled" | "expired" | "failed" | "name";

function describeProviderProblem(
  problem: ProviderSignatureProblem,
  providerName: string,
): string {
  switch (problem) {
    case "cancelled":
      return tr(
        "You did not finish signing at {providerName}. Nothing was signed, so you can try again.",
        { providerName },
      );
    case "expired":
      return tr(
        "Your earlier signing session ended before it finished. Nothing was signed, so you can try again.",
      );
    case "name":
      return tr(
        "The certificate you signed with at {providerName} is not in the name this document was sent to. Nothing was signed. If the name is wrong, ask the sender to send the document again under the name on your certificate.",
        { providerName },
      );
    default:
      return tr(
        "{providerName} could not complete your signature. Nothing was signed. Try again, or ask the sender for help.",
        { providerName },
      );
  }
}

export function SigningLiveShell({
  record,
  signatureProblem = null,
}: {
  record: SigningPayload;
  signatureProblem?: ProviderSignatureProblem | null;
}) {
  const [hasDeclined, setHasDeclined] = useState(false);
  // PetskySign: from the first page, so the tutor reads the contract before
  // reaching the signature; "Go to signature" jumps to it.
  const [activePage, setActivePage] = useState(
    record.pages[0]?.pageNumber ?? 1,
  );
  const [checkboxValues, setCheckboxValues] = useState<Record<string, boolean>>(
    {},
  );
  const [consentedAt, setConsentedAt] = useState(record.consentedAt);
  const [isConsentChecked, setIsConsentChecked] = useState(false);
  const [isSavingConsent, setIsSavingConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [isDeclineDialogOpen, setIsDeclineDialogOpen] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [isFinishDialogOpen, setIsFinishDialogOpen] = useState(false);
  const [isDocumentPanning, setIsDocumentPanning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Part 11 envelopes: the signer's email address and password, given again
  // for this signature, and their confirmation of what it means.
  const [reauthEmail, setReauthEmail] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [isMeaningConfirmed, setIsMeaningConfirmed] = useState(false);
  const part11 = record.part11 ?? null;
  // Signed with a certificate in the signer's own name: Finish goes to the
  // signing provider, which signs, then sends the signer back.
  const providerSignature = record.providerSignature ?? null;
  const isReauthReady =
    part11 === null ||
    (isMeaningConfirmed &&
      reauthEmail.trim().length > 0 &&
      reauthPassword.length > 0);
  const [pdfRenderState, setPdfRenderState] =
    useState<PdfPageRenderState>("loading");
  const [signatureValues, setSignatureValues] = useState<
    Record<string, SignatureEntry>
  >({});
  const [reusableSignatureEntries, setReusableSignatureEntries] =
    useState<ReusableSignatureEntries>({
      initials: null,
      signature: null,
    });
  const [signatureModal, setSignatureModal] =
    useState<SignatureModalState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [drawnSignatureVersion, setDrawnSignatureVersion] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_DOCUMENT_ZOOM_LEVEL);
  const [localDateLabel] = useState(() =>
    new Intl.DateTimeFormat(intlLocale(), {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date()),
  );
  const paperGridRef = useRef<HTMLDivElement | null>(null);
  const isPhone = useIsPhone();
  const documentPanGestureRef = useRef<DocumentPanGesture | null>(null);

  const pageVisibleFields = record.visibleFields.filter(
    (field) => field.page === activePage,
  );
  const enteredValues: EnteredValues = {
    checkboxValues,
    signatureValues,
    textValues,
  };
  // A group of radio buttons is one question: it is listed and counted once.
  const seenRadioGroups = new Set<string>();
  const actionSummaryFields = record.currentSignerFields.filter((field) => {
    if (!isActionSummaryField(field)) {
      return false;
    }

    if (field.type !== "radio" || field.groupId === undefined) {
      return true;
    }

    if (seenRadioGroups.has(field.groupId)) {
      return false;
    }

    seenRadioGroups.add(field.groupId);

    return true;
  });
  const remainingFields = countAnswerableFields(
    record.currentSignerFields,
    (field) =>
      field.required &&
      !isFieldComplete(field, record.currentSignerFields, enteredValues),
  );
  // An optional number field may be left empty, but not filled with
  // something that is not a number.
  const invalidNumberCount = record.currentSignerFields.filter((field) =>
    hasInvalidNumber(field, textValues),
  ).length;
  const canFinish = remainingFields === 0 && invalidNumberCount === 0;
  const nextRequiredField = record.currentSignerFields.find(
    (field) =>
      field.required &&
      !isFieldComplete(field, record.currentSignerFields, enteredValues),
  );
  const goToNextField = () => {
    if (!nextRequiredField) {
      return;
    }

    setActivePage(nextRequiredField.page);

    if (!isPhone) {
      paperGridRef.current?.scrollIntoView({ block: "start" });
      return;
    }

    // Phones: a jump to that page, not a smooth scroll; the pages above are
    // still drawing and a smooth scroll stops partway when they change size.
    const target = document.getElementById(
      `signing-page-${nextRequiredField.page}`,
    );

    if (target) {
      window.scrollTo({
        top: target.getBoundingClientRect().top + window.scrollY - 80,
      });
    }
  };
  const requiredFieldCount = countAnswerableFields(
    record.currentSignerFields,
    (field) => field.required,
  );
  const completionPercent =
    requiredFieldCount === 0
      ? 100
      : Math.round(
          ((requiredFieldCount - remainingFields) / requiredFieldCount) * 100,
        );
  const isDocumentReady = pdfRenderState === "ready";

  function applyZoomLevel(nextZoomLevel: number) {
    if (nextZoomLevel <= DEFAULT_DOCUMENT_ZOOM_LEVEL) {
      setIsDocumentPanning(false);
      documentPanGestureRef.current = null;
    }

    setZoomLevel(nextZoomLevel);
  }

  function handleSignatureFieldClick(field: SigningCurrentField) {
    const fieldType = getSignatureFieldType(field);

    if (!fieldType) {
      return;
    }

    const existingFieldEntry = signatureValues[field.id];
    const reusableEntry = reusableSignatureEntries[fieldType];

    setDrawnSignatureVersion(0);
    setSubmitError(null);

    if (!existingFieldEntry && reusableEntry) {
      setSignatureValues((current) => ({
        ...current,
        [field.id]: reusableEntry,
      }));
      return;
    }

    setSignatureModal({
      fieldId: field.id,
      mode:
        existingFieldEntry?.inputMethod ??
        reusableEntry?.inputMethod ??
        "typed",
      type: fieldType,
    });
  }

  async function handleFinishSigning() {
    if (!canFinish || isSubmitting || !isReauthReady) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Only for signatures made here: a provider signature has its own proof.
      const deviceLocation = providerSignature
        ? {}
        : await readDeviceLocation();
      const response = await fetch(
        providerSignature?.startUrl ?? record.submitUrl,
        {
          body: JSON.stringify({
            ...buildSigningSubmissionPayload(record, enteredValues),
            ...deviceLocation,
            ...(part11
              ? {
                  reauthentication: {
                    email: reauthEmail,
                    meaningConfirmed: true,
                    password: reauthPassword,
                  },
                }
              : {}),
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        redirectPath?: string;
        redirectUrl?: string;
        state?: string;
      } | null;

      if (!response.ok) {
        if (payload?.state) {
          window.location.reload();
          return;
        }

        setSubmitError(payload?.error ?? defaultSubmitErrorMessage);
        setReauthPassword("");
        setIsSubmitting(false);
        return;
      }

      if (providerSignature) {
        if (!payload?.redirectUrl) {
          setSubmitError(defaultSubmitErrorMessage);
          setIsSubmitting(false);
          return;
        }

        window.location.assign(payload.redirectUrl);
        return;
      }

      const fallbackRedirectPath = `${window.location.pathname.replace(/\/$/, "")}/done?title=${encodeURIComponent(record.envelopeTitle)}`;

      window.location.assign(payload?.redirectPath ?? fallbackRedirectPath);
    } catch {
      setSubmitError(defaultSubmitErrorMessage);
      setIsSubmitting(false);
    }
  }

  async function handleConsent() {
    setIsSavingConsent(true);
    setConsentError(null);

    try {
      const response = await fetch(record.consentUrl, {
        body: JSON.stringify({ disclosureVersion: record.disclosure.version }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        consentedAt?: number;
        error?: string;
      } | null;

      if (!response.ok || typeof payload?.consentedAt !== "number") {
        setConsentError(
          payload?.error ?? tr("Your agreement could not be saved right now."),
        );
        return;
      }

      setConsentedAt(payload.consentedAt);
    } catch {
      setConsentError(tr("Your agreement could not be saved right now."));
    } finally {
      setIsSavingConsent(false);
    }
  }

  async function handleDeclineSigning() {
    if (isDeclining) {
      return;
    }

    setIsDeclining(true);
    setDeclineError(null);

    try {
      const response = await fetch(record.declineUrl, {
        body: JSON.stringify({
          reason: declineReason,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        state?: string;
      } | null;

      if (!response.ok) {
        if (payload?.state) {
          window.location.reload();
          return;
        }

        setDeclineError(payload?.error ?? defaultDeclineErrorMessage);
        setIsDeclining(false);
        return;
      }

      // Not a reload: a decline retires this link, so reloading would land
      // on "This link has expired" instead of saying the decline was
      // recorded (issue #55).
      setHasDeclined(true);
    } catch {
      setDeclineError(defaultDeclineErrorMessage);
      setIsDeclining(false);
    }
  }

  function beginDocumentPan(event: ReactPointerEvent<HTMLDivElement>) {
    documentPanGestureRef.current = beginDocumentPanGesture({
      event,
      scrollContainer: paperGridRef.current,
      shouldIgnoreTarget: (target) =>
        Boolean(target.closest("[data-signing-field='true']")),
      zoomLevel,
    });
  }

  function handleDocumentPanMove(event: ReactPointerEvent<HTMLDivElement>) {
    moveDocumentPanGesture({
      event,
      gesture: documentPanGestureRef.current,
      onPanStart: () => setIsDocumentPanning(true),
      scrollContainer: paperGridRef.current,
    });
  }

  function endDocumentPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      endDocumentPanGesture({
        event,
        gesture: documentPanGestureRef.current,
        onPanEnd: () => setIsDocumentPanning(false),
        scrollContainer: paperGridRef.current,
      })
    ) {
      documentPanGestureRef.current = null;
    }
  }

  if (hasDeclined) {
    return (
      <SigningStateScreen
        description={declinedConfirmation.description}
        focusHeading
        title={declinedConfirmation.title}
      />
    );
  }

  // One page of the document with the fields on it. On phones every page is
  // drawn one under the other, to scroll through like a chat; elsewhere one
  // at a time, with the arrows.
  const renderPage = (pageNumber: number, reportsRender: boolean) => {
    const pageRecord =
      record.pages.find((page) => page.pageNumber === pageNumber) ??
      record.pages[0];

    return (
      <div
        className="relative overflow-hidden rounded-md bg-white shadow-[0_1px_2px_rgba(28,29,43,0.08),0_12px_32px_rgba(28,29,43,0.12)]"
        style={{
          width: `${zoomLevel * 100}%`,
        }}
      >
        <div
          className="relative overflow-hidden"
          data-field-viewport
          style={{
            aspectRatio: `${pageRecord?.widthPt ?? 8.5} / ${pageRecord?.heightPt ?? 11}`,
          }}
        >
          <PdfPageCanvas
            documentUrl={record.documentUrl}
            onRenderStateChange={reportsRender ? setPdfRenderState : undefined}
            pageNumber={pageNumber}
          />

          {isDocumentReady
            ? record.visibleFields
                .filter((field) => field.page === pageNumber)
                .map((field) => (
                  <VisibleFieldStamp field={field} key={field.id} />
                ))
            : null}

          {isDocumentReady
            ? record.currentSignerFields
                .filter((field) => field.page === pageNumber)
                .map((field) => (
                  <CurrentSignerField
                    checkboxValue={Boolean(checkboxValues[field.id])}
                    field={field}
                    key={field.id}
                    localDateLabel={localDateLabel}
                    isInvalid={hasInvalidNumber(field, textValues)}
                    signerName={record.signer.name}
                    onCheckboxChange={(checked) => {
                      setSubmitError(null);
                      setCheckboxValues((current) => {
                        const next = {
                          ...current,
                          [field.id]: checked,
                        };

                        // Choosing one radio button lets go of
                        // the others in its group.
                        if (field.type === "radio" && checked) {
                          for (const button of getRadioGroup(
                            field,
                            record.currentSignerFields,
                          )) {
                            if (button.id !== field.id) {
                              next[button.id] = false;
                            }
                          }
                        }

                        return next;
                      });
                    }}
                    onSignatureClick={() => handleSignatureFieldClick(field)}
                    onTextChange={(value) => {
                      setSubmitError(null);
                      setTextValues((current) => ({
                        ...current,
                        [field.id]: value,
                      }));
                    }}
                    signatureEntry={signatureValues[field.id]}
                    textValue={textValues[field.id] ?? ""}
                  />
                ))
            : null}
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 bg-[rgba(243,244,248,0.88)] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1320px] items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-5">
            <Brand href={null} />
            <div className="hidden min-w-0 border-l border-(--border-strong) pl-5 sm:block">
              <p className="truncate text-sm font-bold text-(--fg)">
                {record.envelopeTitle}
              </p>
              <p className="mt-0.5 truncate text-[0.8125rem] text-(--tertiary)">
                {tr("Sent by {sender}", { sender: record.senderName })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              className="btn-quiet min-h-11 px-3 sm:px-4"
              download="document.pdf"
              href={`${record.documentUrl}?download=1`}
            >
              <DownloadIcon aria-hidden="true" className="size-4" />
              <span className="sr-only sm:not-sr-only">
                {tr("Download PDF")}
              </span>
            </a>
            <ShellButton
              className="hidden min-h-11 px-4 sm:inline-flex"
              disabled={isSubmitting || isDeclining}
              onClick={() => {
                setDeclineError(null);
                setIsDeclineDialogOpen(true);
              }}
              variant="secondary"
            >
              {tr("Decline")}
            </ShellButton>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col gap-5 px-4 pb-8 pt-1 sm:px-6">
        {signatureProblem && providerSignature ? (
          <div className="notice notice-danger" role="alert">
            {describeProviderProblem(
              signatureProblem,
              providerSignature.providerName,
            )}
          </div>
        ) : null}
        <section className="panel rounded-[1.25rem] px-4 py-4 sm:hidden">
          <p className="text-[0.9375rem] font-bold leading-snug text-(--fg)">
            {record.envelopeTitle}
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-(--tertiary)">
            {tr("Sent by {sender}", { sender: record.senderName })}
          </p>
          <ol className="mt-3 space-y-1.5 text-sm leading-5 text-(--secondary)">
            <li>
              {record.pageCount > 1
                ? tr(
                    "1. Read the document. It has {count} pages: scroll down to see them all.",
                    { count: record.pageCount },
                  )
                : tr("1. Read the document.")}
            </li>
            <li>{tr("2. Tap the blue box to sign.")}</li>
            <li>{tr("3. Tap Finish at the bottom of the screen.")}</li>
          </ol>
        </section>
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="panel hidden rounded-[1.25rem] px-4 py-3 sm:block">
              <div className="flex flex-col gap-3 xl:grid xl:grid-cols-[1fr_auto_1fr] xl:items-center">
                <div className="flex justify-center xl:justify-start">
                  <DocumentZoomControls
                    onDecrease={() =>
                      applyZoomLevel(
                        clampDocumentZoomLevel(zoomLevel - DOCUMENT_ZOOM_STEP),
                      )
                    }
                    onIncrease={() =>
                      applyZoomLevel(
                        clampDocumentZoomLevel(zoomLevel + DOCUMENT_ZOOM_STEP),
                      )
                    }
                    onReset={() => applyZoomLevel(DEFAULT_DOCUMENT_ZOOM_LEVEL)}
                    zoomLevel={zoomLevel}
                  />
                </div>

                <div className="flex items-center justify-center gap-3">
                  <button
                    aria-label={tr("Previous page")}
                    className="btn-quiet size-10 px-0"
                    disabled={activePage === 1}
                    onClick={() =>
                      setActivePage((page) => Math.max(1, page - 1))
                    }
                    type="button"
                  >
                    <ChevronLeftIcon className="size-4" />
                  </button>
                  <div className="min-w-[7.5rem] text-center">
                    <p className="sr-only">{tr("Document page")}</p>
                    <p className="text-sm font-bold text-(--fg)">
                      {tr("Page {page} of {count}", {
                        count: record.pageCount,
                        page: activePage,
                      })}
                    </p>
                  </div>
                  <button
                    aria-label={tr("Next page")}
                    className="btn-quiet size-10 px-0"
                    disabled={activePage === record.pageCount}
                    onClick={() =>
                      setActivePage((page) =>
                        Math.min(record.pageCount, page + 1),
                      )
                    }
                    type="button"
                  >
                    <ChevronRightIcon className="size-4" />
                  </button>
                </div>

                <div className="flex justify-center xl:justify-end">
                  <SigningToolbarStatus
                    hasLockedFields={pageVisibleFields.length > 0}
                    remainingFields={remainingFields}
                  />
                </div>
              </div>
            </div>

            <div className="panel overflow-hidden rounded-[1.25rem]">
              <div
                className={`relative overflow-auto p-3 sm:p-6 ${
                  zoomLevel > DEFAULT_DOCUMENT_ZOOM_LEVEL
                    ? isDocumentPanning
                      ? "cursor-grabbing"
                      : "cursor-grab"
                    : ""
                }`}
                data-paper-grid
                onPointerCancel={endDocumentPan}
                onPointerDown={beginDocumentPan}
                onPointerMove={handleDocumentPanMove}
                onPointerUp={endDocumentPan}
                ref={paperGridRef}
              >
                <div
                  className={`mx-auto ${
                    zoomLevel > DEFAULT_DOCUMENT_ZOOM_LEVEL
                      ? "w-full"
                      : "flex justify-center"
                  }`}
                >
                  {isPhone ? (
                    <div className="flex w-full flex-col gap-4">
                      {record.pages.map((page, index) => (
                        <div
                          id={`signing-page-${page.pageNumber}`}
                          key={page.pageNumber}
                          className="scroll-mt-24"
                        >
                          <p className="mb-1.5 text-center text-xs font-semibold text-(--tertiary)">
                            {tr("Page {page} of {count}", {
                              count: record.pageCount,
                              page: page.pageNumber,
                            })}
                          </p>
                          {renderPage(page.pageNumber, index === 0)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    renderPage(activePage, true)
                  )}
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-[5.25rem] xl:self-start">
            <section className="panel rounded-[1.25rem] p-5">
              <p className="section-eyebrow">{tr("Current signer")}</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-(--accent-soft) text-[0.9375rem] font-bold text-(--accent-ink)">
                  {getInitials(record.signer.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[0.9375rem] font-bold text-(--fg)">
                    {record.signer.name}
                  </p>
                  <p className="truncate text-sm text-(--secondary)">
                    {displayEmail(record.signer.email)}
                  </p>
                </div>
              </div>

              <div className="well mt-5 p-4">
                <p className="section-eyebrow">{tr("Ready to finish")}</p>
                <p className="mt-1.5 text-[0.9375rem] font-bold text-(--fg)">
                  {remainingFields === 0
                    ? tr("All required fields complete")
                    : remainingFields === 1
                      ? tr("1 required field remaining")
                      : tr("{count} required fields remaining", {
                          count: remainingFields,
                        })}
                </p>
                {invalidNumberCount > 0 ? (
                  <p
                    className="mt-1.5 text-[0.8125rem] font-semibold leading-5 text-(--danger)"
                    role="alert"
                  >
                    {tr("A number field marked in red does not hold a number.")}{" "}
                    {tr(NUMBER_ENTRY_MESSAGE)}
                  </p>
                ) : null}
                <div
                  aria-hidden="true"
                  className="mt-3 h-2 overflow-hidden rounded-full bg-(--surface-strong)"
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${
                      remainingFields === 0 ? "bg-(--success)" : "bg-(--accent)"
                    }`}
                    style={{ width: `${completionPercent}%` }}
                  />
                </div>
                {record.visibleFields.length > 0 ? (
                  <p className="mt-3 text-[0.8125rem] leading-5 text-(--secondary)">
                    {tr(
                      "Previous signer values stay visible but locked. Only your assigned fields are interactive.",
                    )}
                  </p>
                ) : null}
              </div>

              <div className="mt-4">
                <ShellButton
                  className="w-full"
                  disabled={!canFinish || isDeclining || isSubmitting}
                  onClick={() => {
                    setSubmitError(null);
                    setIsFinishDialogOpen(true);
                  }}
                >
                  {tr("Finish")}
                </ShellButton>
              </div>
            </section>

            <section className="panel rounded-[1.25rem] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="section-eyebrow">{tr("Assigned fields")}</p>
                <span className="pill pill-neutral">
                  {actionSummaryFields.length}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {actionSummaryFields.map((field) => (
                  <FieldStatusRow
                    isComplete={isFieldComplete(
                      field,
                      record.currentSignerFields,
                      enteredValues,
                    )}
                    isInvalid={hasInvalidNumber(field, textValues)}
                    key={field.id}
                    label={`${getSummaryLabel(field)} · ${tr("Page {page}", { page: field.page })}`}
                    value={getCompletionValue(
                      field,
                      record.currentSignerFields,
                      {
                        ...enteredValues,
                        localDateLabel,
                        signerName: record.signer.name,
                      },
                    )}
                  />
                ))}
              </div>
            </section>

            <div className="pb-24 text-center sm:hidden">
              <button
                className="text-sm font-semibold text-(--secondary) underline underline-offset-4"
                disabled={isSubmitting || isDeclining}
                onClick={() => {
                  setDeclineError(null);
                  setIsDeclineDialogOpen(true);
                }}
                type="button"
              >
                {tr("I do not want to sign")}
              </button>
            </div>
          </aside>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-(--border) bg-(--paper) px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] sm:hidden">
        {canFinish ? (
          <ShellButton
            className="w-full"
            disabled={isDeclining || isSubmitting}
            onClick={() => {
              setSubmitError(null);
              setIsFinishDialogOpen(true);
            }}
          >
            {tr("Finish")}
          </ShellButton>
        ) : (
          <ShellButton className="w-full" onClick={goToNextField}>
            {nextRequiredField &&
            (isPhone || nextRequiredField.page !== activePage)
              ? tr("Go to the signature (page {page})", {
                  page: nextRequiredField.page,
                })
              : tr("Tap the blue box to sign")}
          </ShellButton>
        )}
      </div>

      <PublicLegalFooter />

      {signatureModal ? (
        <SignatureModal
          existingEntry={
            signatureValues[signatureModal.fieldId] ??
            reusableSignatureEntries[signatureModal.type] ??
            undefined
          }
          drawnSignatureVersion={drawnSignatureVersion}
          fieldType={signatureModal.type}
          onApply={(entry) => {
            setReusableSignatureEntries((current) => ({
              ...current,
              [signatureModal.type]: entry,
            }));
            setSignatureValues((current) => ({
              ...current,
              [signatureModal.fieldId]: entry,
            }));
            setSubmitError(null);
            setSignatureModal(null);
          }}
          onClearDrawnSignature={() =>
            setDrawnSignatureVersion((current) => current + 1)
          }
          onClose={() => setSignatureModal(null)}
          onModeChange={(mode) =>
            setSignatureModal((current) =>
              current
                ? {
                    ...current,
                    mode,
                  }
                : null,
            )
          }
          signatureMode={signatureModal.mode}
          signerName={record.signer.name}
        />
      ) : null}

      {isFinishDialogOpen ? (
        <DialogFrame
          description={tr('You are signing "{title}" from {sender}.', {
            sender: record.senderName,
            title: record.envelopeTitle,
          })}
          title={tr("Finish signing?")}
          onClose={() => {
            if (isSubmitting) {
              return;
            }

            setIsFinishDialogOpen(false);
            setSubmitError(null);
          }}
        >
          {providerSignature ? (
            <div className="grid gap-3 text-sm leading-6 text-(--secondary)">
              <p>
                This document asks for{" "}
                {providerSignature.level === "qualified"
                  ? "a qualified electronic signature"
                  : "an advanced electronic signature"}
                , made with a certificate in your own name.
              </p>
              <p>
                Next, {providerSignature.providerName} asks you to confirm who
                you are and to approve the signature. When it is done, you come
                back here. By continuing, you confirm that your signature is
                intended to be binding for this document.
              </p>
            </div>
          ) : (
            <p className="text-sm leading-6 text-(--secondary)">
              {tr(
                "By clicking Finish, you confirm that your electronic signature is intended to be binding for this document.",
              )}
            </p>
          )}
          {providerSignature ? null : (
            <p className="text-xs leading-5 text-(--tertiary)">
              {tr(
                "Your browser may ask to share your location. It is optional: it adds the place where you signed to the certificate, and you can sign without it.",
              )}
            </p>
          )}
          {part11 ? (
            <div className="grid gap-4">
              <div className="well rounded-xl px-3.5 py-3">
                <p className="text-xs font-semibold text-(--tertiary)">
                  {tr("Meaning of your signature")}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-(--fg)">
                  {part11.meaningLabel}: {part11.meaningStatement}
                </p>
              </div>
              <label className="flex items-start gap-3 text-sm leading-6 text-(--secondary)">
                <Checkbox
                  aria-label={tr("I confirm the meaning of my signature")}
                  checked={isMeaningConfirmed}
                  className="mt-1"
                  disabled={isSubmitting}
                  onCheckedChange={(checked) =>
                    setIsMeaningConfirmed(checked === true)
                  }
                />
                <span>
                  {tr(
                    "I confirm this meaning. My name, the date and time, and this meaning will be printed with my signature.",
                  )}
                </span>
              </label>
              <p className="text-sm leading-6 text-(--secondary)">
                {tr("Enter your account's email address and password to sign.")}
              </p>
              <FieldShell
                autoComplete="username"
                disabled={isSubmitting}
                label={tr("Email address")}
                name="reauth-email"
                onChange={(event) => setReauthEmail(event.target.value)}
                readOnly={false}
                type="email"
                value={reauthEmail}
              />
              <FieldShell
                autoComplete="current-password"
                disabled={isSubmitting}
                label={tr("Password")}
                name="reauth-password"
                onChange={(event) => setReauthPassword(event.target.value)}
                readOnly={false}
                type="password"
                value={reauthPassword}
              />
            </div>
          ) : null}
          {submitError ? (
            <div className="notice notice-danger" role="alert">
              {submitError}
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <ShellButton
              disabled={isDeclining || isSubmitting}
              onClick={() => {
                setIsFinishDialogOpen(false);
                setSubmitError(null);
              }}
              variant="secondary"
            >
              {tr("Back")}
            </ShellButton>
            <ShellButton
              disabled={!isReauthReady}
              loading={isSubmitting}
              onClick={handleFinishSigning}
            >
              {providerSignature
                ? isSubmitting
                  ? tr("Preparing...")
                  : tr("Continue to {provider}", {
                      provider: providerSignature.providerName,
                    })
                : isSubmitting
                  ? tr("Finishing...")
                  : tr("Finish signing")}
            </ShellButton>
          </div>
        </DialogFrame>
      ) : null}

      {consentedAt === null && !isDeclineDialogOpen ? (
        <DialogFrame
          description={tr(
            '{sender} sent you "{title}" to sign electronically.',
            {
              sender: record.senderName,
              title: record.envelopeTitle,
            },
          )}
          onClose={() => undefined}
          title={tr("Before you sign")}
        >
          <div className="well max-h-[45vh] space-y-4 overflow-y-auto px-4 py-4 text-sm leading-6 text-(--secondary) sm:px-5">
            {record.disclosure.sections.map((section) => (
              <section key={section.heading}>
                <h3 className="font-bold text-(--fg)">{section.heading}</h3>
                <p className="mt-1">{section.text}</p>
              </section>
            ))}
          </div>
          <label className="flex items-start gap-3 text-sm leading-6 text-(--fg)">
            <Checkbox
              aria-label={tr(
                "I agree to use electronic records and signatures",
              )}
              checked={isConsentChecked}
              className="mt-1"
              disabled={isSavingConsent}
              onCheckedChange={(checked) =>
                setIsConsentChecked(checked === true)
              }
            />
            <span>{record.disclosure.statement}</span>
          </label>
          {consentError ? (
            <div className="notice notice-danger" role="alert">
              {consentError}
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <ShellButton
              disabled={isSavingConsent}
              onClick={() => {
                setDeclineError(null);
                setIsDeclineDialogOpen(true);
              }}
              variant="secondary"
            >
              {tr("Decline")}
            </ShellButton>
            <ShellButton
              disabled={!isConsentChecked}
              loading={isSavingConsent}
              onClick={handleConsent}
            >
              {tr("Agree and continue")}
            </ShellButton>
          </div>
        </DialogFrame>
      ) : null}

      {isDeclineDialogOpen ? (
        <DialogFrame
          description={tr(
            "The sender ({sender}) will be notified that you declined. This cannot be undone.",
            { sender: record.senderName },
          )}
          title={tr("Decline to sign?")}
          onClose={() => {
            if (isDeclining) {
              return;
            }

            setDeclineError(null);
            setIsDeclineDialogOpen(false);
          }}
        >
          <label className="grid gap-1.5">
            <span className="text-[0.8125rem] font-semibold text-(--secondary)">
              {tr("Reason (optional)")}
            </span>
            <Textarea
              autoFocus
              className="min-h-28"
              id="signing-decline-reason"
              name="signing-decline-reason"
              onChange={(event) => setDeclineReason(event.target.value)}
              placeholder={tr("I'd like to discuss some terms first...")}
              value={declineReason}
            />
          </label>
          {declineError ? (
            <div className="notice notice-danger" role="alert">
              {declineError}
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <ShellButton
              disabled={isDeclining}
              onClick={() => {
                setDeclineError(null);
                setIsDeclineDialogOpen(false);
              }}
              variant="secondary"
            >
              {tr("Cancel")}
            </ShellButton>
            <ShellButton
              loading={isDeclining}
              onClick={handleDeclineSigning}
              variant="danger"
            >
              {isDeclining ? tr("Declining...") : tr("Decline to sign")}
            </ShellButton>
          </div>
        </DialogFrame>
      ) : null}
    </div>
  );
}

function SigningToolbarStatus({
  hasLockedFields,
  remainingFields,
}: {
  hasLockedFields: boolean;
  remainingFields: number;
}) {
  return (
    <div className="inline-flex min-h-10 items-center gap-2.5 rounded-full bg-(--surface) py-1.5 pl-2.5 pr-4">
      <span
        aria-hidden="true"
        className={`inline-flex size-6 items-center justify-center rounded-full ${
          remainingFields === 0
            ? "bg-(--success-soft) text-(--success)"
            : "bg-(--accent) text-white"
        }`}
      >
        {remainingFields === 0 ? (
          <svg
            aria-hidden="true"
            className="size-3.5"
            fill="none"
            viewBox="0 0 16 16"
          >
            <path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        ) : (
          <span className="text-[11px] font-bold leading-none">
            {remainingFields}
          </span>
        )}
      </span>
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-bold leading-tight text-(--fg)">
          {remainingFields === 0
            ? tr("Ready to finish")
            : remainingFields === 1
              ? tr("1 required remaining")
              : tr("{count} required remaining", { count: remainingFields })}
        </p>
        <p className="text-xs leading-tight text-(--tertiary)">
          {hasLockedFields
            ? tr("Locked values visible")
            : tr("Current signer view")}
        </p>
      </div>
    </div>
  );
}

function CurrentSignerField({
  checkboxValue,
  field,
  isInvalid,
  localDateLabel,
  onCheckboxChange,
  onSignatureClick,
  onTextChange,
  signatureEntry,
  signerName,
  textValue,
}: {
  checkboxValue: boolean;
  field: SigningCurrentField;
  /** True for a number field holding something that is not a number. */
  isInvalid: boolean;
  localDateLabel: string;
  onCheckboxChange: (checked: boolean) => void;
  onSignatureClick: () => void;
  onTextChange: (value: string) => void;
  signatureEntry?: SignatureEntry;
  /** What a name field shows: the name the sender gave this signer. */
  signerName: string;
  textValue: string;
}) {
  const frame = getFieldFrame(field);
  const showInlineLabel = shouldShowInlineFieldLabel(field);
  const showInlineValue = shouldShowInlineFieldValue(field);

  if (field.type === "signature" || field.type === "initials") {
    return (
      <button
        aria-label={getSummaryLabel(field)}
        className={`absolute z-2 overflow-hidden rounded-[0.375rem] border-2 border-(--accent) text-(--accent-ink) transition ${
          signatureEntry?.value
            ? "bg-[rgb(var(--accent-rgb)/0.10)]"
            : "bg-[rgb(var(--accent-rgb)/0.07)] hover:bg-[rgb(var(--accent-rgb)/0.16)]"
        }`}
        data-signing-field="true"
        onClick={onSignatureClick}
        style={frame}
        type="button"
      >
        <span className="pointer-events-none flex h-full w-full items-center justify-center overflow-hidden px-1 text-center">
          {signatureEntry?.inputMethod === "drawn" &&
          signatureEntry.imageDataUrl ? (
            <span className="relative block h-full w-full">
              <Image
                alt={
                  field.type === "initials"
                    ? tr("Initials preview")
                    : tr("Signature preview")
                }
                className="object-contain p-1"
                fill
                src={signatureEntry.imageDataUrl}
                unoptimized
              />
            </span>
          ) : signatureEntry?.value && showInlineValue ? (
            <span
              className="block max-w-full truncate px-1 text-sm"
              style={{
                fontFamily:
                  signatureEntry.inputMethod === "typed"
                    ? typedSignatureFont
                    : undefined,
                fontSize:
                  signatureEntry.inputMethod === "typed"
                    ? "1.05rem"
                    : undefined,
              }}
            >
              {signatureEntry.value}
            </span>
          ) : showInlineLabel ? (
            <span className="block max-w-full truncate px-1 text-xs font-bold">
              {getCanvasFieldLabel(field)}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  // Filled in for the signer: the day they sign, or their name.
  if (field.type === "date" || field.type === "name") {
    return (
      <div
        className="absolute z-2 overflow-hidden rounded-[0.375rem] border border-(--border-strong) bg-white/92 text-sm text-(--fg)"
        data-signing-field="true"
        style={frame}
      >
        {showInlineValue ? (
          <p className="flex h-full items-center truncate px-2 text-[12px] font-semibold">
            {field.type === "date" ? localDateLabel : signerName}
          </p>
        ) : null}
      </div>
    );
  }

  if (field.type === "text") {
    return (
      <div
        className="absolute z-2 overflow-hidden rounded-[0.375rem] border-2 border-(--accent) bg-[rgb(var(--accent-rgb)/0.07)] focus-within:bg-white"
        data-signing-field="true"
        style={frame}
      >
        <input
          aria-label={getFieldLabel(field)}
          className="h-full w-full border-none bg-transparent px-2 text-sm text-(--fg) outline-none placeholder:text-(--placeholder)"
          id={`signing-field-${field.id}`}
          name={`signing-field-${field.id}`}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder={showInlineLabel ? getFieldLabel(field) : ""}
          value={textValue}
        />
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div
        className={`absolute z-2 overflow-hidden rounded-[0.375rem] border-2 focus-within:bg-white ${
          isInvalid
            ? "border-(--danger) bg-(--danger-soft)"
            : "border-(--accent) bg-[rgb(var(--accent-rgb)/0.07)]"
        }`}
        data-signing-field="true"
        style={frame}
        title={isInvalid ? NUMBER_ENTRY_MESSAGE : undefined}
      >
        <input
          aria-invalid={isInvalid ? true : undefined}
          aria-label={getFieldLabel(field)}
          autoComplete="off"
          className="h-full w-full border-none bg-transparent px-2 text-sm text-(--fg) outline-none placeholder:text-(--placeholder)"
          id={`signing-field-${field.id}`}
          inputMode="decimal"
          name={`signing-field-${field.id}`}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder={showInlineLabel ? tr("Number") : ""}
          value={textValue}
        />
      </div>
    );
  }

  if (field.type === "dropdown") {
    return (
      <div
        className="absolute z-2 overflow-hidden rounded-[0.375rem] border-2 border-(--accent) bg-[rgb(var(--accent-rgb)/0.07)] focus-within:bg-white"
        data-signing-field="true"
        style={frame}
      >
        <select
          aria-label={getFieldLabel(field)}
          className={`h-full w-full cursor-pointer border-none bg-transparent bg-size-[0.75rem] bg-position-[right_0.25rem_center] pr-5 pl-1.5 text-sm outline-none ${
            textValue ? "text-(--fg)" : "text-(--secondary)"
          }`}
          id={`signing-field-${field.id}`}
          name={`signing-field-${field.id}`}
          onChange={(event) => onTextChange(event.target.value)}
          value={textValue}
        >
          <option value="">
            {field.required ? tr("Choose one") : tr("No answer")}
          </option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "radio") {
    return (
      <button
        aria-checked={checkboxValue}
        aria-label={getFieldLabel(field)}
        className={`absolute z-2 flex items-center justify-center rounded-full border-2 border-(--accent) text-(--accent-ink) transition ${
          checkboxValue
            ? "bg-[rgb(var(--accent-rgb)/0.14)]"
            : "bg-white hover:bg-[rgb(var(--accent-rgb)/0.10)]"
        }`}
        data-signing-field="true"
        // An answer that is needed can be changed but not taken back; one
        // that is optional can be cleared by choosing it again.
        onClick={() => onCheckboxChange(field.required ? true : !checkboxValue)}
        role="radio"
        style={frame}
        type="button"
      >
        {checkboxValue ? (
          <span
            aria-hidden="true"
            className="block size-[52%] max-h-3 max-w-3 rounded-full bg-current"
          />
        ) : null}
      </button>
    );
  }

  return (
    <button
      aria-label={getFieldLabel(field)}
      aria-pressed={checkboxValue}
      className={`absolute z-2 flex items-center justify-center rounded-[0.25rem] border-2 border-(--accent) text-(--accent-ink) transition ${
        checkboxValue
          ? "bg-[rgb(var(--accent-rgb)/0.14)]"
          : "bg-white hover:bg-[rgb(var(--accent-rgb)/0.10)]"
      }`}
      data-signing-field="true"
      onClick={() => onCheckboxChange(!checkboxValue)}
      style={frame}
      type="button"
    >
      {checkboxValue ? (
        <svg
          aria-hidden="true"
          className="h-[68%] w-[68%] max-h-4 max-w-4 text-current"
          fill="none"
          viewBox="0 0 16 16"
        >
          <path
            d="M3.5 8.5 6.5 11.5 12.5 4.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      ) : null}
    </button>
  );
}

function VisibleFieldStamp({ field }: { field: SigningVisibleField }) {
  const frame = getFieldFrame(field);
  const showInlineLabel = shouldShowInlineFieldLabel(field);
  const showInlineValue = shouldShowInlineFieldValue(field);

  if (field.type === "radio") {
    return (
      <div
        className="pointer-events-none absolute z-1 flex items-center justify-center rounded-full border border-(--border-strong) bg-[rgba(28,29,43,0.03)]"
        data-signing-field="true"
        style={frame}
      >
        {field.checked ? (
          <span
            aria-hidden="true"
            className="block size-[52%] max-h-3 max-w-3 rounded-full bg-(--secondary)"
          />
        ) : null}
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <div
        className="pointer-events-none absolute z-1 flex items-center justify-center rounded-[0.25rem] border border-(--border-strong) bg-[rgba(28,29,43,0.03)]"
        data-signing-field="true"
        style={frame}
      >
        {field.checked ? (
          <svg
            aria-hidden="true"
            className="h-[68%] w-[68%] max-h-4 max-w-4 text-(--secondary)"
            fill="none"
            viewBox="0 0 16 16"
          >
            <path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        ) : null}
      </div>
    );
  }

  if (
    (field.type === "signature" || field.type === "initials") &&
    field.imageDataUrl
  ) {
    return (
      <div
        className="pointer-events-none absolute z-1 overflow-hidden rounded-[0.375rem] border border-(--border-strong) bg-[rgba(28,29,43,0.03)]"
        data-signing-field="true"
        style={frame}
      >
        <Image
          alt={`${field.signerName} completed ${field.type}`}
          className="object-contain"
          fill
          src={field.imageDataUrl}
          unoptimized
        />
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute z-1 overflow-hidden rounded-[0.375rem] border border-(--border-strong) bg-[rgba(28,29,43,0.03)] text-(--secondary)"
      data-signing-field="true"
      style={frame}
    >
      <div className="flex h-full w-full items-center overflow-hidden px-1">
        {showInlineValue ? (
          <p
            className={`truncate ${
              showInlineLabel ? "text-[12px]" : "w-full text-center text-[11px]"
            } font-medium`}
            style={{
              fontFamily:
                field.inputMethod === "typed" &&
                (field.type === "signature" || field.type === "initials")
                  ? typedSignatureFont
                  : undefined,
              fontSize:
                field.inputMethod === "typed" &&
                (field.type === "signature" || field.type === "initials")
                  ? "1rem"
                  : undefined,
            }}
          >
            {getVisibleFieldValue(field)}
          </p>
        ) : showInlineLabel ? (
          <p className="w-full truncate text-center text-[11px] font-semibold text-(--tertiary)">
            {getCanvasFieldLabel(field)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SignatureModal({
  existingEntry,
  drawnSignatureVersion,
  fieldType,
  onApply,
  onClearDrawnSignature,
  onClose,
  onModeChange,
  signatureMode,
  signerName,
}: {
  existingEntry?: SignatureEntry;
  drawnSignatureVersion: number;
  fieldType: "initials" | "signature";
  onApply: (entry: SignatureEntry) => void;
  onClearDrawnSignature: () => void;
  onClose: () => void;
  onModeChange: (mode: "drawn" | "typed") => void;
  signatureMode: "drawn" | "typed";
  signerName: string;
}) {
  const [drawnSignatureDataUrl, setDrawnSignatureDataUrl] = useState<
    string | null
  >(
    existingEntry?.inputMethod === "drawn"
      ? (existingEntry.imageDataUrl ?? null)
      : null,
  );
  const [typedSignatureValue, setTypedSignatureValue] = useState(() => {
    if (existingEntry?.inputMethod === "typed" && existingEntry.value.trim()) {
      return existingEntry.value;
    }

    return fieldType === "initials" ? getInitials(signerName) : signerName;
  });
  const drawPreviewMessage =
    drawnSignatureVersion === 0
      ? tr("Draw with mouse or finger")
      : tr("Canvas cleared {count} times", { count: drawnSignatureVersion });
  const typedPlaceholder =
    fieldType === "initials"
      ? tr("Type your initials")
      : tr("Type your signature");
  const normalizedTypedSignatureValue = typedSignatureValue.trim();
  const canApply =
    signatureMode === "typed"
      ? normalizedTypedSignatureValue.length > 0
      : Boolean(drawnSignatureDataUrl);

  function handleTypedSignatureValueChange(value: string) {
    if (fieldType === "initials") {
      setTypedSignatureValue(value.toUpperCase().slice(0, 4));
      return;
    }

    setTypedSignatureValue(value);
  }

  return (
    <DialogFrame
      description={tr(
        "By signing, you agree that this electronic signature is the legal equivalent of your manual signature.",
      )}
      title={
        fieldType === "initials"
          ? tr("Add your initials")
          : tr("Add your signature")
      }
      onClose={onClose}
    >
      <Tabs
        className="gap-4"
        onValueChange={(value) => onModeChange(value as "typed" | "drawn")}
        value={signatureMode}
      >
        <TabsList className="segmented flex h-auto w-full p-1 group-data-horizontal/tabs:h-auto">
          <TabsTrigger
            className="segmented-item h-auto min-h-10 flex-1 data-active:bg-white data-active:text-(--fg) data-active:shadow-[0_1px_3px_rgba(28,29,43,0.12)] after:hidden"
            value="typed"
          >
            {tr("Type")}
          </TabsTrigger>
          <TabsTrigger
            className="segmented-item h-auto min-h-10 flex-1 data-active:bg-white data-active:text-(--fg) data-active:shadow-[0_1px_3px_rgba(28,29,43,0.12)] after:hidden"
            value="drawn"
          >
            {tr("Draw")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {signatureMode === "typed" ? (
        <div className="space-y-4">
          <label className="grid gap-1.5">
            <span className="text-[0.8125rem] font-semibold text-(--secondary)">
              {fieldType === "initials"
                ? tr("Type initials")
                : tr("Type signature")}
            </span>
            <input
              autoFocus
              className="field-input"
              id={`signature-modal-${fieldType}`}
              maxLength={fieldType === "initials" ? 4 : 80}
              name={`signature-modal-${fieldType}`}
              onChange={(event) =>
                handleTypedSignatureValueChange(event.target.value)
              }
              placeholder={typedPlaceholder}
              value={typedSignatureValue}
            />
          </label>

          <div className="well px-6 py-8 text-center">
            <p
              className={`text-[40px] leading-none sm:text-[52px] ${
                normalizedTypedSignatureValue
                  ? "text-(--fg)"
                  : "text-(--placeholder)"
              }`}
              style={{ fontFamily: typedSignatureFont }}
            >
              {normalizedTypedSignatureValue || typedPlaceholder}
            </p>
            <p className="mt-4 text-xs font-medium text-(--tertiary)">
              {tr("Rendered in signature style")}
            </p>
          </div>
        </div>
      ) : (
        <div className="well p-3">
          <SignatureDrawCanvas
            emptyMessage={drawPreviewMessage}
            initialDataUrl={
              drawnSignatureVersion === 0 &&
              existingEntry?.inputMethod === "drawn"
                ? (existingEntry.imageDataUrl ?? null)
                : null
            }
            key={drawnSignatureVersion}
            onChange={setDrawnSignatureDataUrl}
          />
          <div className="mt-2 flex justify-end">
            <ShellButton
              className="min-h-10 px-4 text-sm"
              onClick={() => {
                setDrawnSignatureDataUrl(null);
                onClearDrawnSignature();
              }}
              variant="ghost"
            >
              {tr("Clear")}
            </ShellButton>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <ShellButton onClick={onClose} variant="secondary">
          {tr("Cancel")}
        </ShellButton>
        <ShellButton
          disabled={!canApply}
          onClick={() =>
            onApply(
              signatureMode === "drawn"
                ? {
                    imageDataUrl: drawnSignatureDataUrl,
                    inputMethod: "drawn",
                    value:
                      fieldType === "initials"
                        ? "Drawn initials"
                        : "Drawn signature",
                  }
                : {
                    imageDataUrl: null,
                    inputMethod: "typed",
                    value: normalizedTypedSignatureValue,
                  },
            )
          }
        >
          {fieldType === "initials"
            ? tr("Apply initials")
            : tr("Apply signature")}
        </ShellButton>
      </div>
    </DialogFrame>
  );
}

function SignatureDrawCanvas({
  emptyMessage,
  initialDataUrl,
  onChange,
}: {
  emptyMessage: string;
  initialDataUrl?: string | null;
  onChange: (value: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const storedDataUrlRef = useRef<string | null>(initialDataUrl ?? null);
  const [hasSignature, setHasSignature] = useState(Boolean(initialDataUrl));

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const redrawStoredImage = () => {
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);

      if (!storedDataUrlRef.current) {
        return;
      }

      const image = new window.Image();

      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.clientWidth, canvas.clientHeight);
      };
      image.src = storedDataUrlRef.current;
    };

    const resizeCanvas = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const width = Math.max(canvas.offsetWidth, 1);
      const height = Math.max(canvas.offsetHeight, 1);

      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      context.scale(ratio, ratio);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.2;
      context.strokeStyle = "#111111";
      redrawStoredImage();
    };

    resizeCanvas();
    setHasSignature(Boolean(storedDataUrlRef.current));
    window.addEventListener("resize", resizeCanvas);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [onChange]);

  function getCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    return { x, y };
  }

  function commitDrawing() {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const dataUrl = canvas.toDataURL("image/png");

    storedDataUrlRef.current = dataUrl;
    setHasSignature(true);
    onChange(dataUrl);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const point = getCanvasPoint(event);

    if (!canvas || !context || !point) {
      return;
    }

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    isDrawingRef.current = true;
    lastPointRef.current = point;
    context.beginPath();
    context.arc(point.x, point.y, 1.2, 0, Math.PI * 2);
    context.fillStyle = "#111111";
    context.fill();
    context.beginPath();
    context.moveTo(point.x, point.y);
    setHasSignature(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const point = getCanvasPoint(event);

    if (
      !isDrawingRef.current ||
      !canvas ||
      !context ||
      !point ||
      !lastPointRef.current
    ) {
      return;
    }

    event.preventDefault();
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
    setHasSignature(true);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;

    if (!isDrawingRef.current || !canvas) {
      return;
    }

    event.preventDefault();
    isDrawingRef.current = false;
    lastPointRef.current = null;
    canvas.releasePointerCapture(event.pointerId);
    commitDrawing();
  }

  return (
    <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-(--border-strong) bg-white">
      <canvas
        aria-label={tr("Draw signature canvas")}
        className="h-[220px] w-full touch-none"
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerEnd}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        ref={canvasRef}
      />
      {!hasSignature ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-(--tertiary)">
          {emptyMessage}
        </div>
      ) : null}
    </div>
  );
}

function DialogFrame({
  children,
  description,
  onClose,
  title,
}: {
  children: ReactNode;
  description: string;
  onClose: () => void;
  title: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-[min(600px,calc(100%-2rem))] overflow-y-auto p-0"
        showCloseButton={false}
      >
        <div>
          <DialogHeader className="space-y-2 px-6 pt-6 sm:px-8 sm:pt-8">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 px-6 pb-6 pt-5 sm:px-8 sm:pb-8">
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldStatusRow({
  isComplete,
  isInvalid,
  label,
  value,
}: {
  isComplete: boolean;
  /** Filled in, but with something the field cannot take. */
  isInvalid: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="well flex items-center justify-between gap-3 rounded-xl px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-(--tertiary)">{label}</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-(--fg)">
          {value}
        </p>
      </div>
      <span
        className={`pill shrink-0 ${
          isInvalid
            ? "pill-danger"
            : isComplete
              ? "pill-success"
              : "pill-accent"
        }`}
      >
        {isInvalid
          ? tr("Fix this")
          : isComplete
            ? tr("Complete")
            : tr("Required")}
      </span>
    </div>
  );
}

/** Phones (below Tailwind's sm): the document scrolls as one long page. */
function useIsPhone() {
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setIsPhone(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  return isPhone;
}
