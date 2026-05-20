const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const Groq = require("groq-sdk");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Make sure uploads folder exists
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// IMPORTANT: keep original file extension like .mp4
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
});

app.get("/", (req, res) => {
  res.send("Backend is running successfully 🚀");
});

app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    console.log("Uploaded file:", req.file.originalname);
    console.log("Saved path:", req.file.path);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-large-v3",
      response_format: "verbose_json",
      language: "hi",
    });

    const rawText = transcription.text;

    const hinglish = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "Convert Hindi text into natural Hinglish using English letters only. Never use Hindi script. Return only the final Hinglish subtitle text.",
        },
        {
          role: "user",
          content: rawText,
        },
      ],
    });

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      originalHindi: rawText,
      text: hinglish.choices[0].message.content,
      language: "hinglish",
    });
  } catch (error) {
    console.error("Upload error:", error);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});