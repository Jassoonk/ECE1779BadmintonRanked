# Badminton Ranked: Cloud-Native Matchmaking for a Weekly Drop-in Group

Badminton Ranked is a cloud-based web application for doubles matchmaking, score confirmation, player ratings, and match history.

## 1. Team Information

| Name | Student Number | Email |
|---|---|---|
| Molin Li | 1013212060 | molin.li@mail.utoronto.ca |
| Jason Wei | TBD | TBD |

## 2. Motivation

Our project was inspired by a weekly badminton drop-in group where players usually form teams based on who is available. Without a regular organizer, random pairings often lead to uneven matches, making games less competitive and enjoyable. Players also have no consistent way to record match results or track their improvement over time.

We wanted to bring the ranked matchmaking experience of competitive multiplayer video games into recreational badminton. By using player ratings and automatic matchmaking, our application helps members find more balanced doubles games while maintaining the flexibility of drop-in sessions.

The shared matchmaking queue, match records, and player ratings also make this project a suitable application for exploring cloud computing, persistent storage, orchestration, and concurrent user interactions.

## 3. Objectives

The main objective of this project was to develop a self-service ranked matchmaking application for a weekly badminton group.

Our specific objectives were to:

- Provide secure, invitation-based player registration and authentication.
- Support solo and duo queues for balanced 2v2 matchmaking.
- Allow players to submit, confirm, and correct match scores.
- Update player ratings, leaderboards, and match history based on confirmed results.
- Provide automatic updates without requiring users to manually refresh the page.
- Maintain persistent application data across container restarts and redeployments.
- Deploy a containerized application on DigitalOcean using Docker Swarm with multiple application replicas.
- Provide system monitoring and administrative tools.

The project focuses on a single badminton group rather than a universal rating system or a multi-club platform.


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
