# Huong Dan Trien Khai VietAPI Smart Counter Proxy

Tai lieu nay dung de dua cho nguoi khac tu trien khai VietAPI Smart Counter Proxy tren server Linux, vi du Ubuntu, Zorin OS, hoac may ao/container trong Proxmox.

He thong gom 2 cong:

| Cong | Chuc nang |
| --- | --- |
| `9000` | Proxy endpoint OpenAI-compatible. Client tro API base vao day. |
| `9001` | Dashboard web de xem counter, logs, history va sua limits. |

Proxy se forward request toi `https://api.vietapi.tech`, giu nguyen API key trong header `Authorization`, giu nguyen request body, va chi ghi thong ke vao SQLite.

## 1. Yeu Cau

May chu can co:

- Linux server: Ubuntu/Zorin OS hoac server trong Proxmox.
- Docker va Docker Compose plugin.
- Git, neu lay source tu repo.
- Tailscale, neu muon cac may client truy cap qua mang rieng Tailscale.
- Port `9000` va `9001` chua bi chuong trinh khac su dung.

Kiem tra Docker:

```bash
docker --version
docker compose version
```

Neu chua co Docker tren Ubuntu/Zorin:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Dang xuat dang nhap lai sau khi chay `usermod`, hoac tam thoi dung `sudo docker ...`.

## 2. Lay Source Code

Chon mot thu muc de dat app:

```bash
mkdir -p ~/apps
cd ~/apps
```

Neu dung Git:

```bash
git clone <REPO_URL> vietapi-counter
cd vietapi-counter
```

Neu copy source bang tay, hay dam bao thu muc co cac file chinh:

```text
server.js
proxy.js
counter.js
dashboard.js
db.js
config.js
package.json
package-lock.json
Dockerfile
docker-compose.yml
public/
data/config.json
```

## 3. Cau Hinh

File cau hinh nam tai:

```text
data/config.json
```

Noi dung mau:

```json
{
  "upstream": "https://api.vietapi.tech",
  "proxyPort": 9000,
  "dashboardPort": 9001,
  "limits": {
    "gpt-5.5": 800,
    "claude-opus-4.6": 200
  },
  "timezone": "Asia/Tokyo",
  "retentionDays": 30,
  "knownModels": [
    "gpt-5.3-codex",
    "gpt-5.3-codex-high",
    "gpt-5.3-codex-xhigh",
    "gpt-5.3-high",
    "gpt-5.3-xhigh",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-image",
    "claude-opus-4.6"
  ]
}
```

Giai thich nhanh:

- `upstream`: API goc, mac dinh la `https://api.vietapi.tech`.
- `proxyPort`: cong proxy cho client, mac dinh `9000`.
- `dashboardPort`: cong dashboard web, mac dinh `9001`.
- `limits`: gioi han request moi ngay theo model. Model khong co trong day se la unlimited nhung van duoc dem.
- `timezone`: timezone de tinh ngay hien tai, mac dinh `Asia/Tokyo`.
- `retentionDays`: so ngay giu logs trong SQLite.
- `knownModels`: danh sach model goi y trong dashboard.

Khong dua API key vao file config. API key van nam o tung client nhu binh thuong.

## 4. Chay Bang Docker

Tai thu muc project:

```bash
docker compose up -d --build
```

Kiem tra container:

```bash
docker compose ps
docker compose logs -f vietapi-counter
```

Neu chay thanh cong:

- Dashboard: `http://SERVER_IP:9001`
- Proxy base URL: `http://SERVER_IP:9000/v1`

Neu dung Tailscale, lay IP Tailscale cua server:

```bash
tailscale ip -4
```

Luc do dung:

- Dashboard: `http://TAILSCALE_IP:9001`
- Proxy base URL: `http://TAILSCALE_IP:9000/v1`

## 5. Cau Hinh Client

Tat ca client giu nguyen API key VietAPI. Chi doi API base/host sang proxy.

### Codex CLI

Sua `~/.codex/config.toml`:

```toml
api_base_url = "http://TAILSCALE_IP:9000/v1"
```

### Chatbox

```text
API Host: http://TAILSCALE_IP:9000/v1
API Key: giu nguyen key VietAPI
```

### Claude Code hoac tool OpenAI-compatible

```bash
export OPENAI_BASE_URL="http://TAILSCALE_IP:9000/v1"
export OPENAI_API_KEY="sk-your-vietapi-key"
```

Neu khong dung Tailscale, thay `TAILSCALE_IP` bang IP LAN/server IP.

## 6. Kiem Tra Hoat Dong

Mo dashboard:

```text
http://SERVER_IP:9001
```

Gui thu request qua proxy:

