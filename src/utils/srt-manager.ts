import { TextSegment, ValidationResult } from '../types';

export class SRTManager {
  /**
   * Generate SRT content from TextSegments
   * Format:
   * 1
   * 00:00:01,000 --> 00:00:04,000
   * Text content
   */
  generate(segments: TextSegment[]): string {
    if (segments.length === 0) return '';

    return segments
      .map((segment, idx) => {
        const index = segment.index || idx + 1;
        const startTime = this.formatTimestamp(segment.startTime);
        const endTime = this.formatTimestamp(segment.endTime);
        return `${index}\n${startTime} --> ${endTime}\n${segment.text}`;
      })
      .join('\n\n');
  }

  /**
   * Parse SRT content into TextSegments
   */
  parse(srtContent: string): TextSegment[] {
    if (!srtContent.trim()) return [];

    const segments: TextSegment[] = [];
    const blocks = srtContent.trim().split(/\n\n+/);

    for (const block of blocks) {
      const lines = block.split('\n');
      if (lines.length < 3) continue;

      const index = parseInt(lines[0], 10);
      if (isNaN(index)) continue;

      const timeLine = lines[1];
      const timeMatch = timeLine.match(
        /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
      );
      if (!timeMatch) continue;

      const startTime = this.parseTimestamp(timeMatch[1]);
      const endTime = this.parseTimestamp(timeMatch[2]);
      const text = lines.slice(2).join('\n');

      segments.push({ index, startTime, endTime, text });
    }

    return segments;
  }

  /**
   * Validate SRT segments for sequential and non-overlapping timestamps
   */
  validate(segments: TextSegment[]): ValidationResult {
    const errors: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Check startTime < endTime
      if (segment.startTime >= segment.endTime) {
        errors.push(
          `Segment ${segment.index}: startTime (${segment.startTime}) must be less than endTime (${segment.endTime})`
        );
      }

      // Check sequential (non-overlapping)
      if (i > 0) {
        const prevSegment = segments[i - 1];
        if (segment.startTime < prevSegment.endTime) {
          errors.push(
            `Segment ${segment.index}: startTime (${segment.startTime}) overlaps with previous segment endTime (${prevSegment.endTime})`
          );
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Split SRT content into smaller parts when exceeding maxChars
   */
  split(srtContent: string, maxChars: number = 5000): string[] {
    if (srtContent.length <= maxChars) {
      return [srtContent];
    }

    const segments = this.parse(srtContent);
    const parts: string[] = [];
    let currentSegments: TextSegment[] = [];
    let currentLength = 0;

    for (const segment of segments) {
      const segmentStr = this.generate([segment]);
      const segmentLength = segmentStr.length + 2; // +2 for \n\n separator

      if (currentLength + segmentLength > maxChars && currentSegments.length > 0) {
        parts.push(this.generate(currentSegments));
        currentSegments = [];
        currentLength = 0;
      }

      currentSegments.push(segment);
      currentLength += segmentLength;
    }

    if (currentSegments.length > 0) {
      parts.push(this.generate(currentSegments));
    }

    return parts;
  }

  /**
   * Merge SRT parts back into a single SRT content
   */
  merge(srtParts: string[]): string {
    const allSegments: TextSegment[] = [];
    let indexCounter = 1;

    for (const part of srtParts) {
      const segments = this.parse(part);
      for (const segment of segments) {
        allSegments.push({
          ...segment,
          index: indexCounter++
        });
      }
    }

    return this.generate(allSegments);
  }

  /**
   * Format milliseconds to SRT timestamp format (HH:MM:SS,mmm)
   */
  private formatTimestamp(ms: number): string {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;

    return (
      `${hours.toString().padStart(2, '0')}:` +
      `${minutes.toString().padStart(2, '0')}:` +
      `${seconds.toString().padStart(2, '0')},` +
      `${milliseconds.toString().padStart(3, '0')}`
    );
  }

  /**
   * Parse SRT timestamp format (HH:MM:SS,mmm) to milliseconds
   */
  private parseTimestamp(timestamp: string): number {
    const [time, ms] = timestamp.split(',');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + parseInt(ms, 10);
  }
}

// Export singleton instance
export const srtManager = new SRTManager();
