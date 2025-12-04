import express, { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';

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

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Process video endpoint
app.post('/process-video', async (req: Request, res: Response) => {
  let { video_url, row_number } = req.body;

  if (!video_url) {
    return res.status(400).json({ error: 'video_url is required' });
  }

  // Extract video ID
  let video_id: string;
  const videoIdMatch = video_url.match(/video\/(\d+)/);
  const modalIdMatch = video_url.match(/modal_id=(\d+)/);

  if (videoIdMatch) {
    video_id = videoIdMatch[1];
  } else if (modalIdMatch) {
    video_id = modalIdMatch[1];
    video_url = `https://www.douyin.com/video/${video_id}`;
  } else {
    video_id = `video_${Date.now()}`;
  }

  // File paths
  const videoPath = path.join(TEMP_DIR, `${video_id}.mp4`);
  const framesDir = path.join(TEMP_DIR, `${video_id}_frames`);
  const srtPath = path.join(TEMP_DIR, `${video_id}.srt`);
  const outputPath = path.join(OUTPUT_DIR, `${video_id}_vn.mp4`);

  try {
    console.log(`\n========== Processing video: ${video_id} ==========`);

    // Step 1: Download video
    console.log(`[1/5] Downloading video...`);
    await downloadVideo(video_url, videoPath);

    // Step 2: Extract text using OCR
    console.log(`[2/5] Extracting text from video...`);
    const chineseTexts = await extractAndOCR(videoPath, framesDir);

    // Step 3: Translate to Vietnamese using OpenAI
    console.log(`[3/5] Translating to Vietnamese...`);
    const vietnameseSrt = await translateToVietnamese(chineseTexts);
    fs.writeFileSync(srtPath, vietnameseSrt, 'utf-8');
    console.log(`  SRT saved: ${srtPath}`);

    // Step 4: Add subtitles to video (keep original audio)
    console.log(`[4/5] Adding Vietnamese subtitles...`);
    await addSubtitlesToVideo(videoPath, srtPath, outputPath);

    // Step 5: Upload to Google Drive
    console.log(`[5/5] Uploading to Google Drive...`);
    const driveLink = await uploadToGoogleDrive(outputPath, `${video_id}_vietnamese.mp4`);

    // Cleanup temp files
    cleanupFiles([videoPath, srtPath]);
    if (fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }

    console.log(`========== Completed: ${video_id} ==========\n`);
    
    res.json({
      success: true,
      video_id,
      row_number,
      drive_link: driveLink,
      file_name: `${video_id}_vietnamese.mp4`
    });
  } catch (error: any) {
    console.error(`Error processing video: ${error.message}`);
    
    // Cleanup on error
    cleanupFiles([videoPath, srtPath, outputPath]);
    if (fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
    
    res.status(500).json({
      success: false,
      video_id,
      row_number,
      error: error.message
    });
  }
});

function cleanupFiles(files: string[]) {
  files.forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

// Download video using SaveTik API
async function downloadVideo(videoUrl: string, outputPath: string): Promise<void> {
  const MAX_RETRIES = 10;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`  Attempt ${attempt}/${MAX_RETRIES}...`);
    
    try {
      const response = await fetch('https://savetik.io/api/ajaxSearch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://savetik.io/vi/douyin-video-downloader',
          'Origin': 'https://savetik.io',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        body: `q=${encodeURIComponent(videoUrl)}&lang=vi`
      });
      
      const data = await response.json() as any;
      
      // Debug logging
      console.log(`  [DEBUG] HTTP status: ${response.status}`);
      console.log(`  [DEBUG] API status: ${data.status}`);
      if (data.mess) {
        console.log(`  [DEBUG] API message: ${data.mess}`);
      }
      
      if (data.status === 'ok' && data.data) {
        const html = data.data;
        console.log(`  [DEBUG] Response HTML length: ${html.length}`);
        console.log(`  [DEBUG] HTML preview: ${html.substring(0, 300)}...`);
        
        // Try multiple patterns to find download URL
        const patterns = [
          /href="(https:\/\/[^"]+)"[^>]*>.*?HD/i,
          /href="(https:\/\/[^"]+\.mp4[^"]*)"/,
          /(https:\/\/[^"'\s]+\.mp4[^"'\s]*)/,
          /href="(https:\/\/[^"]+)"/
        ];
        
        let downloadUrl = null;
        for (let i = 0; i < patterns.length; i++) {
          const match = html.match(patterns[i]);
          if (match) {
            downloadUrl = match[1];
            console.log(`  [DEBUG] Pattern ${i + 1} matched: ${downloadUrl.substring(0, 100)}...`);
            break;
          }
        }
        
        if (downloadUrl) {
          console.log(`  Found download URL, downloading...`);
          await execAsync(
            `curl -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -o "${outputPath}" "${downloadUrl}"`,
            { maxBuffer: 200 * 1024 * 1024, timeout: 300000 }
          );
          
          const fileSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
          console.log(`  [DEBUG] Downloaded file size: ${fileSize} bytes`);
          
          if (fileSize > 10000) {
            console.log(`  Download successful!`);
            return;
          }
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } else {
          console.log(`  [DEBUG] No download URL found with any pattern`);
        }
      } else {
        console.log(`  [DEBUG] API returned non-ok status or no data`);
        if (data.data) {
          console.log(`  [DEBUG] Data preview: ${JSON.stringify(data).substring(0, 200)}`);
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

// Extract frames and run EasyOCR
async function extractAndOCR(videoPath: string, framesDir: string): Promise<Array<{start: number, end: number, text: string}>> {
  // Create frames directory
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }

  // Get video duration
  const { stdout: durationStr } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
  );
  const duration = parseFloat(durationStr.trim());
  console.log(`  Video duration: ${duration.toFixed(2)}s`);

  // Extract frames every 1 second for better text detection
  const fps = 1; // 1 frame per second
  await execAsync(
    `ffmpeg -i "${videoPath}" -vf "fps=${fps}" -q:v 2 "${framesDir}/frame_%04d.jpg" -y`,
    { maxBuffer: 100 * 1024 * 1024, timeout: 300000 }
  );

  // Get list of frames
  const frames = fs.readdirSync(framesDir)
    .filter(f => f.endsWith('.jpg'))
    .sort();
  
  console.log(`  Extracted ${frames.length} frames`);

  // Create sequential OCR script (more reliable in Docker)
  const ocrScriptPath = path.join(framesDir, 'batch_ocr.py');
  const framesList = frames.map(f => path.join(framesDir, f)).join('","');
  
  const batchScript = `import warnings
warnings.filterwarnings('ignore')
import os
import sys
import time
import json

print(f"[DEBUG] Python: {sys.version}", file=sys.stderr)

try:
    import easyocr
    print(f"[DEBUG] EasyOCR imported", file=sys.stderr)
except ImportError as e:
    print(f"[ERROR] Failed to import easyocr: {e}", file=sys.stderr)
    print("[]")
    sys.exit(0)

start_time = time.time()
frames = ["${framesList}"]
print(f"[DEBUG] Processing {len(frames)} frames sequentially...", file=sys.stderr)

# Initialize reader once
print(f"[DEBUG] Initializing EasyOCR reader...", file=sys.stderr)
reader = easyocr.Reader(['ch_sim'], gpu=False, verbose=False)
print(f"[DEBUG] Reader ready in {time.time()-start_time:.1f}s", file=sys.stderr)

results = []
for i, frame_path in enumerate(frames):
    try:
        result = reader.readtext(frame_path)
        texts = [d[1] for d in result if d[2] > 0.3]
        results.append(texts)
        
        if texts:
            print(f"[DEBUG] Frame {i+1}: {texts}", file=sys.stderr)
        elif i < 3:
            print(f"[DEBUG] Frame {i+1}: (no text)", file=sys.stderr)
            
    except Exception as e:
        print(f"[ERROR] Frame {i+1}: {e}", file=sys.stderr)
        results.append([])

frames_with_text = sum(1 for r in results if r)
elapsed = time.time() - start_time
print(f"[DEBUG] Done in {elapsed:.1f}s: {frames_with_text}/{len(results)} frames have text", file=sys.stderr)
sys.stderr.flush()

# Output JSON to stdout
print(json.dumps(results, ensure_ascii=False))
sys.stdout.flush()
`;
  fs.writeFileSync(ocrScriptPath, batchScript);

  console.log(`  Running batch OCR on ${frames.length} frames...`);
  
  let allResults: string[][] = [];
  
  try {
    const { stdout, stderr } = await execAsync(
      `python3 "${ocrScriptPath}"`,
      { maxBuffer: 100 * 1024 * 1024, timeout: 900000 }  // 15 minutes
    );
    
    // Log stderr for debugging (contains progress info)
    if (stderr) {
      const stderrLines = stderr.split('\n').slice(-10).join('\n');
      console.log(`  OCR log (last 10 lines):\n${stderrLines}`);
    }

    console.log(`  stdout length: ${stdout.length}`);
    console.log(`  stdout preview: ${stdout.substring(0, 200)}`);

    // Find JSON line in output - should be the last non-empty line
    const lines = stdout.trim().split('\n');
    const jsonLine = lines.reverse().find(line => line.trim().startsWith('['));
    
    if (jsonLine) {
      allResults = JSON.parse(jsonLine.trim());
      console.log(`  Parsed ${allResults.length} frame results`);
      
      // Count frames with text
      const framesWithText = allResults.filter(r => r && r.length > 0).length;
      console.log(`  Frames with text: ${framesWithText}`);
    } else {
      console.log(`  No JSON output found in stdout`);
      console.log(`  All stdout lines: ${lines.slice(0, 5).join(' | ')}`);
    }
  } catch (error: any) {
    console.error(`  OCR error: ${error.message}`);
    if (error.stdout) console.log(`  stdout: ${error.stdout.substring(0, 500)}`);
    if (error.stderr) console.log(`  stderr: ${error.stderr.substring(0, 500)}`);
  }
  
  try {
    
    // First pass: extract text from each frame (1 frame = 1 second)
    const frameTexts: Array<{time: number, text: string}> = [];
    
    for (let i = 0; i < allResults.length; i++) {
      const texts = allResults[i];
      const chineseTexts = texts.filter(t => /[\u4e00-\u9fff]/.test(t));
      const text = chineseTexts.join(' ').trim();

      if (i < 5) {
        console.log(`  [DEBUG] Frame ${i + 1} (${i}s): ${text || '(empty)'}`);
      }

      frameTexts.push({ time: i, text });
    }

    // Second pass: merge consecutive frames with same text
    const results: Array<{start: number, end: number, text: string}> = [];
    let currentSegment: {start: number, end: number, text: string} | null = null;

    for (const frame of frameTexts) {
      if (!frame.text) {
        // No text in this frame - close current segment if exists
        if (currentSegment) {
          results.push(currentSegment);
          currentSegment = null;
        }
        continue;
      }

      if (currentSegment && currentSegment.text === frame.text) {
        // Same text - extend current segment
        currentSegment.end = Math.min(frame.time + 1, duration);
      } else {
        // Different text - close previous and start new
        if (currentSegment) {
          results.push(currentSegment);
        }
        currentSegment = {
          start: frame.time,
          end: Math.min(frame.time + 1, duration),
          text: frame.text
        };
        console.log(`  Segment: ${frame.time}s - "${frame.text.substring(0, 40)}..."`);
      }
    }

    // Don't forget last segment
    if (currentSegment) {
      results.push(currentSegment);
    }

    console.log(`  OCR found ${results.length} text segments (merged from ${frameTexts.filter(f => f.text).length} frames)`);
    return results;
    
  } catch (error: any) {
    const fullError = error.stderr || error.stdout || error.message;
    console.error(`  Batch OCR error:`);
    console.error(`  stdout: ${error.stdout || 'none'}`);
    console.error(`  stderr: ${error.stderr || 'none'}`);
    console.error(`  message: ${error.message}`);
    
    // Try to read the script to debug
    if (fs.existsSync(ocrScriptPath)) {
      console.log(`  Script exists, first 500 chars:`);
      const scriptContent = fs.readFileSync(ocrScriptPath, 'utf-8');
      console.log(`  ${scriptContent.substring(0, 500)}`);
    }
    return [];
  } finally {
    // Cleanup script - keep for debugging if error
    // if (fs.existsSync(ocrScriptPath)) {
    //   fs.unlinkSync(ocrScriptPath);
    // }
  }
}

// Translate Chinese texts to Vietnamese using OpenAI
async function translateToVietnamese(segments: Array<{start: number, end: number, text: string}>): Promise<string> {
  if (segments.length === 0) {
    console.log('  No text to translate');
    return '';
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('  No OpenAI API key, returning original Chinese');
    return generateSrt(segments);
  }

  // Combine all texts for batch translation
  const textsToTranslate = segments.map((s, i) => `${i + 1}. ${s.text}`).join('\n');

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
          content: 'You are a translator. Translate Chinese to Vietnamese. Keep the numbering format. Only output translations, no explanations.'
        }, {
          role: 'user',
          content: `Translate these Chinese texts to Vietnamese:\n\n${textsToTranslate}`
        }],
        temperature: 0.3,
        max_tokens: 2000
      })
    });

    const data = await response.json() as any;
    const translatedText = data.choices?.[0]?.message?.content || '';

    // Parse translated lines
    const translatedLines = translatedText.split('\n').filter((l: string) => l.trim());
    const translatedSegments = segments.map((seg, i) => {
      const line = translatedLines.find((l: string) => l.startsWith(`${i + 1}.`));
      const translated = line ? line.replace(/^\d+\.\s*/, '').trim() : seg.text;
      return { ...seg, text: translated };
    });

    console.log(`  Translated ${translatedSegments.length} segments`);
    return generateSrt(translatedSegments);
  } catch (error: any) {
    console.error(`  Translation error: ${error.message}`);
    return generateSrt(segments);
  }
}

