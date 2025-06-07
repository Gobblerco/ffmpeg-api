# FFmpeg API

A Node.js API for processing videos with text overlays using FFmpeg.

## Features

- Video and audio file processing
- Dynamic text overlays with highlighting
- Channel name branding
- Customizable fonts, colors, and sizes
- RESTful API interface

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Add font files to the `fonts/` directory
4. Start the server: `npm start`

## API Usage

### POST /process

Process a video with text overlays.

**Form Data:**
- `video`: MP4 video file
- `audio`: MP3 audio file
- `transcript1`: First transcript text
- `transcript2`: Second transcript text
- `channelName`: Channel name for branding
- `fontSize`: Font size (default: 80)
- `fontColor`: Font color (default: white)
- `highlightColor`: Highlight color (default: #98FBCB)

**Response:** Processed MP4 video file

### Example cURL

```bash
curl -X POST \
  -F "video=@video.mp4" \
  -F "audio=@audio.mp3" \
  -F "transcript1=Your first transcript text" \
  -F "transcript2=Your second transcript text" \
  -F "channelName=@yourchannel" \
  -F "fontSize=80" \
  -F "fontColor=white" \
  -F "highlightColor=#98FBCB" \
  http://localhost:3000/process \
  --output processed_video.mp4
