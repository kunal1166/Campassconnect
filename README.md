# CampusConnect — Full-stack Smart Campus Platform

A fresh full-stack implementation for UEM Kolkata with React + TypeScript frontend, Express + MongoDB backend, Socket.IO shuttle updates, optional Python CLIP image embeddings, and configurable MongoDB Local/Atlas connection.

## Project structure

```text
CampusConnect/
├── src/                    # React + TypeScript frontend
│   ├── services/api.ts      # Frontend ↔ Express API client
│   └── ...
├── server/                 # Express + TypeScript API
│   ├── src/config/          # MongoDB connection
│   ├── src/models/          # User, Item, Notification, Shuttle
│   ├── src/routes/          # Auth, items, notifications, shuttles
│   └── uploads/             # Uploaded item photos (local MVP storage)
├── ai-service/             # Optional Python CLIP image embedding service
└── README.md
```

## 1. Requirements

- Node.js 20 LTS or newer (Node 18.18+ should also work with the built-in `fetch`/`FormData` APIs).
- npm.
- MongoDB Community Server running locally **or** a MongoDB Atlas connection string.
- Python 3.10+ only if you want to run the optional CLIP service.

## 2. Choose Local MongoDB or MongoDB Atlas

The backend reads one environment variable: `MONGODB_URI`.

### Option A — Local MongoDB (your existing installation)

1. Start MongoDB Server service on Windows (Services → MongoDB Server → Start), or start `mongod` if installed as a standalone process.
2. In `server/`, copy `.env.example` to `.env`.
3. Keep this URI:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/campusconnect
```

MongoDB Compass connection string:

```text
mongodb://127.0.0.1:27017
```

The app creates/uses a database named `campusconnect`.

### Option B — MongoDB Atlas

1. Create a free Atlas cluster.
2. In Atlas → Database Access, create a database user and password.
3. In Atlas → Network Access, allow your current IP address (avoid `0.0.0.0/0` except for a temporary test).
4. Select Connect → Drivers and copy the Node.js connection string.
5. Put it in `server/.env`, URL-encode special characters in the password, and use a database name:

```env
MONGODB_URI=your_mongodb_connection_string
```

Only one `MONGODB_URI` is active at a time. To switch between Local and Atlas, change this one value and restart the backend. No source-code changes are needed.

## 3. Configure and run the backend

Open a terminal in the `server` folder:

```powershell
cd server
Copy-Item .env.example .env
npm install
npm run dev
```

Edit `server/.env` before running. Example local configuration:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/campusconnect
PORT=5000
CLIENT_URL=http://localhost:5173
JWT_SECRET=replace_with_a_long_random_secret
UPLOAD_DIR=uploads
AI_SERVICE_URL=http://127.0.0.1:8000
```

Expected startup message:

```text
MongoDB connected: 127.0.0.1/campusconnect
CampusConnect API running at http://localhost:5000
```

Health check: http://localhost:5000/api/health

## 4. Run the frontend

Open a second terminal at the project root (the folder containing the root `package.json`):

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open http://localhost:5173.

The frontend calls `http://localhost:5000/api` by default. To use another backend host, edit the root `.env`:

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

Restart Vite after changing `.env`.

## 5. Optional — enable actual CLIP image embeddings

The main app and Lost & Found APIs work without the Python service. If the CLIP service is not running, reports are still saved and matching falls back to text, category, location and date signals. The UI must not treat a context-only score as a CLIP visual score.

To enable CLIP:

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

The first run downloads `openai/clip-vit-base-patch32` from Hugging Face and may take time. PyTorch installation is large; CPU inference works, GPU/CUDA is optional. Keep this service running while creating item reports with photos.

Health check: http://127.0.0.1:8000/health

The Express API sends uploaded photos to the CLIP service, stores normalized embeddings in MongoDB, and ranks opposite-status reports. If the service is offline, image upload still works and context-only matching is used.

## 6. Features implemented

### Authentication
- Student and Driver registration/login.
- Password hashing with bcrypt.
- JWT authentication and `/api/auth/me`.
- Driver-only GPS endpoint (admin role supported by middleware).

### Lost & Found
- Create Lost and Found reports with optional image upload.
- MongoDB persistence and item search/filter API.
- Local image storage in `server/uploads`.
- Optional CLIP embeddings.
- Multi-signal candidate ranking: image (when both embeddings exist), text/category, location and report-time proximity.
- Candidate match notifications for authenticated reporters.
- Authenticated claim requests and reporter notification.
- Claim requests are requests only; students/admin must verify ownership before handing an item over.

### Shuttle tracking
- Three route definitions are seeded automatically (R1, R2, R3).
- Driver signs up using the **Driver** role, signs in, opens Shuttle Tracker and explicitly starts GPS sharing.
- Browser asks for location permission. GPS is sent to Express and persisted in MongoDB.
- Socket.IO broadcasts location updates to connected clients.
- Stale GPS detection emits a warning after 60 seconds without an update.
- GPS sharing works on localhost; for remote deployment browsers require HTTPS.
- ETA prediction is not yet a trained/historical model. The UI currently uses illustrative ETA values until route stop coordinates and enough real GPS history are configured.

### Notifications
- Authenticated notification list.
- Mark all notifications as read.
- Item report and candidate-match notifications.

### Campus Insights
- The analytics and hotspot view remains illustrative demo data until enough real campus events have been collected.

## 7. API overview

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/auth/register` | Register student/driver |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Current account |
| GET | `/api/items` | List/search reports |
| POST | `/api/items` | Create report (`multipart/form-data`) |
| GET | `/api/items/:id` | Report details |
| GET | `/api/items/:id/matches` | Ranked opposite-status candidates |
| POST | `/api/items/:id/claim` | Request to claim a found item |
| PATCH | `/api/items/:id/status` | Reporter/admin marks claimed/resolved |
| GET | `/api/notifications` | Current user's notifications |
| PATCH | `/api/notifications/read-all` | Mark all read |
| GET | `/api/shuttles` | Active routes and latest GPS |
| POST | `/api/shuttles/:code/location` | Driver GPS update (JWT Driver/Admin) |

## 8. Test flow

1. Confirm MongoDB is running and backend is connected.
2. Open the frontend and verify the connection banner says **Connected to CampusConnect API · MongoDB data**.
3. Register a Student account. Create a Lost or Found report and attach a photo.
4. Open MongoDB Compass → `campusconnect` → `items`; verify the record exists.
5. Register a second account with role **Driver** and sign in.
6. Open Shuttle Tracker → Start GPS sharing → allow browser location permission.
7. Check `shuttles` collection in Compass and open a second browser tab to see Socket.IO location events update the shuttle list.
8. For CLIP, start the Python service first, then upload photos to two opposite-status reports and call `/api/items/:id/matches` to inspect the candidate scores.

## 9. Important production notes

This is a functional student-project MVP, not a production security review. Before real college deployment:
- Require admin approval for Driver accounts (the MVP currently allows a user to select Driver during registration).
- Store uploads in managed object storage and validate/scan files.
- Add rate limiting, stricter validation, audit logs and HTTPS.
- Restrict claim details and verify ownership offline/through campus staff.
- Configure real campus stop coordinates and build ETA from GPS history.
- Replace illustrative dashboard analytics with database aggregations.
- Add a secure admin workflow for report moderation and account management.
