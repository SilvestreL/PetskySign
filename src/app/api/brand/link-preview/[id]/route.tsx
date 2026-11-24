import { ImageResponse } from "next/og";

import { getDb } from "@/lib/db/connection";
import { PETSKY_LOGO_PNG_BASE64 } from "@/lib/petsky/certificate-logo";
import { getDocumentBranding } from "@/lib/petsky/document-branding";
import { tr } from "@/lib/petsky/locale";
import { createStorageService } from "@/lib/services/storage";

// PetskySign: the picture in a signing link's preview (WhatsApp, iMessage...):
// the logo and name of the business that sent the document. Public like the
// document's logo; the document's title is not in it.

type Context = { params: Promise<{ id: string }> };

const DAY_SECONDS = 24 * 60 * 60;

async function readLogo(logoKey: string | null): Promise<string | null> {
  if (!logoKey) {
    return null;
  }

  try {
    const logo = await createStorageService().getObject(logoKey);
    const type = logo.contentType ?? "";

    // The picture is drawn by Satori, which reads PNG and JPEG.
    if (type !== "image/png" && type !== "image/jpeg") {
      return null;
    }

    return `data:${type};base64,${Buffer.from(logo.body).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const branding = await getDocumentBranding(id, getDb()).catch(() => null);

  if (!branding) {
    return new Response(null, { status: 404 });
  }

  const name = branding.name?.trim() || "Petsky";
  const color = /^#[0-9a-f]{6}$/i.test(branding.color ?? "")
    ? branding.color!
    : "#2d6fd1";
  const logo = await readLogo(branding.logoKey);
  const petskyLogo = `data:image/png;base64,${PETSKY_LOGO_PNG_BASE64}`;

  const image = new ImageResponse(
    (
      <div
        style={{
          background: "#f6f8fb",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          width: "100%",
        }}
      >
        <div style={{ background: color, display: "flex", height: 18 }} />
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flex: 1,
            gap: 56,
            padding: "0 80px",
          }}
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              height={260}
              src={logo}
              style={{ borderRadius: 32, objectFit: "contain" }}
              width={260}
            />
          ) : (
            <div
              style={{
                alignItems: "center",
                background: color,
                borderRadius: 32,
                color: "#ffffff",
                display: "flex",
                fontSize: 120,
                fontWeight: 700,
                height: 260,
                justifyContent: "center",
                width: 260,
              }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div
              style={{
                color: "#18293a",
                display: "flex",
                fontSize: name.length > 28 ? 56 : 72,
                fontWeight: 700,
                lineHeight: 1.1,
              }}
            >
              {name}
            </div>
            <div style={{ color: "#5b6b80", display: "flex", fontSize: 38 }}>
              {tr("Sent you a document to sign")}
            </div>
          </div>
        </div>
        <div
          style={{
            alignItems: "center",
            borderTop: "2px solid #e3e8ef",
            display: "flex",
            justifyContent: "space-between",
            padding: "28px 80px",
          }}
        >
          <div style={{ color: "#5b6b80", display: "flex", fontSize: 28 }}>
            {tr("Secure electronic signature")}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" height={50} src={petskyLogo} width={170} />
        </div>
      </div>
    ),
    { height: 630, width: 1200 },
  );

  image.headers.set("cache-control", `public, max-age=${DAY_SECONDS}`);

  return image;
}
