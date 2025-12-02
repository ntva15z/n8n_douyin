# Requirements Document

## Introduction

Hệ thống n8n workflow tự động hóa quy trình tải video từ Douyin, tạo phụ đề tiếng Trung (qua OCR), dịch sang tiếng Việt bằng AI, và ghép phụ đề vào video. Workflow được điều khiển bởi dữ liệu từ Google Sheet để theo dõi các kênh Douyin và tiến độ xử lý.

## Glossary

- **n8n_Workflow**: Hệ thống tự động hóa workflow chạy trên nền tảng n8n
- **Google_Sheet**: Bảng tính Google chứa danh sách kênh Douyin và trạng thái xử lý
- **Google_Drive**: Dịch vụ lưu trữ đám mây của Google để lưu video đã xử lý
- **Douyin_Channel**: Kênh video trên nền tảng Douyin được xác định bởi user_id
- **lastprocess**: Trường dữ liệu trong Google Sheet lưu ngày xử lý cuối cùng
- **processing_status**: Trường dữ liệu trong Google Sheet lưu trạng thái xử lý hiện tại của video
- **OCR_Service**: Dịch vụ nhận diện ký tự quang học để trích xuất chữ từ video
- **AI_Translation_Service**: Dịch vụ dịch thuật sử dụng AI
- **SRT_File**: File phụ đề theo định dạng SubRip Text
- **Video_Processor**: Module xử lý và ghép phụ đề vào video
- **Environment_Variables**: Các biến môi trường chứa API keys và config

## Requirements

### Requirement 1: Kiểm tra và lọc dữ liệu từ Google Sheet

**User Story:** As a content manager, I want to automatically filter Douyin channels from Google Sheet based on status, so that only active channels are processed.

#### Acceptance Criteria

1. WHEN the n8n_Workflow starts THEN the n8n_Workflow SHALL connect to the configured Google_Sheet and retrieve all rows
2. WHEN retrieving data from Google_Sheet THEN the n8n_Workflow SHALL filter rows where status column equals "Started"
3. WHEN a row has status "Started" THEN the n8n_Workflow SHALL extract user_id and lastprocess fields from that row
4. IF the Google_Sheet connection fails THEN the n8n_Workflow SHALL log the error and retry up to 3 times with 30-second intervals
5. IF a row has missing user_id or lastprocess THEN the n8n_Workflow SHALL skip that row and log a warning message
6. WHEN starting to process a channel THEN the n8n_Workflow SHALL update processing_status in Google_Sheet to "Processing"

### Requirement 2: Tải video tự động từ Douyin

**User Story:** As a content manager, I want to automatically download videos from Douyin channels based on the lastprocess date, so that only new videos are downloaded.

#### Acceptance Criteria

1. WHEN processing a Douyin_Channel THEN the n8n_Workflow SHALL retrieve all videos posted from lastprocess date to current date
2. WHEN a video is identified for download THEN the n8n_Workflow SHALL download the video file to a temporary local storage
3. WHEN all videos from a Douyin_Channel are downloaded successfully THEN the n8n_Workflow SHALL update the lastprocess field in Google_Sheet to current date
4. IF a video download fails THEN the n8n_Workflow SHALL retry up to 3 times before marking that video as failed
5. IF the Douyin API rate limit is reached THEN the n8n_Workflow SHALL pause for 60 seconds before continuing
6. WHEN downloading videos THEN the n8n_Workflow SHALL store video metadata including original title, duration, and publish date
7. WHEN download starts THEN the n8n_Workflow SHALL update processing_status in Google_Sheet to "Downloading"

### Requirement 3: Tạo phụ đề tiếng Trung bằng OCR

**User Story:** As a content manager, I want to extract Chinese subtitles from videos using OCR, so that I have text content for translation.

#### Acceptance Criteria

1. WHEN a video is downloaded THEN the n8n_Workflow SHALL send the video to OCR_Service for text extraction
2. WHEN OCR_Service processes a video THEN the OCR_Service SHALL extract text with timestamp information
3. WHEN OCR extraction completes THEN the n8n_Workflow SHALL generate an SRT_File with Chinese text and timing data
4. IF OCR_Service fails to extract text THEN the n8n_Workflow SHALL mark the video for manual review
5. WHEN generating SRT_File THEN the n8n_Workflow SHALL validate that timestamps are sequential and non-overlapping
6. WHEN OCR processing starts THEN the n8n_Workflow SHALL update processing_status in Google_Sheet to "OCR_Processing"

