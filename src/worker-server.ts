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

  // Extract frames 1 per second, full frame scaled down for memory efficiency
  const fps = 1; // 1 frame per second - less frames, full coverage
  await execAsync(
    `ffmpeg -i "${videoPath}" -vf "fps=${fps},scale=720:-1" -q:v 3 "${framesDir}/frame_%04d.jpg" -y`,
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
  
  const resultsFile = path.join(framesDir, 'ocr_results.json');
  const batchScript = `import warnings
warnings.filterwarnings('ignore')
import os
import sys
import time
import json
import gc

try:
    import easyocr
except ImportError as e:
    print("[]")
    sys.exit(0)

start_time = time.time()
frames = ["${framesList}"]
results_file = "${resultsFile}"
print(f"[DEBUG] Processing {len(frames)} frames...", file=sys.stderr)
sys.stderr.flush()

# Initialize reader with Chinese
reader = easyocr.Reader(['ch_sim'], gpu=False, verbose=False)
print(f"[DEBUG] Reader ready in {time.time()-start_time:.1f}s", file=sys.stderr)
sys.stderr.flush()

results = []
debug_log = []
for i, frame_path in enumerate(frames):
    try:
        result = reader.readtext(frame_path)
        
        # Save debug for first 10 frames
        if i < 10:
            debug_log.append(f"Frame {i+1}: {result}")
        
        texts = []
        for detection in result:
            if len(detection) >= 2:
                text = str(detection[1]).strip()
                # No confidence filter - keep all detected text
                if len(text) > 0:
                    texts.append(text)
        
        results.append(texts)
        if texts:
            print(f"[DEBUG] Frame {i+1}: {texts}", file=sys.stderr)
    except Exception as e:
        debug_log.append(f"Frame {i+1} error: {e}")
        results.append([])

# Print debug for first frames at the end (so it's visible)
print(f"[DEBUG] === First 10 frames raw detections ===", file=sys.stderr)
for log in debug_log:
    print(f"[DEBUG] {log}", file=sys.stderr)
    
    # Save progress every 20 frames
    if (i + 1) % 20 == 0:
        print(f"[DEBUG] Progress: {i+1}/{len(frames)}", file=sys.stderr)
        sys.stderr.flush()
        # Save intermediate results
        with open(results_file, 'w') as f:
            json.dump(results, f, ensure_ascii=False)
        gc.collect()

# Final save
with open(results_file, 'w') as f:
    json.dump(results, f, ensure_ascii=False)

frames_with_text = sum(1 for r in results if r)
elapsed = time.time() - start_time
print(f"[DEBUG] Done in {elapsed:.1f}s: {frames_with_text}/{len(results)} frames", file=sys.stderr)
sys.stderr.flush()

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
      const stderrLines = stderr.split('\n').slice(-15).join('\n');
      console.log(`  stderr (last 15 lines):\n${stderrLines}`);
    }

    console.log(`  stdout length: ${stdout.length}`);
    
    if (stdout.length > 0) {
      console.log(`  stdout first 300 chars: ${stdout.substring(0, 300)}`);
      
      // Find JSON - look for array pattern
      const jsonMatch = stdout.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        allResults = JSON.parse(jsonMatch[0]);
        console.log(`  Parsed ${allResults.length} frame results`);
        
        // Count frames with text
        const framesWithText = allResults.filter(r => r && r.length > 0).length;
        console.log(`  Frames with text: ${framesWithText}`);
      } else {
        console.log(`  No JSON array found in stdout`);
      }
    } else {
      console.log(`  stdout is empty!`);
    }
  } catch (error: any) {
    console.error(`  OCR error: ${error.message.substring(0, 200)}`);
    
    // Try to read from saved results file
    if (fs.existsSync(resultsFile)) {
      console.log(`  Reading from saved results file...`);
      try {
        const savedResults = fs.readFileSync(resultsFile, 'utf-8');
        allResults = JSON.parse(savedResults);
        console.log(`  Recovered ${allResults.length} frame results from file`);
        const framesWithText = allResults.filter(r => r && r.length > 0).length;
        console.log(`  Frames with text: ${framesWithText}`);
      } catch (e) {
        console.log(`  Failed to parse saved results`);
      }
    }
    
    // Also try stdout if available
    if (allResults.length === 0 && error.stdout && error.stdout.length > 0) {
      const jsonMatch = error.stdout.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          allResults = JSON.parse(jsonMatch[0]);
          console.log(`  Recovered ${allResults.length} from stdout`);
        } catch (e) {}
      }
    }
    
    if (error.stderr) {
      const stderrLines = error.stderr.split('\n').slice(-10).join('\n');
      console.log(`  stderr: ${stderrLines}`);
    }
  }
  
  try {
    const frameInterval = 1; // 1 fps = 1s per frame
    
    // First pass: extract text from each frame
    const frameTexts: Array<{time: number, text: string}> = [];
    
    for (let i = 0; i < allResults.length; i++) {
      const texts = allResults[i];
      // Keep all text, join with space
      const text = texts.join(' ').trim();
      const frameTime = i * frameInterval;
      frameTexts.push({ time: frameTime, text });
    }

    // Second pass: merge only EXACT same text (less aggressive)
    const results: Array<{start: number, end: number, text: string}> = [];
    let currentSegment: {start: number, end: number, text: string, texts: string[]} | null = null;

    // Calculate similarity ratio between two strings
    const stringSimilarity = (a: string, b: string): number => {
      if (!a || !b) return 0;
      if (a === b) return 1;
      
      const longer = a.length > b.length ? a : b;
      const shorter = a.length > b.length ? b : a;
      
      if (longer.length === 0) return 1;
      
      // Count matching characters
      let matches = 0;
      for (const char of shorter) {
        if (longer.includes(char)) matches++;
      }
      
      return matches / longer.length;
    };

    const textSimilarity = (a: string, b: string): boolean => {
      if (!a || !b) return false;
      if (a === b) return true;
      // Merge if similarity > 70%
      return stringSimilarity(a, b) > 0.7;
    };

    for (const frame of frameTexts) {
      if (!frame.text) {
        // No text - close segment immediately (no gap tolerance)
        if (currentSegment) {
          // Pick longest text from collected texts
          currentSegment.text = currentSegment.texts.reduce((a, b) => a.length >= b.length ? a : b);
          results.push({ start: currentSegment.start, end: currentSegment.end, text: currentSegment.text });
          currentSegment = null;
        }
        continue;
      }

      if (currentSegment && textSimilarity(currentSegment.text, frame.text)) {
        // Similar text - extend segment
        currentSegment.end = frame.time + frameInterval;
        currentSegment.texts.push(frame.text);
        // Update text to longest version
        if (frame.text.length > currentSegment.text.length) {
          currentSegment.text = frame.text;
        }
      } else {
        // Different text - close previous and start new
        if (currentSegment) {
          // Pick longest text
          currentSegment.text = currentSegment.texts.reduce((a, b) => a.length >= b.length ? a : b);
          results.push({ start: currentSegment.start, end: currentSegment.end, text: currentSegment.text });
        }
        currentSegment = {
          start: frame.time,
          end: frame.time + frameInterval,
          text: frame.text,
          texts: [frame.text]
        };
      }
    }

    // Don't forget last segment
    if (currentSegment) {
      currentSegment.text = currentSegment.texts.reduce((a, b) => a.length >= b.length ? a : b);
      results.push({ start: currentSegment.start, end: currentSegment.end, text: currentSegment.text });
    }

    // Post-process: merge consecutive segments with similar text
    const mergedResults: Array<{start: number, end: number, text: string}> = [];
    
    for (const segment of results) {
      if (mergedResults.length === 0) {
        mergedResults.push(segment);
        continue;
      }
      
      const last = mergedResults[mergedResults.length - 1];
      const gap = segment.start - last.end;
      const similarity = stringSimilarity(last.text, segment.text);
      
      // Merge if gap < 1s AND similarity > 60%
      if (gap < 1 && similarity > 0.6) {
        last.end = segment.end;
        // Keep longer/better text
        if (segment.text.length > last.text.length) {
          last.text = segment.text;
        }
      } else {
        mergedResults.push(segment);
      }
    }

    // Filter: keep valid segments
    const filteredResults = mergedResults.filter(r => {
      // Must be >= 0.2s
      if (r.end - r.start < 0.2) return false;
      // Must have at least 2 Chinese characters
      const chineseChars = (r.text.match(/[\u4e00-\u9fff]/g) || []).length;
      if (chineseChars < 2) return false;
      // Filter out noise (only special chars or single char)
      if (r.text.length < 2) return false;
      return true;
    });
    
    console.log(`  OCR found ${filteredResults.length} segments (merged from ${results.length}) from ${frameTexts.filter(f => f.text).length} frames`);
    filteredResults.forEach((r, i) => {
      console.log(`    ${i+1}. [${r.start.toFixed(1)}s-${r.end.toFixed(1)}s] ${r.text}`);
    });
    
    return filteredResults;
    
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

  // Format texts for translation with context
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
          content: `Bạn là chuyên gia dịch thuật Trung-Việt. Dịch các phụ đề video từ tiếng Trung sang tiếng Việt.

Quy tắc:
- Giữ nguyên số thứ tự (1., 2., 3.,...)
- Dịch tự nhiên, phù hợp ngữ cảnh video (có thể là nấu ăn, hướng dẫn, vlog...)
- Giữ nguyên số liệu, đơn vị (2勺 = 2 thìa)
- Nếu là thuật ngữ nấu ăn, dịch chính xác (老抽 = xì dầu đậm, 蚝油 = dầu hào)
- Chỉ trả về bản dịch, không giải thích`
        }, {
          role: 'user',
          content: `Dịch các phụ đề sau sang tiếng Việt:\n\n${textsToTranslate}`
        }],
        temperature: 0.2,
        max_tokens: 3000
      })
    });

    const data = await response.json() as any;
    const translatedText = data.choices?.[0]?.message?.content || '';
    
    console.log(`  Translation response: ${translatedText.substring(0, 200)}...`);

    // Parse translated lines - handle various formats
    const translatedLines = translatedText.split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l && /^\d+\./.test(l));
    
    const translatedSegments = segments.map((seg, i) => {
      // Find line starting with this index
      const line = translatedLines.find((l: string) => {
        const match = l.match(/^(\d+)\./);
        return match && parseInt(match[1]) === i + 1;
      });
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
