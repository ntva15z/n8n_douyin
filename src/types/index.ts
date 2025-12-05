// Processing Status enum
export enum ProcessingStatus {
  PENDING = 'Pending',
  PROCESSING = 'Processing',
  DOWNLOADING = 'Downloading',
  OCR_PROCESSING = 'OCR_Processing',
  TRANSLATING = 'Translating',
  EMBEDDING = 'Embedding',
  UPLOADING = 'Uploading',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  SYNC_FAILED = 'Sync_Failed',
  UPLOAD_FAILED = 'Upload_Failed'
}

// Google Sheet Row
export interface SheetRow {
  id: string;
  user_id: string;
  lastprocess: string; // ISO date format
  status: string;
  output_location?: string;
  processing_status?: ProcessingStatus;
}

// Video Info from Douyin
export interface VideoInfo {
  id: string;
  title: string;
  duration: number; // seconds
  publishDate: Date;
  downloadUrl: string;
}

// Video Metadata
export interface VideoMetadata {
  id: string;
  originalTitle: string;
  duration: number;
  publishDate: Date;
  sourcePath: string;
  outputPath: string;
  chineseSrtPath: string;
  vietnameseSrtPath: string;
  processingStatus: ProcessingStatus;
}

// Text Segment for SRT
export interface TextSegment {
  index: number;
  text: string;
  startTime: number; // milliseconds
  endTime: number;   // milliseconds
}

// OCR Result
export interface OCRResult {
  segments: TextSegment[];
  language: string;
}

// SRT Validation Result
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Audio Analysis
export interface AudioAnalysis {
  duration: number;
  speechSegments: { start: number; end: number }[];
  averagePace: number; // words per minute
}

// Processing Result for reporting
export interface ProcessingResult {
  videoId: string;
  status: 'success' | 'failed';
  duration: number;
  error?: string;
}

// Report
export interface Report {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  details: ProcessingResult[];
}

// Google Drive File
export interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
  webContentLink: string;
}

// Environment Config
export interface EnvConfig {
  GOOGLE_SHEET_ID: string;
  GOOGLE_DRIVE_FOLDER_ID: string;
  GOOGLE_CREDENTIALS: string;
  OPENAI_API_KEY: string;
  GEMINI_API_KEY: string;
  ALERT_WEBHOOK_URL?: string;
  TEMP_VIDEO_PATH: string;
  OUTPUT_VIDEO_PATH: string;
}

// Gemini Vision Response
export interface GeminiSubtitleResult {
  segments: TextSegment[];
  language: string;
  rawResponse?: string;
}
