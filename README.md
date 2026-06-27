# 🛟 Last-Minute Life Saver

An AI-powered productivity companion that helps students and professionals avoid missing deadlines — assignments, exams, meetings, interviews, bill payments, and more. Powered by **Google Gemini**, it doesn't just remind you of tasks — it actively re-prioritizes them, builds your daily schedule, gives you actionable recommendations, and creates an **Auto Rescue Plan** when a deadline is closing in fast.

---

## ✨ Features

| Feature | Description |
|---|---|
| 📊 **Dashboard** | Responsive control-panel UI with stat cards, sidebar navigation, and mobile support |
| ✅ **Task Management** | Full CRUD — add, edit, delete, mark complete. Stored in SQLite |
| 🧠 **AI Prioritization** | Gemini analyzes all pending tasks and assigns High / Medium / Low priority |
| 🗓️ **AI Schedule Generator** | Gemini builds a realistic timetable for the rest of the day |
| 💡 **AI Recommendations** | Gemini tells you what to do first and how to allocate your time |
| ⚠️ **Smart Deadline Alerts** | Automatic warning banner for tasks due within 24 / 12 / 6 hours |
| 🚨 **Auto Rescue Mode** | Breaks a near-deadline task into subtasks with time estimates and a completion verdict |
| 🎤 **Voice Input** | Add tasks by speaking, using the browser's Web Speech API |
| 📈 **Productivity Analytics** | Total / completed / pending tasks and productivity percentage |

---

## 🗂️ Project Structure

```
project/
│
├── static/
│   ├── style.css          # All styling (responsive, mission-control theme)
│   └── script.js          # All frontend logic (CRUD, AI calls, voice input)
│
├── templates/
│   └── index.html         # Single-page dashboard
│
├── app.py                 # Flask backend + SQLite + Gemini integration
├── database.db            # SQLite database (auto-created on first run)
├── requirements.txt       # Python dependencies
├── .env                   # Environment variables (Gemini API key, etc.)
└── README.md              # This file
```

---

## 🧰 Tech Stack

