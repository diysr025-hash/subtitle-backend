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

// This makes uploaded video playable from frontend
app.use("/uploads", express.static(uploadDir));

// Keep original extension like .mp4
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".mp4";
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

function cleanJsonFromModel(content) {
  return String(content || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

function cleanCaptionText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function improveCueTiming(cues) {
  return cues.map((cue, index) => {
    const text = cleanCaptionText(cue.text);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    let start = Number(cue.start);
    let end = Number(cue.end);

    if (!Number.isFinite(start)) {
      start = index === 0 ? 0 : cues[index - 1].end;
    }

    if (!Number.isFinite(end) || end <= start) {
      end = start + 2.5;
    }

    // Give short captions enough readable time
    const minDuration = Math.min(3.2, Math.max(1.2, wordCount * 0.33));

    if (end - start < minDuration) {
      end = start + minDuration;
    }

    // Avoid overlapping next cue too much
    const next = cues[index + 1];
    if (next && Number.isFinite(Number(next.start)) && end > Number(next.start)) {
      end = Math.max(start + 0.8, Number(next.start) - 0.05);
    }

    return {
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      text,
    };
  });
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

    // Step 1: Get original transcript with segment timings
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-large-v3",
      response_format: "verbose_json",
      language: "hi",
      temperature: 0,
    });

    const segments = transcription.segments || [];

    const originalCues = segments.map((segment, index) => ({
      id: index,
      start: Number(segment.start),
      end: Number(segment.end),
      text: cleanCaptionText(segment.text),
    }));

    const fullContext = originalCues.map((cue) => cue.text).join(" ");

    // Step 2: Fix wrong words and convert to clean Roman Hinglish
    const convertResponse = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a Roman Hinglish subtitle correction expert for Indian creators. Your job is to fix wrong words, unclear pronunciation mistakes, and Hinglish spelling mistakes. Output Roman Hinglish only, not English translation and not Hindi script. Use the full video context to understand unclear words. Keep Hindi-style words written in English letters. Fix obvious mistakes using context. Use common spellings like mujhe, kabhi, nahi, koile, rang, bana, sakte, hain, challenge, subscribers, drawing, video, aaj, hum. Do not invent new meaning. Do not make captions pure English. Keep each subtitle short and natural. Keep the same number of items and same ids. Return only valid JSON array. Format: [{\"id\":0,\"text\":\"Mujhe kabhi nahi laga tha\"}]",
        },
        {
          role: "user",
          content: JSON.stringify({
            fullContext,
            subtitles: originalCues.map((cue) => ({
              id: cue.id,
              text: cue.text,
            })),
          }),
        },
      ],
    });

    let convertedLines = [];

    try {
      const content = cleanJsonFromModel(
        convertResponse.choices[0].message.content
      );

      convertedLines = JSON.parse(content);
    } catch (parseError) {
      console.error("JSON parse failed:", parseError);

      convertedLines = originalCues.map((cue) => ({
        id: cue.id,
        text: cue.text,
      }));
    }

    // Step 3: Combine original timings with corrected Hinglish text
    const finalCuesRaw = originalCues.map((cue) => {
      const converted = convertedLines.find(
        (line) => Number(line.id) === cue.id
      );

      return {
        start: cue.start,
        end: cue.end,
        text: cleanCaptionText(converted?.text || cue.text),
      };
    });

    const finalCues = improveCueTiming(finalCuesRaw);

    // Step 4: Return playable video URL + subtitle cues
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const videoUrl = `${baseUrl}/uploads/${req.file.filename}`;

    res.json({
      success: true,
      language: "hinglish",
      text: finalCues.map((cue) => cue.text).join(" "),
      cues: finalCues,
      originalHindi: transcription.text,
      videoUrl,
      videoName: req.file.originalname,
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