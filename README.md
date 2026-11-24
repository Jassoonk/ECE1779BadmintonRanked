# Badminton Ranked

Badminton Ranked is a web app for doubles matchmaking, score confirmation, ratings, and match history.

## Run the app

Create `.env` in the repo root using your own admin password and six-digit invite code:

```dotenv
ADMIN_PASSWORD=your-admin-password
INITIAL_INVITE_CODE=123456
```

With Docker running, start the app from the repo root:

```bash
docker compose up -d --build --wait
```

Open `http://localhost:3000` when running locally.

## Deploy with HTTPS on a Droplet

Start Compose on the Ubuntu Droplet as shown above and allow inbound TCP ports `80` and `443`. Run the following from the repo root in the same SSH session.

```bash
sudo apt update && sudo apt install -y nginx snapd
sudo snap install --classic certbot
read -rp 'Droplet public IPv4 address: ' PUBLIC_IP
sudo mkdir -p /var/www/certbot/.well-known/acme-challenge

sudo tee /etc/nginx/sites-available/badminton >/dev/null <<EOF
server {
    listen 80;
    server_name $PUBLIC_IP;

    # Serve the validation files Certbot writes before HTTPS is available.
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
}
EOF

sudo ln -sfn /etc/nginx/sites-available/badminton /etc/nginx/sites-enabled/badminton
sudo nginx -t && sudo systemctl reload nginx
```

Request the certificate:

```bash
sudo /snap/bin/certbot certonly --cert-name badminton-ip \
  --preferred-profile shortlived --webroot --webroot-path /var/www/certbot \
  --ip-address "$PUBLIC_IP" --deploy-hook 'systemctl reload nginx'
```

After Certbot succeeds, install the HTTPS config with your public IP:

```bash
sed "s/143\.110\.209\.50/$PUBLIC_IP/g" nginx/badminton.conf |
  sudo tee /etc/nginx/sites-available/badminton >/dev/null
sudo nginx -t && sudo systemctl reload nginx
systemctl list-timers --all '*certbot*'
```

Open `https://YOUR_DROPLET_IP` using your public IP.
