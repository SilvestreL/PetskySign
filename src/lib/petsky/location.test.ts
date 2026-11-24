import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeLocation,
  getIpLocation,
  locationMetadata,
} from "./location.ts";

const cloudflare = { TRUSTED_LOCATION_HEADERS: "cloudflare" };

function cfHeaders(values: Record<string, string>) {
  return new Headers(values);
}

test("without TRUSTED_LOCATION_HEADERS, Cloudflare's headers are ignored", () => {
  const headers = cfHeaders({ "cf-ipcity": "Maceió", "cf-ipcountry": "BR" });

  assert.equal(getIpLocation(headers, {}), null);
  assert.equal(
    getIpLocation(headers, { TRUSTED_LOCATION_HEADERS: "other" }),
    null,
  );
});

test("reads city, region, country and coordinates, decoding the city", () => {
  const location = getIpLocation(
    cfHeaders({
      "cf-ipcity": "S%C3%A3o%20Paulo",
      "cf-ipcountry": "BR",
      "cf-iplatitude": "-23.5475",
      "cf-iplongitude": "-46.63611",
      "cf-region": "Sao Paulo",
    }),
    cloudflare,
  );

  assert.deepEqual(location, {
    city: "São Paulo",
    country: "BR",
    latitude: -23.5475,
    longitude: -46.63611,
    region: "Sao Paulo",
    source: "ip",
  });
});

test("unknown or Tor countries, bad numbers and control characters are dropped", () => {
  assert.equal(
    getIpLocation(cfHeaders({ "cf-ipcountry": "XX" }), cloudflare),
    null,
  );
  assert.equal(
    getIpLocation(cfHeaders({ "cf-ipcountry": "T1" }), cloudflare),
    null,
  );

  const location = getIpLocation(
    cfHeaders({
      "cf-ipcity": "Mace\u0007ió",
      "cf-iplatitude": "999",
      "cf-iplongitude": "abc",
    }),
    cloudflare,
  );

  assert.equal(location?.city, "Maceió");
  assert.equal(location?.latitude, null);
  assert.equal(location?.longitude, null);
});

test("metadata holds only what is known", () => {
  assert.deepEqual(locationMetadata({}), {});
  assert.deepEqual(locationMetadata({ deviceStatus: "denied" }), {
    location: { deviceStatus: "denied" },
  });
});

test("the certificate says where each location came from", () => {
  const translate = (text: string, params?: Record<string, string>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => params?.[key] ?? "");
  const lines = describeLocation(
    locationMetadata({
      device: {
        accuracy: 14.6,
        latitude: -9.6498,
        longitude: -35.7089,
        source: "device",
      },
      deviceStatus: "shared",
      ip: {
        city: "Maceió",
        country: "BR",
        latitude: null,
        longitude: null,
        region: "Alagoas",
        source: "ip",
      },
    }),
    translate,
  );

  assert.deepEqual(lines, [
    "Location shared by the device: -9.64980, -35.70890 (accuracy 15 m)",
    "Approximate location by IP: Maceió, Alagoas, BR",
  ]);
  assert.deepEqual(
    describeLocation(locationMetadata({ deviceStatus: "denied" }), translate),
    ["Device location: not allowed by the signer"],
  );
  assert.deepEqual(describeLocation(null, translate), []);
});

test("a city sent as raw UTF-8 bytes reads back with its accents", () => {
  const raw = Buffer.from("Maceió", "utf8").toString("latin1");
  const headers = new Headers();

  headers.set("cf-ipcity", raw);

  assert.equal(getIpLocation(headers, cloudflare)?.city, "Maceió");
  assert.equal(
    getIpLocation(cfHeaders({ "cf-ipcity": "Göttingen" }), cloudflare)?.city,
    "Göttingen",
  );
});

test("the certificate reads back a city recorded as raw UTF-8 bytes", () => {
  const lines = describeLocation(
    {
      location: {
        ip: {
          city: Buffer.from("Maceió", "utf8").toString("latin1"),
          country: "BR",
          region: "Alagoas",
          source: "ip",
        },
      },
    },
    (text, params) =>
      text.replace(/\{(\w+)\}/g, (_, key: string) => params?.[key] ?? ""),
  );

  assert.deepEqual(lines, ["Approximate location by IP: Maceió, Alagoas, BR"]);
});
