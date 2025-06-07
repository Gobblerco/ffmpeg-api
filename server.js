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

// Create directories with cleanup
const uploadsDir = './uploads';
const outputDir = './output';

// Cleanup function for old files (runs every 5 minutes)
function cleanupOldFiles() {
    [uploadsDir, outputDir].forEach(dir => {
        if (fs.existsSync(dir)) {
            fs.readdirSync(dir).forEach(file => {
                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);
                // Delete files older than 5 minutes
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

// Run cleanup every 5 minutes
setInterval(cleanupOldFiles, 5 * 60 * 1000);

// Create directories if they don't exist
[uploadsDir, outputDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Configure multer with file size limits
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
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 2 // Max 2 files (video + audio)
    }
});

// Health check endpoint
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

// Main processing endpoint
app.post('/combine', upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
]), async (req, res) => {
    try {
        const { text, textPosition = 'center', fontSize = '24', fontColor = 'white' } = req.body;
        
        if (!req.files || !req.files.video) {
            return res.status(400).json({ error: 'Video file is required' });
        }

        const videoFile = req.files.video[0];
        const audioFile = req.files.audio ? req.files.audio[0] : null;
        const outputFileName = `output_${uuidv4()}.mp4`;
        const outputPath = path.join(outputDir, outputFileName);

        console.log('Processing request:', {
            video: videoFile.filename,
            audio: audioFile ? audioFile.filename : 'none',
            text: text || 'none',
            memoryUsage: process.memoryUsage()
        });

        // Create FFmpeg command
        let command = ffmpeg(videoFile.path);

        // Memory-optimized settings
        const outputOptions = [
            '-c:v libx264',
            '-preset ultrafast', // Faster encoding, less memory
            '-crf 28', // Lower quality, less memory
            '-movflags faststart',
            '-threads 2' // Limit CPU threads
        ];

        // Add audio if provided
        if (audioFile) {
            command = command.addInput(audioFile.path)
                .audioCodec('aac')
                .audioBitrate('128k'); // Lower audio quality
        }

        // Configure output
        command = command.outputOptions(outputOptions);

        // Add text overlay if provided
        if (text) {
            const textFilter = `drawtext=text='${text.replace(/'/g, "\\'")}':fontsize=${fontSize}:fontcolor=${fontColor}:x=(w-text_w)/2:y=(h-text_h)/2`;
            command = command.videoFilters(textFilter);
        }

        // Process the video with progress monitoring
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
                
                // Send file back
                res.download(outputPath, outputFileName, (err) => {
                    if (err) {
                        console.error('Download error:', err);
                    }
                    
                    // Cleanup files after sending
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
                
                // Cleanup on error
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

// Cleanup function
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

// Start server with memory monitoring
app.listen(PORT, () => {
    console.log(`FFmpeg API server running on port ${PORT}`);
    console.log('Initial memory usage:', process.memoryUsage());
});

// Handle process errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    cleanupOldFiles(); // Cleanup before exit
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    cleanupOldFiles(); // Cleanup before exit
});
