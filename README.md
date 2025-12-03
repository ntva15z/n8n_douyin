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

**Bước 1: Đăng ký tài khoản**
1. Vào [platform.openai.com](https://platform.openai.com/)
2. Click "Sign up" (hoặc "Log in" nếu đã có tài khoản)
3. Đăng ký bằng email hoặc Google/Microsoft account

**Bước 2: Thêm phương thức thanh toán**
1. Vào Settings → Billing
2. Click "Add payment method"
3. Thêm thẻ Visa/Mastercard (cần thẻ quốc tế)
4. Nạp credit (tối thiểu $5)

**Bước 3: Tạo API Key**
1. Vào [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Click "Create new secret key"
3. Đặt tên (ví dụ: "douyin-workflow")
4. Copy key ngay (chỉ hiện 1 lần!) - bắt đầu bằng `sk-...`

**Chi phí ước tính:**
- GPT-4o-mini: ~$0.15/1M input tokens, ~$0.60/1M output tokens
- Mỗi video ngắn (1-2 phút): ~$0.01-0.05
- Nạp $5-10 là đủ dùng khá lâu

### 3. Baidu OCR

1. Vào [Baidu Cloud](https://cloud.baidu.com/)
2. Đăng ký tài khoản
3. Vào Console → 文字识别 (OCR)
4. Tạo ứng dụng → Lấy API Key và Secret Key

### 4. YouTube Channel (Optional)

**Bước 1: Tạo tài khoản Google**
1. Vào [accounts.google.com](https://accounts.google.com/)
2. Click "Create account" → "For myself"
3. Điền thông tin và xác minh số điện thoại

**Bước 2: Tạo kênh YouTube**
1. Vào [youtube.com](https://www.youtube.com/)
2. Đăng nhập bằng tài khoản Google
3. Click avatar → "Create a channel"
4. Chọn "Use custom name" → đặt tên kênh
5. Upload avatar và banner cho kênh

**Bước 3: Cấu hình kênh**
1. Vào YouTube Studio → Settings
2. Channel → Basic info: Điền mô tả kênh
3. Upload defaults: Đặt visibility mặc định, category, tags

**Bước 4: Bật kiếm tiền (YouTube Partner Program)**

Yêu cầu tối thiểu:
- 1,000 subscribers
- 4,000 giờ xem trong 12 tháng gần nhất HOẶC 10 triệu lượt xem Shorts trong 90 ngày
- Tuân thủ chính sách của YouTube
- Bật xác minh 2 bước
- Có tài khoản AdSense

Các bước:
1. Vào YouTube Studio → Earn
2. Click "Start" khi đủ điều kiện
3. Đọc và chấp nhận điều khoản
4. Kết nối hoặc tạo tài khoản AdSense
5. Đợi YouTube review (thường 1-2 tuần)

**Lưu ý:**
- Kênh mới cần thời gian để đạt yêu cầu monetization
- Nội dung phải tuân thủ YouTube Community Guidelines
- Video có bản quyền có thể bị claim hoặc không được monetize

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
