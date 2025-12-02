import { google, drive_v3 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { DriveFile } from '../types';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10000;

export class GoogleDriveManager {
  private drive: drive_v3.Drive | null = null;
  private folderId: string;

  constructor(folderId: string) {
    this.folderId = folderId;
  }

  /**
   * Connect to Google Drive
   */
  async connect(credentialsPath: string): Promise<void> {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });

    this.drive = google.drive({ version: 'v3', auth });
  }

  /**
   * Upload a file to Google Drive with retry logic
   */
  async uploadFile(localPath: string, fileName?: string): Promise<DriveFile> {
    if (!this.drive) {
      throw new Error('Not connected. Call connect() first.');
    }

    const name = fileName || path.basename(localPath);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.drive.files.create({
          requestBody: {
            name,
            parents: [this.folderId]
          },
          media: {
            mimeType: 'video/mp4',
            body: fs.createReadStream(localPath)
          },
          fields: 'id, name, webViewLink, webContentLink'
        });

        const file = response.data;

        // Make file accessible via link
        await this.drive.permissions.create({
          fileId: file.id!,
          requestBody: {
            role: 'reader',
            type: 'anyone'
          }
        });

        return {
          id: file.id!,
          name: file.name!,
          webViewLink: file.webViewLink || '',
          webContentLink: file.webContentLink || ''
        };
      } catch (error) {
        lastError = error as Error;
        console.error(`Upload attempt ${attempt} failed:`, error);

        if (attempt < MAX_RETRIES) {
          console.log(`Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
          await this.delay(RETRY_DELAY_MS);
        }
      }
    }

    throw new Error(
      `Failed to upload file after ${MAX_RETRIES} attempts: ${lastError?.message}`
    );
  }

  /**
   * Get shareable URL for a file
   */
  getFileUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
