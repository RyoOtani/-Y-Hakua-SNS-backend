const router = require("express").Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use absolute path relative to this file (backEnd/routes/upload.js)
    // We want to reach frontEnd/public/assets
    let uploadPath = path.join(__dirname, "../../frontEnd/public/assets");

    if (req.query.type === "post") {
      uploadPath = path.join(uploadPath, "post");
    } else if (req.query.type === "cover") {
      uploadPath = path.join(uploadPath, "cover");
    } else {
      uploadPath = path.join(uploadPath, "others");
    }

    console.log("Upload path:", uploadPath); // Debug log

    try {
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    } catch (err) {
      console.error("Directory creation error:", err);
      cb(err, null);
    }
  },
  filename: (req, file, cb) => {
    // Sanitize filename just in case
    cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, '-'));
  },
});

const upload = multer({ storage: storage });

router.post("/", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      console.log("No file received in upload request");
      return res.status(400).json("No file uploaded.");
    }

    // Construct relative path for frontend (relative to assets folder)
    const typeFolder = req.query.type === "cover" ? "cover" : (req.query.type === "post" ? "post" : "others");
    const filePath = `${typeFolder}/${req.file.filename}`;

    console.log("File uploaded successfully:", filePath);
    return res.status(200).json({ filePath: filePath });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json(err);
  }
});

module.exports = router;