```bash
curl http://SERVER_IP:9000/v1/models \
  -H "Authorization: Bearer sk-your-vietapi-key"
```

Luu y: `/v1/models` se duoc forward nhung khong tinh counter vi endpoint nay khong co model trong body.

Gui thu request co model:

```bash
curl http://SERVER_IP:9000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-vietapi-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      { "role": "user", "content": "Say hello" }
    ]
  }'
```

Sau do quay lai dashboard, counter cua `gpt-5.5` se tang trong vong 10 giay.

## 7. Van Hanh Hang Ngay

Xem logs:

```bash
docker compose logs -f vietapi-counter
```

Restart service:

```bash
docker compose restart
```

Dung service:

```bash
docker compose down
```

Cap nhat source moi:

```bash
git pull
docker compose up -d --build
```

Backup du lieu:

```bash
mkdir -p ~/backups/vietapi-counter
cp data/config.json ~/backups/vietapi-counter/config-$(date +%F).json
cp data/counter.db ~/backups/vietapi-counter/counter-$(date +%F).db
```

Neu SQLite dang co WAL files va muon backup day du runtime state:

```bash
cp data/counter.db* ~/backups/vietapi-counter/
```

Reset counter hom nay:

1. Mo dashboard `http://SERVER_IP:9001`.
2. Xuong phan Settings.
3. Bam `Reset Today`.
4. Xac nhan reset.

Reset Today se xoa record cua ngay hien tai theo timezone trong config.

## 8. Chay Local Khong Docker

Dung cach nay de test nhanh tren may dev.

Yeu cau Node.js:

```bash
node --version
npm --version
```

Cai dependency:

```bash
npm install
```

Chay app:

```bash
npm start
```

Chay test:

```bash
npm test
```

Khi chay local:

- Dashboard: `http://localhost:9001`
- Proxy base URL: `http://localhost:9000/v1`

## 9. Troubleshooting

### Khong vao duoc dashboard

Kiem tra container co dang chay khong:

```bash
docker compose ps
docker compose logs vietapi-counter
```

Kiem tra port:

```bash
sudo ss -ltnp | grep -E ':9000|:9001'
```

Neu server co firewall:

```bash
sudo ufw allow 9000/tcp
sudo ufw allow 9001/tcp
```

Neu chi dung Tailscale, co the khong can mo port ra internet public; chi can dam bao Tailscale ket noi duoc.

### Port 9000 hoac 9001 bi ban

Sua `data/config.json`:

```json
{
  "proxyPort": 9100,
  "dashboardPort": 9101
}
```

Dong thoi sua `docker-compose.yml` ports tuong ung:

```yaml
ports:
  - "9100:9100"
  - "9101:9101"
```

Sau do restart:

```bash
docker compose up -d --build
```

### Client bi 401

401 thuong la API key sai hoac key khong duoc upstream chap nhan. Proxy khong sua key, nen hay kiem tra key tren client.

### Client bi 429

429 la upstream rate limit/quota cua VietAPI. Proxy van forward nguyen 429 ve client va van dem request.

### Dashboard co counter nhung token bang 0

Token usage chi ghi duoc khi upstream tra `usage` trong response. Voi streaming, viec nay la best-effort va phu thuoc upstream co gui usage chunk hay khong.

### SQLite permission error

Kiem tra quyen thu muc `data`:

```bash
ls -la data
sudo chown -R "$USER":"$USER" data
```

Neu chay Docker rootless hoac user khac, can chown theo user/container runtime tuong ung.

### Tailscale khong truy cap duoc

Kiem tra IP:

```bash
tailscale ip -4
tailscale status
```

Tu may client, thu ping server:

```bash
ping TAILSCALE_IP
```

Neu ping duoc nhung dashboard khong vao duoc, kiem tra firewall va container ports.

## 10. Luu Y Bao Mat

- Dashboard hien khong co dang nhap, nen chi nen expose qua Tailscale/LAN tin cay.
- Khong dua port `9000` va `9001` ra internet public neu khong co reverse proxy/auth rieng.
- Proxy khong luu API key that. Database chi luu SHA-256 hash cua key.
- File `data/config.json` khong nen chua secret.

## 11. Checklist Ban Giao

Truoc khi coi la trien khai xong, hay tick cac muc nay:

- `docker compose ps` hien container dang `Up`.
- Dashboard mo duoc tai `http://SERVER_IP:9001`.
- Client goi duoc API qua `http://SERVER_IP:9000/v1`.
- Dashboard tang counter sau request test.
- `data/config.json` co dung timezone `Asia/Tokyo`.
- Limits dung: `gpt-5.5` la `800`, `claude-opus-4.6` la `200`.
- Thu muc `data/` duoc backup hoac nam tren volume persistent.
