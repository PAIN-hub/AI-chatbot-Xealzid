# Xealzid // Local LLM Integration & Production Deployment Guide

This guide provides instructions to download, configure, and secure a local Large Language Model (LLM) and deploy the Xealzid workspace in a production-ready environment.

---

## 🧠 Part 1: Local LLM Model Selection

For code writing, editing, and architectural analysis, choose one of the following state-of-the-art open-source code models:

| Model | Size | Min VRAM | System RAM | Best For |
| :--- | :--- | :--- | :--- | :--- |
| **Qwen2.5-Coder (7B)** | 4.7 GB | 8 GB | 16 GB | **Highly Recommended** - Exceptional multi-language coding & reasoning. |
| **DeepSeek-Coder (6.7B)** | 3.8 GB | 8 GB | 16 GB | Precise code blocks and strict file editing alignment. |
| **Qwen2.5-Coder (1.5B)** | 980 MB | 2 GB | 4 GB | High-speed inference on CPU-only machines & laptops. |

---

## 🛠️ Part 2: Setting Up Ollama (Local LLM Server)

We utilize **Ollama** as the local inference runner. It exposes an OpenAI-compatible API that Xealzid queries at `/v1/chat/completions`.

### 1. Installation on Linux
Download and install Ollama:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Pull the Recommended Model
Download Qwen2.5-Coder (or your chosen model):
```bash
ollama pull qwen2.5-coder:7b
```
Verify the model list:
```bash
ollama list
```

### 3. Run Ollama as a Systemd Service
By default, Ollama is configured to run automatically. You can verify, start, or enable it using:
```bash
sudo systemctl daemon-reload
sudo systemctl enable ollama
sudo systemctl start ollama
```

### 4. (Optional) Hardening Network Bindings
If Xealzid and Ollama run on the same server, keep Ollama bound to `127.0.0.1:11434` (default). 

If Ollama runs on a **different server** in your network, you must allow external connections. Create a service override file:
```bash
sudo systemctl edit ollama
```
Add the following configuration lines:
```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
Environment="OLLAMA_ORIGINS=*"
```
Save the file, then restart Ollama:
```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```
> [!CAUTION]
> If you expose Ollama publicly (`0.0.0.0`), you **must** configure your firewall (e.g. UFW) to only accept incoming connections on port `11434` from your Xealzid application server IP.

---

## ⚙️ Part 3: Integrating Ollama with Xealzid

Xealzid is pre-configured to query Ollama at `http://localhost:11434`. To override this in production:

1. Define environment variables on your web server:
   ```bash
   export LOCAL_LLM_URL="http://localhost:11434/v1/chat/completions"
   export LOCAL_LLM_MODEL="qwen2.5-coder:7b"
   ```
2. Verify that Xealzid detects the endpoint. Run:
   ```bash
   python3 manage.py test
   ```
   If Ollama is active and matching variables are exported, the system will test live completion responses.

---

## 🌐 Part 4: Production Web Server Setup (Gunicorn + Nginx)

For production deployment, do not use `runserver`. Instead, run Django behind **Gunicorn** (WSGI container) and **Nginx** (Reverse proxy & SSL).

### 1. Install Production Python Requirements
Add WhiteNoise (for high-speed static asset serving without external CDNs) and Gunicorn:
```bash
pip install gunicorn whitenoise
```

### 2. Configure Django `settings.py` for Production
Ensure the following variables are customized in your production settings:
```python
# settings.py
import os

DEBUG = False
ALLOWED_HOSTS = ['yourdomain.com', 'localhost', '127.0.0.1']

# Generate a strong key and pass it via env
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY')

# Register WhiteNoise Middleware (directly after SecurityMiddleware)
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware', # Add this line
    'core.middleware.SecurityHeadersMiddleware',
    ...
]

# Static storage compression
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
STATIC_ROOT = BASE_DIR / 'staticfiles'
```

Collect static assets into the root folder:
```bash
python3 manage.py collectstatic --noinput
```

### 3. Create a Gunicorn Systemd Service
Create the service unit file `/etc/systemd/system/gunicorn.service`:
```ini
[Unit]
Description=Gunicorn daemon for Xealzid
After=network.target

[Service]
User=beelyboss
Group=www-data
WorkingDirectory=/home/beelyboss/.gemini/antigravity/scratch/xealzid
ExecStart=/usr/local/bin/gunicorn --workers 3 --bind unix:/run/gunicorn.sock xealzid.wsgi:application
Environment=DJANGO_SECRET_KEY="YOUR_PROD_SECRET_KEY"
Environment=LOCAL_LLM_URL="http://localhost:11434/v1/chat/completions"
Environment=LOCAL_LLM_MODEL="qwen2.5-coder:7b"

[Install]
WantedBy=multi-user.target
```
Enable and start Gunicorn:
```bash
sudo systemctl enable gunicorn
sudo systemctl start gunicorn
```

### 4. Configure Nginx Reverse Proxy & SSL
Install Nginx:
```bash
sudo apt update
sudo apt install nginx
```

Create a server configuration block at `/etc/nginx/sites-available/xealzid`:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Block XML-RPC and common exploits
    location ~* xmlrpc.php {
        deny all;
    }

    # Redirect to Gunicorn WSGI Socket
    location / {
        include proxy_params;
        proxy_pass http://unix:/run/gunicorn.sock;
    }

    # Custom security headers safety layer
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```
Link the file and reload Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/xealzid /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 5. Secure Nginx with SSL (Certbot)
Install and run Certbot to automatically generate SSL/TLS certificates:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```
This automatically redirects HTTP traffic to secure HTTPS and injects TLS configurations.
