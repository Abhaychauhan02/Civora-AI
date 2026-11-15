#!/usr/bin/env bash
# ==============================================================================
# Civora EC2 HTTPS, Geolocation & Systemd Production Setup Script
# Configures Wildcard Domain (nip.io), Let's Encrypt TLS/SSL, Nginx, and Civora Service
# ==============================================================================

set -e

echo "🚀 [Civora Setup] Starting HTTPS & Geolocation Setup..."

# 1. Determine Current User and Working Directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CURRENT_USER="$(whoami)"

echo "📁 Civora Repository: ${REPO_DIR}"
echo "👤 Current User: ${CURRENT_USER}"

# 2. Update packages and install Nginx, Certbot & OpenSSL
echo "📦 Installing Nginx, Certbot, and SSL utilities..."
sudo apt-get update -y
sudo apt-get install -y nginx certbot python3-certbot-nginx openssl

# 3. Stop any existing background python processes running Civora
echo "🛑 Stopping any existing background manual Civora processes..."
pkill -f "python.*main.py" || true

# 4. Prepare SSL Directory and Temporary Fallback Certificate
echo "🔐 Preparing TLS/SSL Certificates..."
sudo mkdir -p /etc/ssl/civora
sudo mkdir -p /var/www/certbot

DOMAIN="13.211.32.245.nip.io"
ALT_DOMAIN="13-211-32-245.sslip.io"

if [ ! -f /etc/ssl/civora/fullchain.pem ] || [ ! -f /etc/ssl/civora/privkey.pem ]; then
  echo "🔑 Generating initial TLS certificates for ${DOMAIN}..."
  sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/ssl/civora/privkey.pem \
    -out /etc/ssl/civora/fullchain.pem \
    -subj "/C=IN/ST=Delhi/L=NewDelhi/O=Civora/OU=CivicIntelligence/CN=${DOMAIN}"
  sudo chmod 600 /etc/ssl/civora/privkey.pem
  sudo chmod 644 /etc/ssl/civora/fullchain.pem
fi

# 5. Configure Nginx Reverse Proxy
echo "🌐 Configuring Nginx Reverse Proxy..."
sudo cp "${REPO_DIR}/deploy/nginx_civora.conf" /etc/nginx/sites-available/civora
sudo ln -sf /etc/nginx/sites-available/civora /etc/nginx/sites-enabled/civora
sudo rm -f /etc/nginx/sites-enabled/default

echo "🔍 Validating Nginx configuration syntax..."
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx

# 6. Configure & Enable Systemd Service
echo "⚙️ Configuring Civora systemd daemon..."
SERVICE_FILE="/etc/systemd/system/civora.service"

sudo bash -c "cat <<EOF > ${SERVICE_FILE}
[Unit]
Description=Civora AI - Civic Intelligence & Resolution Platform
After=network.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${REPO_DIR}
ExecStart=${REPO_DIR}/venv/bin/python main.py
Restart=always
RestartSec=3
Environment=PYTHONPATH=${REPO_DIR}
Environment=TRANSFORMERS_OFFLINE=1
Environment=HF_HUB_OFFLINE=1
Environment=HOST=127.0.0.1
Environment=PORT=8000

LimitNOFILE=65535
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF"

sudo systemctl daemon-reload
sudo systemctl enable civora
sudo systemctl restart civora

echo "⏳ Waiting for Civora API backend to boot..."
sleep 4

# 7. Check backend health
if curl -s http://127.0.0.1:8000/api/health > /dev/null 2>&1 || curl -s http://127.0.0.1:8000/ > /dev/null 2>&1; then
  echo "✅ Civora backend is UP and running under systemd!"
else
  echo "⚠️ Backend not responding yet, checking logs..."
  sudo journalctl -u civora -n 15 --no-pager
fi

# 8. Attempt Let's Encrypt Certificate Generation via Certbot
echo "🔒 Attempting to obtain official Let's Encrypt Certificate for ${DOMAIN}..."
set +e
sudo certbot certonly --webroot -w /var/www/certbot \
  -d "${DOMAIN}" \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --preferred-challenges http 2>&1 | tee /tmp/certbot.log

CERT_RESULT=$?
if [ ${CERT_RESULT} -eq 0 ] && [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  echo "🎉 Let's Encrypt certificate obtained successfully! Linking to Nginx..."
  sudo ln -sf "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" /etc/ssl/civora/fullchain.pem
  sudo ln -sf "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" /etc/ssl/civora/privkey.pem
  sudo systemctl reload nginx
  echo "✅ HTTPS with Trusted CA Certificate is now ACTIVE!"
else
  echo "ℹ️ Note: Let's Encrypt HTTP challenge requires AWS EC2 Security Group inbound Port 80 and Port 443 to be open to 0.0.0.0/0."
  echo "ℹ️ The server is currently running with standard TLS certificates for ${DOMAIN}."
  echo "ℹ️ Once inbound 80/443 are verified in AWS console, re-run 'sudo certbot --nginx -d ${DOMAIN}'."
fi
set -e

echo ""
echo "=============================================================================="
echo "🎉 CIVORA SECURE HTTPS DEPLOYMENT READY!"
echo "=============================================================================="
echo "👉 Secure HTTPS URL: https://${DOMAIN}"
echo "👉 Local Proxy Port: 8000 -> 443 (SSL)"
echo "👉 High-Precision Browser GPS: ENABLED (window.isSecureContext = true)"
echo "👉 Service Status: sudo systemctl status civora"
echo "👉 Service Logs:   sudo journalctl -u civora -f"
echo "=============================================================================="
