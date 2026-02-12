const router = require("express").Router();
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const dotenv = require("dotenv");
const { authenticate } = require("../middleware/auth");

dotenv.config();

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 許可するMIMEタイプ
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
const ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

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
      allowed_formats = ["mp4", "mov", "avi", "webm"];
    }

    return {
      folder: folder,
      resource_type: resource_type,
      allowed_formats: allowed_formats,
      public_id: Date.now() + "-" + file.originalname.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, '_'),
    };
  },
});

// ファイルフィルター
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('許可されていないファイル形式です'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: fileFilter,
});

router.post("/", authenticate, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error("Multer error:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "ファイルサイズが大きすぎます (上限100MB)" });
      }
      return res.status(400).json({ error: "ファイルアップロードエラー" });
    } else if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({ error: err.message || "アップロードに失敗しました" });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: "ファイルが選択されていません" });
      }

      const filePath = req.file.path;
      console.log("File uploaded successfully to Cloudinary:", filePath);
      return res.status(200).json({ filePath: filePath });
    } catch (err) {
      console.error("Upload processing error:", err);
      res.status(500).json({ error: "アップロード処理に失敗しました" });
    }
  });
});

module.exports = router;