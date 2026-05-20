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

const uploadDir = "uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

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
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
});

app.get("/", (req, res) => {
  res.send("Backend is running successfully 🚀");
});

function splitIntoShortCues(text, start, end) {
  const words = text.trim().split(/\s+/);
  const maxWords = 5;

  if (words.length <= maxWords) {
    return [
      {
        start,
        end,
        text,
      },
    ];
  }

  const chunks = [];

  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }

  const duration = end - start;
  const cueDuration = duration / chunks.length;

  return chunks.map((chunk, index) => ({
    start: Number((start + cueDuration * index).toFixed(2)),
    end: Number((start + cueDuration * (index + 1)).toFixed(2)),
    text: chunk,
  }));
}

app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No video file uploaded",
      });
    }

    console.log("Uploaded file:", req.file.originalname);
    console.log("Saved path:", req.file.path);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-large-v3",
      response_format: "verbose_json",
      language: "hi",
    });

    const segments = transcription.segments || [];

    const originalCues = segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
    }));

    const convertResponse = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "Convert each Hindi subtitle line into natural Hinglish using English letters only. Never use Hindi script. Keep meaning same. Return only valid JSON array. Format: [{\"id\":0,\"text\":\"converted text\"}]",
        },
        {
          role: "user",
          content: JSON.stringify(
            originalCues.map((cue, index) => ({
              id: index,
              text: cue.text,
            }))
          ),
        },
      ],
    });

    let convertedLines = [];

    try {
      const content = convertResponse.choices[0].message.content
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      convertedLines = JSON.parse(content);
    } catch (parseError) {
      console.error("JSON parse failed:", parseError);
      convertedLines = originalCues.map((cue, index) => ({
        id: index,
        text: cue.text,
      }));
    }

    const finalCues = [];

    for (let i = 0; i < originalCues.length; i++) {
      const originalCue = originalCues[i];
      const converted = convertedLines.find((line) => line.id === i);

      const hinglishText = converted?.text || originalCue.text;

      const shortCues = splitIntoShortCues(
        hinglishText,
        originalCue.start,
        originalCue.end
      );

      finalCues.push(...shortCues);
    }

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      language: "hinglish",
      text: finalCues.map((cue) => cue.text).join(" "),
      cues: finalCues,
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});