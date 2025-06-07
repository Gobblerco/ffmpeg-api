const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Constants for text rendering
const TEXT_CONFIG = {
    maxLineWidth: 0.8, // 80% of video width
    fontSize: 80,
    channelFontSize: 40,
    fontColor: "white",
    highlightColor: "#98FBCB",
    lineHeightMultiplier: 2.5, // Increased for more spacing
    textVerticalOffset: -300, // Adjusted for better positioning
    channelVerticalOffset: 400,
    lineSpacing: 100, // Explicit line spacing
    glowLevels: [
        { opacity: 0.08, borderWidth: 20, borderOpacity: 0.05 },
        { opacity: 0.15, borderWidth: 12, borderOpacity: 0.1 },
        { opacity: 0.3, borderWidth: 6, borderOpacity: 0.2 },
        { opacity: 1, borderWidth: 2, borderOpacity: 0.4 }
    ],
    transcriptTiming: {
        first: 'lt(t,7.5)',
        second: 'gte(t,8.5)'
    }
};

// Create directories
const uploadsDir = './uploads';
const outputDir = './output';
const fontDir = './fonts';

[uploadsDir, outputDir, fontDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Font file path
const fontFile = path.join(fontDir, 'Frontage-Condensed-Bold.ttf');

// Text processing helper functions
function cleanText(text) {
    return text
        .replace(/['"]/g, '')
        .replace(/[:]/g, ' ')
        .replace(/[,]/g, ' ')
        .replace(/[\[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitTextIntoLines(text, maxCharsPerLine) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = [];
    let currentLength = 0;

    words.forEach((word, index) => {
        const wordLength = word.length;
        if (currentLength + wordLength + (currentLine.length > 0 ? 1 : 0) <= maxCharsPerLine) {
            currentLine.push({ word, index });
            currentLength += wordLength + (currentLine.length > 0 ? 1 : 0);
        } else {
            if (currentLine.length > 0) {
                lines.push(currentLine);
            }
            currentLine = [{ word, index }];
            currentLength = wordLength;
        }
    });

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines;
}

function createGlowEffects(text, x, y, fontSize, color, fontFile, enableExpr = null) {
    return TEXT_CONFIG.glowLevels.map(level => {
        const baseCommand = [
            `drawtext=text='${text}'`,
            `fontfile='${fontFile}'`,
            `fontsize=${fontSize}`,
            `fontcolor=${color}@${level.opacity}`,
            `x=${x}`,
            `y=${y}`,
            `borderw=${level.borderWidth}`,
            `bordercolor=white@${level.borderOpacity}`
        ];

        if (enableExpr) {
            baseCommand.push(`enable='${enableExpr}'`);
        }

        return baseCommand.join(':');
    }).join(',');
}

function createHighlightedText(lines, isFirstTranscript, fontSize, fontFile, yOffset, enableExpr) {
    const drawCommands = [];
    const lineHeight = fontSize * TEXT_CONFIG.lineHeightMultiplier;
    const totalHeight = lines.length * lineHeight;
    const startY = `(h/2)${yOffset}-(${totalHeight}/2)`; // Center vertically

    lines.forEach((line, lineIndex) => {
        const lineY = `${startY}+${lineIndex * lineHeight}`;
        
        // Process each word in the line
        const words = line.map((wordObj, wordIndex) => {
            const isHighlighted = isFirstTranscript ? 
                (lineIndex === lines.length - 1 && wordIndex >= line.length - 2) : // Last two words
                (lineIndex === 0 && wordIndex === 0); // First word
            
            return {
                ...wordObj,
                highlight: isHighlighted
            };
        });

        // Create separate commands for regular and highlighted words
        let currentX = '(w-tw)/2';
        words.forEach((wordObj, wordIndex) => {
            const color = wordObj.highlight ? TEXT_CONFIG.highlightColor : TEXT_CONFIG.fontColor;
            drawCommands.push(createGlowEffects(
                wordObj.word,
                currentX,
                lineY,
                fontSize,
                color,
                fontFile,
                enableExpr
            ));
        });
    });

    return drawCommands.join(',');
}
// Cleanup functions
function cleanupOldFiles() {
    [uploadsDir, outputDir].forEach(dir => {
        if (fs.existsSync(dir)) {
            fs.readdirSync(dir).forEach(file => {
                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);
                if (Date.now() - stats.mtimeMs > 5 * 60 * 1000) {
                    try {
                        fs.unlinkSync(filePath);
                        console.log('Cleaned up:', filePath);
                    } catch (err) {
                        console.error('Cleanup error:', err);
                    }
                }
            });
        }
    });
}

function cleanupFiles(filePaths) {
    filePaths.forEach(filePath => {
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log('Cleaned up:', filePath);
            } catch (err) {
                console.error('Cleanup error:', err);
            }
        }
    });
}

// Run cleanup every 5 minutes
setInterval(cleanupOldFiles, 5 * 60 * 1000);

// Configure multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = uuidv4() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB limit
        files: 2
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'video') {
            if (!file.mimetype.startsWith('video/')) {
                return cb(new Error('Only video files are allowed for video field'));
            }
        }
        if (file.fieldname === 'audio') {
            if (!file.mimetype.startsWith('audio/')) {
                return cb(new Error('Only audio files are allowed for audio field'));
            }
        }
        cb(null, true);
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                error: 'File too large',
                details: 'Maximum file size is 500MB',
                limits: {
                    video: '500MB maximum',
                    audio: '500MB maximum',
                    total: '1GB maximum combined'
                }
            });
        }
    }
    next(error);
});

