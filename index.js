const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const OpenAI = require("openai");
require("dotenv").config();
console.log("OPENAI KEY EXISTS:", !!process.env.OPENAI_API_KEY);
console.log("OPENAI KEY START:", process.env.OPENAI_API_KEY?.slice(0, 8));
console.log("OPENAI KEY END:", process.env.OPENAI_API_KEY?.slice(-4));
const app = express();

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const upload = multer({
  dest: "uploads/",
});

app.get("/", (req, res) => {
  res.send("Backend is running successfully 🚀");
});

app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-1",
    });

    res.json({
      success: true,
      text: transcription.text,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      error: "Transcription failed",
    });
  }
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});