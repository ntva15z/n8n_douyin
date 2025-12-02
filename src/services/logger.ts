import axios from 'axios';
import { ProcessingResult, Report } from '../types';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  stepName: string;
  message: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export class Logger {
  private logs: LogEntry[] = [];
  private alertWebhookUrl?: string;

  constructor(alertWebhookUrl?: string) {
    this.alertWebhookUrl = alertWebhookUrl;
  }

  /**
   * Log info message
   */
  info(stepName: string, message: string, metadata?: Record<string, unknown>): void {
    const entry = this.createEntry('info', stepName, message, metadata);
    this.logs.push(entry);
    console.log(`[INFO] [${stepName}] ${message}`, metadata || '');
  }

  /**
   * Log warning message
   */
  warn(stepName: string, message: string, metadata?: Record<string, unknown>): void {
    const entry = this.createEntry('warn', stepName, message, metadata);
    this.logs.push(entry);
    console.warn(`[WARN] [${stepName}] ${message}`, metadata || '');
  }

  /**
   * Log error message
   */
  error(
    stepName: string,
    message: string,
    error?: Error,
    metadata?: Record<string, unknown>
  ): void {
    const entry = this.createEntry('error', stepName, message, metadata, error);
    this.logs.push(entry);
    console.error(`[ERROR] [${stepName}] ${message}`, error?.message || '', metadata || '');
  }

  /**
   * Log video processing success
   */
  logSuccess(videoId: string, durationMs: number): void {
    this.info('VideoProcessing', `Video ${videoId} completed successfully`, {
      videoId,
      processingDuration: `${(durationMs / 1000).toFixed(2)}s`
    });
  }

  /**
   * Log video processing failure
   */
  logFailure(videoId: string, stepName: string, error: Error): void {
    this.error(stepName, `Video ${videoId} failed`, error, { videoId });
  }

  /**
   * Generate summary report
   */
  generateReport(results: ProcessingResult[]): Report {
    const successCount = results.filter(r => r.status === 'success').length;
    const failureCount = results.filter(r => r.status === 'failed').length;

    const report: Report = {
      totalProcessed: results.length,
      successCount,
      failureCount,
      details: results
    };

    this.info('Report', `Batch completed: ${successCount} success, ${failureCount} failed`, {
      totalProcessed: report.totalProcessed,
      successCount,
      failureCount
    });

    return report;
  }

  /**
   * Send alert notification for critical errors
   */
  async sendAlert(message: string, details?: Record<string, unknown>): Promise<void> {
    if (!this.alertWebhookUrl) {
      console.warn('Alert webhook URL not configured');
      return;
    }

    try {
      await axios.post(this.alertWebhookUrl, {
        text: `🚨 *Critical Error*\n${message}`,
        attachments: details ? [
          {
            color: 'danger',
            fields: Object.entries(details).map(([key, value]) => ({
              title: key,
              value: String(value),
              short: true
            }))
          }
        ] : undefined
      });

      this.info('Alert', 'Alert notification sent', { message });
    } catch (error) {
      this.error('Alert', 'Failed to send alert notification', error as Error);
    }
  }

  /**
   * Get all logs
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get error logs only
   */
  getErrorLogs(): LogEntry[] {
    return this.logs.filter(log => log.level === 'error');
  }

  /**
   * Clear logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  private createEntry(
    level: LogEntry['level'],
    stepName: string,
    message: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      stepName,
      message,
      metadata,
      error: error?.message
    };
  }
}

// Export singleton instance
export const logger = new Logger(process.env.ALERT_WEBHOOK_URL);
