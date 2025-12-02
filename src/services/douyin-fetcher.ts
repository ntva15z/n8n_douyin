import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { VideoInfo, VideoMetadata, ProcessingStatus } from '../types';

const execAsync = promisify(exec);

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10000;
const RATE_LIMIT_DELAY_MS = 60000;

export class DouyinFetcher {
  private tempPath: string;
  private cookiesPath?: string;

  constructor(tempPath: string, cookiesPath?: string) {
    this.tempPath = tempPath;
    this.cookiesPath = cookiesPath;

    // Ensure temp directory exists
    if (!fs.existsSync(tempPath)) {
      fs.mkdirSync(tempPath, { recursive: true });
    }
  }

  /**
   * Get videos from a Douyin user within a date range
   */
  async getVideosByDateRange(
    userId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<VideoInfo[]> {
    const userUrl = `https://www.douyin.com/user/${userId}`;
    
    try {
      // Use yt-dlp to get video list with metadata
      const cookieArg = this.cookiesPath ? `--cookies "${this.cookiesPath}"` : '';
      const cmd = `yt-dlp ${cookieArg} --flat-playlist --dump-json "${userUrl}"`;
      
      const { stdout } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
      
      const videos: VideoInfo[] = [];
      const lines = stdout.trim().split('\n');
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const data = JSON.parse(line);
          const publishDate = new Date(data.timestamp * 1000);
          
          // Filter by date range
          if (publishDate >= fromDate && publishDate <= toDate) {
            videos.push({
              id: data.id,
              title: data.title || data.description || 'Untitled',
              duration: data.duration || 0,
              publishDate,
              downloadUrl: data.url || data.webpage_url
            });
          }
        } catch {
          // Skip invalid JSON lines
          continue;
        }
      }
      
      return videos;
    } catch (error) {
      const err = error as Error & { stderr?: string };
      
      // Check for rate limiting
      if (err.stderr?.includes('rate') || err.stderr?.includes('429')) {
        console.log(`Rate limited. Waiting ${RATE_LIMIT_DELAY_MS / 1000} seconds...`);
        await this.delay(RATE_LIMIT_DELAY_MS);
        return this.getVideosByDateRange(userId, fromDate, toDate);
      }
      
      throw error;
    }
  }

  /**
   * Download a video with retry logic
   */
  async downloadVideo(
    videoUrl: string,
    videoId: string
  ): Promise<VideoMetadata> {
    let lastError: Error | null = null;
    const outputPath = path.join(this.tempPath, `${videoId}.mp4`);
    const infoPath = path.join(this.tempPath, `${videoId}.info.json`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const cookieArg = this.cookiesPath ? `--cookies "${this.cookiesPath}"` : '';
        const cmd = `yt-dlp ${cookieArg} -o "${outputPath}" --write-info-json "${videoUrl}"`;
        
        await execAsync(cmd, { maxBuffer: 100 * 1024 * 1024 });

        // Read metadata from info.json
        let metadata: VideoMetadata = {
          id: videoId,
          originalTitle: 'Untitled',
          duration: 0,
          publishDate: new Date(),
          sourcePath: outputPath,
          outputPath: '',
          chineseSrtPath: '',
          vietnameseSrtPath: '',
          processingStatus: ProcessingStatus.DOWNLOADING
        };

        if (fs.existsSync(infoPath)) {
          const infoData = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
          metadata = {
            ...metadata,
            originalTitle: infoData.title || infoData.description || 'Untitled',
            duration: infoData.duration || 0,
            publishDate: new Date(infoData.timestamp * 1000)
          };
        }

        return metadata;
      } catch (error) {
        lastError = error as Error;
        const err = error as Error & { stderr?: string };
        
        // Check for rate limiting
        if (err.stderr?.includes('rate') || err.stderr?.includes('429')) {
          console.log(`Rate limited. Waiting ${RATE_LIMIT_DELAY_MS / 1000} seconds...`);
          await this.delay(RATE_LIMIT_DELAY_MS);
          continue;
        }

        console.error(`Download attempt ${attempt} failed:`, error);

        if (attempt < MAX_RETRIES) {
          console.log(`Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
          await this.delay(RETRY_DELAY_MS);
        }
      }
    }

    throw new Error(
      `Failed to download video after ${MAX_RETRIES} attempts: ${lastError?.message}`
    );
  }

  /**
   * Clean up temporary files for a video
   */
  cleanupVideo(videoId: string): void {
    const files = [
      path.join(this.tempPath, `${videoId}.mp4`),
      path.join(this.tempPath, `${videoId}.info.json`)
    ];

    for (const file of files) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
