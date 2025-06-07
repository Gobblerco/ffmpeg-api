const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public')); // Serve static files

// Ensure directories exist
const ensureDirectories = async () => {
  await fs.ensureDir('./uploads');
  await fs.ensureDir('./output');
  await fs.ensureDir('./fonts');
  await fs.ensureDir('./public');
};

// Configure multer for file uploads - OPTIMIZED
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
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 2 // Limit number of files
  },
  fileFilter: (req, file, cb) => {
    // Quick file type check
    if (file.fieldname === 'video' && !file.mimetype.startsWith('video/')) {
      return cb(new Error('Video file required'));
    }
    if (file.fieldname === 'audio' && !file.mimetype.startsWith('audio/')) {
      return cb(new Error('Audio file required'));
    }
    cb(null, true);
  }
});

// Memory cleanup function
const cleanupFiles = async (files) => {
  for (const file of files) {
    try {
      if (await fs.pathExists(file)) {
        await fs.remove(file);
      }
    } catch (error) {
      console.error(`Error cleaning up file ${file}:`, error);
    }
  }
};

// Simplified channel name function for speed
function createChannelNameDrawText(channelName, fontFile, fontColor) {
  const cleanChannelName = channelName
    .replace(/['"]/g, '')
    .replace(/[:]/g, ' ')
    .replace(/[,]/g, ' ')
    .replace(/[\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const channelFontSize = 40;
  const channelVerticalOffset = 400;
  const y = `(h/2)+${channelVerticalOffset}`;
  const drawTextCommands = [];

  // REDUCED TO 2 LAYERS FOR SPEED
  drawTextCommands.push(
    `drawtext=text='${cleanChannelName}':fontsize=${channelFontSize}:fontcolor=white@0.2:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=6:bordercolor=white@0.1`
  );
  drawTextCommands.push(
    `drawtext=text='${cleanChannelName}':fontsize=${channelFontSize}:fontcolor=${fontColor}:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=1:bordercolor=white@0.4`
  );

  return drawTextCommands.join(',');
}

// Optimize text processing - reduce glow effects for speed
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

      // REDUCED GLOW EFFECTS FOR SPEED - Only 2 layers instead of 4
      drawTextCommands.push(
        `drawtext=text='${cleanLine}':fontsize=${fontSize}:fontcolor=white@0.2:x=(w-tw)/2:y=${y}:fontfile='${fontFile}':borderw=8:bordercolor=white@0.1:enable='${enableExpr}'`
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

          // REDUCED GLOW EFFECTS FOR SPEED - Only 2 layers instead of 4
          drawTextCommands.push(
            `drawtext=text='${cleanWord}':fontsize=${fontSize}:fontcolor=${glowColor}@0.2:x=${xPos}:y=${y}:fontfile='${fontFile}':borderw=8:bordercolor=${glowColor}@0.1:enable='${enableExpr}'`
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

// Root route - API documentation
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>FFmpeg API</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
            .method { color: #fff; padding: 5px 10px; border-radius: 3px; font-weight: bold; }
            .post { background: #28a745; }
            .get { background: #007bff; }
            code { background: #e9ecef; padding: 2px 5px; border-radius: 3px; }
        </style>
    </head>
    <body>
        <h1>FFmpeg API</h1>
        <p>A Node.js API for processing videos with text overlays using FFmpeg.</p>
        
        <h2>Available Endpoints</h2>
        
        <div class="endpoint">
            <h3><span class="method get">GET</span> /health</h3>
            <p>Health check endpoint to verify the API is running.</p>
            <p><strong>Response:</strong> JSON with status and timestamp</p>
        </div>
        
        <div class="endpoint">
            <h3><span class="method post">POST</span> /process-video</h3>
            <p>Process video with text overlays and audio replacement. Video duration: 16 seconds.</p>
            <p><strong>Content-Type:</strong> multipart/form-data</p>
            <p><strong>Parameters:</strong></p>
            <ul>
                <li><code>video</code> (file): MP4 video file</li>
                <li><code>audio</code> (file): MP3 audio file</li>
                <li><code>transcript1</code> (text): First transcript text (shows 0-7.5s)</li>
                <li><code>transcript2</code> (text): Second transcript text (shows 8.5-16s)</li>
                <li><code>channelName</code> (text): Channel name to display</li>
                <li><code>fontSize</code> (text, optional): Font size (default: 80)</li>
                <li><code>fontColor</code> (text, optional): Font color (default: white)</li>
                <li><code>highlightColor</code> (text, optional): Highlight color (default: #98FBCB)</li>
            </ul>
            <p><strong>Response:</strong> Processed MP4 video file download</p>
        </div>
        
        <h2>Usage Example</h2>
        <p>Use this API from Make.com or any HTTP client that supports multipart form uploads.</p>
        
        <h2>Status</h2>
        <p>API Status: <span style="color: green;">✓ Online</span></p>
        <p>Server Time: ${new Date().toISOString()}</p>
        <p>Optimized for fast processing with 16-second output duration.</p>
    </body>
    </html>
  `);
});

// Main API endpoint
app.post('/process-video', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]), async (req, res) => {
  const filesToCleanup = [];
  
  try {
    const { 
      transcript1, 
      transcript2, 
      channelName, 
      fontSize = '80', 
      fontColor = 'white', 
      highlightColor = '#98FBCB' 
    } = req.body;

    if (!req.files.video || !req.files.audio) {
      return res.status(400).json({ error: 'Video and audio files are required' });
    }

    const videoPath = req.files.video[0].path;
    const audioPath = req.files.audio[0].path;
    const outputPath = path.join('./output', `processed-${uuidv4()}.mp4`);
    const fontFile = path.join('./fonts', 'Frontage-Condensed-Bold.ttf');

    filesToCleanup.push(videoPath, audioPath, outputPath);

    // Check if font file exists
    if (!await fs.pathExists(fontFile)) {
      return res.status(400).json({ error: 'Font file not found' });
    }

    const parsedFontSize = parseInt(fontSize);

    // Generate drawtext filters - KEEPING ORIGINAL TIMING (7.5s and 8.5s)
    const drawText1 = transcriptToDrawText(transcript1, "lt(t,7.5)", true, parsedFontSize, fontColor, highlightColor, fontFile);
    const drawText2 = transcriptToDrawText(transcript2, "gte(t,8.5)", false, parsedFontSize, fontColor, highlightColor, fontFile);
    const channelDrawText = createChannelNameDrawText(channelName, fontFile, fontColor);

    const drawTextFilters = [drawText1, drawText2, channelDrawText].filter(Boolean);
    const drawText = drawTextFilters.length > 0 ? drawTextFilters.join(',') : '';

    // Process video with FFmpeg - OPTIMIZED FOR SPEED
    await new Promise((resolve, reject) => {
      let command = ffmpeg(videoPath)
        .input(audioPath)
        .outputOptions([
          '-c:v libx264',
          '-preset ultrafast', // Changed from 'fast' to 'ultrafast'
          '-crf 28', // Increased from 23 (lower quality but faster)
          '-c:a aac',
          '-b:a 96k', // Reduced from 128k
          '-movflags +faststart',
          '-threads 0', // Use all available CPU cores
          '-tune zerolatency', // Optimize for speed
          '-profile:v baseline', // Faster encoding profile
          '-level 3.0',
          '-pix_fmt yuv420p',
          '-r 24', // Reduce frame rate to 24fps if not specified
          '-s 1080x1920', // Set resolution explicitly
          '-t 16' // Set duration to exactly 16 seconds
        ]);

      if (drawText) {
        command = command.complexFilter([
          `[0:v]scale=1080:1920,${drawText}[v]` // Scale and add text in one pass
        ]).outputOptions(['-map [v]', '-map 1:a']);
      } else {
        command = command.outputOptions([
          '-map 0:v', 
          '-map 1:a',
          '-vf scale=1080:1920' // Scale video if no text overlay
        ]);
      }

      command
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg process started:', commandLine);
        })
        .on('progress', (progress) => {
          console.log('Processing: ' + progress.percent + '% done');
        })
        .on('end', () => {
          console.log('Processing finished successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .run();
    });

    // Send the processed video
    res.download(outputPath, 'processed-video.mp4', async (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      // Cleanup files after download
      await cleanupFiles(filesToCleanup);
    });

  } catch (error) {
    console.error('Processing error:', error);
    await cleanupFiles(filesToCleanup);
    res.status(500).json({ error: 'Video processing failed', details: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
const startServer = async () => {
  await ensureDirectories();
  app.listen(PORT, () => {
    console.log(`FFmpeg API server running on port ${PORT}`);
  });
};

startServer().catch(console.error);
