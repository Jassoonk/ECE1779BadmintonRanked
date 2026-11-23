# Badminton Ranked: Cloud-Native Matchmaking for a Weekly Drop-in Group

Team Members: Molin Li, Jason Wei

## 1. Motivation

Our project begins with one existing badminton group that meets for an informal weekly drop-in. Members arrive when available and usually join whoever is ready for an open court, without anyone routinely organizing matches. This flexibility makes the group social and accessible, but random pairings often produce uneven games. Players may face opponents far above or below their skill level, making sessions less competitive and enjoyable. Finding four similarly skilled players is difficult when people arrive and leave at different times, and the group has no consistent record of match results.

Members also lack a simple way to quantify their skill and track improvement. Informal labels such as “intermediate” and “advanced” are subjective; match-based ratings could provide more consistent feedback within the group. Eventually, the concept could expand to other clubs and cities, allowing players to develop portable skill profiles. This is a future possibility, not part of this project: ratings from separate groups would require validation and calibration before meaningful comparisons could be made.

The intended users are members of this specific weekly group. A self-service ranked lobby will help them find balanced doubles games without an on-site coordinator. One trusted administrator will issue invitations and resolve occasional disputes, but normal play requires no organizer. The immediate goal is a more engaging drop-in experience and a record of individual progress—not a universal rating system or multi-club platform. Concurrent changes to the shared queue, match records, and rankings also make this a suitable stateful cloud-native application.

## 2. Objectives, Architecture, and Key Features

### 2.1 Core Application Scope

We will build a small, invite-only web matchmaking application for one weekly badminton group. It will resemble ranked modes in multiplayer video games, adapted to in-person badminton. Members register through invitation links and select an initial Bronze, Silver, or Gold rank, which maps to a starting matchmaking rating (MMR). Verified results update ratings across weekly sessions.

During the drop-in, a member opens the lobby and joins a solo queue or invites another member into a duo queue. A duo enters only after both players accept. The backend forms doubles matches from four available players, keeps duo partners together, and prevents duplicate assignments. A simple rating-based rule is sufficient for the first version. Players find a free court themselves; court reservations, attendance scheduling, and multiple concurrent lobbies are outside scope.

After a game, one team submits the score, which the opposing team must confirm. If they disagree, they can propose a corrected score for the first team to confirm; this continues until both teams agree. Finalization updates MMR and match/rating history. WebSockets push verified results, leaderboard changes, recent match history, queue status, and match assignments to connected players without manual refresh.

### 2.2 Architecture and Required Technologies

**Application and local development — Docker / Docker Compose:** HTML, CSS, vanilla JavaScript, and Bootstrap will provide a simple frontend served directly by Node.js/Express, without a frontend framework or build process. PostgreSQL runs separately. Docker containerizes both services, and Docker Compose starts them locally with environment-based configuration. Keeping the frontend and API together reduces deployment complexity.

**State management — PostgreSQL and persistent storage:** PostgreSQL will store users, invitations, queue entries, duo membership, matches, score submissions, MMR, and rating history. Constraints, transactions, and locking will prevent duplicate assignments and repeated rating updates. In production, PostgreSQL will use a DigitalOcean Block Storage Volume mounted on its designated host. We will test that records survive database container recreation and redeployment. This single-database setup is not fully highly available, a tradeoff accepted for the short timeline.

**Cloud provider — DigitalOcean:** Two Ubuntu Droplets will communicate through private networking, with a public HTTPS endpoint. A reverse proxy such as Caddy will terminate HTTPS and forward requests. This requires more configuration than managed hosting but lets us implement the required orchestrator directly.

**Orchestration — Docker Swarm:** One Droplet will be the manager and the other a worker. Two application replicas will run across the nodes using Swarm service discovery and ingress load balancing. PostgreSQL will run as one stateful service constrained to the volume's host. Swarm will replace failed application tasks. Queue and rating state will remain in PostgreSQL, not server memory. Each replica will subscribe to PostgreSQL `LISTEN/NOTIFY` and forward relevant changes to connected clients, avoiding a separate Redis service.

**Monitoring and observability:** DigitalOcean Monitoring will track CPU, memory, disk, and network usage, with at least one resource alert. Application logs and a `/health` endpoint will support troubleshooting. Queue length, match-creation latency, and request errors will provide additional evaluation measurements.

### 2.3 Advanced Features

**Security enhancements:** Invitation-based registration, password hashing, authenticated endpoints, administrator-versus-player authorization, HTTPS, and protected deployment secrets will restrict unauthorized access and protect results.

**Real-time functionality:** Socket.IO, using WebSocket-only connections, will deliver queue status, duo invitations, match assignments, score-confirmation status, and leaderboard updates. PostgreSQL `LISTEN/NOTIFY` will coordinate changes across API replicas. PostgreSQL remains the source of truth; reconnecting clients will reload current state to recover missed updates.

### 2.4 Planned Evaluation

We will evaluate the project through functional testing and basic cloud-system testing.

For functional testing, we will use multiple browser sessions to simulate players registering, joining queues, receiving match assignments, submitting scores, and checking updated MMR rankings. We will verify that players cannot join multiple active matches, disputed scores do not update rankings, and each confirmed match updates MMR only once.

