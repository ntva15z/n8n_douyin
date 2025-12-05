import * as fs from 'fs';
import * as path from 'path';
import { OCRResult, TextSegment } from '../types';

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
}

export class GeminiVisionService {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey?: string, model: string = 'gemini-1.5-flash') {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    this.model = model;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
  }

  /**
   * Extract subtitles from video using Gemini Vision
   */
  async extractSubtitles(videoPath: string): Promise<OCRResult> {
    const videoBuffer = fs.readFileSync(videoPath);
    const base64Video = videoBuffer.toString('base64');
    const mimeType = this.getMimeType(videoPath);

    const prompt = `Analyze this video and extract ALL subtitle/caption text that appears on screen.

Rules:
- Extract ONLY the subtitle text, ignore other UI elements
- Return each subtitle with its approximate timestamp
- Format: [MM:SS] subtitle text
- If subtitle appears multiple times, include each occurrence
- Keep original language (Chinese/Vietnamese)
- One subtitle per line

Return ONLY the subtitles, no explanations.`;

    try {
      const response = await this.callGeminiAPI(base64Video, mimeType, prompt);
      const subtitleText = response.candidates[0]?.content?.parts[0]?.text || '';
      
      return this.parseSubtitles(subtitleText);
    } catch (error) {
      console.error('Gemini Vision extraction failed:', error);
      throw error;
    }
  }

  /**
   * Call Gemini API with video
   */
  private async callGeminiAPI(
    base64Video: string,
    mimeType: string,
    prompt: string
  ): Promise<GeminiResponse> {
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Video
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 8192
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    return response.json();
  }


  /**
   * Parse Gemini response into TextSegments
   */
  private parseSubtitles(text: string): OCRResult {
    const lines = text.trim().split('\n').filter(line => line.trim());
    const segments: TextSegment[] = [];
    
    // Regex to match [MM:SS] or [HH:MM:SS] format
    const timestampRegex = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.+)$/;
    
    let index = 1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(timestampRegex);
      
      if (match) {
        const hours = match[3] ? parseInt(match[1]) : 0;
        const minutes = match[3] ? parseInt(match[2]) : parseInt(match[1]);
        const seconds = match[3] ? parseInt(match[3]) : parseInt(match[2]);
        const subtitleText = match[4].trim();
        
        const startTime = (hours * 3600 + minutes * 60 + seconds) * 1000;
        
        // Estimate end time (next subtitle start or +3 seconds)
        let endTime = startTime + 3000;
        if (i + 1 < lines.length) {
          const nextMatch = lines[i + 1].match(timestampRegex);
          if (nextMatch) {
            const nextHours = nextMatch[3] ? parseInt(nextMatch[1]) : 0;
            const nextMinutes = nextMatch[3] ? parseInt(nextMatch[2]) : parseInt(nextMatch[1]);
            const nextSeconds = nextMatch[3] ? parseInt(nextMatch[3]) : parseInt(nextMatch[2]);
            endTime = (nextHours * 3600 + nextMinutes * 60 + nextSeconds) * 1000;
          }
        }
        
        segments.push({
          index: index++,
          text: subtitleText,
          startTime,
          endTime
        });
      }
    }
    
    return {
      segments,
      language: 'zh'
    };
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska'
    };
    return mimeTypes[ext] || 'video/mp4';
  }
}
