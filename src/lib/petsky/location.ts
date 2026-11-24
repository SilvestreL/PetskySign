import { z } from "zod";

/**
 * PetskySign: where a signer was when they opened, accepted and signed, as
 * evidence beside the IP address and the browser (D4Sign shows the same).
 *
 * Two sources, kept apart and always labelled:
 *
 * - "ip": approximate, from the visitor's IP address. Cloudflare looks it up
 *   and sends it in the cf-ipcity, cf-region, cf-ipcountry, cf-iplatitude
 *   and cf-iplongitude headers once the zone's "Add visitor location
 *   headers" managed transform is on. Read only when
 *   TRUSTED_LOCATION_HEADERS=cloudflare, because without Cloudflare in front
 *   anyone could send those headers.
 * - "device": from the phone or computer, only if the signer allowed the
 *   browser to share it. Never required: signing works without it.
 */

export type IpLocation = {
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  region: string | null;
  source: "ip";
};

export const deviceLocationSchema = z.object({
  accuracy: z.number().finite().min(0).max(100_000),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export type DeviceLocation = z.infer<typeof deviceLocationSchema> & {
  source: "device";
};

/** What the signer's browser answered when asked for the location. */
export const deviceLocationStatusSchema = z.enum([
  "shared",
  "denied",
  "unavailable",
]);

export type DeviceLocationStatus = z.infer<typeof deviceLocationStatusSchema>;

type LocationEnv = Record<string, string | undefined>;

function headerText(headers: Headers, name: string): string | null {
  const raw = headers.get(name)?.trim();

  if (!raw) {
    return null;
  }

  let value = raw;

  try {
    // Cloudflare percent-encodes non-ASCII city names ("S%C3%A3o Paulo").
    value = decodeURIComponent(raw);
  } catch {
    value = raw;
  }

  // Free text that ends up in the audit trail and the certificate.
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80);

  return clean || null;
}

function headerNumber(
  headers: Headers,
  name: string,
  limit: number,
): number | null {
  const value = Number(headers.get(name));

  return headers.get(name) !== null &&
    Number.isFinite(value) &&
    Math.abs(value) <= limit
    ? value
    : null;
}

export function getIpLocation(
  headers: Headers,
  env: LocationEnv = process.env,
): IpLocation | null {
  if (env.TRUSTED_LOCATION_HEADERS?.trim().toLowerCase() !== "cloudflare") {
    return null;
  }

  const location: IpLocation = {
    city: headerText(headers, "cf-ipcity"),
    country: headerText(headers, "cf-ipcountry"),
    latitude: headerNumber(headers, "cf-iplatitude", 90),
    longitude: headerNumber(headers, "cf-iplongitude", 180),
    region: headerText(headers, "cf-region"),
    source: "ip",
  };

  // "XX" and "T1" are Cloudflare's "unknown" and "Tor" countries.
  if (location.country === "XX" || location.country === "T1") {
    location.country = null;
  }

  return location.city || location.region || location.country ? location : null;
}

/** The location part of an audit event's metadata. */
export function locationMetadata(input: {
  device?: DeviceLocation | null;
  deviceStatus?: DeviceLocationStatus | null;
  ip?: IpLocation | null;
}): { location?: Record<string, unknown> } {
  const location: Record<string, unknown> = {};

  if (input.ip) {
    location.ip = input.ip;
  }

  if (input.device) {
    location.device = input.device;
  }

  if (input.deviceStatus) {
    location.deviceStatus = input.deviceStatus;
  }

  return Object.keys(location).length > 0 ? { location } : {};
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/**
 * Lines for the certificate, in the app's language through `translate`.
 * Each says where the location came from, so an approximate one is never
 * shown as if it were exact.
 */
export function describeLocation(
  metadata: Record<string, unknown> | null | undefined,
  translate: (text: string, params?: Record<string, string>) => string,
): string[] {
  const location = metadata?.location;

  if (!location || typeof location !== "object") {
    return [];
  }

  const { device, deviceStatus, ip } = location as Record<string, unknown>;
  const lines: string[] = [];

  if (device && typeof device === "object") {
    const record = device as Record<string, unknown>;
    const latitude = readNumber(record.latitude);
    const longitude = readNumber(record.longitude);
    const accuracy = readNumber(record.accuracy);

    if (latitude !== null && longitude !== null) {
      lines.push(
        translate(
          "Location shared by the device: {coordinates} (accuracy {meters} m)",
          {
            coordinates: coordinates(latitude, longitude),
            meters: String(Math.round(accuracy ?? 0)),
          },
        ),
      );
    }
  } else if (deviceStatus === "denied") {
    lines.push(translate("Device location: not allowed by the signer"));
  } else if (deviceStatus === "unavailable") {
    lines.push(translate("Device location: unavailable"));
  }

  if (ip && typeof ip === "object") {
    const record = ip as Record<string, unknown>;
    const place = [
      readText(record.city),
      readText(record.region),
      readText(record.country),
    ]
      .filter(Boolean)
      .join(", ");
    const latitude = readNumber(record.latitude);
    const longitude = readNumber(record.longitude);

    if (place) {
      lines.push(
        latitude !== null && longitude !== null
          ? translate("Approximate location by IP: {place} ({coordinates})", {
              coordinates: coordinates(latitude, longitude),
              place,
            })
          : translate("Approximate location by IP: {place}", { place }),
      );
    }
  }

  return lines;
}