- **Frontend:** HTML, CSS, vanilla JavaScript (Web Speech API for voice)
- **Backend:** Python Flask
- **Database:** SQLite (via Python's built-in `sqlite3` module)
- **AI:** Google Gemini (via the official `google-genai` SDK)

> **Note:** This project uses the current, actively-maintained `google-genai` Python package. The older `google-generativeai` package has been fully deprecated by Google and is intentionally **not** used here.

---



### 1. Create a virtual environment (recommended)
```bash
python3 -m venv venv
source venv/bin/activate        # On Windows: venv\Scripts\activate
```

### 2. Install dependencies
```bash
pip install -r requirements.txt
```

### 3. Set up your Gemini API key
1. Get a free key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Open `.env` and replace the placeholder:
   ```
   GEMINI_API_KEY=MY_actual_key
   ```

### 4. Run the app
```bash
python app.py
```
The app will start on **http://localhost:5000**. The SQLite database (`database.db`) is created automatically on first run.

### 5. Open it in your browser
Go to `http://localhost:5000` — add a few tasks, then try **AI Prioritize**, **Generate Schedule**, **Get Recommendations**, and **🚨 Rescue** on a task due soon.

> 🎤 Voice input requires a Chromium-based browser (Chrome/Edge) since Web Speech API support varies across browsers.

---

## 🔌 API Routes Reference

### Task CRUD
| Method | Route | Description |
|---|---|---|
| GET | `/api/tasks` | List all tasks (includes computed `hours_left` and `urgency`) |
| POST | `/api/tasks` | Create a task (`title`, `description`, `deadline`, `category`) |
| PUT | `/api/tasks/<id>` | Update any subset of task fields |
| DELETE | `/api/tasks/<id>` | Delete a task |
| PATCH | `/api/tasks/<id>/complete` | Mark a task as complete |
| GET | `/api/analytics` | Total / completed / pending counts and productivity % |

### AI Routes (Gemini-powered)
| Method | Route | Description |
|---|---|---|
| POST | `/prioritize` | Re-prioritizes all pending tasks (High/Medium/Low) |
| POST | `/schedule` | Generates today's timetable as a list of time blocks |
| POST | `/recommend` | Returns ordered recommendations + time allocations |
| POST | `/rescue` | Body: `{"task_id": <id>}` — returns a step-by-step recovery plan |

All AI routes return clean JSON error messages (HTTP 502) if the Gemini API key is missing or the call fails, so the frontend can show a friendly error instead of crashing.

---

## 🗄️ Database Schema

```sql
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    deadline TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    priority TEXT DEFAULT 'Unranked',
    status TEXT DEFAULT 'Pending',
    created_at TEXT NOT NULL
);
```

---

## ☁️ Deploying to Google Cloud Run

Google Cloud Run is a great fit for this app because Flask + Gunicorn run in a container, it scales to zero, and you only pay for what you use.

### Prerequisites
- A Google Cloud project with billing enabled
- The [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated (`gcloud init`)
- Your Gemini API key

### Step 1 — Add a `Dockerfile`
Create a file named `Dockerfile` in the project root:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "app:app"]
```

### Step 2 — Add a `.gcloudignore` (optional but recommended)
```
venv/
__pycache__/
*.pyc
.env
database.db
```

> ⚠️ Your local `database.db` will **not** persist across Cloud Run deployments or restarts, since each instance gets its own ephemeral filesystem. For production use, swap SQLite for a managed database like Cloud SQL, or mount a Cloud Storage-backed volume. For demos and hackathons, the ephemeral SQLite file is fine.

### Step 3 — Authenticate and set your project
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### Step 4 — Enable required services
```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

### Step 5 — Build and deploy directly from source
Cloud Run can build your container for you with a single command:

```bash
gcloud run deploy last-minute-life-saver \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=YOUR_GEMINI_API_KEY,GEMINI_MODEL=gemini-2.5-flash,FLASK_DEBUG=false
```

- `--source .` tells Cloud Run to build the container from your Dockerfile using Cloud Build.
- `--allow-unauthenticated` makes the app publicly accessible (remove this flag if you want to restrict access).
- `--set-env-vars` passes your Gemini API key securely as an environment variable instead of committing it to `.env`.

### Step 6 — Get your live URL
After deployment finishes, gcloud prints a URL like:
```
Service [last-minute-life-saver] revision [...] has been deployed and is serving 100 percent of traffic.
Service URL: https://last-minute-life-saver-xxxxx-uc.a.run.app
```
Open that URL — your app is live! 🎉

### Step 7 — (Recommended) Store the API key in Secret Manager instead
For production, avoid plain env vars for secrets:
```bash
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-

gcloud run deploy last-minute-life-saver \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

### Updating your deployment
Whenever you change code, just re-run the same `gcloud run deploy` command — Cloud Run rebuilds and redeploys a new revision automatically with zero downtime.

---

## 🧠 How the "Agentic" AI Works

This app goes beyond simple reminders — Gemini is used as an active decision-making layer:

1. **`/prioritize`** sends Gemini the full list of pending tasks (title, description, deadline, category) and asks it to reason about urgency *and* workload, not just the raw deadline — then the result is written back into the database so the new priorities persist.
2. **`/schedule`** asks Gemini to actually plan the rest of the user's day, choosing time blocks and ordering based on urgency.
3. **`/recommend`** asks Gemini to produce an ordered action list with time budgets — effectively a coach, not a calendar.
4. **`/rescue`** is triggered automatically in the UI whenever a task is within 24 hours of its deadline. Gemini decomposes the task into concrete sub-steps with time estimates and gives an honest "achievable / not achievable" verdict — turning panic into a plan.

All four routes use structured JSON prompts and the app parses Gemini's structured response directly into UI components, so the AI's reasoning is never just a wall of text — it always becomes an actionable card, badge, or step in the interface.

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| `Gemini API key not configured` error | Make sure `.env` has a real `GEMINI_API_KEY` and you restarted the Flask server after editing it |
| Voice input button shows an error toast | Use Chrome or Edge — Safari/Firefox have limited Web Speech API support |
| `database.db` seems out of date | Delete the file and restart `app.py` — it will recreate the table automatically |
| Gemini returns invalid JSON occasionally | The backend already strips ` ```json ` fences; if it still fails, the route returns a clean 502 error instead of crashing — just retry |

---

## 📄 License
This project was made for hackathon starter kit — feel free to use it.
