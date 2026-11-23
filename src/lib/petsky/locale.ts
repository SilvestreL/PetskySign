import { PT_BR } from "./pt-br.ts";
import { PT_BR_ADMIN } from "./pt-br-admin.ts";
import { PT_BR_ENVELOPES } from "./pt-br-envelopes.ts";
import { PT_BR_MISC } from "./pt-br-misc.ts";
import { PT_BR_SETTINGS } from "./pt-br-settings.ts";

/**
 * PetskySign: the language of what signers see. SignuDoc is written in
 * English; with NEXT_PUBLIC_APP_LOCALE=pt-BR the signer-facing text is shown
 * in Brazilian Portuguese instead.
 *
 * `tr()` takes the original English text and returns its translation, so
 * the English stays in the code where SignuDoc wrote it. That keeps merges
 * from SignuDoc simple, and text added there later shows in English (never
 * broken) until it is translated in pt-br.ts.
 *
 * NEXT_PUBLIC_ variables are fixed at build time in the browser bundle, so
 * the language is chosen when the app is built (on Coolify, a build env).
 */

export type AppLocale = "en" | "pt-BR";

export function appLocale(): AppLocale {
  // Written out in full: Next.js replaces exactly this expression at build.
  return process.env.NEXT_PUBLIC_APP_LOCALE === "pt-BR" ? "pt-BR" : "en";
}

/** For Intl formatters: "en-US" or "pt-BR". */
export function intlLocale(): string {
  return appLocale() === "pt-BR" ? "pt-BR" : "en-US";
}

/** The time zone dates are shown in, when the code names one. */
export function displayTimeZone(): string {
  return appLocale() === "pt-BR" ? "America/Sao_Paulo" : "UTC";
}

/** Every dictionary; where two translate the same text, the first wins. */
const PT_BR_ALL: Readonly<Record<string, string>> = {
  ...PT_BR_MISC,
  ...PT_BR_SETTINGS,
  ...PT_BR_ENVELOPES,
  ...PT_BR_ADMIN,
  ...PT_BR,
};

export type TrParams = Record<string, string | number>;

/**
 * Translates `text` (the English original) into the app's language and fills
 * in `{name}` placeholders from `params`. Unknown text comes back as it is.
 */
export function tr(text: string, params?: TrParams): string {
  const template = appLocale() === "pt-BR" ? (PT_BR_ALL[text] ?? text) : text;

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : match,
  );
}
