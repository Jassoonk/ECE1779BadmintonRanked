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

- Provide secure player registration, authentication, and invite-code-based lobby access.
- Support solo and duo queues for balanced 2v2 matchmaking.
- Allow players to submit, confirm, and correct match scores.
- Update player ratings, leaderboards, and match history based on confirmed results.
- Provide automatic updates without requiring users to manually refresh the page.
- Maintain persistent application data across container restarts and redeployments.
- Deploy a containerized application on DigitalOcean using Docker Swarm with multiple application replicas.
- Provide system monitoring and administrative tools.

The project focuses on a single badminton group rather than a universal rating system or a multi-club platform.

## 4. Technical Stack

We selected technologies that meet the cloud computing requirements while keeping the application simple to develop, deploy, and maintain.

| Component | Technology | Purpose |
|---|---|---|
| Frontend | HTML5, CSS, Bootstrap 5.3.9, Vanilla JavaScript | Provides the player interface, leaderboard, match history, and admin dashboard. |
| Backend | Node.js 24, Express 5 | Handles HTTP requests, REST APIs, and application logic. |
| Database | PostgreSQL 17 | Stores player accounts, ratings, queue entries, and match records. |
| Database Client | node-postgres (pg) | Connects the backend to PostgreSQL and executes SQL queries. |
| Containerization | Docker | Packages the application and its dependencies into a consistent runtime environment. |
| Local Development | Docker Compose | Manages the application and database services for local development. |
| Orchestration | Docker Swarm | Manages service deployment, application replicas, load balancing, and task recovery. |
| Persistent Storage | Docker Named Volume and DigitalOcean Block Storage | Preserves database records independently of the container lifecycle. |
| Cloud Infrastructure | DigitalOcean Droplets | Hosts the two-node Docker Swarm cluster. |
| Reverse Proxy | Nginx | Forwards incoming HTTPS requests to the application. |
| HTTPS | Let's Encrypt and Certbot | Provides encrypted connections and certificate management. |
| Secret Management | Docker Swarm Secrets | Protects database credentials, admin credentials, invite codes, and the monitoring API token. |
| Real-Time Updates | HTTP Polling and Fetch API | Updates application information without requiring manual page refreshes. |
| Monitoring | DigitalOcean Monitoring API and Health Endpoints | Provides server resource metrics, application health, and database health information. |
| Version Control | Git and GitHub | Supports team collaboration, code reviews, and version management. |

We chose plain HTML, CSS, and JavaScript instead of a frontend framework to reduce development complexity. The frontend assets are served by the Express backend, allowing both components to run within a single application container.

Docker Compose is used for local development, while Docker Swarm manages the cloud deployment. Two application replicas share a single PostgreSQL database, with persistent storage attached to the designated database node.

Compared with our original proposal, we replaced the planned WebSocket-based communication with HTTP polling. This simplified the implementation while still allowing automatic updates. Queue length and current matches are refreshed every two seconds on the admin dashboard, while resource metrics are refreshed every 60 seconds to avoid unnecessary API requests.

This technical stack focuses on meeting the project requirements without introducing unnecessary services or infrastructure.

## 5. Features

### 5.1 Application Features

#### Player Registration and Authentication

Players can register using their email address, password, display name, and starting rank. Bronze, Silver, and Gold correspond to initial ratings of 200, 400, and 600, respectively. Registered players can sign in and access the matchmaking lobby after verifying a six-digit invite code.

#### Solo and Duo Queue

Players can enter the solo queue individually or invite an online player to form a duo. A duo enters the queue only after the invited player accepts. Invitations expire after three minutes. Players can also cancel their queue entry before a match is created.

The backend checks whether a player is already invited, queued, or participating in an unfinished match to prevent conflicting actions.

#### Doubles Matchmaking

The matchmaking algorithm searches up to 12 of the oldest eligible queued parties. It uses backtracking to find a group of four players and compares possible team combinations based on their average ratings.

A match is created only when the difference between the two teams' average ratings is no greater than 50. Players who enter as a duo remain on the same team.

This approach provides a simple way to improve match balance while prioritizing earlier queue entries. However, it does not guarantee a globally optimal match across the entire queue.

#### Score Submission and Confirmation

After a match, a player can submit the final score. A player from the opposing team must confirm the score before ratings are updated.

If the opposing team disagrees, they can submit a corrected score for further review. This process continues until both teams agree on the result.

The match progresses through four possible states: active, pending confirmation, pending correction, and completed.

#### Rating System and Leaderboard

The application uses an Elo-based rating system with a K-factor of 32. The expected result is calculated using the average ratings of the two teams.

The expected winning probability is:

E = 1 / (1 + 10^((R_opponent - R_team) / 400))

Each player's updated rating is calculated as:

R_new = R_old + 32(S - E)

Here, S is 1 for a win and 0 for a loss. The updated rating is rounded to an integer and cannot fall below zero.

Ratings are updated only after score confirmation. The leaderboard displays players in descending order of their current ratings.

#### Match History

Players can view the 10 most recent completed matches, including the team members, final scores, completion time, and individual ratings before and after each match.

#### Admin Dashboard

The admin dashboard provides tools for managing the application and monitoring the system. Administrators can:

