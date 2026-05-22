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

app.use("/uploads", express.static(uploadDir));
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
function makeSmartCuesFromWords(words, fallbackSegments = []) {
  if (!Array.isArray(words) || words.length === 0) {
    return fallbackSegments.map((segment) => ({
      start: Number(segment.start),
      end: Number(segment.end),
      text: String(segment.text || "").trim(),
    }));
  }

  const cues = [];
  let currentWords = [];
  let cueStart = null;

  const maxWords = 7;
  const maxDuration = 3.2;
  const pauseGap = 0.45;

  for (let i = 0; i < words.length; i++) {
    const item = words[i];
    const word = String(item.word || "").trim();
    const start = Number(item.start);
    const end = Number(item.end);

    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) continue;

    if (cueStart === null) cueStart = start;

    const prev = words[i - 1];
    const prevEnd = prev ? Number(prev.end) : start;
    const gap = start - prevEnd;

    const currentDuration = end - cueStart;
    const shouldBreak =
      currentWords.length >= maxWords ||
      currentDuration >= maxDuration ||
      gap >= pauseGap;

    if (shouldBreak && currentWords.length > 0) {
      cues.push({
        start: Number(cueStart.toFixed(2)),
        end: Number(prevEnd.toFixed(2)),
        text: currentWords.join(" "),
      });

      currentWords = [];
      cueStart = start;
    }

    currentWords.push(word.replace(/^[\s,.!?]+|[\s,.!?]+$/g, ""));
  }

  if (currentWords.length > 0 && cueStart !== null) {
    const lastWord = words[words.length - 1];

    cues.push({
      start: Number(cueStart.toFixed(2)),
      end: Number(Number(lastWord.end).toFixed(2)),
      text: currentWords.join(" "),
    });
  }

  const cleaned = [];

  for (const cue of cues) {
    const wordCount = cue.text.split(/\s+/).filter(Boolean).length;

    if (wordCount <= 2 && cleaned.length > 0) {
      const prev = cleaned[cleaned.length - 1];
      prev.end = cue.end;
      prev.text = `${prev.text} ${cue.text}`.trim();
    } else {
      cleaned.push(cue);
    }
  }

  return cleaned;
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
      temperature: 0,
      timestamp_granularities: ["word", "segment"],
    });

    const segments = transcription.segments || [];
    const words = transcription.words || [];
    
    const originalCues = makeSmartCuesFromWords(words, segments);

    const convertResponse = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "Convert each Hindi subtitle line into Roman Hinglish, NOT English translation. Keep Hindi words, but write them using English letters. Never use Devanagari Hindi script. Do not translate to full English. Example: 'मुझे कभी नहीं लगा था कि हम कोयले से इतने रंग बना सकते हैं' becomes 'Mujhe kabhi nahi laga tha ki hum koile se itne rang bana sakte hain'. Return only valid JSON array. Format: [{\"id\":0,\"text\":\"converted text\"}]"
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

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const videoUrl = `${baseUrl}/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      language: "hinglish",
      text: finalCues.map((cue) => cue.text).join(" "),
      cues: finalCues,
      originalHindi: transcription.text,
      videoUrl: videoUrl,
      videoName: req.file.originalname,
    });
    });
  } catch (error) {
    console.error("Upload error:", error);

    if (req.file && fs.existsSync(req.file.path)) {
      
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