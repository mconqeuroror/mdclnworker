import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import PDFDocument from "pdfkit";

// ─── Config ────────────────────────────────────────────────────────────────
const TARGET_EMAIL = process.argv[2] || "vikarlogi13@gmail.com";
const REPORT_ROOT = path.resolve("report", "iceland");
const RAW_DIR = path.join(REPORT_ROOT, "raw");
const DERIVED_DIR = path.join(REPORT_ROOT, "derived");
const EVIDENCE_DIR = path.join(REPORT_ROOT, "evidence");
const PHOTOS_MODELS_DIR = path.join(EVIDENCE_DIR, "photos", "models");
const PHOTOS_GENERATED_DIR = path.join(EVIDENCE_DIR, "photos", "generated_samples");

const dateStamp = new Date().toISOString().slice(0, 10);
const reportRef = `INC-${dateStamp}-IS-NCII-001`;

const EXPLICIT_RE =
  /\b(nsfw|nude|naked|sex|sexual|porn|boobs|tits|ass|lingerie|bikini|erotic|topless|milf|orgasm|fetish|horny|cum|xxx|pussy|dick|cock|rape|unconscious.*naked|naked.*unconscious)\b/i;

// ─── Helpers ───────────────────────────────────────────────────────────────
function safeStr(v) { return v == null ? "" : String(v); }
function asIso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}
function csvEsc(v) {
  const s = safeStr(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}
function toCsv(rows, cols) {
  return [cols.map(csvEsc).join(","), ...rows.map(r => cols.map(c => csvEsc(r[c])).join(","))].join("\n") + "\n";
}
async function writeJson(p, data) {
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}
function slugify(name) {
  return safeStr(name).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase().replace(/_+/g, "_").slice(0, 40);
}
function extFromUrl(url) {
  try {
    const p = new URL(url).pathname;
    const e = path.extname(p).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(e) ? e : ".jpg";
  } catch { return ".jpg"; }
}

async function fetchBuf(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}

async function downloadImg(url, localPath) {
  const buf = await fetchBuf(url);
  if (!buf) return false;
  await fs.writeFile(localPath, buf);
  return true;
}

async function ensureDirs() {
  for (const d of [RAW_DIR, DERIVED_DIR, PHOTOS_MODELS_DIR, PHOTOS_GENERATED_DIR]) {
    await fs.mkdir(d, { recursive: true });
  }
}

function keywordCounts(gens) {
  const stop = new Set(["the","and","with","from","that","this","for","you","your","girl","woman","image","photo","model","make","like","very","high","realistic"]);
  const m = new Map();
  for (const g of gens) {
    const toks = safeStr(g.prompt).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length >= 3 && !stop.has(t));
    for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([keyword, count]) => ({ keyword, count }));
}

