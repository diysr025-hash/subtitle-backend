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
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-large-v3",
      response_format: "verbose_json",
      language: "hi",
      prompt:
        "Transcribe Hindi speech as natural Hinglish using English letters only. Do not use Devanagari Hindi script.",
    });

    const hinglish = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
          "You are a Hinglish subtitle expert for Indian YouTube/Reels creators. Convert the text into natural Hinglish using ONLY English letters. Never use Hindi/Devanagari script. Fix obvious speech recognition mistakes. Keep captions short, clean, and easy to read. Return only Hinglish text.",
        },
        {
          role: "user",
          content: transcription.text,
        },
      ],
    });

    fs.unlinkSync(req.file.path);
    console.log("HINGLISH OUTPUT:", hinglish.choices[0].message.content);
    res.json({
      success: true,
      originalHindi: transcription.text,
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