// Generate SRT format
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

// Add subtitles to video (keep original audio)
async function addSubtitlesToVideo(videoPath: string, srtPath: string, outputPath: string): Promise<void> {
  // Check if SRT has content
  const srtContent = fs.readFileSync(srtPath, 'utf-8').trim();
  if (!srtContent) {
    console.log('  No subtitles, copying original video');
    fs.copyFileSync(videoPath, outputPath);
    return;
  }

  // Escape path for FFmpeg subtitles filter
  const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");

  // Add subtitles while keeping original audio
  await execAsync(
    `ffmpeg -i "${videoPath}" \
     -vf "subtitles='${escapedSrtPath}':force_style='FontSize=24,PrimaryColour=&H00FFFF&,OutlineColour=&H000000&,Outline=2,MarginV=30'" \
     -c:a copy \
     -c:v libx264 -preset fast -crf 23 \
     -y "${outputPath}"`,
    { maxBuffer: 100 * 1024 * 1024, timeout: 600000 }
  );
  console.log(`  Subtitles added successfully`);
}

// Upload to Google Drive
async function uploadToGoogleDrive(filePath: string, fileName: string): Promise<string> {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.log('  No Google credentials found');
    return `local://${filePath}`;
  }

  try {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    
    let auth;
    if (credentials.type === 'service_account') {
      // Service account
      auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/drive.file']
      });
    } else if (credentials.installed || credentials.web) {
      // OAuth2 - need token
      const tokenPath = CREDENTIALS_PATH.replace('credentials.json', 'token.json');
      if (!fs.existsSync(tokenPath)) {
        console.log('  No OAuth token found');
        return `local://${filePath}`;
      }
      
      const token = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
      const { client_id, client_secret } = credentials.installed || credentials.web;
      
      const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
      oauth2Client.setCredentials(token);
      auth = oauth2Client;
    } else {
      console.log('  Unknown credentials type');
      return `local://${filePath}`;
    }

    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata: any = { name: fileName };
    if (DRIVE_FOLDER_ID) {
      fileMetadata.parents = [DRIVE_FOLDER_ID];
    }

    console.log(`  Uploading ${fileName}...`);
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: { 
        mimeType: 'video/mp4', 
        body: fs.createReadStream(filePath) 
      },
      fields: 'id, webViewLink'
    });

    // Make publicly accessible
    await drive.permissions.create({
      fileId: response.data.id!,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    const link = response.data.webViewLink || `https://drive.google.com/file/d/${response.data.id}/view`;
    console.log(`  Uploaded: ${link}`);
    return link;
  } catch (error: any) {
    console.error(`  Upload error: ${error.message}`);
    return `local://${filePath}`;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Worker server running on port ${PORT}`);
});
