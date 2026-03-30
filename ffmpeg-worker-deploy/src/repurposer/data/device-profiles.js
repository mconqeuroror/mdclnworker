import { IPHONE_PROFILES, getIphoneProfileById } from "./iphone-profiles.js";
import { EXTRA_DEVICE_CATALOG } from "./extra-device-catalog.generated.js";
import { buildSyntheticProfileFromCatalogEntry } from "./synthetic-device-profile.js";

const extraById = new Map(EXTRA_DEVICE_CATALOG.map((e) => [e.id, e]));

/** @returns {import("./iphone-profiles.js").IPhoneProfile | ReturnType<typeof buildSyntheticProfileFromCatalogEntry> | null} */
export function getUnifiedDeviceProfileById(id) {
  if (!id) return null;
  const iphone = getIphoneProfileById(id);
  if (iphone) return iphone;
  const entry = extraById.get(id);
  if (entry) return buildSyntheticProfileFromCatalogEntry(entry);
  return null;
}

export function getRandomUnifiedDeviceProfile() {
  const nI = IPHONE_PROFILES.length;
  const nE = EXTRA_DEVICE_CATALOG.length;
  const pick = Math.floor(Math.random() * (nI + nE));
  if (pick < nI) return IPHONE_PROFILES[pick];
  return buildSyntheticProfileFromCatalogEntry(EXTRA_DEVICE_CATALOG[pick - nI]);
}

export function getAllDeviceModelIds() {
  return [...IPHONE_PROFILES.map((p) => p.id), ...EXTRA_DEVICE_CATALOG.map((e) => e.id)];
}

/** For UI: searchable device list */
export function getDevicePickerOptions() {
  const opts = [];
  for (const p of IPHONE_PROFILES) {
    opts.push({
      id: p.id,
      label: p.marketingName,
      category: "Smartphone",
      manufacturer: "Apple",
      searchText: `${p.marketingName} Apple iPhone ${p.model}`.toLowerCase(),
    });
  }
  for (const e of EXTRA_DEVICE_CATALOG) {
    const label = `${e.marketingName} (${e.manufacturer})`;
    opts.push({
      id: e.id,
      label,
      category: e.category,
      manufacturer: e.manufacturer,
      searchText: `${e.marketingName} ${e.manufacturer} ${e.modelExif} ${e.category}`.toLowerCase(),
    });
  }
  return opts.sort((a, b) => a.label.localeCompare(b.label));
}
