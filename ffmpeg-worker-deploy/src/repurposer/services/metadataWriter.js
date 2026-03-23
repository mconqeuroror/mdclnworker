import { execFile } from "child_process";
import { promisify } from "util";

const execAsync = promisify(execFile);
const EXIFTOOL_PATH = process.env.EXIFTOOL_PATH || "exiftool";

function toExifDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toGpsDateStamp(date) {
  return date.toISOString().split("T")[0].replace(/-/g, ":");
}

function toGpsTimeStamp(date) {
  return date.toISOString().split("T")[1].replace(/\.\d{3}Z$/, "");
}

function toGPSCoords(decimal) {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = ((minFull - min) * 60).toFixed(4);
  return `${deg} ${min} ${sec}`;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function isValidLatitude(lat) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLongitude(lng) {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function hasTagValue(value, expected) {
  return String(value || "").trim().toLowerCase() === String(expected || "").trim().toLowerCase();
}

async function readIdentityTags(filePath) {
  const { stdout } = await execAsync(
    EXIFTOOL_PATH,
    [
      "-j",
      "-Make",
      "-Model",
      "-LensModel",
      "-EXIF:Make",
      "-EXIF:Model",
      "-EXIF:LensModel",
      "-QuickTime:Make",
      "-QuickTime:Model",
      "-QuickTime:LensModel",
      "-Keys:Make",
      "-Keys:Model",
      "-Keys:LensModel",
      filePath,
    ],
    { timeout: 20000 },
  );

  let parsed = [];
  try {
    parsed = JSON.parse(stdout || "[]");
  } catch {
    parsed = [];
  }
  return parsed[0] || {};
}

function hasExpectedIdentityTags(tags, profile) {
  const make = profile?.make;
  const model = profile?.model;
  const lens = profile?.lensModel;
  if (!make || !model || !lens) return false;

  const hasMake =
    hasTagValue(tags.Make, make) ||
    hasTagValue(tags["EXIF:Make"], make) ||
    hasTagValue(tags["QuickTime:Make"], make) ||
    hasTagValue(tags["Keys:Make"], make);
  const hasModel =
    hasTagValue(tags.Model, model) ||
    hasTagValue(tags["EXIF:Model"], model) ||
    hasTagValue(tags["QuickTime:Model"], model) ||
    hasTagValue(tags["Keys:Model"], model);
  const hasLens =
    hasTagValue(tags.LensModel, lens) ||
    hasTagValue(tags["EXIF:LensModel"], lens) ||
    hasTagValue(tags["QuickTime:LensModel"], lens) ||
    hasTagValue(tags["Keys:LensModel"], lens);

  return hasMake && hasModel && hasLens;
}

/**
 * @param {{
 *  filePath: string,
 *  profile: import("../data/iphone-profiles.js").IPhoneProfile,
 *  dateTaken: Date,
 *  gpsLat: number|null,
 *  gpsLng: number|null,
 *  gpsAlt?: number|null,
 *  randomizeShutter?: boolean,
 *  randomizeISO?: boolean,
 * }} options
 */
export async function writeMetadata(options) {
  const {
    filePath,
    profile,
    dateTaken,
    gpsLat,
    gpsLng,
    gpsAlt,
    randomizeShutter = true,
    randomizeISO = true,
  } = options;

  if (!profile) {
    throw new Error("Metadata profile is required.");
  }
  if (!(dateTaken instanceof Date) || Number.isNaN(dateTaken.getTime())) {
    throw new Error("Invalid dateTaken value.");
  }

  const hasGps = isValidLatitude(gpsLat) && isValidLongitude(gpsLng);
  const lowerPath = String(filePath || "").toLowerCase();
  const isVideo = /\.(mp4|mov|m4v|webm|mkv)$/.test(lowerPath);

  const iso = randomizeISO
    ? Math.round(rand(profile.isoRange[0], profile.isoRange[1]))
    : profile.isoRange[0];

  const shutterDenom = randomizeShutter
    ? Math.round(rand(profile.shutterRange[0], profile.shutterRange[1]))
    : profile.shutterRange[0];

  const exifDate = toExifDate(dateTaken);

  const args = [
    "-overwrite_original",
    "-m",
    "-all=",
    "-XMP:all=",
    "-C2PA:all=",
    "-XMP-c2pa:all=",
    `-Make=${profile.make}`,
    `-Model=${profile.model}`,
    `-EXIF:Make=${profile.make}`,
    `-EXIF:Model=${profile.model}`,
    `-Software=${profile.software}`,
    `-LensModel=${profile.lensModel}`,
    `-EXIF:LensModel=${profile.lensModel}`,
    `-XMP-exifEX:LensModel=${profile.lensModel}`,
    `-FocalLength=${profile.focalLength} mm`,
    `-FocalLengthIn35mmFormat=${profile.focalLength35mm}`,
    `-FNumber=${profile.fNumber}`,
    `-ApertureValue=${profile.fNumber}`,
    `-ISO=${iso}`,
    `-ExposureTime=1/${shutterDenom}`,
    `-ShutterSpeedValue=1/${shutterDenom}`,
    `-ExposureMode=${profile.exposureMode}`,
    `-WhiteBalance=${profile.whiteBalance}`,
    `-SceneCaptureType=${profile.sceneCaptureType}`,
    `-ExifVersion=${profile.exifVersion}`,
    `-FlashPixVersion=${profile.flashpixVersion}`,
    `-ColorSpace=${profile.colorSpace}`,
    `-XResolution=${profile.xResolution}`,
    `-YResolution=${profile.yResolution}`,
    `-BrightnessValue=${profile.brightnessValue}`,
    `-DateTimeOriginal=${exifDate}`,
    `-CreateDate=${exifDate}`,
    `-ModifyDate=${exifDate}`,
  ];

  if (isVideo) {
    args.push(
      `-QuickTime:Make=${profile.make}`,
      `-QuickTime:Model=${profile.model}`,
      `-QuickTime:LensModel=${profile.lensModel}`,
      `-Keys:Make=${profile.make}`,
      `-Keys:Model=${profile.model}`,
      `-Keys:LensModel=${profile.lensModel}`,
      `-QuickTime:CreateDate=${exifDate}`,
      `-QuickTime:ModifyDate=${exifDate}`,
    );
  }

  if (hasGps) {
    const altitude = Number.isFinite(gpsAlt)
      ? gpsAlt
      : rand(profile.gpsAltitudeRange[0], profile.gpsAltitudeRange[1]);

    const latRef = gpsLat >= 0 ? "N" : "S";
    const lngRef = gpsLng >= 0 ? "E" : "W";
    const latSign = gpsLat >= 0 ? "+" : "-";
    const lngSign = gpsLng >= 0 ? "+" : "-";
    const latAbs = Math.abs(gpsLat).toFixed(6);
    const lngAbs = Math.abs(gpsLng).toFixed(6);
    const quicktimeGps = `${latSign}${latAbs}${lngSign}${lngAbs}+${Math.abs(altitude).toFixed(1)}/`;

    args.push(
      `-GPSLatitude=${toGPSCoords(gpsLat)}`,
      `-GPSLatitudeRef=${latRef}`,
      `-GPSLongitude=${toGPSCoords(gpsLng)}`,
      `-GPSLongitudeRef=${lngRef}`,
      `-GPSAltitude=${altitude.toFixed(2)}`,
      "-GPSAltitudeRef=0",
      `-GPSDateStamp=${toGpsDateStamp(dateTaken)}`,
      `-GPSTimeStamp=${toGpsTimeStamp(dateTaken)}`,
      `-Keys:GPSCoordinates=${quicktimeGps}`,
      `-QuickTime:GPSCoordinates=${quicktimeGps}`,
    );
  }

  args.push(
    "-HostComputer=",
    "-UserComment=",
    filePath,
  );

  await execAsync(EXIFTOOL_PATH, args, { timeout: 30000 });

  // Verify critical identity metadata exists; some containers/codecs drop generic tags.
  let tags = await readIdentityTags(filePath);
  if (hasExpectedIdentityTags(tags, profile)) return;

  // Fallback pass without wiping metadata, using explicit groups.
  const fallbackArgs = [
    "-overwrite_original",
    "-m",
    `-Make=${profile.make}`,
    `-Model=${profile.model}`,
    `-EXIF:Make=${profile.make}`,
    `-EXIF:Model=${profile.model}`,
    `-LensModel=${profile.lensModel}`,
    `-EXIF:LensModel=${profile.lensModel}`,
    `-XMP-exifEX:LensModel=${profile.lensModel}`,
    `-Software=${profile.software}`,
  ];
  if (isVideo) {
    fallbackArgs.push(
      `-QuickTime:Make=${profile.make}`,
      `-QuickTime:Model=${profile.model}`,
      `-QuickTime:LensModel=${profile.lensModel}`,
      `-Keys:Make=${profile.make}`,
      `-Keys:Model=${profile.model}`,
      `-Keys:LensModel=${profile.lensModel}`,
    );
  }
  fallbackArgs.push(filePath);
  await execAsync(EXIFTOOL_PATH, fallbackArgs, { timeout: 30000 });

  tags = await readIdentityTags(filePath);
  if (!hasExpectedIdentityTags(tags, profile)) {
    throw new Error("Critical identity metadata tags missing after write/verify pass");
  }
}
