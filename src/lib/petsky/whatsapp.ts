/**
 * PetskySign: WhatsApp messages through the Evolution API, the same instance
 * petsky sends from. Used for the one-time code before signing
 * ("whatsapp_code" in signer-checks.ts).
 *
 * EVOLUTION_API_URL, EVOLUTION_API_KEY and EVOLUTION_INSTANCE go together:
 * without any of them nothing is sent, and the API refuses documents that
 * ask for a WhatsApp code.
 */

const TIMEOUT_MS = 15_000;

export type EvolutionConfig = {
  apiKey: string;
  instance: string;
  url: string;
};

export function getEvolutionConfig(
  env: NodeJS.ProcessEnv = process.env,
): EvolutionConfig | null {
  const url = env.EVOLUTION_API_URL?.trim();
  const apiKey = env.EVOLUTION_API_KEY?.trim();
  const instance = env.EVOLUTION_INSTANCE?.trim();

  if (!url || !apiKey || !instance || !/^https?:\/\//.test(url)) {
    return null;
  }

  return { apiKey, instance, url: url.replace(/\/+$/, "") };
}

export type WhatsappSender = (to: string, text: string) => Promise<void>;

export class WhatsappSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsappSendError";
  }
}

/** Sends with the Evolution API v2: POST {url}/message/sendText/{instance}. */
export function createWhatsappSender(
  config: EvolutionConfig | null = getEvolutionConfig(),
  fetchImpl: typeof fetch = fetch,
): WhatsappSender | null {
  if (!config) {
    return null;
  }

  const endpoint = `${config.url}/message/sendText/${encodeURIComponent(config.instance)}`;

  return async (to, text) => {
    let response: Response;

    try {
      response = await fetchImpl(endpoint, {
        body: JSON.stringify({ number: to, text }),
        headers: {
          accept: "application/json",
          apikey: config.apiKey,
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new WhatsappSendError("The WhatsApp service did not answer.");
    }

    // The answer echoes the number; it is not read or logged.
    await response.body?.cancel().catch(() => undefined);

    if (!response.ok) {
      throw new WhatsappSendError(
        `The WhatsApp service refused the message (HTTP ${String(response.status)}).`,
      );
    }
  };
}

/**
 * A Brazilian mobile number as "55" + area code + 9 digits, from "+55 (82)
 * 99605-7758", "82996057758" or "5582996057758". Null for anything else,
 * landlines included: they have no WhatsApp to send a code to.
 */
export function normalizeBrazilMobile(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  let digits = input.replace(/\D/g, "");

  if (digits.length === 11) {
    digits = `55${digits}`;
  }

  return /^55[1-9][0-9]9[0-9]{8}$/.test(digits) ? digits : null;
}

/** "(82) •••••-7758": enough for the signer to recognize their number. */
export function maskPhone(phone: string): string {
  const local = phone.startsWith("55") ? phone.slice(2) : phone;

  return `(${local.slice(0, 2)}) •••••-${local.slice(-4)}`;
}