For cloud-system testing, we will check whether PostgreSQL data remains available after restarting and recreating its container. We will also test whether the application continues responding when one backend replica stops. To evaluate real-time functionality, we will open multiple browser sessions and check whether queue status, match assignments, and leaderboard changes are delivered correctly through WebSockets, including when users are connected to different backend replicas. We will also verify Swarm service replication and load balancing.

We will perform basic concurrent-request tests and use DigitalOcean Monitoring to observe CPU and memory usage. Screenshots, logs, and test results will be collected as evidence. Our evaluation will focus on correctness, reliability, and required cloud features rather than advanced matchmaking performance.

## 3. Project Plan and Team Responsibilities

We plan to complete the project in four weeks, focusing on a working application and the required cloud computing features rather than adding too many optional functions.

### Project Development Plan

**Week 1 (November 7–13) — Basic Setup:** Finalize the main features, create a shared GitHub repository, design the PostgreSQL database, and set up the Node.js/Express backend using Docker Compose. Build a simple frontend using HTML, CSS, JavaScript, and Bootstrap, and test communication between the frontend, backend, and database.

**Week 2 (November 14–20) — Core Features:** Implement invitation-based registration, solo queue management, basic doubles matchmaking, score submission and confirmation, and a simple MMR update system. Add duo queuing after the basic solo queue works. Connect these features to the database and test the main workflow locally.

**Week 3 (November 21–27) — Cloud Deployment and Real-Time Features:** Deploy the application to DigitalOcean using Docker Swarm. Configure backend replicas, PostgreSQL persistent storage, HTTPS, and basic monitoring. Implement Socket.IO for real-time updates of queue status, match assignments, and leaderboards, using PostgreSQL `LISTEN/NOTIFY` to synchronize updates between backend replicas. Aim to have a working demonstration ready before November 24.

**Week 4 (November 28–December 5) — Testing and Final Delivery:** Complete real-time integration and perform basic security checks. Test database persistence, backend replica recovery, concurrent queue requests, and score confirmation to ensure MMR updates only once per match. Fix major issues, collect monitoring and testing results, and prepare the final report and demonstration video.

### Team Responsibilities

As a two-person team, we plan to divide the work into two main areas:

**Molin — Backend and Database:** Responsible for the Node.js/Express backend, PostgreSQL database design, REST APIs, queue management, and basic Docker Compose setup.

**Jason — Frontend and Cloud Deployment:** Responsible for the frontend interface, basic matchmaking and ranking logic, DigitalOcean deployment, Docker Swarm configuration, and system monitoring.

Both members will work together on Socket.IO real-time functionality, security checks, system integration, testing, documentation, and the final presentation. Responsibilities may be adjusted based on progress and technical challenges.

### Integration and Potential Risks

We will use a shared GitHub repository and agree on the database structure and API endpoints before developing separate components. We will test frontend and backend integration throughout development rather than waiting until the end.

The main risks include limited development time, cloud deployment issues, data conflicts caused by simultaneous queue requests, and real-time communication between backend replicas. To reduce these risks, we will prioritize the basic workflow, use PostgreSQL transactions to maintain consistency, and begin cloud deployment early. We will keep matchmaking rules simple and focus real-time functionality on queue status, match assignments, and leaderboard updates. Additional features will only be considered after the core system works reliably.

## 4. Initial Team Reasoning and AI-Assisted Exploration

### 4.1 Initial Team Reasoning

Both team members enjoy competitive multiplayer video games, and Jason is particularly passionate about badminton. The project idea emerged after Jason became frustrated with the skill mismatches and lack of competitiveness during a weekly badminton drop-in. We wanted to bring a ranked matchmaking experience, similar to those found in competitive video games, into recreational badminton while preserving the flexibility of drop-in sessions.

Our initial understanding was that the system would need a central server that players could connect to for matchmaking. The server would handle queue requests, assign matches, and calculate new MMR values after each game. A database would store player accounts, ratings, and match history so that progress could be tracked over time.

However, neither of us had experience with web development. We were unsure which frontend technologies to use, such as React or plain HTML, CSS, and JavaScript. We also identified several areas requiring further investigation, including frontend–backend integration, user authentication and security, real-time communication between players and the server, and how to make the application accessible through a public URL.

### 4.2 Exploration and Evaluation

Through course assignments, we gained familiarity with containerization, cloud deployment, and client–server communication using Node.js and Express. We understood that HTTP requests could be handled through routes similar to those implemented in `app.js` in our assignments, while PostgreSQL and cloud volumes could provide persistent storage. This gave us a starting point for translating our idea into a cloud-native application.

Initially, we considered Fly.io because we had already used it in coursework and it provides a public URL with minimal configuration. During AI-assisted exploration, we compared Fly.io and DigitalOcean against the project's technical requirements. We realized that although Fly.io simplifies deployment, its built-in orchestration does not satisfy the course requirement to implement Docker Swarm or Kubernetes. Running our own orchestrator on Fly.io would introduce additional complexity.

Rather than accepting the simplest hosting option, we prioritized meeting the course requirements with a manageable implementation. We therefore chose DigitalOcean with Docker Swarm and planned to configure our own public HTTPS endpoint. We also favored a simple HTML, CSS, JavaScript, and Bootstrap frontend over React to reduce the learning overhead. These decisions reflect our preference for a focused application that demonstrates the required cloud technologies without unnecessary complexity.
