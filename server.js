const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure directories exist
const ensureDirectories = async () => {
  await fs.ensureDir('./fonts');
  await fs.ensureDir('./uploads');
  await fs.ensureDir('./output');
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
});

// Text processing functions
function createChannelNameDrawText(channelName, fontFile, fontColor, channelFontSize = 40, channelVerticalOffset = 400) {
  const cleanChannelName = channelName
    .replace(/['"]/g, '')
    .replace(/[:]/g, ' ')
    .replace(/[,]/g, ' ')
    .replace(/[\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const y = `(h/2)+${channelVerticalOffset}`;
  const drawTextCommands = [];

  // Outer glow
  drawTextCommands.push(
    `drawtext=text='${cleanChannelName}':fontsize=${channelFontSize}:fontcolor=white@0.08:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=10:bordercolor=white@0.05`
  );
  
  // Medium glow
  drawTextCommands.push(
    `drawtext=text='${cleanChannelName}':fontsize=${channelFontSize}:fontcolor=white@0.15:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=6:bordercolor=white@0.1`
  );
  
  // Inner glow
  drawTextCommands.push(
    `drawtext=text='${cleanChannelName}':fontsize=${channelFontSize}:fontcolor=white@0.3:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=3:bordercolor=white@0.2`
  );
  
  // Main text
  drawTextCommands.push(
    `drawtext=text='${cleanChannelName}':fontsize=${channelFontSize}:fontcolor=${fontColor}:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=1:bordercolor=white@0.4`
  );

  return drawTextCommands.join(',');
}

function transcriptToDrawText(transcript, enableExpr, isFirstTranscript, fontSize, fontColor, highlightColor, fontFile) {
  if (!transcript) return '';

  const lineHeightMultiplier = 1.1;
  const videoWidth = 1080;
  const textVerticalOffset = -500;
  
  const avgCharWidth = fontSize * 0.6;
  const maxCharsPerLine = Math.floor(videoWidth / avgCharWidth);
  
  const cleanTranscript = transcript.trim();
  const words = cleanTranscript.split(' ').filter(word => word.length > 0);
  
  if (words.length === 0) return '';

  // Determine which words to highlight
  let highlightIndices = new Set();
  if (isFirstTranscript && words.length >= 2) {
    highlightIndices.add(words.length - 2);
    highlightIndices.add(words.length - 1);
  } else if (!isFirstTranscript && words.length >= 1) {
    highlightIndices.add(0);
  }

  // Build lines with word tracking
  const lines = [];
  let currentLine = [];
  let currentCharCount = 0;
  let globalWordIndex = 0;

  words.forEach(word => {
    const wordLength = word.length;
    const potentialLength = currentCharCount + (currentLine.length > 0 ? 1 : 0) + wordLength;
    
    if (potentialLength <= maxCharsPerLine) {
      currentLine.push({
        word: word,
        globalIndex: globalWordIndex,
        highlight: highlightIndices.has(globalWordIndex)
      });
      currentCharCount = potentialLength;
    } else {
      if (currentLine.length > 0) lines.push(currentLine);
      currentLine = [{
        word: word,
        globalIndex: globalWordIndex,
        highlight: highlightIndices.has(globalWordIndex)
      }];
      currentCharCount = wordLength;
    }
    globalWordIndex++;
  });
  if (currentLine.length > 0) lines.push(currentLine);

  const totalHeight = lines.length * fontSize * lineHeightMultiplier;
  const lineHeight = fontSize * lineHeightMultiplier;
  const drawTextCommands = [];

  lines.forEach((line, lineIndex) => {
    const yOffset = Math.round((lineIndex * lineHeight) - (totalHeight / 2)) + textVerticalOffset;
    const y = yOffset >= 0 ? `(h/2)+${yOffset}` : `(h/2)${yOffset}`;

    const hasHighlighted = line.some(wordObj => wordObj.highlight);
    
    if (!hasHighlighted) {
      const lineText = line.map(w => w.word).join(' ');
      const cleanLine = lineText
        .replace(/['"]/g, '')
        .replace(/[:]/g, ' ')
        .replace(/[,]/g, ' ')
        .replace(/[\[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Add glow effects and main text
      drawTextCommands.push(
        `drawtext=text='${cleanLine}':fontsize=${fontSize}:fontcolor=white@0.08:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=20:bordercolor=white@0.05:enable='${enableExpr}'`
      );
      drawTextCommands.push(
        `drawtext=text='${cleanLine}':fontsize=${fontSize}:fontcolor=white@0.15:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=12:bordercolor=white@0.1:enable='${enableExpr}'`
      );
      drawTextCommands.push(
        `drawtext=text='${cleanLine}':fontsize=${fontSize}:fontcolor=white@0.3:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=6:bordercolor=white@0.2:enable='${enableExpr}'`
      );
      drawTextCommands.push(
        `drawtext=text='${cleanLine}':fontsize=${fontSize}:fontcolor=${fontColor}:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=2:bordercolor=white@0.4:enable='${enableExpr}'`
      );
    } else {
      const fullLineText = line.map(w => w.word).join(' ');
      
      line.forEach((wordObj, wordIndexInLine) => {
        const cleanWord = wordObj.word
          .replace(/['"]/g, '')
          .replace(/[:]/g, ' ')
          .replace(/[,]/g, ' ')
          .replace(/[\[\]]/g, '')
          .trim();

        if (cleanWord) {
          const textBeforeWord = line.slice(0, wordIndexInLine).map(w => w.word).join(' ');
          const spacesBeforeWord = textBeforeWord.length > 0 ? textBeforeWord.length + 1 : 0;
          
          const charWidth = fontSize * 0.55;
          const pixelOffset = Math.round(spacesBeforeWord * charWidth);
          
          const fullLineLength = fullLineText.length;
          const fullLineWidth = Math.round(fullLineLength * charWidth);
          const lineStartX = `(w-${fullLineWidth})/2`;
          
          const xPos = pixelOffset > 0 ? `${lineStartX}+${pixelOffset}` : lineStartX;
          const color = wordObj.highlight ? highlightColor : fontColor;
          const glowColor = wordObj.highlight ? highlightColor : 'white';

          // Add glow effects and main text for individual words
          drawTextCommands.push(
            `drawtext=text='${cleanWord}':fontsize=${fontSize}:fontcolor=${glowColor}@0.08:x=${xPos}:y=${y}:fontfile='${fontFile}':borderw=20:bordercolor=${glowColor}@0.05:enable='${enableExpr}'`
          );
          drawTextCommands.push(
            `drawtext=text='${cleanWord}':fontsize=${fontSize}:fontcolor=${glowColor}@0.15:x=${xPos}:y=${y}:fontfile='${fontFile}':borderw=12:bordercolor=${glowColor}@0.1:enable='${enableExpr}'`
          );
          drawTextCommands.push(
            `drawtext=text='${cleanWord}':fontsize=${fontSize}:fontcolor=${glowColor}@0.3:x=${xPos}:y=${y}:fontfile='${fontFile}':borderw=6:bordercolor=${glowColor}@0.2:enable='${enableExpr}'`
          );
          drawTextCommands.push(
            `drawtext=text='${cleanWord}':fontsize=${fontSize}:fontcolor=${color}:x=${xPos}:y=${y}:fontfile='${fontFile}':borderw=2:bordercolor=${glowColor}@0.4:enable='${enableExpr}'`
          );
        }
      });
    }
  });

  return drawTextCommands.join(',');
}

// API Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'FFmpeg API is running',
    endpoints: {
      'POST /process': 'Process video with text overlays',
      'GET /health': 'Health check'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/process', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]), async (req, res) => {
  try {
    const { 
      transcript1, 
      transcript2, 
      channelName, 
      fontSize = '80', 
      fontColor = 'white', 
      highlightColor = '#98FBCB' 
    } = req.body;

    if (!req.files || !req.files.video || !req.files.audio) {
      return res.status(400).json({ error: 'Video and audio files are required' });
    }

    const videoFile = req.files.video[0];
    const audioFile = req.files.audio[0];
    const outputFileName = `processed-${uuidv4()}.mp4`;
    const outputPath = path.join('./output', outputFileName);

    // Use a default font or the first available font in fonts folder
    const fontsDir = './fonts';
    const fontFiles = await fs.readdir(fontsDir).catch(() => []);
    const fontFile = fontFiles.length > 0 ? 
      path.join(fontsDir, fontFiles[0]) : 
      '/System/Library/Fonts/Arial.ttf'; // Fallback system font

    const parsedFontSize = parseInt(fontSize);

    // Generate drawtext filters
    const drawText1 = transcriptToDrawText(transcript1, "lt(t,7.5)", true, parsedFontSize, fontColor, highlightColor, fontFile);
    const drawText2 = transcriptToDrawText(transcript2, "gte(t,8.5)", false, parsedFontSize, fontColor, highlightColor, fontFile);
    const channelDrawText = createChannelNameDrawText(channelName, fontFile, fontColor);

    // Combine filters
    const drawTextFilters = [drawText1, drawText2, channelDrawText].filter(Boolean);
    const drawText = drawTextFilters.length > 0 ? drawTextFilters.join(',') : '';

    // Process video with FFmpeg
    const command = ffmpeg()
      .input(videoFile.path)
      .input(audioFile.path)
      .outputOptions([
        '-c:v libx264',
        '-c:a aac',
        '-map 0:v:0',
        '-map 1:a:0',
        '-shortest'
      ]);

    if (drawText) {
      command.videoFilters(drawText);
    }

    command
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg process started:', commandLine);
      })
      .on('progress', (progress) => {
        console.log('Processing: ' + progress.percent + '% done');
      })
      .on('end', async () => {
        console.log('Processing finished successfully');
        
        // Clean up uploaded files
        await fs.remove(videoFile.path).catch(console.error);
        await fs.remove(audioFile.path).catch(console.error);
        
        // Send the processed video
        res.download(outputPath, outputFileName, async (err) => {
          if (err) {
            console.error('Download error:', err);
          }
          // Clean up output file after download
          await fs.remove(outputPath).catch(console.error);
        });
      })
      .on('error', async (err) => {
        console.error('FFmpeg error:', err);
        
        // Clean up files on error
        await fs.remove(videoFile.path).catch(console.error);
        await fs.remove(audioFile.path).catch(console.error);
        await fs.remove(outputPath).catch(console.error);
        
        res.status(500).json({ 
          error: 'Video processing failed', 
          details: err.message 
        });
      })
      .run();

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
});

// Start server
const startServer = async () => {
  await ensureDirectories();
  app.listen(PORT, () => {
    console.log(`FFmpeg API server running on port ${PORT}`);
  });
};

startServer().catch(console.error);
