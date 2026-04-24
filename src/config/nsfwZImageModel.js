/**
 * Basename of the UNet on the RunPod worker (`models/unet/`, e.g. volume + start.sh).
 * Refiner path uses the same UNET + CLIP + VAE as txt2img (no separate checkpoint bundle).
 */
export const NSFW_ZIMAGE_UNET_BASENAME = "zImageTurboNSFW_62BF16.safetensors";