// Routes
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        memory: process.memoryUsage(),
        message: 'FFmpeg API is running!',
        endpoints: {
            '/combine': 'POST - Combine video, audio, and text',
            '/health': 'GET - Health check'
        }
    });
});

app.get('/health', (req, res) => {
    const memoryUsage = process.memoryUsage();
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        memory: {
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
            rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB'
        }
    });
});

app.post('/combine', async (req, res) => {
    try {
        // Wrap multer in a promise
        await new Promise((resolve, reject) => {
            upload.fields([
                { name: 'video', maxCount: 1 },
                { name: 'audio', maxCount: 1 }
            ])(req, res, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        const {
            transcript1,
            transcript2,
            channelName = "@motivvmindset",
            fontSize = TEXT_CONFIG.fontSize.toString(),
            fontColor = TEXT_CONFIG.fontColor,
            highlightColor = TEXT_CONFIG.highlightColor
        } = req.body;

        if (!req.files || !req.files.video) {
            return res.status(400).json({ error: 'Video file is required' });
        }

        const videoFile = req.files.video[0];
        const audioFile = req.files.audio ? req.files.audio[0] : null;
        const outputFileName = `output_${uuidv4()}.mp4`;
        const outputPath = path.join(outputDir, outputFileName);

        // Get video dimensions
        const videoInfo = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoFile.path, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
            });
        });

        const videoWidth = videoInfo.streams[0].width;
        const maxCharsPerLine = Math.floor((videoWidth * TEXT_CONFIG.maxLineWidth) / (parseInt(fontSize) * 0.6));

        // Generate text filters
        const textFilters = [];
        let currentVerticalOffset = TEXT_CONFIG.textVerticalOffset;

        // Process transcript1
        if (transcript1) {
            const cleanedText1 = cleanText(transcript1);
            const lines1 = splitTextIntoLines(cleanedText1, maxCharsPerLine);
            textFilters.push(createHighlightedText(
                lines1,
                true,
                parseInt(fontSize),
                fontFile,
                currentVerticalOffset,
                TEXT_CONFIG.transcriptTiming.first
            ));
        }

        // Add spacing between transcripts
        currentVerticalOffset += TEXT_CONFIG.lineSpacing;

        // Process transcript2
        if (transcript2) {
            const cleanedText2 = cleanText(transcript2);
            const lines2 = splitTextIntoLines(cleanedText2, maxCharsPerLine);
            textFilters.push(createHighlightedText(
                lines2,
                false,
                parseInt(fontSize),
                fontFile,
                currentVerticalOffset,
                TEXT_CONFIG.transcriptTiming.second
            ));
        }

        // Add channel name
        const cleanedChannelName = cleanText(channelName);
        textFilters.push(createGlowEffects(
            cleanedChannelName,
            '(w-tw)/2',
            `(h/2)+${TEXT_CONFIG.channelVerticalOffset}`,
            TEXT_CONFIG.channelFontSize,
            fontColor,
            fontFile
        ));

        // Memory-optimized settings with larger output size
        const outputOptions = [
            '-c:v libx264',
            '-preset ultrafast',
            '-crf 28',
            '-maxrate 5M',
            '-bufsize 10M',
            '-movflags faststart',
            '-threads 2',
            '-fs 524288000' // 500MB output limit
        ];

        // Create FFmpeg command
        let command = ffmpeg(videoFile.path);

        // Add audio if provided
        if (audioFile) {
            command = command.addInput(audioFile.path)
                .audioCodec('aac')
                .audioBitrate('192k');
        }

        // Configure output with filters
        command = command
            .outputOptions(outputOptions)
            .videoFilters(textFilters.filter(Boolean).join(','));

        // Process the video
        command
            .output(outputPath)
            .on('start', (commandLine) => {
                console.log('FFmpeg started:', commandLine);
            })
            .on('progress', (progress) => {
                console.log('Processing:', Math.round(progress.percent) + '% done');
                console.log('Memory usage:', process.memoryUsage());
            })
            .on('end', () => {
                console.log('Processing finished successfully');
                res.download(outputPath, outputFileName, (err) => {
                    if (err) {
                        console.error('Download error:', err);
                    }
                    setTimeout(() => {
                        cleanupFiles([videoFile.path, audioFile?.path, outputPath]);
                    }, 1000);
                });
            })
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                res.status(500).json({
                    error: 'Processing failed',
                    details: err.message
                });
                cleanupFiles([videoFile.path, audioFile?.path, outputPath]);
            })
            .run();

    } catch (error) {
        console.error('Upload error:', error);
        if (error instanceof multer.MulterError) {
            return res.status(400).json({
                error: 'File upload error',
                details: error.message,
                limits: {
                    maxFileSize: '500MB per file',
                    allowedTypes: {
                        video: ['video/mp4', 'video/quicktime'],
                        audio: ['audio/mpeg', 'audio/mp3']
                    }
                }
            });
        }
        
        return res.status(500).json({
            error: 'Server error',
            details: error.message
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`FFmpeg API server running on port ${PORT}`);
    console.log('Initial memory usage:', process.memoryUsage());
});

// Error handling
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    cleanupOldFiles();
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    cleanupOldFiles();
});
