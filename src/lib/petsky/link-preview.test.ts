import assert from "node:assert/strict";
import test from "node:test";

import { isLinkPreviewBot } from "./link-preview.ts";

test("robots drawing a link's preview are told apart from signers", () => {
  for (const bot of [
    "WhatsApp/2.23.20.0 A",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "facebookexternalhit/1.1 Facebot Twitterbot/1.0",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  ]) {
    assert.equal(isLinkPreviewBot(bot), true, bot);
  }

  for (const person of [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
    null,
  ]) {
    assert.equal(isLinkPreviewBot(person), false, String(person));
  }
});