- View the current queue length and unfinished matches.
- View and modify player ratings.
- Check application and database health.
- Monitor resource usage on both Droplets.
- Configure the lobby invite code before player registration.
- Reset player accounts and associated match data when necessary.

Administrative operations require a valid admin session token.

### 5.2 Cloud Computing Features

#### Containerization

The application uses Docker to package the Node.js backend, production dependencies, and frontend assets into a single container image.

The Dockerfile uses the Node.js 24 Alpine base image and installs dependencies through npm ci using the package lockfile. The application runs as a non-root user to reduce unnecessary privileges.

PostgreSQL runs in a separate container using the PostgreSQL 17 Alpine image.

For local development, Docker Compose manages both services. The application connects to PostgreSQL through the service name db. A database readiness check prevents the application from starting before PostgreSQL is ready.

#### Stateful Persistence

PostgreSQL stores player accounts, sessions, invitations, queue entries, match results, and rating history.

In the local environment, database files are stored in a Docker named volume. In the cloud environment, the database data directory is bind-mounted to a DigitalOcean Block Storage Volume.

This separates persistent data from the database container lifecycle. Database records can therefore be retained when the container is recreated, provided that the underlying storage remains available.

The same database initialization script is used for both local development and cloud deployment.

#### Orchestration and Replication

The cloud deployment uses Docker Swarm with two DigitalOcean Droplets: one manager and one worker.

The application service is configured with two replicas, with a maximum of one replica per node. Swarm's ingress routing mesh distributes incoming requests across the available application replicas.

Both replicas connect to the same PostgreSQL service. Player and admin sessions are stored in PostgreSQL rather than application memory, allowing requests to be handled by different replicas without requiring sticky sessions.

The PostgreSQL service runs as a single replica with a placement constraint that keeps it on the manager node, where the persistent storage is mounted.

Application replication improves availability during individual application container failures. However, the single PostgreSQL instance and manager-hosted infrastructure remain potential single points of failure.

#### Data Consistency and Concurrency Control

Multiple application replicas may receive matchmaking or score confirmation requests simultaneously. To maintain consistent shared state, the backend uses PostgreSQL transactions and transaction-level advisory locks to serialize critical lobby operations.

Match and player records are also locked using SELECT FOR UPDATE during result confirmation. Changes are committed together, and failed operations are rolled back.

A partial unique index prevents a player from belonging to more than one unfinished match. Match status validation also prevents completed matches from updating player ratings again.

These mechanisms provide both application-level and database-level protection against conflicting operations.

The shared advisory lock simplifies concurrency control but limits the number of critical lobby operations that can execute simultaneously. This is an acceptable trade-off for our small weekly badminton group.

#### Monitoring and Observability

The application provides two separate health endpoints:

- /health checks whether the application server is responding.
- /db-health checks whether PostgreSQL can execute a database query.

Docker Swarm uses the application health endpoint to monitor application containers.

The admin dashboard retrieves resource metrics for both the manager and worker Droplets through the DigitalOcean Monitoring API. The displayed metrics include CPU usage, memory usage, root filesystem disk usage, and inbound and outbound network traffic.

The backend retrieves the most recent 10 minutes of monitoring data and processes the latest available values. Multiple metric requests are performed in parallel.

Resource metrics are refreshed every 60 seconds, while the current queue length and unfinished matches are refreshed every two seconds.

Application logs and error messages provide additional information for troubleshooting.

#### Real-Time Functionality

Instead of the WebSocket-based communication proposed initially, the final application uses HTTP polling to provide near-real-time updates.

The player interface sends requests every two seconds when no user action is in progress. A presence heartbeat updates the player's online status, followed by a request for the latest invitation, queue, and match state.

The backend queries PostgreSQL and returns the current information. The frontend updates the relevant page elements without requiring a manual refresh.

When the player's match is completed, the frontend automatically reloads the leaderboard and the player's displayed rating.

The player interface also prevents overlapping refresh requests and preserves score input while polling.

Polling was selected because it is simpler to implement across multiple application replicas and does not require a separate WebSocket communication infrastructure. Its main limitations are repeated HTTP requests and a short delay between a state change and the next refresh.

#### Security Enhancements

Several security measures are implemented to protect player accounts, administrative operations, and deployment credentials.

Player passwords are processed using scrypt with a randomly generated salt. The derived password keys and salts are stored instead of plaintext player passwords.

Player and admin sessions use randomly generated tokens with an eight-hour expiration. Only SHA-256 token hashes are stored in PostgreSQL.

Player sessions use HttpOnly cookies with SameSite protection. Secure cookies are enabled in the production environment. Admin requests use bearer tokens, which are verified by authorization middleware.

The matchmaking lobby requires a valid six-digit invite code. The verification status is stored with the player's session.

Sensitive deployment credentials are supplied through Docker Swarm Secrets, including the database password, admin password, initial invite code, and DigitalOcean API token.

Nginx acts as a reverse proxy and terminates HTTPS connections using a Let's Encrypt certificate managed by Certbot. HTTP requests are redirected to HTTPS, and application traffic is forwarded to the Swarm-published application port.

The Swarm configuration also requires public access to port 3000 to be restricted through the DigitalOcean firewall so that external application traffic uses HTTPS.

These measures provide basic security for the intended small-group application, although the system has not undergone a comprehensive security audit.


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
