# Deploy xentra-core to VPS

## Prerequisites

- VPS Ubuntu/Debian dengan SSH access
- Domain sudah pointed ke IP VPS (DNS A record)
- Node 24 (via NVM)
- PM2
- Nginx
- Certbot (untuk SSL)

## Quick Setup (sekali saja)

### 1. Setup VPS

```bash
# SSH ke VPS, lalu:
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 24
npm install -g pm2
pm2 startup systemd
sudo apt install nginx certbot python3-certbot-nginx git -y
```

### 2. Clone & Setup App

```bash
cd ~
git clone https://github.com/wanstudio/xentra-core.git
cd xentra-core
npm install --omit=dev

# Buat .env
cp .env.example .env
nano .env   # isi values

# Test jalan
node server/app.js   # Ctrl+C setelah yakin
```

### 3. Start dengan PM2

```bash
pm2 start server/app.js --name xentra-core
pm2 save
pm2 status   # harusnya "online"
```

### 4. Setup Nginx

```bash
sudo tee /etc/nginx/sites-available/xentra.cloud > /dev/null << 'EOF'
server {
    listen 80;
    server_name xentra.cloud www.xentra.cloud;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }

    location ~* \.(jpg|jpeg|png|gif|ico|css|js|woff2|ttf|svg)$ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/xentra.cloud /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 5. SSL Certificate

```bash
sudo certbot --nginx -d xentra.cloud -d www.xentra.cloud
sudo certbot renew --dry-run
```

## Auto-Deploy via GitHub Actions

### 1. Generate Deploy Key

```bash
# di VPS
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```

Copy output, tambah ke GitHub repo → Settings → Deploy keys → Add deploy key (Allow write access).

### 2. Tambah GitHub Secrets

| Name | Value |
|------|-------|
| `VPS_SSH_KEY` | Private key dari `cat ~/.ssh/github_deploy` |
| `VPS_SSH_HOST` | IP VPS |
| `VPS_SSH_USER` | Username VPS |
| `VPS_SSH_PORT` | `22` |

### 3. Workflow

File `.github/workflows/deploy-vps.yml` sudah dibuat. Setiap push ke `main`:
1. Git pull di VPS
2. npm install
3. PM2 restart
4. Health check

## Manual Deploy

```bash
# SSH ke VPS
cd ~/xentra-core
git pull origin main
npm install --omit=dev
pm2 restart xentra-core
```

## Troubleshooting

### App tidak jalan
```bash
pm2 status
pm2 logs xentra-core --lines 50
```

### Health check fail
```bash
curl -v http://127.0.0.1:3000/health
pm2 logs xentra-core --lines 20
```

### Nginx 502 Bad Gateway
```bash
sudo nginx -t
sudo systemctl status nginx
pm2 status   # pastikan app online
```

### SSL expired
```bash
sudo certbot renew
sudo systemctl reload nginx
```

## PM2 Useful Commands

```bash
pm2 status              # lihat status
pm2 logs xentra-core    # lihat logs
pm2 restart xentra-core # restart app
pm2 stop xentra-core    # stop app
pm2 delete xentra-core  # hapus app
pm2 save                # save config (auto-start on reboot)
pm2 monit               # monitoring realtime
```
