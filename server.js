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

// Text processing functions
function createChannelNameDrawText(channelName, fontColor, fontFile) {
    const cleanChannelName = channelName
        .replace(/['"]/g, '')
        .replace(/[:]/g, ' ')
        .replace(/[,]/g, ' ')
        .replace(/[\[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return [
        // Outer glow
        `drawtext=text='${cleanChannelName}':fontsize=40:fontcolor=white@0.08:x=(w-tw)/2:y=(h/2)+400:fontfile='${fontFile}':borderw=10:bordercolor=white@0.05`,
        // Medium glow
        `drawtext=text='${cleanChannelName}':fontsize=40:fontcolor=white@0.15:x=(w-tw)/2:y=(h/2)+400:fontfile='${fontFile}':borderw=6:bordercolor=white@0.1`,
        // Inner glow
        `drawtext=text='${cleanChannelName}':fontsize=40:fontcolor=white@0.3:x=(w-tw)/2:y=(h/2)+400:fontfile='${fontFile}':borderw=3:bordercolor=white@0.2`,
        // Main text
        `drawtext=text='${cleanChannelName}':fontsize=40:fontcolor=${fontColor}:x=(w-tw)/2:y=(h/2)+400:fontfile='${fontFile}':borderw=1:bordercolor=white@0.4`
    ].join(',');
}

// Add this after the previous code

function createTranscriptDrawText(text, enableExpr, fontSize, fontColor, fontFile, yOffset) {
    if (!text) return '';

    const cleanText = text
        .replace(/['"]/g, '')
        .replace(/[:]/g, ' ')
        .replace(/[,]/g, ' ')
        .replace(/[\[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return [
        // Outer glow
        `drawtext=text='${cleanText}':fontsize=${fontSize}:fontcolor=white@0.08:x=(w-tw)/2:y=(h/2)${yOffset}:fontfile='${fontFile}':borderw=20:bordercolor=white@0.05:enable='${enableExpr}'`,
        // Medium glow
        `drawtext=text='${cleanText}':fontsize=${fontSize}:fontcolor=white@0.15:x=(w-tw)/2:y=(h/2)${yOffset}:fontfile='${fontFile}':borderw=12:bordercolor=white@0.1:enable='${enableExpr}'`,
        // Inner glow
        `drawtext=text='${cleanText}':fontsize=${fontSize}:fontcolor=white@0.3:x=(w-tw)/2:y=(h/2)${yOffset}:fontfile='${fontFile}':borderw=6:bordercolor=white@0.2:enable='${enableExpr}'`,
        // Main text
        `drawtext=text='${cleanText}':fontsize=${fontSize}:fontcolor=${fontColor}:x=(w-tw)/2:y=(h/2)${yOffset}:fontfile='${fontFile}':borderw=2:bordercolor=white@0.4:enable='${enableExpr}'`
    ].join(',');
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
        fileSize: 25 * 1024 * 1024, // 25MB per file
        files: 2
    }
});

// Add this after the previous code

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

app.post('/combine', upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
]), async (req, res) => {
    try {
        const {
            transcript1,
            transcript2,
            channelName = "@motivvmindset",
            fontSize = "80",
            fontColor = "white",
            highlightColor = "#98FBCB"
        } = req.body;

        if (!req.files || !req.files.video) {
            return res.status(400).json({ error: 'Video file is required' });
        }

        const videoFile = req.files.video[0];
        const audioFile = req.files.audio ? req.files.audio[0] : null;
        const outputFileName = `output_${uuidv4()}.mp4`;
        const outputPath = path.join(outputDir, outputFileName);

        // Create FFmpeg command
        let command = ffmpeg(videoFile.path);

        // Generate text filters
        const textFilters = [];

        // Add transcript1 if provided
        if (transcript1) {
            textFilters.push(
                createTranscriptDrawText(transcript1, 'lt(t,7.5)', fontSize, fontColor, fontFile, '-500')
            );
        }

        // Add transcript2 if provided
        if (transcript2) {
            textFilters.push(
                createTranscriptDrawText(transcript2, 'gte(t,8.5)', fontSize, fontColor, fontFile, '-500')
            );
        }

        // Add channel name
        textFilters.push(
            createChannelNameDrawText(channelName, fontColor, fontFile)
        );
// Continue inside the /combine endpoint after the previous code

        // Memory-optimized settings with 5MB target size
        const outputOptions = [
            '-c:v libx264',
            '-preset ultrafast',
            '-crf 32',
            '-maxrate 1M',
            '-bufsize 2M',
            '-movflags faststart',
            '-threads 2',
            '-fs 5242880'
        ];

        // Add audio if provided
        if (audioFile) {
            command = command.addInput(audioFile.path)
                .audioCodec('aac')
                .audioBitrate('64k');
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
        console.error('Server error:', error);
        res.status(500).json({
            error: 'Internal server error',
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
