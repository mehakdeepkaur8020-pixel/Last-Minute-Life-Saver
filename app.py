"""
Last-Minute Life Saver - Flask Backend
----------------------------------------
An AI-powered productivity companion that helps users avoid missing
deadlines by using Google Gemini to prioritize tasks, generate schedules,
give recommendations, and build "rescue plans" for tasks that are about
to be late.

Author: Generated for hackathon project
"""

import os
import re
import json
import sqlite3
from datetime import datetime, timedelta
from contextlib import closing

from flask import Flask, request, jsonify, render_template, g
from dotenv import load_dotenv

# Google Gemini SDK (the unified "google-genai" SDK — the old
# "google-generativeai" package is deprecated and should not be used)
from google import genai
from google.genai import types as genai_types

# ---------------------------------------------------------------------------
# App & Config
# ---------------------------------------------------------------------------

load_dotenv()  # Load variables from .env file

app = Flask(__name__)

DATABASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database.db")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# Configure Gemini only if a key is present. This lets the app still boot
# (and show a friendly error in the UI) even if the key hasn't been set yet.
GEMINI_ENABLED = bool(GEMINI_API_KEY)
_gemini_client = None
if GEMINI_ENABLED:
    _gemini_client = genai.Client(api_key=GEMINI_API_KEY)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    """Return a SQLite connection stored on Flask's application context `g`."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    """Close the DB connection at the end of the request."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create the Tasks table if it doesn't already exist."""
    with closing(sqlite3.connect(DATABASE)) as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                deadline TEXT NOT NULL,
                category TEXT DEFAULT 'General',
                priority TEXT DEFAULT 'Unranked',
                status TEXT DEFAULT 'Pending',
                created_at TEXT NOT NULL
            )
            """
        )
        db.commit()


def row_to_dict(row):
    """Convert a sqlite3.Row into a plain dict."""
    return {key: row[key] for key in row.keys()}


# ---------------------------------------------------------------------------
# Gemini helper
# ---------------------------------------------------------------------------

def call_gemini(prompt, expect_json=True):
    """
    Call the Gemini API with a text prompt.
    If expect_json is True, attempts to parse the response as JSON
    (stripping markdown code fences if Gemini wraps the JSON in them).

    Raises RuntimeError if Gemini is not configured or the call fails,
    so calling routes can return a clean error to the frontend.
    """
    if not GEMINI_ENABLED:
        raise RuntimeError(
            "Gemini API key not configured. Add GEMINI_API_KEY to your .env file."
        )

    try:
        response = _gemini_client.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                # Gemini 2.5 models "think" by default, and those thinking
                # tokens are deducted from the SAME output budget as the
                # visible response. For our structured JSON tasks we don't
                # need deep reasoning, so we turn thinking off entirely and
                # give the visible output a generous ceiling. Without this,
                # responses can be silently truncated mid-JSON.
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                max_output_tokens=4096,
            ),
        )
        text = (response.text or "").strip()

        # If Gemini still hit the token limit (e.g. on a very long task list),
        # surface a clear error instead of trying to parse a cut-off response.
        finish_reason = None
        if response.candidates:
            finish_reason = getattr(response.candidates[0], "finish_reason", None)
        if not text and finish_reason is not None and "MAX_TOKENS" in str(finish_reason):
            raise RuntimeError(
                "Gemini's response was cut off before it produced any output. "
                "Try again, or reduce the number of pending tasks."
            )
    except RuntimeError:
        raise
    except Exception as exc:  # noqa: BLE001 - we want to surface any SDK error
        raise RuntimeError(f"Gemini API call failed: {exc}") from exc

    if not expect_json:
        return text

    cleaned = extract_json_string(text)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Gemini did not return valid JSON. Raw response: {text[:300]}"
        ) from exc


def extract_json_string(text):
    """
    Robustly pull a JSON object out of a raw LLM text response.

    Handles:
      - Plain JSON with no wrapping
      - ```json ... ``` or ``` ... ``` markdown code fences
      - Leading/trailing commentary text around the JSON block
    """
    cleaned = text.strip()

    # Strip a ```json ... ``` or ``` ... ``` fence if present, anywhere
    # in the text (not just at the very start), and prefer the content
    # between the first and last fence markers.
    fence_match = re.search(r"```(?:json)?\s*(.*?)```", cleaned, re.DOTALL | re.IGNORECASE)
    if fence_match:
        cleaned = fence_match.group(1).strip()

    # As a fallback (no fences, but the model added stray commentary),
    # extract the substring between the first "{" and the last "}".
    if not cleaned.startswith("{"):
        first_brace = cleaned.find("{")
        last_brace = cleaned.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            cleaned = cleaned[first_brace:last_brace + 1]

    return cleaned


def hours_until(deadline_str):
    """Return the number of hours remaining until the given ISO deadline string."""
    try:
        deadline = datetime.fromisoformat(deadline_str)
    except ValueError:
        return None
    delta = deadline - datetime.now()
    return delta.total_seconds() / 3600.0


# ---------------------------------------------------------------------------
# Page Route
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Serve the single-page dashboard."""
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Task CRUD Routes
# ---------------------------------------------------------------------------

