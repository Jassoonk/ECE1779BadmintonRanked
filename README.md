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

## 6. User Guide

### 6.1 Player Guide

#### Step 1: Register an Account

1. Open the application homepage.
2. Enter your email address, password, and display name.
3. Select a starting rank: Bronze (200), Silver (400), or Gold (600).
4. Click Register to create your account.

#### Step 2: Sign In and Access the Lobby

1. Sign in using your registered email address and password.
2. Enter the six-digit invite code provided by the administrator.
3. Click Verify code to access the matchmaking queue.

#### Step 3: Join the Matchmaking Queue

Players can choose between two queue modes:

- Solo Queue: Join individually and wait for the system to match you with three other players.
- Duo Queue: Select an online teammate and send an invitation. Once the teammate accepts, both players enter the queue together.

Players can click Cancel Queue to leave the queue before a match is created.

#### Step 4: Play the Match

Once a suitable match is found, the application displays both teams and their player ratings.

Players can then find an available court and play the badminton match. The match information is updated automatically without manually refreshing the page.

#### Step 5: Submit and Confirm the Score

1. After the match, enter your team's score and the opposing team's score.
2. Click Submit score.
3. A player from the opposing team reviews the submitted result.
4. Click Agree to confirm the score or Dispute to submit a corrected score.
5. If a correction is submitted, the other team must review it again.

Player ratings are updated only after the result is confirmed.

#### Step 6: View Rankings and Match History

The leaderboard displays players in descending order of their current ratings.

After a match is completed, the participating player's interface automatically refreshes the leaderboard and their displayed rating.

Click Match History to view the 10 most recent completed matches, including scores, team members, and rating changes.

### 6.2 Administrator Guide

The administrator dashboard can be accessed by adding /admin to the application URL.

1. Enter the administrator password to sign in.
2. Check the application and database health status.
3. View the current queue length and unfinished matches.
4. Monitor CPU, memory, disk, and network usage on both cloud nodes.
5. Modify individual player ratings when necessary.
6. Configure the six-digit lobby invite code before any player accounts are registered.

The administrator can also reset all player accounts and associated match data using the player deletion function. This operation is permanent and should only be used when a complete reset is required.

The queue length and current match information are automatically refreshed every two seconds. Cloud resource metrics are refreshed every 60 seconds.

## 7. Development Guide

### 7.1 Prerequisites

The following tools are required to run the application locally:

- Git
- Docker Engine or Docker Desktop
- Docker Compose V2
- A web browser

Node.js and PostgreSQL do not need to be installed separately on the host machine because both run inside Docker containers.

Cloud deployment additionally requires two DigitalOcean Droplets, Docker Swarm, DigitalOcean Block Storage, Nginx, and Certbot.

### 7.2 Local Development

#### Clone the Repository

Clone this repository and navigate to its root directory.

```bash
git clone <repository-url>
cd ECE1779BadmintonRanked
```

Replace `<repository-url>` with the GitHub repository URL.

#### Configure Environment Variables

Create a `.env` file in the repository root using your own administrator password and six-digit invite code:

```dotenv
ADMIN_PASSWORD=your-admin-password
INITIAL_INVITE_CODE=123456
```

The DigitalOcean API token is optional for local development. It is required only when retrieving DigitalOcean monitoring metrics.

```dotenv
DO_API_TOKEN=your-digitalocean-api-token
```

Do not commit the `.env` file or actual credentials to GitHub.

#### Build and Start the Application

With Docker running, execute:

```bash
docker compose up -d --build --wait
```

Docker Compose builds the application image, starts PostgreSQL, and waits for the database readiness check before starting the application.

The database schema is initialized automatically from `database/init.sql` when the database volume is empty.

#### Access the Application

Player interface:

http://localhost:3000

Administrator dashboard:

http://localhost:3000/admin

#### Verify the Local Deployment

Check the container status:

```bash
docker compose ps
```

