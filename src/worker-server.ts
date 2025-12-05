import express, { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import { GeminiVisionService } from './services/gemini-vision-service';

const execAsync = promisify(exec);
const app = express();
app.use(express.json());

const TEMP_DIR = process.env.TEMP_VIDEO_PATH || '/app/temp';
const OUTPUT_DIR = process.env.OUTPUT_VIDEO_PATH || '/app/output';
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS || '/app/credentials/credentials.json';
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

// Ensure directories exist
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// STEP 1: DOWNLOAD VIDEO
// ============================================
app.post('/step/download', async (req: Request, res: Response) => {
  let { video_url } = req.body;

  if (!video_url) {
    return res.status(400).json({ error: 'video_url is required' });
  }

  // Extract video ID
  const video_id = extractVideoId(video_url);
  const videoPath = path.join(TEMP_DIR, `${video_id}.mp4`);

  try {
    console.log(`[DOWNLOAD] Starting: ${video_id}`);
    await downloadVideo(video_url, videoPath);
    
    const stats = fs.statSync(videoPath);
    console.log(`[DOWNLOAD] Complete: ${video_id} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    res.json({
      success: true,
      video_id,
      video_path: videoPath,
      file_size: stats.size
    });
  } catch (error: any) {
    console.error(`[DOWNLOAD] Failed: ${error.message}`);
    res.status(500).json({ success: false, video_id, error: error.message });
  }
});

// ============================================
// STEP 2: EXTRACT SUBTITLES (Gemini Vision)
// ============================================
app.post('/step/extract', async (req: Request, res: Response) => {
  const { video_id, video_path } = req.body;

  if (!video_path || !fs.existsSync(video_path)) {
    return res.status(400).json({ error: 'video_path is required and must exist' });
  }

  try {
    console.log(`[EXTRACT] Starting: ${video_id}`);
    const segments = await extractSubtitlesWithGemini(video_path);
    
    // Save segments to JSON for next step
    const segmentsPath = path.join(TEMP_DIR, `${video_id}_segments.json`);
    fs.writeFileSync(segmentsPath, JSON.stringify(segments, null, 2));
    
    console.log(`[EXTRACT] Complete: ${segments.length} segments found`);
    
    res.json({
      success: true,
      video_id,
      segments_count: segments.length,
      segments_path: segmentsPath,
      segments // Return segments directly for inspection
    });
  } catch (error: any) {
    console.error(`[EXTRACT] Failed: ${error.message}`);
    res.status(500).json({ success: false, video_id, error: error.message });
  }
});

// ============================================
// STEP 3: TRANSLATE SUBTITLES
// ============================================
app.post('/step/translate', async (req: Request, res: Response) => {
  const { video_id, segments, segments_path } = req.body;

  // Load segments from file or use provided
  let subtitleSegments = segments;
  if (!subtitleSegments && segments_path && fs.existsSync(segments_path)) {
    subtitleSegments = JSON.parse(fs.readFileSync(segments_path, 'utf-8'));
  }

  if (!subtitleSegments || subtitleSegments.length === 0) {
    return res.status(400).json({ error: 'No segments to translate' });
  }

  try {
    console.log(`[TRANSLATE] Starting: ${subtitleSegments.length} segments`);
    const translatedSegments = await translateSegments(subtitleSegments);
    
    // Save SRT file
    const srtPath = path.join(TEMP_DIR, `${video_id}.srt`);
    const srtContent = generateSrt(translatedSegments);
    fs.writeFileSync(srtPath, srtContent, 'utf-8');
    
    console.log(`[TRANSLATE] Complete: ${srtPath}`);
    
    res.json({
      success: true,
      video_id,
      srt_path: srtPath,
      translated_segments: translatedSegments
    });
  } catch (error: any) {
    console.error(`[TRANSLATE] Failed: ${error.message}`);
    res.status(500).json({ success: false, video_id, error: error.message });
  }
});


// ============================================
// STEP 4: EMBED SUBTITLES INTO VIDEO
// ============================================
app.post('/step/embed', async (req: Request, res: Response) => {
  const { video_id, video_path, srt_path } = req.body;

  if (!video_path || !fs.existsSync(video_path)) {
    return res.status(400).json({ error: 'video_path is required and must exist' });
  }
  if (!srt_path || !fs.existsSync(srt_path)) {
    return res.status(400).json({ error: 'srt_path is required and must exist' });
  }

  const outputPath = path.join(OUTPUT_DIR, `${video_id}_vn.mp4`);

  try {
    console.log(`[EMBED] Starting: ${video_id}`);
    await embedSubtitles(video_path, srt_path, outputPath);
    
    const stats = fs.statSync(outputPath);
    console.log(`[EMBED] Complete: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    res.json({
      success: true,
      video_id,
      output_path: outputPath,
      file_size: stats.size
    });
  } catch (error: any) {
    console.error(`[EMBED] Failed: ${error.message}`);
    res.status(500).json({ success: false, video_id, error: error.message });
  }
});

// ============================================
// STEP 5: UPLOAD TO GOOGLE DRIVE
// ============================================
app.post('/step/upload', async (req: Request, res: Response) => {
  const { video_id, file_path } = req.body;

  if (!file_path || !fs.existsSync(file_path)) {
    return res.status(400).json({ error: 'file_path is required and must exist' });
  }

  try {
    console.log(`[UPLOAD] Starting: ${video_id}`);
    const driveLink = await uploadToGoogleDrive(file_path, `${video_id}_vietnamese.mp4`);
    console.log(`[UPLOAD] Complete: ${driveLink}`);
    
    res.json({
      success: true,
      video_id,
      drive_link: driveLink
    });
  } catch (error: any) {
    console.error(`[UPLOAD] Failed: ${error.message}`);
    res.status(500).json({ success: false, video_id, error: error.message });
  }
});

// ============================================
// STEP 6: CLEANUP TEMP FILES
// ============================================
app.post('/step/cleanup', async (req: Request, res: Response) => {
  const { video_id } = req.body;

  if (!video_id) {
    return res.status(400).json({ error: 'video_id is required' });
  }

  try {
    const filesToClean = [
      path.join(TEMP_DIR, `${video_id}.mp4`),
      path.join(TEMP_DIR, `${video_id}.srt`),
      path.join(TEMP_DIR, `${video_id}_segments.json`)
    ];
    
    let cleaned = 0;
    filesToClean.forEach(f => {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        cleaned++;
      }
    });

    // Cleanup frames directory if exists
    const framesDir = path.join(TEMP_DIR, `${video_id}_frames`);
    if (fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
      cleaned++;
    }

    console.log(`[CLEANUP] Removed ${cleaned} items for ${video_id}`);
    res.json({ success: true, video_id, cleaned_count: cleaned });
  } catch (error: any) {
    console.error(`[CLEANUP] Failed: ${error.message}`);
    res.status(500).json({ success: false, video_id, error: error.message });
  }
});


// ============================================
// FULL PIPELINE (All steps in one call)
// ============================================
app.post('/process-video', async (req: Request, res: Response) => {
  let { video_url, row_number } = req.body;

  if (!video_url) {
    return res.status(400).json({ error: 'video_url is required' });
  }

  const video_id = extractVideoId(video_url);
  const videoPath = path.join(TEMP_DIR, `${video_id}.mp4`);
  const srtPath = path.join(TEMP_DIR, `${video_id}.srt`);
  const outputPath = path.join(OUTPUT_DIR, `${video_id}_vn.mp4`);

  try {
    console.log(`\n========== Processing: ${video_id} ==========`);

    // Step 1
    console.log(`[1/5] Downloading...`);
    await downloadVideo(video_url, videoPath);

    // Step 2
    console.log(`[2/5] Extracting subtitles...`);
    const segments = await extractSubtitlesWithGemini(videoPath);

    // Step 3
    console.log(`[3/5] Translating...`);
    const translatedSegments = await translateSegments(segments);
    fs.writeFileSync(srtPath, generateSrt(translatedSegments), 'utf-8');

    // Step 4
    console.log(`[4/5] Embedding subtitles...`);
    await embedSubtitles(videoPath, srtPath, outputPath);

    // Step 5
    console.log(`[5/5] Uploading...`);
    const driveLink = await uploadToGoogleDrive(outputPath, `${video_id}_vietnamese.mp4`);

    // Cleanup
    cleanupFiles([videoPath, srtPath]);

    console.log(`========== Complete: ${video_id} ==========\n`);
    
    res.json({
      success: true,
      video_id,
      row_number,
      drive_link: driveLink
    });
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    cleanupFiles([videoPath, srtPath, outputPath]);
    res.status(500).json({ success: false, video_id, row_number, error: error.message });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractVideoId(videoUrl: string): string {
  const videoIdMatch = videoUrl.match(/video\/(\d+)/);
  const modalIdMatch = videoUrl.match(/modal_id=(\d+)/);
  
  if (videoIdMatch) return videoIdMatch[1];
  if (modalIdMatch) return modalIdMatch[1];
  return `video_${Date.now()}`;
}

function cleanupFiles(files: string[]) {
  files.forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}


// ============================================
// CORE FUNCTIONS
// ============================================

async function downloadVideo(videoUrl: string, outputPath: string): Promise<void> {
  const MAX_RETRIES = 10;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`  Attempt ${attempt}/${MAX_RETRIES}...`);
    
    try {
      const response = await fetch('https://savetik.io/api/ajaxSearch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://savetik.io/vi/douyin-video-downloader',
          'Origin': 'https://savetik.io'
        },
        body: `q=${encodeURIComponent(videoUrl)}&lang=vi`
      });
      
      const data = await response.json() as any;
      
      if (data.status === 'ok' && data.data) {
        const html = data.data;
        const patterns = [
          /href="(https:\/\/[^"]+)"[^>]*>.*?HD/i,
          /href="(https:\/\/[^"]+\.mp4[^"]*)"/,
          /(https:\/\/[^"'\s]+\.mp4[^"'\s]*)/
        ];
        
        let downloadUrl = null;
        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match) {
            downloadUrl = match[1];
            break;
          }
        }
        
        if (downloadUrl) {
          await execAsync(
            `curl -L -A "Mozilla/5.0" -o "${outputPath}" "${downloadUrl}"`,
            { maxBuffer: 200 * 1024 * 1024, timeout: 300000 }
          );
          
          const fileSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
          if (fileSize > 10000) {
            console.log(`  Download successful!`);
            return;
          }
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        }
      }
    } catch (error: any) {
      console.log(`  Failed: ${error.message.substring(0, 100)}`);
    }
    
    if (attempt < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, Math.min(attempt * 2000, 10000)));
    }
  }
  
  throw new Error('Video download failed after all retries');
}

