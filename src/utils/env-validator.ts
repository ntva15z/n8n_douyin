import { EnvConfig } from '../types';

const REQUIRED_ENV_VARS = [
  'GOOGLE_SHEET_ID',
  'GOOGLE_DRIVE_FOLDER_ID',
  'GOOGLE_CREDENTIALS',
  'OPENAI_API_KEY'
] as const;

export function validateEnv(): EnvConfig {
  const missingVars: string[] = [];

  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`
    );
  }

  return {
    GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID!,
    GOOGLE_DRIVE_FOLDER_ID: process.env.GOOGLE_DRIVE_FOLDER_ID!,
    GOOGLE_CREDENTIALS: process.env.GOOGLE_CREDENTIALS!,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
    ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL,
    TEMP_VIDEO_PATH: process.env.TEMP_VIDEO_PATH || './temp/videos',
    OUTPUT_VIDEO_PATH: process.env.OUTPUT_VIDEO_PATH || './output/videos'
  };
}
