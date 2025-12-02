import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { OCRResult, TextSegment } from '../types';

const execAsync = promisify(exec);

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

export interface BaiduOCRConfig {
  apiKey: string;
  secretKey: string;
  endpoint?: string;
}

export class OCRService {
  private config: BaiduOCRConfig;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private frameInterval: number; // seconds between frame extractions

  constructor(config: BaiduOCRConfig, frameInterval: number = 1) {
    this.config = {
      ...config,
      endpoint: config.endpoint || 'https://aip.baidubce.com/rest/2.0/ocr/v1/general'
    };
    this.frameInterval = frameInterval;
  }

  /**
   * Extract text from video using OCR
   */
  async extractText(videoPath: string): Promise<OCRResult> {
    const tempDir = path.join(path.dirname(videoPath), 'frames');
    
    try {
      // Create temp directory for frames
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Extract frames from video
      const frames = await this.extractFrames(videoPath, tempDir);
      
      // Process each frame with OCR
      const segments: TextSegment[] = [];
      let lastText = '';
      let segmentStart = 0;
      let index = 1;

      for (let i = 0; i < frames.length; i++) {
        const frameTime = i * this.frameInterval * 1000; // Convert to ms
        const text = await this.processFrame(frames[i]);

        // Detect text changes to create segments
        if (text && text !== lastText) {
          if (lastText) {
            // Close previous segment
            segments.push({
              index: index++,
              text: lastText,
              startTime: segmentStart,
              endTime: frameTime
            });
          }
          segmentStart = frameTime;
          lastText = text;
        }
      }

      // Add final segment
      if (lastText) {
        const videoDuration = await this.getVideoDuration(videoPath);
        segments.push({
          index: index,
          text: lastText,
          startTime: segmentStart,
          endTime: videoDuration
        });
      }

      return {
        segments,
        language: 'zh'
      };
    } finally {
      // Cleanup frames
      this.cleanupFrames(tempDir);
    }
  }

  /**
   * Extract frames from video using FFmpeg
   */
  private async extractFrames(videoPath: string, outputDir: string): Promise<string[]> {
    const outputPattern = path.join(outputDir, 'frame_%04d.jpg');
    const cmd = `ffmpeg -i "${videoPath}" -vf "fps=1/${this.frameInterval}" -q:v 2 "${outputPattern}"`;
    
    await execAsync(cmd);

    // Get list of extracted frames
    const files = fs.readdirSync(outputDir)
      .filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
      .sort()
      .map(f => path.join(outputDir, f));

    return files;
  }

  /**
   * Process a single frame with Baidu OCR
   */
  private async processFrame(framePath: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const token = await this.getAccessToken();
        const imageBase64 = fs.readFileSync(framePath).toString('base64');

        const response = await axios.post(
          `${this.config.endpoint}?access_token=${token}`,
          `image=${encodeURIComponent(imageBase64)}`,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );

        if (response.data.words_result) {
          // Combine all detected text
          return response.data.words_result
            .map((item: { words: string }) => item.words)
            .join(' ');
        }

        return '';
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY_MS);
        }
      }
    }

    console.error(`OCR failed for frame ${framePath}:`, lastError);
    return '';
  }

  /**
   * Get Baidu API access token
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await axios.post(
      'https://aip.baidubce.com/oauth/2.0/token',
      null,
      {
        params: {
          grant_type: 'client_credentials',
          client_id: this.config.apiKey,
          client_secret: this.config.secretKey
        }
      }
    );

    this.accessToken = response.data.access_token;
    // Token expires in 30 days, refresh 1 day early
    this.tokenExpiry = Date.now() + (29 * 24 * 60 * 60 * 1000);

    return this.accessToken!;
  }

  /**
   * Get video duration in milliseconds
   */
  private async getVideoDuration(videoPath: string): Promise<number> {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const { stdout } = await execAsync(cmd);
    return parseFloat(stdout.trim()) * 1000;
  }

  /**
   * Cleanup extracted frames
   */
  private cleanupFrames(framesDir: string): void {
    if (fs.existsSync(framesDir)) {
      const files = fs.readdirSync(framesDir);
      for (const file of files) {
        fs.unlinkSync(path.join(framesDir, file));
      }
      fs.rmdirSync(framesDir);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
