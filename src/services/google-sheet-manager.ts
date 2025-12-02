import { google, sheets_v4 } from 'googleapis';
import { SheetRow, ProcessingStatus } from '../types';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30000;

export class GoogleSheetManager {
  private sheets: sheets_v4.Sheets | null = null;
  private sheetId: string;
  private sheetName: string;

  constructor(sheetId: string, sheetName: string = 'Sheet1') {
    this.sheetId = sheetId;
    this.sheetName = sheetName;
  }

  /**
   * Connect to Google Sheets with retry logic
   */
  async connect(credentialsPath: string): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const auth = new google.auth.GoogleAuth({
          keyFile: credentialsPath,
          scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });

        this.sheets = google.sheets({ version: 'v4', auth });
        
        // Test connection by getting spreadsheet info
        await this.sheets.spreadsheets.get({
          spreadsheetId: this.sheetId
        });

        return;
      } catch (error) {
        lastError = error as Error;
        console.error(`Connection attempt ${attempt} failed:`, error);

        if (attempt < MAX_RETRIES) {
          console.log(`Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
          await this.delay(RETRY_DELAY_MS);
        }
      }
    }

    throw new Error(
      `Failed to connect to Google Sheet after ${MAX_RETRIES} attempts: ${lastError?.message}`
    );
  }

  /**
   * Get all rows from the sheet
   */
  async getRows(): Promise<SheetRow[]> {
    if (!this.sheets) {
      throw new Error('Not connected. Call connect() first.');
    }

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: `${this.sheetName}!A:F`
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      return [];
    }

    // Skip header row
    return rows.slice(1).map((row, index) => ({
      id: String(index + 2), // Row number (1-indexed, skip header)
      user_id: row[0] || '',
      lastprocess: row[1] || '',
      status: row[2] || '',
      output_location: row[3] || '',
      processing_status: (row[4] as ProcessingStatus) || undefined
    }));
  }

  /**
   * Filter rows by status
   */
  filterByStatus(rows: SheetRow[], status: string): SheetRow[] {
    return rows.filter(row => row.status === status);
  }

  /**
   * Extract valid rows (with user_id and lastprocess)
   */
  extractValidRows(rows: SheetRow[]): { valid: SheetRow[]; warnings: string[] } {
    const valid: SheetRow[] = [];
    const warnings: string[] = [];

    for (const row of rows) {
      if (!row.user_id || !row.lastprocess) {
        warnings.push(
          `Row ${row.id}: Missing ${!row.user_id ? 'user_id' : 'lastprocess'}, skipping`
        );
        continue;
      }
      valid.push(row);
    }

    return { valid, warnings };
  }

  /**
   * Update a row with partial data
   */
  async updateRow(rowId: string, data: Partial<SheetRow>): Promise<void> {
    if (!this.sheets) {
      throw new Error('Not connected. Call connect() first.');
    }

    const rowNumber = parseInt(rowId, 10);
    const values: (string | undefined)[] = [];
    const range = `${this.sheetName}!A${rowNumber}:F${rowNumber}`;

    // Get current row first
    const current = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range
    });

    const currentValues = current.data.values?.[0] || ['', '', '', '', '', ''];

    // Merge with updates
    values[0] = data.user_id ?? currentValues[0];
    values[1] = data.lastprocess ?? currentValues[1];
    values[2] = data.status ?? currentValues[2];
    values[3] = data.output_location ?? currentValues[3];
    values[4] = data.processing_status ?? currentValues[4];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [values] }
    });
  }

  /**
   * Update processing status for a row
   */
  async updateProcessingStatus(
    rowId: string,
    status: ProcessingStatus
  ): Promise<void> {
    await this.updateRow(rowId, { processing_status: status });
  }

  /**
   * Update lastprocess date for a row
   */
  async updateLastProcess(rowId: string, date: Date): Promise<void> {
    await this.updateRow(rowId, { lastprocess: date.toISOString().split('T')[0] });
  }

  /**
   * Update output location for a row
   */
  async updateOutputLocation(rowId: string, url: string): Promise<void> {
    await this.updateRow(rowId, { output_location: url });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
