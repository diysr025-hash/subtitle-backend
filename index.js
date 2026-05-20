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

    const segments = transcription.segments || [];

    const cues = [];

    for (const segment of segments) {
      const hinglish = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "Convert this Hindi subtitle line into natural Hinglish using English letters only. Do not add extra words. Keep the same meaning. Return only the converted line.",
          },
          {
            role: "user",
            content: segment.text,
          },
        ],
      });

      cues.push({
        start: segment.start,
        end: segment.end,
        text: hinglish.choices[0].message.content.trim(),
      });
    }

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      language: "hinglish",
      text: cues.map((cue) => cue.text).join(" "),
      cues: cues,
      originalHindi: transcription.text,
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