async function extractSubtitlesWithGemini(
  videoPath: string
): Promise<Array<{start: number, end: number, text: string}>> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required for subtitle extraction');
  }

  console.log(`  Using Gemini Vision...`);
  const gemini = new GeminiVisionService(geminiApiKey);
  const result = await gemini.extractSubtitles(videoPath);
  
  console.log(`  Found ${result.segments.length} segments`);
  result.segments.forEach((seg, i) => {
    console.log(`    ${i+1}. [${(seg.startTime/1000).toFixed(1)}s] ${seg.text}`);
  });
  
  return result.segments.map(seg => ({
    start: seg.startTime / 1000,
    end: seg.endTime / 1000,
    text: seg.text
  }));
}


async function translateSegments(
  segments: Array<{start: number, end: number, text: string}>
): Promise<Array<{start: number, end: number, text: string}>> {
  if (segments.length === 0) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('  No OpenAI API key, keeping original text');
    return segments;
  }

  const textsToTranslate = segments.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
  console.log(`  Translating ${segments.length} segments...`);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Dịch phụ đề video từ tiếng Trung sang tiếng Việt.
Giữ nguyên số thứ tự. Dịch tự nhiên, phù hợp ngữ cảnh.
Chỉ trả về bản dịch, không giải thích.`
        }, {
          role: 'user',
          content: `Dịch sang tiếng Việt:\n\n${textsToTranslate}`
        }],
        temperature: 0.2,
        max_tokens: 3000
      })
    });

    const data = await response.json() as any;
    const translatedText = data.choices?.[0]?.message?.content || '';
    
    const translatedLines = translatedText.split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l && /^\d+\./.test(l));
    
    return segments.map((seg, i) => {
      const line = translatedLines.find((l: string) => {
        const match = l.match(/^(\d+)\./);
        return match && parseInt(match[1]) === i + 1;
      });
      const translated = line ? line.replace(/^\d+\.\s*/, '').trim() : seg.text;
      return { ...seg, text: translated };
    });
  } catch (error: any) {
    console.error(`  Translation error: ${error.message}`);
    return segments;
  }
}

function generateSrt(segments: Array<{start: number, end: number, text: string}>): string {
  return segments.map((seg, i) => {
    const startTime = formatSrtTime(seg.start);
    const endTime = formatSrtTime(seg.end);
    return `${i + 1}\n${startTime} --> ${endTime}\n${seg.text}\n`;
  }).join('\n');
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}


async function embedSubtitles(videoPath: string, srtPath: string, outputPath: string): Promise<void> {
  const srtContent = fs.readFileSync(srtPath, 'utf-8').trim();
  if (!srtContent) {
    console.log('  No subtitles, copying original video');
    fs.copyFileSync(videoPath, outputPath);
    return;
  }

  const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");

  await execAsync(
    `ffmpeg -i "${videoPath}" \
     -vf "subtitles='${escapedSrtPath}':force_style='FontSize=24,PrimaryColour=&H00FFFF&,OutlineColour=&H000000&,Outline=2,MarginV=30'" \
     -c:a copy -c:v libx264 -preset fast -crf 23 \
     -y "${outputPath}"`,
    { maxBuffer: 100 * 1024 * 1024, timeout: 600000 }
  );
  console.log(`  Subtitles embedded successfully`);
}

async function uploadToGoogleDrive(filePath: string, fileName: string): Promise<string> {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.log('  No Google credentials found');
    return `local://${filePath}`;
  }

  try {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    
    let auth;
    if (credentials.type === 'service_account') {
      auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/drive.file']
      });
    } else if (credentials.installed || credentials.web) {
      const tokenPath = CREDENTIALS_PATH.replace('credentials.json', 'token.json');
      if (!fs.existsSync(tokenPath)) {
        return `local://${filePath}`;
      }
      
      const token = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
      const { client_id, client_secret } = credentials.installed || credentials.web;
      
      const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
      oauth2Client.setCredentials(token);
      auth = oauth2Client;
    } else {
      return `local://${filePath}`;
    }

    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata: any = { name: fileName };
    if (DRIVE_FOLDER_ID) {
      fileMetadata.parents = [DRIVE_FOLDER_ID];
    }

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: { mimeType: 'video/mp4', body: fs.createReadStream(filePath) },
      fields: 'id, webViewLink'
    });

    await drive.permissions.create({
      fileId: response.data.id!,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    return response.data.webViewLink || `https://drive.google.com/file/d/${response.data.id}/view`;
  } catch (error: any) {
    console.error(`  Upload error: ${error.message}`);
    return `local://${filePath}`;
  }
}

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Worker server running on port ${PORT}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  GET  /health          - Health check`);
  console.log(`  POST /step/download   - Step 1: Download video`);
  console.log(`  POST /step/extract    - Step 2: Extract subtitles`);
  console.log(`  POST /step/translate  - Step 3: Translate subtitles`);
  console.log(`  POST /step/embed      - Step 4: Embed subtitles`);
  console.log(`  POST /step/upload     - Step 5: Upload to Drive`);
  console.log(`  POST /step/cleanup    - Step 6: Cleanup temp files`);
  console.log(`  POST /process-video   - Full pipeline (all steps)`);
});
