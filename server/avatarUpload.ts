import { Router } from "express";
import { storagePut } from "./storage";
import { randomBytes } from "crypto";
import { requireAuth } from "./_core/requireAdmin";

export const avatarUploadRouter = Router();

// SECURITY_AUDIT_2026_05_14 P0-1: was anonymous → drained R2 storage.
// Avatar is a per-user profile photo so requireAuth (any logged-in user),
// not requireAdmin. Customers DO upload their own avatars.
avatarUploadRouter.use(requireAuth);

// Avatars are user faces; 2 MB is plenty. Anything bigger is either a
// mistake or abuse, so reject pre-decode rather than after Buffer.from().
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

avatarUploadRouter.post("/upload-avatar", async (req, res) => {
  try {
    const { image } = req.body;

    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "Invalid image data" });
    }

    // Extract base64 data
    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "Invalid image format" });
    }

    const imageType = matches[1];
    const base64Data = matches[2];
    // Quick size check on the base64 string before we allocate a Buffer.
    // base64 is ~4/3 the binary size, so 2 MB binary ≈ 2.67 MB base64.
    if (base64Data.length > AVATAR_MAX_BYTES * 1.4) {
      return res.status(413).json({ error: "Avatar exceeds 2 MB" });
    }
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length > AVATAR_MAX_BYTES) {
      return res.status(413).json({ error: "Avatar exceeds 2 MB" });
    }

    // Generate unique filename
    const randomSuffix = randomBytes(8).toString("hex");
    const fileName = `avatar-${Date.now()}-${randomSuffix}.${imageType}`;
    const fileKey = `avatars/${fileName}`;

    // Upload to S3
    const { url } = await storagePut(fileKey, buffer, `image/${imageType}`);

    res.json({ url });
  } catch (error) {
    console.error("Avatar upload error:", error);
    res.status(500).json({ error: "Failed to upload avatar" });
  }
});