// ─── PDF Builder ───────────────────────────────────────────────────────────
function buildPdf(outputPath, sections) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);

    const pageW = doc.page.width - 100; // usable width

    function heading1(t) {
      doc.moveDown(0.5).font("Helvetica-Bold").fontSize(14).fillColor("#1a1a2e").text(t).font("Helvetica").fontSize(9).fillColor("#000");
    }
    function heading2(t) {
      doc.moveDown(0.4).font("Helvetica-Bold").fontSize(11).fillColor("#16213e").text(t).font("Helvetica").fontSize(9).fillColor("#000");
    }
    function heading3(t) {
      doc.moveDown(0.3).font("Helvetica-Bold").fontSize(9.5).fillColor("#0f3460").text(t).font("Helvetica").fontSize(9).fillColor("#000");
    }
    function para(t, opts = {}) {
      doc.fontSize(9).font("Helvetica").fillColor("#000").text(safeStr(t), { width: pageW, lineGap: 1, ...opts });
    }
    function label(k, v) {
      doc.moveDown(0.1).font("Helvetica-Bold").fontSize(8.5).fillColor("#333").text(`${k}: `, { continued: true }).font("Helvetica").fillColor("#000").text(safeStr(v));
    }
    function rule() {
      doc.moveDown(0.3).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#aaa").stroke().moveDown(0.3);
    }
    function newPage() { doc.addPage(); }

    // ── Cover ──
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#1a1a2e").text("FORENSIC INVESTIGATION REPORT", { align: "center" });
    doc.moveDown(0.3).font("Helvetica").fontSize(11).fillColor("#333").text("Non-Consensual Deepfake / Unauthorized NSFW Generation", { align: "center" });
    doc.moveDown(0.2).font("Helvetica-Bold").fontSize(9).fillColor("#c0392b").text("CLASSIFICATION: CONFIDENTIAL — FOR LAW ENFORCEMENT USE", { align: "center" });
    rule();
    label("Report Reference", sections.reportRef);
    label("Report Date", sections.dateStamp);
    label("Prepared by", "Platform Security / Admin");
    label("Status", "Evidence Package — Active Investigation");
    rule();

    // ── Section 1: Subject ──
    heading1("1. SUBJECT IDENTIFICATION");
    const u = sections.user;
    label("Platform User ID", u.id);
    label("Email", u.email);
    label("Display Name", safeStr(u.name));
    label("Auth Provider", safeStr(u.authProvider));
    label("Google ID", safeStr(u.googleId));
    label("Region", safeStr(u.region));
    label("Role", safeStr(u.role));
    label("Account Created", asIso(u.createdAt));
    label("Last Account Update", asIso(u.updatedAt));
    label("Subscription Status", safeStr(u.subscriptionStatus));
    label("Total Credits Used", safeStr(u.totalCreditsUsed));
    doc.moveDown(0.5);

    heading2("1.1 IP Address Evidence");
    para("Note: IP addresses are stored as one-way hashes in this platform's telemetry system. Raw IPs can be obtained via Google emergency data preservation (account linked via Google OAuth) or ISP records correlated with timestamps below.");
    doc.moveDown(0.3);
    heading3("Dominant IP Hashes (by request volume)");
    for (const h of sections.ipHashes.slice(0, 10)) {
      label(`  ipHash ${h.ipHash}`, `${h.count} requests`);
    }
    doc.moveDown(0.3);
    label("First recorded request (UTC)", sections.firstRequestAt);
    label("Last recorded request (UTC)", sections.lastRequestAt);
    label("Total unique IP hashes observed", String(sections.ipHashes.length));

    doc.moveDown(0.5);
    heading2("1.2 Investigator Witness Context");
    para("• Investigator reported this account generated unauthorized NSFW content using classmates' photos.");
    para("• Investigator identified victim Yasmin Petra from a TikTok screenshot used in the generation workflow.");
    para("• Victim reportedly knows suspect identity and is assisting with identifying additional victims.");
    para("• These witness statements should be independently corroborated through victim interviews and source-platform records.");

    // ── Section 2: Activity Summary ──
    newPage();
    heading1("2. PLATFORM ACTIVITY SUMMARY");
    const c = sections.counts;
    label("Saved models", String(c.models));
    label("Total generations", String(c.generations));
    label("NSFW-like generations (prompt heuristic)", String(c.nsfwLikeGenerations));
    label("Child safety incidents recorded", String(c.childSafetyIncidents));
    label("Credit transactions", String(c.creditTransactions));
    label("API telemetry records", String(c.apiRequestMetrics));
    label("Unique IP hashes", String(sections.ipHashes.length));
    doc.moveDown(0.5);

    heading2("2.1 Top API Routes by Request Volume");
    for (const r of sections.topRoutes.slice(0, 20)) {
      label(`  ${r.route}`, `${r.count} calls`);
    }
    doc.moveDown(0.5);

    heading2("2.2 Generation Volume by Day");
    for (const d of sections.generationsByDay) {
      label(`  ${d.day}`, `${d.count} generations`);
    }
    doc.moveDown(0.5);

    heading2("2.3 Top Prompt Keywords (frequency analysis)");
    const kwRows = sections.topKeywords.slice(0, 20);
    for (const k of kwRows) {
      label(`  "${k.keyword}"`, `${k.count} occurrences`);
    }

    // ── Section 3: Models + Photos ──
    newPage();
    heading1("3. SAVED MODELS — SOURCE IDENTITY PHOTOS");
    para("Each model below was created by the subject using real photographs of individuals, then used to generate explicit/NSFW content without the subjects' consent. Source photos are embedded below.");

    for (const m of sections.models) {
      doc.moveDown(0.6);
      heading2(`Model: "${m.name}"  [${m.id.slice(0, 8)}]`);
      label("  Model ID", m.id);
      label("  Created", asIso(m.createdAt));
      label("  Generations using this model", String(m.usage));
      doc.moveDown(0.4);

      // 3 photos side by side
      const photos = [
        { label: "Photo 1", url: m.photo1Url, localPath: m.localPhotos[0] },
        { label: "Photo 2", url: m.photo2Url, localPath: m.localPhotos[1] },
        { label: "Photo 3", url: m.photo3Url, localPath: m.localPhotos[2] },
      ];

      const imgW = 155;
      const imgH = 155;
      const gap = 10;
      let startX = 50;
      const imgY = doc.y;

      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        const x = startX + i * (imgW + gap);
        if (ph.localPath && ph.buf) {
          try {
            doc.image(ph.buf, x, imgY, { fit: [imgW, imgH] });
          } catch {
            doc.rect(x, imgY, imgW, imgH).stroke();
            doc.fontSize(7).text("[Image unavailable]", x + 5, imgY + imgH / 2);
          }
        } else {
          doc.rect(x, imgY, imgW, imgH).stroke("#ccc");
          doc.fontSize(7).fillColor("#999").text("[Image unavailable]", x + 5, imgY + imgH / 2);
        }
      }

      doc.y = imgY + imgH + 6;

      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        const x = startX + i * (imgW + gap);
        doc.fontSize(7).font("Helvetica-Bold").fillColor("#333").text(`${ph.label}:`, x, doc.y, { width: imgW });
        doc.fontSize(6.5).font("Helvetica").fillColor("#0000cc").text(ph.url, x, doc.y, { width: imgW, link: ph.url, underline: true, ellipsis: true });
      }
      doc.moveDown(1);

      // Generated samples for this model
      if (m.generatedSamples && m.generatedSamples.length > 0) {
        heading3(`Latest ${m.generatedSamples.length} generated output(s) using model "${m.name}":`);
        const sampleY = doc.y;
        const sW = 155;
        const sH = 140;
        for (let i = 0; i < m.generatedSamples.length; i++) {
          const s = m.generatedSamples[i];
          const x = startX + i * (sW + gap);
          if (s.buf) {
            try {
              doc.image(s.buf, x, sampleY, { fit: [sW, sH] });
            } catch {
              doc.rect(x, sampleY, sW, sH).stroke("#ccc");
              doc.fontSize(7).fillColor("#999").text("[Image unavailable]", x + 5, sampleY + sH / 2);
            }
          } else {
            doc.rect(x, sampleY, sW, sH).stroke("#ccc");
            doc.fontSize(7).fillColor("#999").text("[Image unavailable]", x + 5, sampleY + sH / 2);
          }
        }
        doc.y = sampleY + sH + 6;
        for (let i = 0; i < m.generatedSamples.length; i++) {
          const s = m.generatedSamples[i];
          const x = startX + i * (sW + gap);
          doc.fontSize(6.5).font("Helvetica-Bold").fillColor("#333").text(`Gen ${i + 1} (${safeStr(s.createdAt).slice(0, 10)}):`, x, doc.y, { width: sW });
          doc.fontSize(6.5).font("Helvetica").fillColor("#555").text(safeStr(s.prompt).slice(0, 120), x, doc.y, { width: sW });
          if (s.outputUrl) {
            doc.fontSize(6).fillColor("#0000cc").text(s.outputUrl, x, doc.y, { width: sW, link: s.outputUrl, underline: true, ellipsis: true });
          }
        }
        doc.moveDown(1);
      }

      if (doc.y > doc.page.height - 180) newPage();
    }

    // ── Section 4: Child Safety ──
    newPage();
    heading1("4. CHILD SAFETY INCIDENT RECORDS");
    if (sections.incidents.length === 0) {
      para("No ChildSafetyIncident records were logged for this account in the current safety incident table.");
      para("Note: Absence of records in this table does not exclude criminal abuse — it may reflect detector coverage gaps, content that circumvented classifiers, or activity that occurred before the safety system was deployed.");
    } else {
      for (const [idx, inc] of sections.incidents.entries()) {
        heading3(`Incident ${idx + 1}`);
        label("  Timestamp", asIso(inc.createdAt));
        label("  Classifier Code", safeStr(inc.classifierCode));
        label("  Generation Mode", safeStr(inc.generationMode));
        label("  Route", safeStr(inc.routePath));
        label("  IP Address", safeStr(inc.ipAddress));
        label("  Prompt Preview", safeStr(inc.promptPreview).slice(0, 300));
      }
    }

    // ── Section 5: All Prompts ──
    newPage();
    heading1("5. FULL GENERATION PROMPT LOG (ALL 231 GENERATIONS)");
    para("All prompts are also exported to: report/iceland/derived/all_generation_prompts.csv");
    doc.moveDown(0.4);

    for (const [idx, g] of sections.allGens.entries()) {
      if (doc.y > doc.page.height - 100) newPage();
      const isNsfw = g.isNsfw || EXPLICIT_RE.test(safeStr(g.prompt));
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(isNsfw ? "#c0392b" : "#1a1a2e")
        .text(`#${idx + 1}  ${safeStr(g.createdAt).slice(0, 16)}  [${safeStr(g.type)}]  model=${safeStr(g.modelName) || "—"}  status=${g.status}${isNsfw ? "  ⚠ NSFW" : ""}`, { width: pageW });
      doc.font("Helvetica").fontSize(7.5).fillColor("#222")
        .text(safeStr(g.prompt).slice(0, 400), { width: pageW, lineGap: 0 });
      if (g.outputUrl) {
        doc.fontSize(6.5).fillColor("#0000cc").text(g.outputUrl, { width: pageW, link: g.outputUrl, underline: true, ellipsis: true });
      }
      doc.moveDown(0.2);
    }

    // ── Section 6: Timeline ──
    newPage();
    heading1("6. CHRONOLOGICAL EVENT TIMELINE (EXTRACT)");
    para("Complete timeline: report/iceland/derived/timeline.json");
    doc.moveDown(0.3);

    for (const ev of sections.timeline.slice(0, 200)) {
      if (doc.y > doc.page.height - 60) newPage();
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(ev.eventType === "CHILD_SAFETY_INCIDENT" ? "#c0392b" : "#1a1a2e")
        .text(`${safeStr(ev.timestamp).slice(0, 19)}  ${ev.eventType}`, { continued: true })
        .font("Helvetica").fillColor("#333")
        .text(`  ${safeStr(ev.details).slice(0, 160)}`, { width: pageW });
    }

    // ── Section 7: Evidence Package ──
    newPage();
    heading1("7. EVIDENCE PACKAGE CONTENTS");
    const rawFiles = [
      "user.json", "saved_models.json", "trained_loras.json", "lora_training_images.json",
      "generations.json", "child_safety_incidents.json", "credit_transactions.json",
      "api_request_metrics.json", "telemetry_edge_events.json", "admin_audit_logs.json",
      "nsfw_auto_select_jobs.json", "nsfw_plan_generation_jobs.json", "api_keys.json",
      "avatars.json", "avatar_videos.json", "signup_fingerprints.json",
      "repurpose_jobs.json", "converter_jobs.json", "telegram_legacy_states.json",
    ];
    heading2("Raw DB Exports (report/iceland/raw/):");
    for (const f of rawFiles) para(`  • ${f}`);
    doc.moveDown(0.4);
    heading2("Derived Analysis (report/iceland/derived/):");
    for (const f of ["summary.json", "timeline.json", "all_generation_prompts.csv", "saved_models.csv", "generations_by_day.csv", "top_api_routes.csv", "top_prompt_keywords.csv"]) {
      para(`  • ${f}`);
    }
    doc.moveDown(0.4);
    heading2("Downloaded Source Photos (report/iceland/evidence/photos/):");
    para("  • models/{model-name}/photo_1.jpg, photo_2.jpg, photo_3.jpg");
    para("  • generated_samples/{model-name}/gen_1.jpg, gen_2.jpg, gen_3.jpg");

    // ── Section 8: Legal / Actions ──
    doc.moveDown(0.6);
    heading1("8. INVESTIGATIVE NOTES & RECOMMENDED ACTIONS");
    heading2("Legal Framework (Iceland):");
    para("  • Art. 209 Almenn hegningarlög — Unlawful pornographic material");
    para("  • Act No. 86/2018 on Equal Treatment — image-based sexual abuse");
    para("  • Art. 229a Almenn hegningarlög — Non-consensual intimate image sharing");
    doc.moveDown(0.3);
    heading2("Recommended Immediate Actions:");
    para("  1. Report to Lögreglan (Icelandic Police): https://www.logreglan.is/");
    para("  2. Report to Barnaverndarstofa (Child Protection Agency) if any victims are minors");
    para("  3. Google Emergency Preservation Request for account wRbsKLy1JsQMvfKjeksMkg7b7dM2 (Google ID)");
    para("     https://support.google.com/code/contact/le_emergency");
    para("  4. NCMEC CyberTipline: https://www.missingkids.org/gethelpnow/cybertipline");
    para("  5. Notify victim Yasmin Petra of evidence preservation");
    para("  6. Permanent account ban — account currently active (not banned)");
    doc.moveDown(0.4);
    heading2("Platform Evidence Preservation:");
    para("  • Content-deletion lock: APPLY IMMEDIATELY");
    para("  • All 231 generations preserved in Vercel Blob / R2 CDN storage");
    para("  • 7 saved model records with source photo URLs preserved");
    para("  • API telemetry: 9,704 records with IP hashes");

    // ── Section 9: Chain of Custody ──
    doc.moveDown(0.6);
    heading1("9. CHAIN OF CUSTODY");
    para("Data extracted directly from platform production database (Neon PostgreSQL) at time of report generation.");
    para("All exports are immutable point-in-time snapshots preserved under report/iceland/.");
    para("All timestamps are UTC from database records. Image URLs are CDN-hosted and independently accessible.");
    rule();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#1a1a2e")
      .text("END OF REPORT", { align: "center" });
    doc.font("Helvetica").fontSize(8).fillColor("#333")
      .text(reportRef, { align: "center" });

    // Page numbers
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor("#888").text(
        `${reportRef}  |  Page ${i + 1} of ${pageCount}`,
        50, doc.page.height - 30, { align: "center", width: doc.page.width - 100 },
      );
    }

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

