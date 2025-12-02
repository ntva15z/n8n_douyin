# Douyin Video Workflow

Tự động tải video Douyin, trích xuất phụ đề bằng OCR, dịch sang tiếng Việt và ghép vào video.

## Yêu cầu

- Node.js >= 18
- n8n (self-hosted hoặc cloud)
- FFmpeg
- yt-dlp

## Cài đặt

### 1. Cài đặt dependencies

```bash
npm install
```

### 2. Cài đặt external tools

```bash
# macOS
brew install ffmpeg yt-dlp

# Ubuntu/Debian
apt install ffmpeg
pip install yt-dlp
```

### 3. Cấu hình environment

Copy `.env.example` thành `.env` và điền các giá trị:

```bash
cp .env.example .env
```

Các biến cần cấu hình:

| Variable | Mô tả |
|----------|-------|
| `GOOGLE_SHEET_ID` | ID của Google Sheet chứa danh sách kênh |
| `GOOGLE_DRIVE_FOLDER_ID` | ID folder Google Drive để lưu video |
| `GOOGLE_CREDENTIALS` | Path đến file credentials.json |
| `OCR_API_KEY` | Baidu OCR API Key |
| `OCR_SECRET_KEY` | Baidu OCR Secret Key |
| `OPENAI_API_KEY` | OpenAI API Key |

### 4. Tạo Google Service Account

1. Vào [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới hoặc chọn project có sẵn
3. Enable APIs: Google Sheets API, Google Drive API
4. Tạo Service Account và download credentials.json
5. Share Google Sheet và Drive folder với email của Service Account

### 5. Import n8n Workflow

1. Mở n8n
2. Vào Settings → Import from File
3. Chọn file `workflow/douyin-video-workflow.json`
4. Cấu hình credentials trong n8n:
   - Google Sheets OAuth2
   - Google Drive OAuth2
   - OpenAI API

## Google Sheet Format

| Column | Tên | Mô tả |
|--------|-----|-------|
| A | user_id | Douyin user ID |
| B | lastprocess | Ngày xử lý cuối (YYYY-MM-DD) |
| C | status | Trạng thái (Started/Stopped) |
| D | output_location | URL video đã xử lý |
| E | processing_status | Trạng thái xử lý hiện tại |

## Processing Status

| Status | Mô tả |
|--------|-------|
| Pending | Chờ xử lý |
| Processing | Đang bắt đầu |
| Downloading | Đang tải video |
| OCR_Processing | Đang trích xuất text |
| Translating | Đang dịch |
| Embedding | Đang ghép phụ đề |
| Uploading | Đang upload |
| Completed | Hoàn thành |
| Failed | Lỗi |

## Chạy thủ công

```bash
# Build
npm run build

# Test
npm test
```

## Cấu trúc project

```
├── src/
│   ├── types/           # TypeScript types
│   ├── utils/           # Utilities (SRT, env)
│   ├── services/        # Core services
│   └── index.ts
├── workflow/            # n8n workflow JSON
├── .env.example
└── package.json
```