Check application health:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{"status":"ok"}
```

Check database health:

```bash
curl http://localhost:3000/db-health
```

Expected response:

```json
{"status":"ok","database":"connected"}
```

View application and database logs:

```bash
docker compose logs app
docker compose logs db
```

#### Stop and Restart the Application

Stop and remove the containers:

```bash
docker compose down
```

Restart the application:

```bash
docker compose up -d --build --wait
```

PostgreSQL data is retained in the named volume across container recreation.

Do not use `docker compose down -v` unless a complete database reset is intended, because this command removes the persistent database volume.

### 7.3 Cloud Infrastructure

The production environment is deployed on DigitalOcean using a two-node Docker Swarm cluster.

| Component | Configuration |
|---|---|
| Manager Node | badminton-manager |
| Worker Node | badminton-worker |
| Operating System | Ubuntu |
| Stack Name | badminton_ranked |
| Application Image | badminton-ranked:demo-ready |
| Application Replicas | 2 |
| PostgreSQL Replicas | 1 |
| Persistent Storage | 10 GB DigitalOcean Block Storage |
| Volume Filesystem | ext4 |
| Volume Mount Point | /mnt/badminton_data |
| Database Data Directory | /mnt/badminton_data/postgres-demo |
| Application Port | 3000 |
| Public HTTP Port | 80 |
| Public HTTPS Port | 443 |

The manager and worker nodes communicate through the Swarm network. The PostgreSQL service is restricted to the manager node, where the persistent storage is attached.

### 7.4 Docker Swarm Deployment

The following steps describe how to reproduce the cloud deployment on a new environment.

#### Step 1: Prepare the Cloud Nodes

Create two Ubuntu Droplets on DigitalOcean and install Docker Engine on both nodes.

Configure their hostnames as follows:

- Manager: badminton-manager
- Worker: badminton-worker

The manager hostname must match the database placement constraint in stack.yaml.

Configure the firewall to allow SSH from trusted sources, public HTTP and HTTPS traffic, and the required Swarm communication between trusted cluster nodes.

Docker Swarm requires TCP port 2377, TCP and UDP port 7946, and UDP port 4789 for cluster communication. These ports should not be exposed to untrusted public traffic.

Restrict public access to port 3000 so that users access the application through Nginx.

#### Step 2: Initialize Docker Swarm

On the manager node, initialize Swarm using its private IP address:

```bash
docker swarm init --advertise-addr <manager-private-ip>
```

Retrieve the worker join command:

```bash
docker swarm join-token worker
```

Run the generated join command on the worker node.

Verify the cluster from the manager:

```bash
docker node ls
```

Both nodes should show Ready and Active.

#### Step 3: Prepare Persistent Storage

Create and attach a DigitalOcean Block Storage Volume to the manager Droplet.

Configure the volume to use the ext4 filesystem and mount it at:

```text
/mnt/badminton_data
```

Verify that the volume is mounted:

```bash
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS
mountpoint /mnt/badminton_data
```

Only after confirming that the volume is mounted, create the database data directory:

```bash
sudo mkdir -p /mnt/badminton_data/postgres-demo
```

The database service bind-mounts this directory to /var/lib/postgresql/data inside the PostgreSQL container.

The volume should remain mounted across host restarts.

#### Step 4: Prepare the Application Image

Clone the repository on both nodes and ensure that both use the same source code revision.

From the repository root on each node, build the application image:

```bash
docker build -t badminton-ranked:demo-ready .
```

Verify that the image is available on both nodes:

```bash
docker image ls badminton-ranked
```

For this small two-node cluster, the application image can be built locally on both nodes without requiring a separate container registry.

#### Step 5: Create Docker Secrets

The Swarm deployment requires four external secrets:

| Secret Name | Purpose |
|---|---|
| badminton_admin_password | Administrator authentication |
| badminton_db_password | PostgreSQL authentication |
| badminton_invite_code | Initial six-digit lobby invite code |
| do_api_token | DigitalOcean Monitoring API access |

Prepare a separate file for each credential outside the Git repository. Restrict access to these files and do not commit them to version control.

On the manager node, create the secrets using the credential files:

```bash
docker secret create badminton_admin_password /secure/path/admin_password
docker secret create badminton_db_password /secure/path/db_password
docker secret create badminton_invite_code /secure/path/invite_code
docker secret create do_api_token /secure/path/do_api_token
```

Replace the example file paths with the actual secure credential file locations.

Verify that all four secrets exist:

```bash
docker secret ls
```

These commands are intended for a new deployment. Existing secrets do not need to be recreated.

#### Step 6: Configure Monitoring

The monitoring backend retrieves metrics for the manager and worker Droplets using their DigitalOcean Droplet IDs.

For a new deployment, update the two Droplet IDs in the /admin/monitoring route in app.js before building the application image on both nodes.

DigitalOcean Monitoring must be enabled on both Droplets, and the API token must have the required monitoring permissions.

#### Step 7: Deploy the Stack

On the manager node, navigate to the repository root and configure the deployment variables:

```bash
export APP_IMAGE=badminton-ranked:demo-ready
export DB_DATA_DIR=/mnt/badminton_data/postgres-demo
```

Deploy the application:

```bash
docker stack deploy --resolve-image never -c stack.yaml badminton_ranked
```

The stack configuration creates two application replicas and one PostgreSQL replica.

The application replicas are distributed across the manager and worker nodes, while PostgreSQL remains on the manager node.

#### Step 8: Verify the Deployment

Check the deployed stack and services:

```bash
docker stack ls
docker service ls
```

Check application replica placement:

```bash
docker service ps badminton_ranked_app
```

Check database placement:

```bash
docker service ps badminton_ranked_db
```

Verify the database storage configuration:

```bash
docker service inspect badminton_ranked_db --format '{{json .Spec.TaskTemplate.ContainerSpec.Mounts}}'
```

The expected configuration is two running application replicas, one running database replica, and a database bind mount backed by the DigitalOcean volume.


### 7.5 HTTPS Configuration

After deploying the Docker Swarm stack, configure HTTPS on the manager Droplet. Allow inbound TCP ports 80 and 443. Run the following commands from the repository root in the same SSH session.

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

### 7.6 Verification and Troubleshooting

#### Check Service Status

```bash
docker node ls
docker service ls
docker service ps badminton_ranked_app
docker service ps badminton_ranked_db
```

#### Check Application and Database Logs

```bash
docker service logs --tail 50 badminton_ranked_app
docker service logs --tail 50 badminton_ranked_db
```

#### Verify Nginx and HTTPS

```bash
sudo nginx -t
systemctl is-active nginx
```

Check the application and database health endpoints:

```bash
curl https://YOUR_DROPLET_IP/health
curl https://YOUR_DROPLET_IP/db-health
```

Check HTTP redirection:

```bash
curl -I http://YOUR_DROPLET_IP
```

The HTTP endpoint should return a 308 Permanent Redirect to HTTPS.

#### Check Certificate Renewal

```bash
sudo /snap/bin/certbot certificates
systemctl list-timers --all '*certbot*'
```

The HTTPS certificate must remain valid throughout the grading period.

#### Deployment Verification Results

On November 27, 2026, we inspected the deployed cloud environment and confirmed the following:

| Verification | Observed Result |
|---|---|
| Swarm cluster | Both nodes were Ready and Active |
| Application replication | 2/2 replicas running |
| Database service | 1/1 replica running |
| Application placement | One replica on each node |
| Database placement | Running on badminton-manager |
| Persistent storage | 10 GB ext4 volume mounted |
| Docker Secrets | All four required secrets present |
| Nginx configuration | Configuration test successful |
| Nginx service | Active |
| Application health | Status OK |
| Database health | Status OK |
| HTTP redirection | 308 Permanent Redirect |
| HTTPS certificate | Valid at the time of inspection |
| Certificate renewal | Renewal timer scheduled |

These checks confirm the deployment configuration and its operational status at the time of inspection. They do not by themselves establish performance, full fault tolerance, or successful certificate renewal.

### 7.7 Deployment Credentials

Sensitive deployment credentials are not included in the public source code.

Local development uses environment variables, while the cloud deployment uses Docker Swarm Secrets.

The credentials required for grading will be provided separately to the teaching assistant according to the course submission instructions.

## 8. Deployment Information

The application is deployed on DigitalOcean using a two-node Docker Swarm cluster.

- Live Application: [https://143.110.209.50](https://143.110.209.50)
- Admin Dashboard: [https://143.110.209.50/admin](https://143.110.209.50/admin)
- Application Health: [https://143.110.209.50/health](https://143.110.209.50/health)
- Database Health: [https://143.110.209.50/db-health](https://143.110.209.50/db-health)

The deployment runs two application replicas and one PostgreSQL replica across a manager and a worker node. PostgreSQL data is stored on a 10 GB DigitalOcean Block Storage Volume attached to the manager node.

Public traffic is served through Nginx over HTTPS. The credentials required for testing the application and administrator features are provided separately according to the course submission instructions.

The deployment will remain online throughout the grading period.

