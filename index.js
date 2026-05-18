const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const Groq = require("groq-sdk");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const upload = multer({
  dest: "uploads/",
});

app.get("/", (req, res) => {
  res.send("Backend is running successfully 🚀");
});

app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No video uploaded",
      });
    }

    console.log("Processing file:", req.file.originalname);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
    });

    const text = transcription.text;

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      text,
    });

  } catch (error) {
    console.error("Transcription failed:", error);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      error: "Transcription failed",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});