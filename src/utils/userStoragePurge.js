/**
 * Best-effort delete of all Vercel Blob / R2 objects referenced by a user's rows (before prisma.user.delete).
 */
import prisma from "../lib/prisma.js";
import {
  deleteStoredMediaUrl,
  deleteStoredMediaFromOutputField,
} from "./storageDelete.js";

function addUrl(set, u) {
  if (u && typeof u === "string" && u.startsWith("http")) set.add(u);
}

/**
 * @param {Set<string>} urls
 */
async function deleteAllUrls(urls) {
  for (const u of urls) {
    await deleteStoredMediaUrl(u);
  }
}

/**
 * @param {string} userId
 */
export async function purgeAllBlobAndR2ForUser(userId) {
  const urls = new Set();

  const gens = await prisma.generation.findMany({
    where: { userId },
    select: { outputUrl: true, inputImageUrl: true, inputVideoUrl: true },
  });
  for (const g of gens) {
    addUrl(urls, g.inputImageUrl);
    addUrl(urls, g.inputVideoUrl);
    if (g.outputUrl?.trim().startsWith("[")) {
      try {
        const arr = JSON.parse(g.outputUrl);
        if (Array.isArray(arr)) {
          for (const u of arr) addUrl(urls, u);
        } else addUrl(urls, g.outputUrl);
      } catch {
        addUrl(urls, g.outputUrl);
      }
    } else {
      addUrl(urls, g.outputUrl);
    }
  }

  const models = await prisma.savedModel.findMany({
    where: { userId },
    include: { trainingImages: true, trainedLoras: true },
  });
  for (const m of models) {
    addUrl(urls, m.photo1Url);
    addUrl(urls, m.photo2Url);
    addUrl(urls, m.photo3Url);
    addUrl(urls, m.thumbnail);
    addUrl(urls, m.loraUrl);
    addUrl(urls, m.faceReferenceUrl);
    addUrl(urls, m.modelVoicePreviewUrl);
    for (const ti of m.trainingImages || []) addUrl(urls, ti.imageUrl);
    for (const tl of m.trainedLoras || []) {
      addUrl(urls, tl.loraUrl);
      addUrl(urls, tl.faceReferenceUrl);
    }
  }

  const extraVoices = await prisma.modelVoice.findMany({
    where: { userId },
    select: { previewUrl: true, sampleAudioUrl: true },
  });
  for (const v of extraVoices) {
    addUrl(urls, v.previewUrl);
    addUrl(urls, v.sampleAudioUrl);
  }

  const gva = await prisma.generatedVoiceAudio.findMany({
    where: { userId },
    select: { audioUrl: true, previewUrlSnapshot: true },
  });
  for (const a of gva) {
    addUrl(urls, a.audioUrl);
    addUrl(urls, a.previewUrlSnapshot);
  }

  const avatars = await prisma.avatar.findMany({
    where: { userId },
    include: { videos: true },
  });
  for (const av of avatars) {
    addUrl(urls, av.photoUrl);
    for (const vid of av.videos || []) addUrl(urls, vid.outputUrl);
  }

  const repurposeJobs = await prisma.repurposeJob.findMany({
    where: { userId },
    include: { outputs: true },
  });
  for (const j of repurposeJobs) {
    for (const o of j.outputs || []) addUrl(urls, o.fileUrl);
  }

  const converterJobs = await prisma.converterJob.findMany({
    where: { userId },
    select: { outputUrl: true },
  });
  for (const c of converterJobs) addUrl(urls, c.outputUrl);

  const drafts = await prisma.draftTask.findMany({
    where: { userId },
    select: { imageUrls: true },
  });
  for (const d of drafts) {
    for (const u of d.imageUrls || []) addUrl(urls, u);
  }

  const kieTasks = await prisma.kieTask.findMany({
    where: { userId },
    select: { outputUrl: true },
  });
  for (const k of kieTasks) addUrl(urls, k.outputUrl);

  await deleteAllUrls(urls);
}