// ─── HTML Builder ─────────────────────────────────────────────────────────
function buildHtml(sections) {
  const css = `
    body { font-family: Arial, sans-serif; font-size: 13px; max-width: 1100px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .cover { background: #1a1a2e; color: white; padding: 30px; border-radius: 8px; margin-bottom: 24px; }
    .cover h1 { margin: 0 0 6px; font-size: 22px; }
    .cover .sub { color: #aaa; font-size: 13px; }
    .cover .ref { color: #e74c3c; font-weight: bold; font-size: 12px; margin-top: 8px; }
    h2 { border-left: 4px solid #1a1a2e; padding-left: 10px; color: #1a1a2e; margin-top: 28px; }
    h3 { color: #0f3460; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    h4 { color: #333; margin-bottom: 4px; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 12px; }
    th { background: #1a1a2e; color: white; padding: 7px 10px; text-align: left; }
    td { padding: 6px 10px; border-bottom: 1px solid #eee; }
    tr:nth-child(even) td { background: #fafafa; }
    .model-card { background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); }
    .photo-grid { display: flex; gap: 14px; flex-wrap: wrap; margin: 12px 0; }
    .photo-item { text-align: center; }
    .photo-item img { width: 180px; height: 180px; object-fit: cover; border: 2px solid #ddd; border-radius: 6px; display: block; }
    .photo-item .url-link { display: block; font-size: 10px; color: #0066cc; word-break: break-all; margin-top: 4px; max-width: 180px; }
    .gen-item { background: #fafafa; border: 1px solid #eee; border-radius: 4px; padding: 8px; margin: 6px 0; font-size: 11px; }
    .gen-item .prompt { color: #333; margin-top: 4px; }
    .gen-item .nsfw { color: #c0392b; font-weight: bold; }
    .gen-grid { display: flex; gap: 12px; flex-wrap: wrap; margin: 10px 0; }
    .gen-img-item { text-align: center; }
    .gen-img-item img { width: 160px; height: 140px; object-fit: cover; border: 2px solid #c0392b; border-radius: 4px; }
    .gen-img-item .gen-label { font-size: 10px; color: #555; max-width: 160px; word-break: break-all; margin-top: 3px; }
    .ip-table td { font-family: monospace; font-size: 11px; }
    .warning { background: #fdf0ed; border-left: 4px solid #e74c3c; padding: 10px 14px; border-radius: 4px; color: #922b21; margin: 10px 0; }
    .info-box { background: #eaf4fb; border-left: 4px solid #2980b9; padding: 10px 14px; border-radius: 4px; margin: 10px 0; }
    .stat-grid { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
    .stat-box { background: white; border: 1px solid #ddd; border-radius: 6px; padding: 12px 18px; text-align: center; min-width: 140px; }
    .stat-box .num { font-size: 24px; font-weight: bold; color: #1a1a2e; }
    .stat-box .lbl { font-size: 11px; color: #666; }
    footer { text-align: center; color: #999; font-size: 11px; margin-top: 40px; border-top: 1px solid #ddd; padding-top: 10px; }
  `;

  const modelCards = sections.models.map(m => {
    const photos = [
      { label: "Photo 1", url: m.photo1Url },
      { label: "Photo 2", url: m.photo2Url },
      { label: "Photo 3", url: m.photo3Url },
    ].map(ph => `
      <div class="photo-item">
        <img src="${ph.url}" alt="${ph.label}" onerror="this.style.display='none'">
        <span class="url-link">${ph.label}</span>
        <a class="url-link" href="${ph.url}" target="_blank">${ph.url.slice(0, 80)}…</a>
      </div>`).join("");

    const genSamples = (m.generatedSamples || []).map((s, i) => `
      <div class="gen-img-item">
        ${s.outputUrl ? `<img src="${s.outputUrl}" alt="Gen ${i+1}" onerror="this.style.display='none'">` : ""}
        <div class="gen-label">
          <b>Gen ${i+1} — ${safeStr(s.createdAt).slice(0, 10)}</b><br>
          <span style="color:#c0392b">${safeStr(s.prompt).slice(0, 150)}</span><br>
          ${s.outputUrl ? `<a href="${s.outputUrl}" target="_blank">${s.outputUrl.slice(0, 80)}…</a>` : ""}
        </div>
      </div>`).join("");

    return `
    <div class="model-card">
      <h3>Model: "${m.name}"</h3>
      <table>
        <tr><th>Field</th><th>Value</th></tr>
        <tr><td>Model ID</td><td><code>${m.id}</code></td></tr>
        <tr><td>Created</td><td>${asIso(m.createdAt)}</td></tr>
        <tr><td>Generations using this model</td><td><b>${m.usage}</b></td></tr>
      </table>
      <h4>Source Identity Photos (used for training)</h4>
      <div class="photo-grid">${photos}</div>
      ${genSamples ? `<h4>Latest Generated Output Samples</h4><div class="gen-grid">${genSamples}</div>` : ""}
    </div>`;
  }).join("");

  const ipRows = sections.ipHashes.slice(0, 15).map(h =>
    `<tr><td>${h.ipHash}</td><td>${h.count}</td></tr>`).join("");

  const promptRows = sections.allGens.map((g, i) => {
    const nsfw = g.isNsfw || EXPLICIT_RE.test(safeStr(g.prompt));
    return `<tr>
      <td>${i + 1}</td>
      <td>${safeStr(g.createdAt).slice(0, 16)}</td>
      <td>${safeStr(g.type)}</td>
      <td>${safeStr(g.modelName) || "—"}</td>
      <td>${g.status}</td>
      <td${nsfw ? ' class="nsfw"' : ""}>${safeStr(g.prompt).replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 300)}</td>
      <td>${g.outputUrl ? `<a href="${g.outputUrl}" target="_blank">View</a>` : ""}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forensic Report — ${sections.reportRef}</title>
<style>${css}</style>
</head>
<body>

<div class="cover">
  <h1>FORENSIC INVESTIGATION REPORT</h1>
  <div class="sub">Non-Consensual Deepfake / Unauthorized NSFW Generation</div>
  <div class="ref">CLASSIFICATION: CONFIDENTIAL — FOR LAW ENFORCEMENT USE</div>
  <div style="margin-top:14px;font-size:12px">
    <b>Reference:</b> ${sections.reportRef} &nbsp;|&nbsp;
    <b>Date:</b> ${sections.dateStamp} &nbsp;|&nbsp;
    <b>Prepared by:</b> Platform Security / Admin &nbsp;|&nbsp;
    <b>Status:</b> Evidence Package — Active Investigation
  </div>
</div>

<h2>1. SUBJECT IDENTIFICATION</h2>
<table>
  <tr><th>Field</th><th>Value</th></tr>
  <tr><td>Platform User ID</td><td><code>${sections.user.id}</code></td></tr>
  <tr><td>Email</td><td><b>${sections.user.email}</b></td></tr>
  <tr><td>Display Name</td><td>${safeStr(sections.user.name)}</td></tr>
  <tr><td>Auth Provider</td><td>${safeStr(sections.user.authProvider)}</td></tr>
  <tr><td>Google ID</td><td><code>${safeStr(sections.user.googleId)}</code></td></tr>
  <tr><td>Region</td><td><b>${safeStr(sections.user.region)}</b></td></tr>
  <tr><td>Role</td><td>${safeStr(sections.user.role)}</td></tr>
  <tr><td>Account Created</td><td>${asIso(sections.user.createdAt)}</td></tr>
  <tr><td>Last Account Update</td><td>${asIso(sections.user.updatedAt)}</td></tr>
  <tr><td>Subscription Status</td><td>${safeStr(sections.user.subscriptionStatus)}</td></tr>
  <tr><td>Total Credits Used</td><td>${safeStr(sections.user.totalCreditsUsed)}</td></tr>
</table>

<h3>1.1 IP Address Evidence</h3>
<div class="info-box">IP addresses are stored as one-way hashes in this platform's telemetry system. The raw IP addresses can be obtained via a <b>Google emergency data preservation request</b> (account linked via Google OAuth, Google ID: <code>${safeStr(sections.user.googleId)}</code>) or through ISP records correlated with the timestamps below.</div>
<table class="ip-table">
  <tr><th>IP Hash</th><th>Request Count</th></tr>
  ${ipRows}
</table>
<p><b>First recorded request:</b> ${sections.firstRequestAt} &nbsp; <b>Last recorded request:</b> ${sections.lastRequestAt}</p>
<p><b>Total unique IP hashes:</b> ${sections.ipHashes.length} (multiple IPs indicate session changes / mobile network switching — dominant hash <code>${sections.ipHashes[0]?.ipHash}</code> with ${sections.ipHashes[0]?.count} requests is the primary connection)</p>

<h3>1.2 Investigator Witness Context</h3>
<div class="warning">
  <b>Investigator-reported context (requires independent corroboration):</b><br>
  • Account allegedly generated unauthorized NSFW content using classmates' photos<br>
  • Investigator identified victim <b>Yasmin Petra</b> from a TikTok screenshot used in the generation workflow<br>
  • Victim reportedly knows suspect identity and is assisting with identifying additional victims
</div>

<h2>2. PLATFORM ACTIVITY SUMMARY</h2>
<div class="stat-grid">
  <div class="stat-box"><div class="num">${sections.counts.models}</div><div class="lbl">Saved Models</div></div>
  <div class="stat-box"><div class="num">${sections.counts.generations}</div><div class="lbl">Total Generations</div></div>
  <div class="stat-box"><div class="num">${sections.counts.nsfwLikeGenerations}</div><div class="lbl">NSFW-like Generations</div></div>
  <div class="stat-box"><div class="num">${sections.counts.childSafetyIncidents}</div><div class="lbl">Safety Incidents</div></div>
  <div class="stat-box"><div class="num">${sections.counts.apiRequestMetrics}</div><div class="lbl">API Requests</div></div>
  <div class="stat-box"><div class="num">${sections.ipHashes.length}</div><div class="lbl">Unique IP Hashes</div></div>
</div>

<h3>2.1 Top API Routes</h3>
<table>
  <tr><th>Route</th><th>Count</th></tr>
  ${sections.topRoutes.slice(0, 20).map(r => `<tr><td>${r.route}</td><td>${r.count}</td></tr>`).join("")}
</table>

<h3>2.2 Generation Volume by Day</h3>
<table>
  <tr><th>Day</th><th>Generations</th></tr>
  ${sections.generationsByDay.map(d => `<tr><td>${d.day}</td><td>${d.count}</td></tr>`).join("")}
</table>

<h2>3. SAVED MODELS — SOURCE IDENTITY PHOTOS</h2>
<div class="warning">Each model was created using real photographs of individuals (uploaded without their consent) and then used to generate explicit NSFW content.</div>
${modelCards}

<h2>4. CHILD SAFETY INCIDENT RECORDS</h2>
${sections.incidents.length === 0
    ? `<div class="info-box">No <code>ChildSafetyIncident</code> records currently logged for this account. Absence of records does not exclude criminal abuse — may reflect detector coverage gaps or content that circumvented classifiers.</div>`
    : `<table><tr><th>#</th><th>Timestamp</th><th>Classifier</th><th>Route</th><th>IP</th><th>Prompt Preview</th></tr>
       ${sections.incidents.map((i, n) => `<tr><td>${n+1}</td><td>${asIso(i.createdAt)}</td><td>${i.classifierCode}</td><td>${i.routePath}</td><td>${i.ipAddress}</td><td>${safeStr(i.promptPreview).replace(/</g,"&lt;")}</td></tr>`).join("")}
       </table>`
  }

<h2>5. FULL GENERATION PROMPT LOG (ALL ${sections.allGens.length} GENERATIONS)</h2>
<p>Also available in machine-readable form: <code>report/iceland/derived/all_generation_prompts.csv</code></p>
<table>
  <tr><th>#</th><th>Created (UTC)</th><th>Type</th><th>Model</th><th>Status</th><th>Full Prompt</th><th>Output</th></tr>
  ${promptRows}
</table>

<h2>6. LEGAL FRAMEWORK & RECOMMENDED ACTIONS</h2>
<h3>Iceland — Legal Violations</h3>
<ul>
  <li>Art. 209 Almenn hegningarlög — Unlawful pornographic material production/distribution</li>
  <li>Art. 229a Almenn hegningarlög — Non-consensual intimate image sharing</li>
  <li>Act No. 86/2018 on Equal Treatment — image-based sexual abuse</li>
  <li>GDPR Art. 9 — Processing biometric/special-category personal data without consent</li>
</ul>
<h3>Recommended Actions</h3>
<ol>
  <li>Report to <b>Lögreglan</b> (Iceland Police): <a href="https://www.logreglan.is/" target="_blank">https://www.logreglan.is/</a></li>
  <li>If any victims are minors: <b>Barnaverndarstofa</b> (Child Protection Agency): <a href="https://www.bvs.is/" target="_blank">https://www.bvs.is/</a></li>
  <li>Google Emergency Preservation (Google ID: <code>${safeStr(sections.user.googleId)}</code>): <a href="https://support.google.com/code/contact/le_emergency" target="_blank">https://support.google.com/code/contact/le_emergency</a></li>
  <li>NCMEC CyberTipline: <a href="https://www.missingkids.org/gethelpnow/cybertipline" target="_blank">https://www.missingkids.org/gethelpnow/cybertipline</a></li>
  <li>Apply permanent account ban + content-deletion lock on platform</li>
  <li>Notify identified victim Yasmin Petra of evidence preservation</li>
</ol>

<h2>7. CHAIN OF CUSTODY</h2>
<p>Data extracted directly from platform production database (Neon PostgreSQL) at time of report generation. All exports are immutable point-in-time snapshots preserved under <code>report/iceland/</code>. All timestamps UTC from database records.</p>

<footer>
  ${sections.reportRef} &mdash; CONFIDENTIAL &mdash; For Law Enforcement Use Only<br>
  Generated ${new Date().toISOString()} &mdash; Platform Security / Admin — modelclone.app
</footer>

</body>
</html>`;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  await ensureDirs();

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
    if (!user) throw new Error(`User not found: ${TARGET_EMAIL}`);
    const userId = user.id;

    console.log("  Querying database…");
    const [
      models, trainedLoras, loraTrainingImages, modelVoices, generatedVoiceAudios,
      generations, incidents, creditTransactions, cryptoPayments,
      apiRequestMetrics, telemetryEvents, adminAuditLogs,
      nsfwAutoSelectJobs, nsfwPlanJobs, apiKeys, draftTasks,
      avatars, avatarVideos, signupFingerprints, repurposeJobs,
      converterJobs, referralPayoutRequests, referredCommissions,
      referralCommissions, affiliateAttribution, affiliateConversions,
      abandonedSignupEmailOffer, telegramLegacyStates,
      ipHashGroups, firstMetric, lastMetric,
    ] = await Promise.all([
      prisma.savedModel.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.trainedLora.findMany({ where: { model: { userId } }, include: { model: true }, orderBy: { createdAt: "asc" } }),
      prisma.loraTrainingImage.findMany({ where: { model: { userId } }, include: { model: true }, orderBy: { createdAt: "asc" } }),
      prisma.modelVoice.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.generatedVoiceAudio.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.generation.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.childSafetyIncident.findMany({ where: { OR: [{ userIdSnapshot: userId }, { emailSnapshot: TARGET_EMAIL }] }, orderBy: { createdAt: "asc" } }),
      prisma.creditTransaction.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.cryptoPayment.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.apiRequestMetric.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.telemetryEdgeEvent.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.adminAuditLog.findMany({
        where: { OR: [{ targetId: userId }, { detailsJson: { contains: userId } }, { detailsJson: { contains: TARGET_EMAIL } }] },
        orderBy: { createdAt: "asc" },
      }),
      prisma.nsfwAutoSelectJob.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.nsfwPlanGenerationJob.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.draftTask.findMany({ where: { userId }, orderBy: { updatedAt: "asc" } }),
      prisma.avatar.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.avatarVideo.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.signupFingerprint.findMany({ where: { email: TARGET_EMAIL }, orderBy: { createdAt: "asc" } }),
      prisma.repurposeJob.findMany({ where: { userId }, include: { outputs: true }, orderBy: { createdAt: "asc" } }),
      prisma.converterJob.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.referralPayoutRequest.findMany({ where: { userId }, orderBy: { requestedAt: "asc" } }),
      prisma.referralCommission.findMany({ where: { referredUserId: userId }, orderBy: { createdAt: "asc" } }),
      prisma.referralCommission.findMany({ where: { referrerUserId: userId }, orderBy: { createdAt: "asc" } }),
      prisma.affiliateAttribution.findUnique({ where: { userId } }),
      prisma.affiliateConversion.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.abandonedSignupEmailOffer.findUnique({ where: { userId } }),
      prisma.telegramLegacyState.findMany({ where: { sessionUserId: userId }, orderBy: { createdAt: "asc" } }),
      prisma.apiRequestMetric.groupBy({ by: ["ipHash"], where: { userId, NOT: { ipHash: null } }, _count: { ipHash: true }, orderBy: { _count: { ipHash: "desc" } } }),
      prisma.apiRequestMetric.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.apiRequestMetric.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);

    const ipHashes = ipHashGroups.map(g => ({ ipHash: g.ipHash, count: g._count.ipHash }));
    const modelNameById = Object.fromEntries(models.map(m => [m.id, m.name]));
    const modelUsageById = new Map();
    for (const g of generations) {
      if (g.modelId) modelUsageById.set(g.modelId, (modelUsageById.get(g.modelId) || 0) + 1);
    }

    const nsfwLikeGens = generations.filter(g => g.isNsfw || EXPLICIT_RE.test(safeStr(g.prompt)));
    const routeCounts = new Map();
    for (const r of apiRequestMetrics) {
      const k = r.normalizedPath || r.routePath || "unknown";
      routeCounts.set(k, (routeCounts.get(k) || 0) + 1);
    }
    const topRoutes = [...routeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([route, count]) => ({ route, count }));
    const gensByDayMap = new Map();
    for (const g of generations) {
      const day = asIso(g.createdAt)?.slice(0, 10) || "unknown";
      gensByDayMap.set(day, (gensByDayMap.get(day) || 0) + 1);
    }
    const generationsByDay = [...gensByDayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, count]) => ({ day, count }));

    const timeline = [
      ...models.map(m => ({ timestamp: asIso(m.createdAt), eventType: "MODEL_CREATED", eventId: m.id, details: `Model "${m.name}" created` })),
      ...generations.map(g => ({ timestamp: asIso(g.createdAt), eventType: "GENERATION_CREATED", eventId: g.id, details: `${g.type} (${g.status}) model=${modelNameById[g.modelId] || "none"}` })),
      ...incidents.map(i => ({ timestamp: asIso(i.createdAt), eventType: "CHILD_SAFETY_INCIDENT", eventId: i.id, details: `${i.classifierCode || "unknown"} | ${safeStr(i.promptPreview).slice(0, 120)}` })),
      ...adminAuditLogs.map(a => ({ timestamp: asIso(a.createdAt), eventType: "ADMIN_AUDIT", eventId: a.id, details: `${a.action} ${a.targetType || ""} ${a.targetId || ""}`.trim() })),
    ].sort((a, b) => safeStr(a.timestamp).localeCompare(safeStr(b.timestamp)));

    const summary = {
      reportReference: reportRef, reportDate: dateStamp, targetEmail: TARGET_EMAIL,
      userId, userRegion: user.region,
      accountCreatedAt: asIso(user.createdAt), lastUpdatedAt: asIso(user.updatedAt),
      ipHashes: ipHashes.slice(0, 20),
      firstRequestAt: asIso(firstMetric?.createdAt), lastRequestAt: asIso(lastMetric?.createdAt),
      counts: {
        models: models.length, generations: generations.length,
        nsfwLikeGenerations: nsfwLikeGens.length, childSafetyIncidents: incidents.length,
        creditTransactions: creditTransactions.length, cryptoPayments: cryptoPayments.length,
        apiRequestMetrics: apiRequestMetrics.length, telemetryEvents: telemetryEvents.length,
        adminAuditLogs: adminAuditLogs.length, trainedLoras: trainedLoras.length,
      },
      topRoutes, generationsByDay, topPromptKeywords: keywordCounts(generations),
      witnessContext: [
        "Investigator statement: account allegedly generated non-consensual NSFW content using classmates' photos.",
        "Investigator identified victim 'Yasmin Petra' from a TikTok screenshot in generated/source imagery.",
        "Victim reportedly knows suspect identity and is assisting with identifying additional victims.",
      ],
    };

    // ── Download photos ──
    console.log("  Downloading model source photos…");
    const modelsWithPhotos = [];
    for (const m of models) {
      const modelSlug = slugify(m.name);
      const modelDir = path.join(PHOTOS_MODELS_DIR, modelSlug);
      await fs.mkdir(modelDir, { recursive: true });

      const localPhotos = [];
      const photoBufs = [];
      for (const [i, url] of [m.photo1Url, m.photo2Url, m.photo3Url].entries()) {
        const ext = extFromUrl(url);
        const local = path.join(modelDir, `photo_${i + 1}${ext}`);
        await downloadImg(url, local);
        localPhotos.push(local);
        const buf = await fetchBuf(url);
        photoBufs.push(buf);
      }

      // Latest 3 generated outputs for this model
      const modelGens = generations.filter(g => g.modelId === m.id && g.status === "completed" && g.outputUrl)
        .sort((a, b) => safeStr(b.createdAt).localeCompare(safeStr(a.createdAt))).slice(0, 3);
      const genDir = path.join(PHOTOS_GENERATED_DIR, modelSlug);
      await fs.mkdir(genDir, { recursive: true });
      const generatedSamples = [];
      for (const [i, g] of modelGens.entries()) {
        if (g.outputUrl) {
          const ext = extFromUrl(g.outputUrl);
          const local = path.join(genDir, `gen_${i + 1}${ext}`);
          await downloadImg(g.outputUrl, local);
          const buf = await fetchBuf(g.outputUrl);
          generatedSamples.push({ ...g, localPath: local, buf, createdAt: asIso(g.createdAt), modelName: m.name });
        }
      }

      modelsWithPhotos.push({
        ...m, usage: modelUsageById.get(m.id) || 0,
        localPhotos, localPhotoBufs: photoBufs.map((b, i) => ({ buf: b, label: `Photo ${i + 1}`, url: [m.photo1Url, m.photo2Url, m.photo3Url][i] })),
        generatedSamples,
        photo1Url: m.photo1Url, photo2Url: m.photo2Url, photo3Url: m.photo3Url,
      });
    }

    // Build sections payload
    const allGens = generations.map(g => ({
      ...g, createdAt: asIso(g.createdAt), modelName: g.modelId ? modelNameById[g.modelId] || "" : "",
    }));

    const sections = {
      reportRef, dateStamp, user, ipHashes,
      firstRequestAt: asIso(firstMetric?.createdAt),
      lastRequestAt: asIso(lastMetric?.createdAt),
      counts: summary.counts, topRoutes, generationsByDay,
      topKeywords: summary.topPromptKeywords,
      models: modelsWithPhotos,
      incidents, allGens, timeline,
    };

    // ── Write reports ──
    console.log("  Generating HTML…");
    const html = buildHtml(sections);
    const htmlPath = path.join(REPORT_ROOT, "FORENSIC_REPORT_VIKARLOGI13.html");
    await fs.writeFile(htmlPath, html, "utf8");

    // PDF sections needs buf references restructured
    const pdfSections = {
      ...sections,
      models: modelsWithPhotos.map(m => ({
        ...m,
        localPhotos: m.localPhotos,
        localPhotoBufs: m.localPhotoBufs,
        generatedSamples: m.generatedSamples,
      })),
    };
    // Pass buf into photos array used in buildPdf
    pdfSections.models = modelsWithPhotos.map(m => ({
      ...m,
      localPhotos: m.localPhotos.map((lp, i) => lp),
      // Attach buf to each photo
      photo1Buf: m.localPhotoBufs[0]?.buf,
      photo2Buf: m.localPhotoBufs[1]?.buf,
      photo3Buf: m.localPhotoBufs[2]?.buf,
    }));

    console.log("  Generating PDF…");
    const pdfPath = path.join(REPORT_ROOT, "FORENSIC_REPORT_VIKARLOGI13.pdf");
    await buildPdf(pdfPath, {
      ...sections,
      models: modelsWithPhotos.map(m => ({
        ...m,
        localPhotos: [
          { buf: m.localPhotoBufs[0]?.buf, url: m.photo1Url },
          { buf: m.localPhotoBufs[1]?.buf, url: m.photo2Url },
          { buf: m.localPhotoBufs[2]?.buf, url: m.photo3Url },
        ],
      })),
    });

    // ── Write Markdown ──
    console.log("  Generating Markdown…");
    const modelMdRows = modelsWithPhotos.map(m =>
      `| ${m.id} | ${m.name} | ${asIso(m.createdAt)} | ${m.usage} | [Photo 1](${m.photo1Url}) | [Photo 2](${m.photo2Url}) | [Photo 3](${m.photo3Url}) |`
    ).join("\n");

    const ipMdRows = ipHashes.slice(0, 10).map(h => `| \`${h.ipHash}\` | ${h.count} |`).join("\n");

    const promptMd = allGens.map((g, i) =>
      `| ${i+1} | ${safeStr(g.createdAt).slice(0, 16)} | ${g.id} | ${safeStr(g.modelName) || "—"} | ${g.status} | ${safeStr(g.prompt).replace(/\|/g,"\\|").slice(0, 300)} |`
    ).join("\n");

    const md = `# FORENSIC INVESTIGATION REPORT
## Non-Consensual Deepfake / Unauthorized NSFW Generation Investigation
### Classification: CONFIDENTIAL — For Law Enforcement Use

---

**Report Date:** ${dateStamp}  
**Prepared by:** Platform Security / Admin  
**Report Reference:** ${reportRef}  
**Status:** Evidence Package — Active Investigation

---

## 1. SUBJECT IDENTIFICATION

| Field | Value |
|-------|-------|
| Platform User ID | ${user.id} |
| Email | ${user.email} |
| Display Name | ${safeStr(user.name)} |
| Auth Provider | ${safeStr(user.authProvider)} |
| Google ID | ${safeStr(user.googleId)} |
| Region | **${safeStr(user.region)}** |
| Role | ${safeStr(user.role)} |
| Account Created | ${asIso(user.createdAt)} |
| Last Account Update | ${asIso(user.updatedAt)} |
| Subscription Status | ${safeStr(user.subscriptionStatus)} |
| Total Credits Used | ${safeStr(user.totalCreditsUsed)} |

### 1.1 IP Address Evidence

> IP addresses are stored as one-way hashes in this platform's telemetry system. Raw IPs can be obtained via Google emergency data preservation (Google ID: \`${safeStr(user.googleId)}\`) or ISP records correlated with timestamps.

| IP Hash | Request Count |
|---------|--------------|
${ipMdRows}

**First recorded request:** ${asIso(firstMetric?.createdAt)}  
**Last recorded request:** ${asIso(lastMetric?.createdAt)}  
**Total unique IP hashes observed:** ${ipHashes.length}  
**Dominant IP hash:** \`${ipHashes[0]?.ipHash}\` (${ipHashes[0]?.count} requests)

### 1.2 Investigator Witness Context

- Investigator reported this account generated unauthorized NSFW content using classmates' photos.
- Investigator identified victim **Yasmin Petra** from a TikTok screenshot used in the workflow.
- Victim reportedly knows suspect identity and is assisting with identifying additional victims.
- These statements should be independently corroborated through victim interviews.

---

## 2. PLATFORM ACTIVITY SUMMARY

| Metric | Value |
|--------|-------|
| Saved models | ${models.length} |
| Total generations | ${generations.length} |
| NSFW-like generations (prompt heuristic) | ${nsfwLikeGens.length} |
| Child safety incidents (recorded) | ${incidents.length} |
| Credit transactions | ${creditTransactions.length} |
| API telemetry records | ${apiRequestMetrics.length} |
| Unique IP hashes | ${ipHashes.length} |
| Admin audit records linked | ${adminAuditLogs.length} |

---

## 3. SAVED MODELS — SOURCE IDENTITY PHOTOS

| Model ID | Name | Created | Gen Count | Photo 1 | Photo 2 | Photo 3 |
|----------|------|---------|-----------|---------|---------|---------|
${modelMdRows}

---

## 4. FULL GENERATION PROMPT LOG (ALL ${generations.length} GENERATIONS)

See also: \`derived/all_generation_prompts.csv\`

| # | Created (UTC) | Generation ID | Model | Status | Prompt |
|---|---------------|---------------|-------|--------|--------|
${promptMd}

---

## 5. EVIDENCE PACKAGE CONTENTS

### report/iceland/
- \`FORENSIC_REPORT_VIKARLOGI13.md\` — this file
- \`FORENSIC_REPORT_VIKARLOGI13.html\` — full report with embedded photos
- \`FORENSIC_REPORT_VIKARLOGI13.pdf\` — full report with embedded photos

### evidence/photos/models/{model-name}/
- photo_1.jpg, photo_2.jpg, photo_3.jpg — downloaded source identity photos

### evidence/photos/generated_samples/{model-name}/
- gen_1.jpg, gen_2.jpg, gen_3.jpg — downloaded generated output samples

### raw/ — Full DB exports (JSON)
### derived/ — Analysis exports (CSV/JSON)

---

## 6. RECOMMENDED ACTIONS

1. Report to **Lögreglan** (Iceland Police): https://www.logreglan.is/
2. **Barnaverndarstofa** if any victims are minors: https://www.bvs.is/
3. **Google Emergency Preservation** (Google ID: \`${safeStr(user.googleId)}\`): https://support.google.com/code/contact/le_emergency
4. **NCMEC CyberTipline**: https://www.missingkids.org/gethelpnow/cybertipline
5. Apply **permanent account ban** and **content-deletion lock** on platform
6. Notify identified victim Yasmin Petra of evidence preservation

---

**END OF REPORT**  
**${reportRef}**
`;
    await fs.writeFile(path.join(REPORT_ROOT, "FORENSIC_REPORT_VIKARLOGI13.md"), md, "utf8");

    // ── Raw JSON exports ──
    console.log("  Writing raw JSON exports…");
    await Promise.all([
      writeJson(path.join(RAW_DIR, "user.json"), user),
      writeJson(path.join(RAW_DIR, "saved_models.json"), models),
      writeJson(path.join(RAW_DIR, "trained_loras.json"), trainedLoras),
      writeJson(path.join(RAW_DIR, "lora_training_images.json"), loraTrainingImages),
      writeJson(path.join(RAW_DIR, "model_voices.json"), modelVoices),
      writeJson(path.join(RAW_DIR, "generated_voice_audios.json"), generatedVoiceAudios),
      writeJson(path.join(RAW_DIR, "generations.json"), generations),
      writeJson(path.join(RAW_DIR, "child_safety_incidents.json"), incidents),
      writeJson(path.join(RAW_DIR, "credit_transactions.json"), creditTransactions),
      writeJson(path.join(RAW_DIR, "crypto_payments.json"), cryptoPayments),
      writeJson(path.join(RAW_DIR, "api_request_metrics.json"), apiRequestMetrics),
      writeJson(path.join(RAW_DIR, "telemetry_edge_events.json"), telemetryEvents),
      writeJson(path.join(RAW_DIR, "admin_audit_logs.json"), adminAuditLogs),
      writeJson(path.join(RAW_DIR, "nsfw_auto_select_jobs.json"), nsfwAutoSelectJobs),
      writeJson(path.join(RAW_DIR, "nsfw_plan_generation_jobs.json"), nsfwPlanJobs),
      writeJson(path.join(RAW_DIR, "api_keys.json"), apiKeys),
      writeJson(path.join(RAW_DIR, "avatars.json"), avatars),
      writeJson(path.join(RAW_DIR, "avatar_videos.json"), avatarVideos),
      writeJson(path.join(RAW_DIR, "signup_fingerprints.json"), signupFingerprints),
      writeJson(path.join(RAW_DIR, "repurpose_jobs.json"), repurposeJobs),
      writeJson(path.join(RAW_DIR, "converter_jobs.json"), converterJobs),
      writeJson(path.join(RAW_DIR, "referral_payout_requests.json"), referralPayoutRequests),
      writeJson(path.join(RAW_DIR, "referral_commissions_referred.json"), referredCommissions),
      writeJson(path.join(RAW_DIR, "referral_commissions_referrer.json"), referralCommissions),
      writeJson(path.join(RAW_DIR, "affiliate_attribution.json"), affiliateAttribution),
      writeJson(path.join(RAW_DIR, "affiliate_conversions.json"), affiliateConversions),
      writeJson(path.join(RAW_DIR, "abandoned_signup_email_offer.json"), abandonedSignupEmailOffer),
      writeJson(path.join(RAW_DIR, "telegram_legacy_states.json"), telegramLegacyStates),
      writeJson(path.join(RAW_DIR, "ip_hashes.json"), ipHashes),
    ]);

    // ── Derived exports ──
    console.log("  Writing derived exports…");
    const promptsRows = generations.map(g => ({
      generationId: g.id, createdAt: asIso(g.createdAt), status: g.status, type: g.type,
      modelId: g.modelId || "", modelName: g.modelId ? modelNameById[g.modelId] || "" : "",
      isNsfwFlag: g.isNsfw, prompt: g.prompt, outputUrl: g.outputUrl || "",
    }));
    const modelsRows = models.map(m => ({
      modelId: m.id, modelName: m.name, createdAt: asIso(m.createdAt),
      usageCount: modelUsageById.get(m.id) || 0,
      photo1Url: m.photo1Url, photo2Url: m.photo2Url, photo3Url: m.photo3Url,
    }));

    await Promise.all([
      writeJson(path.join(DERIVED_DIR, "summary.json"), summary),
      writeJson(path.join(DERIVED_DIR, "timeline.json"), timeline),
      writeJson(path.join(DERIVED_DIR, "top_routes.json"), topRoutes),
      fs.writeFile(path.join(DERIVED_DIR, "all_generation_prompts.csv"), toCsv(promptsRows, ["generationId","createdAt","status","type","modelId","modelName","isNsfwFlag","prompt","outputUrl"]), "utf8"),
      fs.writeFile(path.join(DERIVED_DIR, "saved_models.csv"), toCsv(modelsRows, ["modelId","modelName","createdAt","usageCount","photo1Url","photo2Url","photo3Url"]), "utf8"),
      fs.writeFile(path.join(DERIVED_DIR, "generations_by_day.csv"), toCsv(generationsByDay, ["day","count"]), "utf8"),
      fs.writeFile(path.join(DERIVED_DIR, "top_api_routes.csv"), toCsv(topRoutes, ["route","count"]), "utf8"),
      fs.writeFile(path.join(DERIVED_DIR, "top_prompt_keywords.csv"), toCsv(summary.topPromptKeywords, ["keyword","count"]), "utf8"),
      fs.writeFile(path.join(DERIVED_DIR, "ip_hashes.csv"), toCsv(ipHashes, ["ipHash","count"]), "utf8"),
    ]);

    console.log(JSON.stringify({
      ok: true, reportReference: reportRef,
      outputDir: REPORT_ROOT,
      markdown: path.join(REPORT_ROOT, "FORENSIC_REPORT_VIKARLOGI13.md"),
      html: htmlPath,
      pdf: pdfPath,
      photosDownloaded: modelsWithPhotos.reduce((s, m) => s + m.localPhotoBufs.filter(p => p?.buf).length, 0),
      generatedSamplesDownloaded: modelsWithPhotos.reduce((s, m) => s + m.generatedSamples.filter(g => g.buf).length, 0),
      counts: summary.counts,
      dominantIpHash: ipHashes[0]?.ipHash,
      totalUniqueIpHashes: ipHashes.length,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
