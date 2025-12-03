# Douyin Video Workflow

Tự động tải video Douyin, trích xuất phụ đề bằng OCR, dịch sang tiếng Việt và ghép vào video.

## Mục lục

- [Quick Start](#quick-start)
- [Hướng dẫn tạo API Keys](#hướng-dẫn-tạo-api-keys)
- [Cấu hình n8n](#cấu-hình-n8n)
- [Google Sheet Format](#google-sheet-format)

---

## Quick Start

### 1. Clone và cấu hình

```bash
# Copy file env
cp .env.example .env

# Mở .env và điền các API keys (xem hướng dẫn bên dưới)
```

### 2. Chạy Docker

```bash
docker-compose up -d --build
```

### 3. Truy cập n8n

- URL: http://localhost:5678
- Lần đầu: Tạo owner account (email + password bất kỳ)

---

## Hướng dẫn tạo API Keys

### 1. Google Cloud (Sheets + Drive)

**Bước 1: Tạo Project**
1. Vào [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Đặt tên project → Create

**Bước 2: Enable APIs**
1. Vào "APIs & Services" → "Library"
2. Tìm và Enable:
   - Google Sheets API
   - Google Drive API

**Bước 3: Tạo OAuth Credentials**
1. Vào "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Application type: "Web application"
4. Authorized redirect URIs: `http://localhost:5678/rest/oauth2-credential/callback`
5. Download JSON → Lưu Client ID và Client Secret

**Bước 4: Lấy Sheet ID và Drive Folder ID**
```
Google Sheet URL: https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
                                                         ^^^^^^^^^^
Google Drive URL: https://drive.google.com/drive/folders/{FOLDER_ID}
                                                          ^^^^^^^^^^
```

### 2. OpenAI API Key

1. Vào [OpenAI Platform](https://platform.openai.com/api-keys)
2. Click "Create new secret key"
3. Copy key (bắt đầu bằng `sk-`)

### 3. Baidu OCR

1. Vào [Baidu Cloud](https://cloud.baidu.com/)
2. Đăng ký tài khoản
3. Vào Console → 文字识别 (OCR)
4. Tạo ứng dụng → Lấy API Key và Secret Key

---

## Cấu hình n8n

### Bước 1: Tạo Owner Account

Lần đầu truy cập http://localhost:5678:
1. Nhập email (ví dụ: `admin@local.dev`)
2. Nhập password
3. Click "Next" → "Get started"

### Bước 2: Tạo Credentials

**Google Sheets:**
1. Settings → Credentials → Add Credential
2. Chọn "Google Sheets OAuth2 API"
3. Nhập Client ID và Client Secret từ Google Cloud
4. Click "Sign in with Google" → Authorize

**Google Drive:**
1. Add Credential → "Google Drive OAuth2 API"
2. Nhập Client ID và Client Secret
3. Sign in with Google

**OpenAI:**
1. Add Credential → "OpenAI API"
2. Nhập API Key

### Bước 3: Import Workflow

1. Click "+" (Add workflow)
2. Click "..." → "Import from file"
3. Chọn file `workflow/douyin-video-workflow.json`
4. Trong mỗi node, chọn credential đã tạo

### Bước 4: Chạy Workflow

- Manual: Click "Execute Workflow"
- Auto: Workflow sẽ chạy mỗi 6 giờ (có thể điều chỉnh trong Schedule Trigger)

---

## Google Sheet Format

Tạo Google Sheet với các cột sau:

| Cột | Tên | Mô tả | Ví dụ |
|-----|-----|-------|-------|
| A | user_id | Douyin user ID | MS4wLjABAAAA... |
| B | lastprocess | Ngày xử lý cuối | 2024-01-01 |
| C | status | Trạng thái | Started |
| D | output_location | URL video output | (tự động điền) |
| E | processing_status | Trạng thái xử lý | (tự động điền) |

**Giá trị cột status:**
- `Started` - Kênh đang hoạt động, sẽ được xử lý
- `Stopped` - Tạm dừng, không xử lý

**Giá trị processing_status:**
- `Pending` - Chờ xử lý
- `Downloading` - Đang tải video
- `OCR_Processing` - Đang trích xuất text
- `Translating` - Đang dịch
- `Embedding` - Đang ghép phụ đề
- `Completed` - Hoàn thành
- `Failed` - Lỗi

---

## Cấu trúc Project

```
├── src/                    # Source code TypeScript
│   ├── services/           # Core services
│   ├── utils/              # Utilities
│   └── types/              # Type definitions
├── workflow/               # n8n workflow JSON
├── docker-compose.yml      # Docker config
├── Dockerfile.worker       # Worker container
└── .env.example            # Environment template
```

## Troubleshooting

**n8n không start:**
```bash
docker-compose logs n8n
```

**Worker build lỗi:**
```bash
docker-compose build --no-cache worker
```

**Reset hoàn toàn:**
```bash
docker-compose down -v
docker-compose up -d --build
```
