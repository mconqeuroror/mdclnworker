/** Builds an EXIF profile compatible with metadataWriter from a catalog row. */
export function buildSyntheticProfileFromCatalogEntry(entry) {
  const manufacturer = entry.manufacturer || entry.make || "Unknown";
  const model = entry.modelExif || entry.marketingName;
  const year = entry.releaseYear || 2020;
  const cat = entry.category || "Smartphone";

  let focalLength = 4.2;
  let focal35 = 26;
  let fNumber = 1.8;
  let imageW = 4032;
  let imageH = 3024;
  let megapixels = 12;
  let isoRange = [25, 3200];
  let shutterRange = [500, 8000];

  if (cat === "Drone" || cat === "FPV Drone" || cat === "Enterprise Drone") {
    focalLength = 4.73;
    focal35 = 24;
    fNumber = 2.8;
    imageW = 4000;
    imageH = 3000;
    megapixels = 12;
    isoRange = [50, 1600];
    shutterRange = [500, 4000];
  } else if (cat === "Action Camera" || cat === "360 Camera") {
    focalLength = 2.65;
    focal35 = 14;
    fNumber = 2.8;
    imageW = 3840;
    imageH = 2160;
    megapixels = 12;
    isoRange = [50, 6400];
    shutterRange = [500, 8000];
  } else if (cat === "Handheld Camera") {
    focalLength = 3.6;
    focal35 = 20;
    fNumber = 1.9;
    imageW = 4000;
    imageH = 3000;
    megapixels = 12;
  }

  const iosMajor = Math.min(18, Math.max(10, 8 + Math.floor((2026 - year) / 2)));
  const software =
    manufacturer === "Apple"
      ? `${iosMajor}.6.1`
      : `${String(manufacturer).slice(0, 32)} ${year}.1`;

  const lensModel = `${entry.marketingName} camera ${focalLength}mm f/${fNumber}`;

  return {
    id: entry.id,
    marketingName: entry.marketingName,
    make: manufacturer,
    model,
    software,
    lensModel,
    focalLength,
    focalLength35mm: focal35,
    fNumber,
    isoRange,
    shutterRange,
    gpsAltitudeRange: [0, 800],
    imageWidth: imageW,
    imageHeight: imageH,
    megapixels,
    xResolution: 72,
    yResolution: 72,
    colorSpace: 1,
    exifVersion: "0232",
    flashpixVersion: "0100",
    brightnessValue: "7.500",
    exposureMode: 0,
    whiteBalance: 0,
    sceneCaptureType: 0,
  };
}
