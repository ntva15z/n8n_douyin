import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { AudioAnalysis, TextSegment } from '../types';
import { SRTManager } from '../utils/srt-manager';

const execAsync = promisify(exec);

export interface SyncReport {
  videoId: string;
  discrepancies: {
    segmentIndex: number;
    expectedStart: number;
    actualStart: number;
    difference: number;
  }[];
  averageDiscrepancy: number;
  maxDiscrepancy: number;
}

export class VideoProcessor {
  private outputPath: string;
  private srtManager: SRTManager;

  constructor(outputPath: string) {
    this.outputPath = outputPath;
    this.srtManager = new SRTManager();

    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
  }

  /**
   * Embed subtitles into video (burn-in/hardcoded)
   */
  async embedSubtitles(
    videoPath: string,
    srtPath: string,
    outputFileName: string
  ): Promise<string> {
    const outputFilePath = path.join(this.outputPath, outputFileName);

    // Burn-in subtitles with styling
    const cmd = `ffmpeg -i "${videoPath}" -vf "subtitles='${srtPath}':force_style='FontSize=24,FontName=Arial,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2'" -c:a copy "${outputFilePath}" -y`;

    await execAsync(cmd, { maxBuffer: 100 * 1024 * 1024 });

    return outputFilePath;
  }

  /**
   * Embed soft subtitles (can be toggled on/off)
   */
  async embedSoftSubtitles(
    videoPath: string,
    srtPath: string,
    outputFileName: string
  ): Promise<string> {
    const outputFilePath = path.join(this.outputPath, outputFileName);

    const cmd = `ffmpeg -i "${videoPath}" -i "${srtPath}" -c copy -c:s mov_text "${outputFilePath}" -y`;

    await execAsync(cmd, { maxBuffer: 100 * 1024 * 1024 });

    return outputFilePath;
  }

  /**
   * Analyze audio pace for subtitle timing adjustment
   */
  async analyzeAudioPace(videoPath: string): Promise<AudioAnalysis> {
    // Extract audio duration
    const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const { stdout: durationStr } = await execAsync(durationCmd);
    const duration = parseFloat(durationStr.trim()) * 1000;

    // Detect speech segments using silence detection
    const silenceCmd = `ffmpeg -i "${videoPath}" -af "silencedetect=noise=-30dB:d=0.5" -f null - 2>&1`;
    
    try {
      const { stderr } = await execAsync(silenceCmd, { maxBuffer: 50 * 1024 * 1024 });
      const speechSegments = this.parseSilenceDetection(stderr, duration);

      // Calculate average pace (rough estimate)
      const totalSpeechTime = speechSegments.reduce(
        (sum, seg) => sum + (seg.end - seg.start),
        0
      );
      const averagePace = totalSpeechTime > 0 ? (duration / totalSpeechTime) * 150 : 150;

      return {
        duration,
        speechSegments,
        averagePace
      };
    } catch {
      // If silence detection fails, return default values
      return {
        duration,
        speechSegments: [{ start: 0, end: duration }],
        averagePace: 150
      };
    }
  }

  /**
   * Adjust subtitle timing based on audio analysis
   */
  adjustSubtitleTiming(
    srtContent: string,
    audioAnalysis: AudioAnalysis
  ): string {
    const segments = this.srtManager.parse(srtContent);
    const { speechSegments, duration } = audioAnalysis;

    if (speechSegments.length === 0 || segments.length === 0) {
      return srtContent;
    }

    // Scale subtitle timing to match video duration
    const lastSegment = segments[segments.length - 1];
    const subtitleDuration = lastSegment.endTime;
    const scaleFactor = duration / subtitleDuration;

    const adjustedSegments: TextSegment[] = segments.map(segment => ({
      ...segment,
      startTime: Math.round(segment.startTime * scaleFactor),
      endTime: Math.round(segment.endTime * scaleFactor)
    }));

    return this.srtManager.generate(adjustedSegments);
  }

  /**
   * Check subtitle synchronization and generate report
   */
  async checkSynchronization(
    videoPath: string,
    srtContent: string,
    videoId: string,
    toleranceMs: number = 100
  ): Promise<SyncReport> {
    const audioAnalysis = await this.analyzeAudioPace(videoPath);
    const segments = this.srtManager.parse(srtContent);
    const discrepancies: SyncReport['discrepancies'] = [];

    // Compare subtitle timing with speech segments
    for (let i = 0; i < segments.length && i < audioAnalysis.speechSegments.length; i++) {
      const subtitleStart = segments[i].startTime;
      const speechStart = audioAnalysis.speechSegments[i]?.start || 0;
      const difference = Math.abs(subtitleStart - speechStart);

      if (difference > toleranceMs) {
        discrepancies.push({
          segmentIndex: i + 1,
          expectedStart: speechStart,
          actualStart: subtitleStart,
          difference
        });
      }
    }

    const avgDiscrepancy = discrepancies.length > 0
      ? discrepancies.reduce((sum, d) => sum + d.difference, 0) / discrepancies.length
      : 0;

    const maxDiscrepancy = discrepancies.length > 0
      ? Math.max(...discrepancies.map(d => d.difference))
      : 0;

    return {
      videoId,
      discrepancies,
      averageDiscrepancy: avgDiscrepancy,
      maxDiscrepancy
    };
  }

  /**
   * Parse FFmpeg silence detection output
   */
  private parseSilenceDetection(
    output: string,
    totalDuration: number
  ): { start: number; end: number }[] {
    const silenceStarts: number[] = [];
    const silenceEnds: number[] = [];

    const startMatches = output.matchAll(/silence_start: ([\d.]+)/g);
    const endMatches = output.matchAll(/silence_end: ([\d.]+)/g);

    for (const match of startMatches) {
      silenceStarts.push(parseFloat(match[1]) * 1000);
    }
    for (const match of endMatches) {
      silenceEnds.push(parseFloat(match[1]) * 1000);
    }

    // Convert silence periods to speech periods
    const speechSegments: { start: number; end: number }[] = [];
    let lastEnd = 0;

    for (let i = 0; i < silenceStarts.length; i++) {
      if (silenceStarts[i] > lastEnd) {
        speechSegments.push({
          start: lastEnd,
          end: silenceStarts[i]
        });
      }
      lastEnd = silenceEnds[i] || silenceStarts[i];
    }

    // Add final speech segment if needed
    if (lastEnd < totalDuration) {
      speechSegments.push({
        start: lastEnd,
        end: totalDuration
      });
    }

    return speechSegments;
  }
}
