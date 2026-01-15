const router = require("express").Router();
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const dotenv = require("dotenv");

dotenv.config();

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    let folder = "others";
    if (req.query.type === "post") {
      folder = "post";
    } else if (req.query.type === "cover") {
      folder = "cover";
    }

    let resource_type = "image";
    let allowed_formats = ["jpg", "png", "jpeg", "gif", "webp"];

    if (file.mimetype.startsWith("video")) {
      resource_type = "video";
      allowed_formats = ["mp4", "mov", "avi", "webm", "mkv"];
    } else if (!file.mimetype.startsWith("image")) {
      resource_type = "raw";
      allowed_formats = undefined;
    }

    return {
      folder: folder,
      resource_type: resource_type,
      allowed_formats: allowed_formats,
      public_id: Date.now() + "-" + file.originalname.replace(/\.[^/.]+$/, "").replace(/\s+/g, '-'),
    };
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

router.post("/", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error("Multer error:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json("ファイルサイズが大きすぎます (上限100MB)");
      }
      return res.status(500).json(err);
    } else if (err) {
      console.error("Unknown upload error:", err);
      return res.status(500).json(err);
    }

    try {
      if (!req.file) {
        console.log("No file received in upload request");
        return res.status(400).json("No file uploaded.");
      }

      // Cloudinary returns the full secure_url
      const filePath = req.file.path;

      console.log("File uploaded successfully to Cloudinary:", filePath);
      return res.status(200).json({ filePath: filePath });
    } catch (err) {
      console.error("Upload processing error:", err);
      res.status(500).json(err);
    }
  });
});

module.exports = router;