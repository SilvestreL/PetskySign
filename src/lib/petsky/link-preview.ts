import { type DbExecutor, queryOne } from "../db/connection.ts";
import { hashOpaqueToken } from "../services/opaque-tokens.ts";

/**
 * PetskySign: the preview WhatsApp, iMessage and the like show for a signing
 * link (Open Graph): the document's title, who sent it and their logo.
 */

export type LinkPreview = {
  envelopeId: string;
  name: string | null;
  title: string;
};

/** The document a still-usable signing link opens, for its preview. */
export async function getLinkPreviewForToken(
  token: string,
  database: DbExecutor,
): Promise<LinkPreview | null> {
  if (!token || token.length > 200) {
    return null;
  }

  return queryOne<LinkPreview>(
    database,
    `
      SELECT e.id AS "envelopeId", e.brand_name AS name, e.title
      FROM envelopes e
      JOIN signers s ON s.envelope_id = e.id
      WHERE s.signing_token_hash = $1
      LIMIT 1
    `,
    [hashOpaqueToken(token)],
  );
}

// The robots that open a link to draw its preview. Their visit is not the
// signer's, so it must not be recorded as "viewed" in the certificate.
const LINK_PREVIEW_BOTS =
  /facebookexternalhit|facebot|whatsapp|twitterbot|telegrambot|slackbot|slack-imgproxy|linkedinbot|discordbot|skypeuripreview|applebot|googlebot|bingbot|google-pagerenderer|embedly|pinterest|redditbot|vkshare|iframely|outlook|microsoftpreview|bitlybot/i;

export function isLinkPreviewBot(
  userAgent: string | null | undefined,
): boolean {
  return Boolean(userAgent && LINK_PREVIEW_BOTS.test(userAgent));
}
