import OpenAI from 'openai';
import { SRTManager } from '../utils/srt-manager';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const MAX_CHARS_PER_REQUEST = 5000;

const TRANSLATION_PROMPT = `Translate the following Chinese subtitle text to Vietnamese.
Keep the same line structure and timing markers.
Maintain natural Vietnamese expression while preserving the original meaning.
Only output the translated text, no explanations.

Chinese text:
{input}`;

export class TranslationService {
  private openai: OpenAI;
  private model: string;
  private srtManager: SRTManager;

  constructor(apiKey: string, model: string = 'gpt-4o-mini') {
    this.openai = new OpenAI({ apiKey });
    this.model = model;
    this.srtManager = new SRTManager();
  }

  /**
   * Translate text from Chinese to Vietnamese
   */
  async translate(text: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: TRANSLATION_PROMPT.replace('{input}', text)
            }
          ],
          temperature: 0.3,
          max_tokens: 4096
        });

        return response.choices[0]?.message?.content?.trim() || '';
      } catch (error) {
        lastError = error as Error;
        console.error(`Translation attempt ${attempt} failed:`, error);

        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY_MS);
        }
      }
    }

    throw new Error(
      `Failed to translate after ${MAX_RETRIES} attempts: ${lastError?.message}`
    );
  }

  /**
   * Translate SRT content, handling large files by splitting
   */
  async translateSRT(srtContent: string): Promise<string> {
    // Parse original SRT to get segments
    const originalSegments = this.srtManager.parse(srtContent);
    
    if (srtContent.length <= MAX_CHARS_PER_REQUEST) {
      // Small file - translate directly
      const translatedText = await this.translateSRTContent(srtContent);
      return this.preserveTimestamps(originalSegments, translatedText);
    }

    // Large file - split, translate, merge
    const parts = this.srtManager.split(srtContent, MAX_CHARS_PER_REQUEST);
    const translatedParts: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      console.log(`Translating part ${i + 1}/${parts.length}...`);
      const translatedPart = await this.translateSRTContent(parts[i]);
      translatedParts.push(translatedPart);
    }

    // Merge and preserve original timestamps
    const mergedContent = this.srtManager.merge(translatedParts);
    return this.preserveTimestamps(originalSegments, mergedContent);
  }

  /**
   * Translate SRT content while keeping structure
   */
  private async translateSRTContent(srtContent: string): Promise<string> {
    const segments = this.srtManager.parse(srtContent);
    const translatedSegments = [];

    for (const segment of segments) {
      const translatedText = await this.translate(segment.text);
      translatedSegments.push({
        ...segment,
        text: translatedText
      });
    }

    return this.srtManager.generate(translatedSegments);
  }

  /**
   * Preserve original timestamps in translated content
   */
  private preserveTimestamps(
    originalSegments: { startTime: number; endTime: number }[],
    translatedContent: string
  ): string {
    const translatedSegments = this.srtManager.parse(translatedContent);

    // Ensure we have matching segment counts
    const result = translatedSegments.map((segment, index) => {
      if (index < originalSegments.length) {
        return {
          ...segment,
          startTime: originalSegments[index].startTime,
          endTime: originalSegments[index].endTime
        };
      }
      return segment;
    });

    return this.srtManager.generate(result);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
