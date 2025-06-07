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

// Create uploads directory
const uploadsDir = './uploads';
const outputDir = './output';

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Configure multer for file uploads
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
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'FFmpeg API is running!',
        endpoints: {
            '/combine': 'POST - Combine video, audio, and text',
            '/health': 'GET - Health check'
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
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
            text: text || 'none'
        });

        // Create FFmpeg command
        let command = ffmpeg(videoFile.path);

        // Add audio if provided
        if (audioFile) {
            command = command.addInput(audioFile.path);
        }

        // Configure output
        command = command
            .outputOptions([
                '-c:v libx264',
                '-c:a aac',
                '-preset fast',
                '-crf 23'
            ]);

        // Add text overlay if provided
        if (text) {
            const textFilter = `drawtext=text='${text.replace(/'/g, "\\'")}':fontsize=${fontSize}:fontcolor=${fontColor}:x=(w-text_w)/2:y=(h-text_h)/2`;
            command = command.videoFilters(textFilter);
        }

        // Process the video
        command
            .output(outputPath)
            .on('start', (commandLine) => {
                console.log('FFmpeg started:', commandLine);
            })
            .on('progress', (progress) => {
                console.log('Processing: ' + Math.round(progress.percent) + '% done');
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
                    }, 5000);
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

// Start server
app.listen(PORT, () => {
    console.log(`FFmpeg API server running on port ${PORT}`);
});