### Requirement 4: Dịch phụ đề sang tiếng Việt bằng AI

**User Story:** As a content manager, I want to translate Chinese subtitles to Vietnamese using AI, so that Vietnamese viewers can understand the content.

#### Acceptance Criteria

1. WHEN an SRT_File with Chinese text is ready THEN the n8n_Workflow SHALL send the content to AI_Translation_Service
2. WHEN the SRT_File exceeds 5000 characters THEN the n8n_Workflow SHALL split the file into smaller segments for translation
3. WHEN AI_Translation_Service returns translated text THEN the n8n_Workflow SHALL merge segments back into a complete Vietnamese SRT_File
4. WHEN merging translated segments THEN the n8n_Workflow SHALL preserve original timestamp information
5. IF AI_Translation_Service fails THEN the n8n_Workflow SHALL retry up to 3 times before marking for manual translation
6. WHEN translation starts THEN the n8n_Workflow SHALL update processing_status in Google_Sheet to "Translating"

### Requirement 5: Ghép phụ đề vào video và lưu trữ

**User Story:** As a content manager, I want to embed Vietnamese subtitles into videos synchronized with audio and store them on Google Drive, so that the final video is ready for publishing.

#### Acceptance Criteria

1. WHEN Vietnamese SRT_File is ready THEN the Video_Processor SHALL embed subtitles into the original video
2. WHEN embedding subtitles THEN the Video_Processor SHALL synchronize subtitle display with audio timing
3. WHEN subtitle timing needs adjustment THEN the Video_Processor SHALL adjust reading speed to match audio pace
4. WHEN video processing starts THEN the n8n_Workflow SHALL update processing_status in Google_Sheet to "Embedding"
5. WHEN video processing completes THEN the n8n_Workflow SHALL upload the output video to Google_Drive
6. WHEN upload to Google_Drive completes THEN the n8n_Workflow SHALL update processing_status in Google_Sheet to "Completed"
7. WHEN output video is uploaded THEN the n8n_Workflow SHALL update Google_Sheet with Google_Drive file URL in output_location field
8. IF subtitle synchronization fails THEN the n8n_Workflow SHALL update processing_status to "Sync_Failed" and generate a report with timing discrepancies
9. IF upload to Google_Drive fails THEN the n8n_Workflow SHALL update processing_status to "Upload_Failed" and retry up to 3 times

### Requirement 6: Xử lý lỗi và logging

**User Story:** As a system administrator, I want comprehensive error handling and logging, so that I can monitor and troubleshoot the workflow.

#### Acceptance Criteria

1. WHEN any step in the workflow fails THEN the n8n_Workflow SHALL log error details including timestamp, step name, and error message
2. WHEN any step fails THEN the n8n_Workflow SHALL update processing_status in Google_Sheet to indicate the failed step
3. WHEN a video completes all processing steps THEN the n8n_Workflow SHALL log success with processing duration
4. WHEN the workflow completes a batch THEN the n8n_Workflow SHALL generate a summary report with success and failure counts
5. IF critical errors occur THEN the n8n_Workflow SHALL send notification to configured alert channel

### Requirement 7: Cấu hình và Environment Variables

**User Story:** As a system administrator, I want all sensitive configuration stored in environment variables, so that the system is secure and easy to configure.

#### Acceptance Criteria

1. WHEN the n8n_Workflow starts THEN the n8n_Workflow SHALL read API keys from Environment_Variables
2. WHEN configuring Google_Sheet connection THEN the n8n_Workflow SHALL use GOOGLE_SHEET_ID and GOOGLE_CREDENTIALS from Environment_Variables
3. WHEN configuring Google_Drive connection THEN the n8n_Workflow SHALL use GOOGLE_DRIVE_FOLDER_ID from Environment_Variables
4. WHEN configuring OCR_Service THEN the n8n_Workflow SHALL use OCR_API_KEY and OCR_ENDPOINT from Environment_Variables
5. WHEN configuring AI_Translation_Service THEN the n8n_Workflow SHALL use OPENAI_API_KEY from Environment_Variables
6. IF any required Environment_Variable is missing THEN the n8n_Workflow SHALL fail with a clear error message indicating the missing variable