@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    """Return all tasks, ordered by soonest deadline first."""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM tasks ORDER BY deadline ASC"
    ).fetchall()
    tasks = [row_to_dict(r) for r in rows]

    # Attach computed "hours_left" and "urgency" fields for the frontend
    for t in tasks:
        hrs = hours_until(t["deadline"])
        t["hours_left"] = round(hrs, 1) if hrs is not None else None
        if hrs is None:
            t["urgency"] = "unknown"
        elif hrs < 0:
            t["urgency"] = "overdue"
        elif hrs <= 6:
            t["urgency"] = "critical"
        elif hrs <= 12:
            t["urgency"] = "high"
        elif hrs <= 24:
            t["urgency"] = "medium"
        else:
            t["urgency"] = "normal"

    return jsonify({"success": True, "tasks": tasks})


@app.route("/api/tasks", methods=["POST"])
def create_task():
    """Create a new task. Expects JSON: title, description, deadline, category."""
    data = request.get_json(force=True, silent=True) or {}

    title = (data.get("title") or "").strip()
    deadline = (data.get("deadline") or "").strip()

    if not title:
        return jsonify({"success": False, "error": "Title is required."}), 400
    if not deadline:
        return jsonify({"success": False, "error": "Deadline is required."}), 400

    description = data.get("description", "")
    category = data.get("category", "General")

    db = get_db()
    cursor = db.execute(
        """
        INSERT INTO tasks (title, description, deadline, category, priority, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (title, description, deadline, category, "Unranked", "Pending", datetime.now().isoformat()),
    )
    db.commit()

    new_task = db.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify({"success": True, "task": row_to_dict(new_task)}), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    """Edit an existing task. Any subset of fields may be provided."""
    data = request.get_json(force=True, silent=True) or {}
    db = get_db()

    existing = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if existing is None:
        return jsonify({"success": False, "error": "Task not found."}), 404

    fields = {}
    for field in ["title", "description", "deadline", "category", "priority", "status"]:
        if field in data:
            fields[field] = data[field]

    if not fields:
        return jsonify({"success": False, "error": "No fields to update."}), 400

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [task_id]
    db.execute(f"UPDATE tasks SET {set_clause} WHERE id = ?", values)
    db.commit()

    updated = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return jsonify({"success": True, "task": row_to_dict(updated)})


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    """Delete a task by id."""
    db = get_db()
    existing = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if existing is None:
        return jsonify({"success": False, "error": "Task not found."}), 404

    db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    db.commit()
    return jsonify({"success": True, "deleted_id": task_id})


@app.route("/api/tasks/<int:task_id>/complete", methods=["PATCH"])
def complete_task(task_id):
    """Mark a task as Complete."""
    db = get_db()
    existing = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if existing is None:
        return jsonify({"success": False, "error": "Task not found."}), 404

    db.execute("UPDATE tasks SET status = 'Complete' WHERE id = ?", (task_id,))
    db.commit()
    updated = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return jsonify({"success": True, "task": row_to_dict(updated)})


# ---------------------------------------------------------------------------
# Analytics Route
# ---------------------------------------------------------------------------

@app.route("/api/analytics", methods=["GET"])
def analytics():
    """Return basic productivity analytics."""
    db = get_db()
    total = db.execute("SELECT COUNT(*) AS c FROM tasks").fetchone()["c"]
    completed = db.execute("SELECT COUNT(*) AS c FROM tasks WHERE status = 'Complete'").fetchone()["c"]
    pending = total - completed
    productivity_pct = round((completed / total) * 100, 1) if total > 0 else 0.0

    return jsonify({
        "success": True,
        "total_tasks": total,
        "completed_tasks": completed,
        "pending_tasks": pending,
        "productivity_percentage": productivity_pct,
    })


# ---------------------------------------------------------------------------
# AI Routes (Gemini powered)
# ---------------------------------------------------------------------------

@app.route("/prioritize", methods=["POST"])
def prioritize():
    """
    Send all pending tasks to Gemini and ask it to assign a priority
    (High / Medium / Low) to each, based on deadline proximity and workload.
    Persists the returned priority back into the database.
    """
    db = get_db()
    rows = db.execute("SELECT * FROM tasks WHERE status != 'Complete'").fetchall()
    tasks = [row_to_dict(r) for r in rows]

    if not tasks:
        return jsonify({"success": True, "tasks": [], "message": "No pending tasks to prioritize."})

    now_str = datetime.now().isoformat()
    prompt = f"""
You are an productivity assistant. The current date and time is {now_str}.
Here is a JSON list of pending tasks (id, title, description, deadline, category):

{json.dumps(tasks, indent=2)}

For EACH task, decide a priority level of exactly one of: "High", "Medium", "Low".
Base the decision on how close the deadline is, and on the apparent workload/complexity
implied by the title and description. Tasks due soon or with heavy workload should be High.

Respond with ONLY valid JSON (no markdown fences, no commentary) in this exact format:
{{
  "priorities": [
    {{"id": <task_id>, "priority": "High|Medium|Low", "reason": "<short reason, 1 sentence>"}}
  ]
}}
"""

    try:
        result = call_gemini(prompt, expect_json=True)
    except RuntimeError as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    priorities = result.get("priorities", [])

    # Persist priorities back to DB
    for item in priorities:
        task_id = item.get("id")
        priority = item.get("priority", "Unranked")
        if task_id is not None:
            db.execute("UPDATE tasks SET priority = ? WHERE id = ?", (priority, task_id))
    db.commit()

    return jsonify({"success": True, "priorities": priorities})


@app.route("/schedule", methods=["POST"])
def schedule():
    """
    Ask Gemini to build a realistic timetable for today based on
    the user's pending tasks and their deadlines.
    """
    db = get_db()
    rows = db.execute("SELECT * FROM tasks WHERE status != 'Complete'").fetchall()
    tasks = [row_to_dict(r) for r in rows]

    if not tasks:
        return jsonify({"success": True, "schedule": [], "message": "No pending tasks to schedule."})

    now_str = datetime.now().isoformat()
    prompt = f"""
You are a scheduling assistant. The current date and time is {now_str}.
Here is a JSON list of the user's pending tasks:

{json.dumps(tasks, indent=2)}

Create a realistic timetable for the REST OF TODAY that helps the user get through
these tasks before their deadlines, in an order that respects urgency and workload.
Use time blocks in 24-hour HH:MM format, starting from the current time, and include
short breaks where reasonable.

Respond with ONLY valid JSON (no markdown fences, no commentary) in this exact format:
{{
  "schedule": [
    {{"start_time": "HH:MM", "end_time": "HH:MM", "task_id": <id or null for a break>, "title": "<task title or 'Break'>", "notes": "<short note>"}}
  ]
}}
"""

    try:
        result = call_gemini(prompt, expect_json=True)
    except RuntimeError as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify({"success": True, "schedule": result.get("schedule", [])})


@app.route("/recommend", methods=["POST"])
def recommend():
    """
    Ask Gemini for productivity recommendations: what to do first,
    and how to allocate time across remaining tasks.
    """
    db = get_db()
    rows = db.execute("SELECT * FROM tasks WHERE status != 'Complete'").fetchall()
    tasks = [row_to_dict(r) for r in rows]

    if not tasks:
        return jsonify({"success": True, "recommendations": [], "message": "No pending tasks to analyze."})

    now_str = datetime.now().isoformat()
    prompt = f"""
You are a productivity coach. The current date and time is {now_str}.
Here is a JSON list of the user's pending tasks:

{json.dumps(tasks, indent=2)}

Analyze the tasks and produce clear, actionable recommendations: what the user
should complete first and why, and how much time they should allocate to each
remaining task today.

Respond with ONLY valid JSON (no markdown fences, no commentary) in this exact format:
{{
  "recommendations": [
    {{"task_id": <id>, "title": "<title>", "suggested_order": <integer, 1 = do first>, "time_allocation_minutes": <integer>, "advice": "<one or two sentence actionable tip>"}}
  ],
  "summary": "<one short paragraph overall recommendation>"
}}
"""

    try:
        result = call_gemini(prompt, expect_json=True)
    except RuntimeError as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify({
        "success": True,
        "recommendations": result.get("recommendations", []),
        "summary": result.get("summary", ""),
    })


@app.route("/rescue", methods=["POST"])
def rescue():
    """
    Auto Rescue Mode: given a single task id (close to its deadline),
    ask Gemini to break it into smaller subtasks with a recovery plan
    and time estimates.
    """
    data = request.get_json(force=True, silent=True) or {}
    task_id = data.get("task_id")

    if task_id is None:
        return jsonify({"success": False, "error": "task_id is required."}), 400

    db = get_db()
    row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        return jsonify({"success": False, "error": "Task not found."}), 404

    task = row_to_dict(row)
    hrs_left = hours_until(task["deadline"])
    now_str = datetime.now().isoformat()

    prompt = f"""
You are an emergency productivity assistant helping someone who is close to missing a deadline.
The current date and time is {now_str}. The task has approximately {hrs_left if hrs_left is not None else "unknown"} hours remaining.

Task details:
{json.dumps(task, indent=2)}

Break this task down into a short, realistic recovery plan of sequential subtasks/steps
that can be completed within the remaining time. Each step needs a clear action and a
time estimate in minutes. Then give an overall estimated total completion time and a
verdict on whether it is realistically achievable before the deadline.

Respond with ONLY valid JSON (no markdown fences, no commentary) in this exact format:
{{
  "steps": [
    {{"step": "<short step description>", "estimated_minutes": <integer>}}
  ],
  "total_estimated_minutes": <integer>,
  "achievable": true|false,
  "verdict": "<one short sentence>"
}}
"""

    try:
        result = call_gemini(prompt, expect_json=True)
    except RuntimeError as exc:
        return jsonify({"success": False, "error": str(exc)}), 502

    return jsonify({
        "success": True,
        "task": task,
        "rescue_plan": result,
    })


# ---------------------------------------------------------------------------
# Error Handlers
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def not_found(e):
    return jsonify({"success": False, "error": "Resource not found."}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"success": False, "error": "Internal server error."}), 500


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug_mode)