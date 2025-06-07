# FFmpeg API

A Node.js API for processing videos with text overlays using FFmpeg.

## Features

- Video and audio processing
- Dynamic text overlays with highlighting
- Channel name branding
- Memory efficient processing (under 500MB)
- Ready for Render deployment

## API Usage

### POST /process-video

**Form Data:**
- `video`: MP4 video file
- `audio`: MP3 audio file
- `transcript1`: Text for first transcript
- `transcript2`: Text for second transcript
- `channelName`: Channel name to display
- `fontSize`: Font size (default: 80)
- `fontColor`: Font color (default: white)
- `highlightColor`: Highlight color (default: #98FBCB)

**Response:** Processed MP4 video file

## Deployment

1. Push to GitHub
2. Connect to Render
3. Add font file to `/fonts/` directory
4. Deploy

## Local Development

```bash
npm install
npm run dev
