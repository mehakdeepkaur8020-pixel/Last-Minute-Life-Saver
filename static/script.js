/* ===========================================================
   Last-Minute Life Saver — Frontend Logic
   =========================================================== */

// ----------------------------------------------------------------
// Global state
// ----------------------------------------------------------------
let allTasks = [];
let editingTaskId = null;

// ----------------------------------------------------------------
// DOM ready
// ----------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initSidebarToggle();
  initModal();
  initVoiceInput();
  initFilters();
  bindActionButtons();

  refreshEverything();

  // Re-check deadline alerts every 60 seconds
  setInterval(checkDeadlineAlerts, 60000);
});

// ----------------------------------------------------------------
// Navigation between sections
// ----------------------------------------------------------------
function initNavigation() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const section = item.dataset.section;

      navItems.forEach((n) => n.classList.remove("active"));
      item.classList.add("active");

      document.querySelectorAll(".page-section").forEach((sec) => sec.classList.remove("active"));
      document.getElementById(`section-${section}`).classList.add("active");

      closeSidebarMobile();
    });
  });
}

function initSidebarToggle() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");

  document.getElementById("menuToggle").addEventListener("click", () => {
    sidebar.classList.add("open");
    overlay.classList.add("show");
  });

  overlay.addEventListener("click", closeSidebarMobile);
}

function closeSidebarMobile() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("show");
}

// ----------------------------------------------------------------
// Loading / Toast helpers
// ----------------------------------------------------------------
function showGlobalLoader(text) {
  document.getElementById("globalLoaderText").textContent = text || "Working on it...";
  document.getElementById("globalLoader").classList.remove("hidden");
}
function hideGlobalLoader() {
  document.getElementById("globalLoader").classList.add("hidden");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

// ----------------------------------------------------------------
// API helpers
// ----------------------------------------------------------------
async function apiRequest(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Something went wrong.");
    }
    return data;
  } catch (err) {
    throw err;
  }
}

// ----------------------------------------------------------------
// Refresh all data
// ----------------------------------------------------------------
async function refreshEverything() {
  await Promise.all([loadTasks(), loadAnalytics()]);
}

// ----------------------------------------------------------------
// TASKS — Load + Render
// ----------------------------------------------------------------
async function loadTasks() {
  try {
    const data = await apiRequest("/api/tasks");
    allTasks = data.tasks;
    renderUpcomingList();
    renderAllTasksList();
    checkDeadlineAlerts();
  } catch (err) {
    showToast(`Failed to load tasks: ${err.message}`, "error");
  }
}

function renderUpcomingList() {
  const container = document.getElementById("upcomingList");
  const pending = allTasks.filter((t) => t.status !== "Complete").slice(0, 6);

  if (pending.length === 0) {
    container.innerHTML = emptyStateHTML("✅", "No upcoming deadlines. You're all caught up!");
    return;
  }

  container.innerHTML = pending.map(taskCardHTML).join("");
  bindTaskCardEvents(container);
}

function renderAllTasksList() {
  const container = document.getElementById("allTasksList");
  const search = document.getElementById("searchInput").value.toLowerCase().trim();
  const statusFilter = document.getElementById("filterStatus").value;
  const priorityFilter = document.getElementById("filterPriority").value;

  let filtered = allTasks.filter((t) => {
    const matchesSearch = !search || t.title.toLowerCase().includes(search) || (t.description || "").toLowerCase().includes(search);
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    const matchesPriority = priorityFilter === "all" || (t.priority || "Unranked") === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  if (filtered.length === 0) {
    container.innerHTML = emptyStateHTML("🔍", "No tasks match your filters.");
    return;
  }

  container.innerHTML = filtered.map(taskCardHTML).join("");
  bindTaskCardEvents(container);
}

function emptyStateHTML(icon, message) {
  return `<div class="empty-state"><span class="empty-icon">${icon}</span>${message}</div>`;
}

function taskCardHTML(task) {
  const urgencyClass = task.status === "Complete" ? "" : `urgency-${task.urgency}`;
  const statusClass = task.status === "Complete" ? "status-complete" : "";
  const priorityBadgeClass = `badge-${(task.priority || "Unranked").toLowerCase()}`;
  const deadlineLabel = formatDeadline(task.deadline);
  const hoursLeftLabel = task.status === "Complete"
    ? "Done"
    : task.urgency === "overdue"
      ? "⚠️ Overdue"
      : `${task.hours_left}h left`;

  const showRescueBtn = task.status !== "Complete" && task.hours_left !== null && task.hours_left <= 24;

  return `
    <div class="task-card ${urgencyClass} ${statusClass}" data-id="${task.id}">
      <div class="task-main">
        <div class="task-title">${escapeHTML(task.title)}</div>
        <div class="task-meta">
          <span class="badge ${priorityBadgeClass}">${task.priority || "Unranked"}</span>
          <span class="badge badge-category">${escapeHTML(task.category)}</span>
          <span>📅 ${deadlineLabel}</span>
          <span>⏱️ ${hoursLeftLabel}</span>
        </div>
        ${task.description ? `<div class="task-desc">${escapeHTML(task.description)}</div>` : ""}
      </div>
      <div class="task-actions">
        ${showRescueBtn ? `<button class="btn btn-danger btn-sm" data-action="rescue" title="Auto Rescue Mode">🚨 Rescue</button>` : ""}
        ${task.status !== "Complete" ? `<button class="btn btn-outline btn-sm" data-action="complete" title="Mark complete">✓</button>` : ""}
        <button class="btn btn-outline btn-sm" data-action="edit" title="Edit">✏️</button>
        <button class="btn btn-outline btn-sm" data-action="delete" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

function bindTaskCardEvents(container) {
  container.querySelectorAll(".task-card").forEach((card) => {
    const id = parseInt(card.dataset.id, 10);

    const rescueBtn = card.querySelector('[data-action="rescue"]');
    if (rescueBtn) rescueBtn.addEventListener("click", () => openRescueMode(id));

    const completeBtn = card.querySelector('[data-action="complete"]');
    if (completeBtn) completeBtn.addEventListener("click", () => markComplete(id));

    const editBtn = card.querySelector('[data-action="edit"]');
    if (editBtn) editBtn.addEventListener("click", () => openEditTask(id));

    const deleteBtn = card.querySelector('[data-action="delete"]');
    if (deleteBtn) deleteBtn.addEventListener("click", () => deleteTask(id));
  });
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function formatDeadline(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return isoStr;
  }
}

// ----------------------------------------------------------------
// TASKS — Filters
// ----------------------------------------------------------------
function initFilters() {
  document.getElementById("searchInput").addEventListener("input", renderAllTasksList);
  document.getElementById("filterStatus").addEventListener("change", renderAllTasksList);
  document.getElementById("filterPriority").addEventListener("change", renderAllTasksList);
}

// ----------------------------------------------------------------
// TASKS — Modal (Add / Edit)
// ----------------------------------------------------------------
function initModal() {
  const overlay = document.getElementById("taskModalOverlay");
  const openButtons = [document.getElementById("openAddTaskBtn"), document.getElementById("openAddTaskBtn2")];

  openButtons.forEach((btn) => btn.addEventListener("click", () => openAddTask()));

  document.getElementById("closeModalBtn").addEventListener("click", closeTaskModal);
  document.getElementById("cancelModalBtn").addEventListener("click", closeTaskModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeTaskModal();
  });

  document.getElementById("taskForm").addEventListener("submit", handleTaskFormSubmit);

  // Rescue modal close handlers
  document.getElementById("closeRescueModalBtn").addEventListener("click", closeRescueModal);
  document.getElementById("rescueModalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "rescueModalOverlay") closeRescueModal();
  });
}

function openAddTask() {
  editingTaskId = null;
  document.getElementById("modalTitle").textContent = "Add Task";
  document.getElementById("taskForm").reset();
  document.getElementById("taskId").value = "";
  document.getElementById("taskModalOverlay").classList.remove("hidden");
}

function openEditTask(id) {
  const task = allTasks.find((t) => t.id === id);
  if (!task) return;

  editingTaskId = id;
  document.getElementById("modalTitle").textContent = "Edit Task";
  document.getElementById("taskId").value = id;
  document.getElementById("taskTitle").value = task.title;
  document.getElementById("taskDescription").value = task.description || "";
  document.getElementById("taskDeadline").value = toDatetimeLocalValue(task.deadline);
  document.getElementById("taskCategory").value = task.category || "General";

  document.getElementById("taskModalOverlay").classList.remove("hidden");
}

function toDatetimeLocalValue(isoStr) {
  try {
    const d = new Date(isoStr);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function closeTaskModal() {
  document.getElementById("taskModalOverlay").classList.add("hidden");
}

async function handleTaskFormSubmit(e) {
  e.preventDefault();

  const payload = {
    title: document.getElementById("taskTitle").value.trim(),
    description: document.getElementById("taskDescription").value.trim(),
    deadline: document.getElementById("taskDeadline").value,
    category: document.getElementById("taskCategory").value,
  };

  if (!payload.title || !payload.deadline) {
    showToast("Title and deadline are required.", "error");
    return;
  }

  const saveBtn = document.getElementById("saveTaskBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    if (editingTaskId) {
      await apiRequest(`/api/tasks/${editingTaskId}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast("Task updated.", "success");
    } else {
      await apiRequest("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
      showToast("Task added.", "success");
    }
    closeTaskModal();
    await refreshEverything();
  } catch (err) {
    showToast(`Failed to save task: ${err.message}`, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Task";
  }
}

async function markComplete(id) {
  try {
    await apiRequest(`/api/tasks/${id}/complete`, { method: "PATCH" });
    showToast("Task marked complete. 🎉", "success");
    await refreshEverything();
  } catch (err) {
    showToast(`Failed: ${err.message}`, "error");
  }
}

async function deleteTask(id) {
  if (!confirm("Delete this task? This cannot be undone.")) return;
  try {
    await apiRequest(`/api/tasks/${id}`, { method: "DELETE" });
    showToast("Task deleted.", "success");
    await refreshEverything();
  } catch (err) {
    showToast(`Failed: ${err.message}`, "error");
  }
}

// ----------------------------------------------------------------
// ANALYTICS
// ----------------------------------------------------------------
async function loadAnalytics() {
  try {
    const data = await apiRequest("/api/analytics");
    ["statTotal", "statTotal2"].forEach((id) => (document.getElementById(id).textContent = data.total_tasks));
    ["statPending", "statPending2"].forEach((id) => (document.getElementById(id).textContent = data.pending_tasks));
    ["statCompleted", "statCompleted2"].forEach((id) => (document.getElementById(id).textContent = data.completed_tasks));
    ["statProductivity", "statProductivity2"].forEach((id) => (document.getElementById(id).textContent = `${data.productivity_percentage}%`));
    document.getElementById("progressFill").style.width = `${data.productivity_percentage}%`;
  } catch (err) {
    showToast(`Failed to load analytics: ${err.message}`, "error");
  }
}

// ----------------------------------------------------------------
// SMART DEADLINE ALERTS
// ----------------------------------------------------------------
function checkDeadlineAlerts() {
  const banner = document.getElementById("alertBanner");
  const urgent = allTasks.filter((t) => t.status !== "Complete" && t.hours_left !== null && t.hours_left <= 24 && t.hours_left >= 0);

  if (urgent.length === 0) {
    banner.classList.add("hidden");
    return;
  }

  const mostUrgent = urgent.reduce((min, t) => (t.hours_left < min.hours_left ? t : min), urgent[0]);
  const count = urgent.length;
  const plural = count > 1 ? `${count} tasks` : "1 task";

  banner.innerHTML = `⚠️ <strong>${plural}</strong> due within 24 hours — closest: <strong>${escapeHTML(mostUrgent.title)}</strong> in ${mostUrgent.hours_left}h. Consider using 🚨 Auto Rescue Mode.`;
  banner.classList.remove("hidden");
}

// ----------------------------------------------------------------
// AI FEATURE: PRIORITIZE
// ----------------------------------------------------------------
function bindActionButtons() {
  document.getElementById("prioritizeBtn").addEventListener("click", runPrioritize);
  document.getElementById("generateScheduleBtn").addEventListener("click", runSchedule);
  document.getElementById("generateRecommendBtn").addEventListener("click", runRecommend);
}

async function runPrioritize() {
  showGlobalLoader("Asking Gemini to prioritize your tasks...");
  try {
    const data = await apiRequest("/prioritize", { method: "POST" });
    if (data.message) {
      showToast(data.message, "info");
    } else {
      showToast("Tasks re-prioritized by AI. ✨", "success");
    }
    await loadTasks();
  } catch (err) {
    showToast(`AI prioritization failed: ${err.message}`, "error");
  } finally {
    hideGlobalLoader();
  }
}

// ----------------------------------------------------------------
// AI FEATURE: SCHEDULE GENERATOR
// ----------------------------------------------------------------
async function runSchedule() {
  showGlobalLoader("Building today's schedule with Gemini...");
  const container = document.getElementById("scheduleResults");

  try {
    const data = await apiRequest("/schedule", { method: "POST" });
    const items = data.schedule || [];

    if (items.length === 0) {
      container.innerHTML = emptyStateHTML("🗓️", data.message || "No schedule generated.");
      return;
    }

    container.innerHTML = items.map((item) => `
      <div class="schedule-card">
        <div class="schedule-time">${escapeHTML(item.start_time)} – ${escapeHTML(item.end_time)}</div>
        <div class="schedule-title">${escapeHTML(item.title)}</div>
        <div class="schedule-notes">${escapeHTML(item.notes || "")}</div>
      </div>
    `).join("");

    showToast("Schedule generated. 🗓️", "success");
  } catch (err) {
    container.innerHTML = emptyStateHTML("⚠️", `Failed to generate schedule: ${err.message}`);
    showToast(`Schedule generation failed: ${err.message}`, "error");
  } finally {
    hideGlobalLoader();
  }
}

// ----------------------------------------------------------------
// AI FEATURE: RECOMMENDATIONS
// ----------------------------------------------------------------
async function runRecommend() {
  showGlobalLoader("Analyzing your workload with Gemini...");
  const container = document.getElementById("recommendResults");
  const summaryBox = document.getElementById("recommendSummary");

  try {
    const data = await apiRequest("/recommend", { method: "POST" });
    const items = (data.recommendations || []).sort((a, b) => a.suggested_order - b.suggested_order);

    if (items.length === 0) {
      container.innerHTML = emptyStateHTML("💡", data.message || "No recommendations available.");
      summaryBox.classList.add("hidden");
      return;
    }

    container.innerHTML = items.map((item) => `
      <div class="recommend-card">
        <div class="recommend-order">${item.suggested_order}</div>
        <div class="schedule-title">${escapeHTML(item.title)}</div>
        <div class="recommend-time">⏱️ ${item.time_allocation_minutes} min suggested</div>
        <div class="schedule-notes">${escapeHTML(item.advice || "")}</div>
      </div>
    `).join("");

    if (data.summary) {
      summaryBox.textContent = `💡 ${data.summary}`;
      summaryBox.classList.remove("hidden");
    }

    showToast("Recommendations ready. 💡", "success");
  } catch (err) {
    container.innerHTML = emptyStateHTML("⚠️", `Failed to get recommendations: ${err.message}`);
    showToast(`Recommendation failed: ${err.message}`, "error");
  } finally {
    hideGlobalLoader();
  }
}

// ----------------------------------------------------------------
// AI FEATURE: AUTO RESCUE MODE
// ----------------------------------------------------------------
async function openRescueMode(taskId) {
  const overlay = document.getElementById("rescueModalOverlay");
  const content = document.getElementById("rescueModalContent");

  overlay.classList.remove("hidden");
  content.innerHTML = `<div class="loader" style="margin: 30px auto;"></div><p style="text-align:center;color:var(--color-text-dim);font-size:13.5px;">Building your recovery plan...</p>`;

  try {
    const data = await apiRequest("/rescue", { method: "POST", body: JSON.stringify({ task_id: taskId }) });
    const plan = data.rescue_plan;
    const steps = plan.steps || [];

    const stepsHTML = steps.map((s, idx) => `
      <div class="rescue-step">
        <div class="rescue-step-num">${idx + 1}</div>
        <div class="rescue-step-text">${escapeHTML(s.step)}</div>
        <div class="rescue-step-time">${s.estimated_minutes} min</div>
      </div>
    `).join("");

    const achievable = plan.achievable;
    const verdictClass = achievable ? "achievable" : "not-achievable";
    const verdictIcon = achievable ? "✅" : "⚠️";

    content.innerHTML = `
      <h3 style="font-size:15px;margin-bottom:14px;">${escapeHTML(data.task.title)}</h3>
      ${stepsHTML}
      <div class="rescue-verdict ${verdictClass}">
        ${verdictIcon} Total estimated time: ${plan.total_estimated_minutes} min — ${escapeHTML(plan.verdict || "")}
      </div>
    `;
  } catch (err) {
    content.innerHTML = emptyStateHTML("⚠️", `Failed to build rescue plan: ${err.message}`);
  }
}

function closeRescueModal() {
  document.getElementById("rescueModalOverlay").classList.add("hidden");
}

// ----------------------------------------------------------------
// VOICE INPUT (Web Speech API)
// ----------------------------------------------------------------
function initVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtns = [document.getElementById("micToggleMobile"), document.getElementById("micToggleDesktop")];

  if (!SpeechRecognition) {
    micBtns.forEach((btn) => {
      btn.addEventListener("click", () => showToast("Voice input isn't supported in this browser. Try Chrome.", "error"));
    });
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let listening = false;

  micBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (listening) return;
      try {
        recognition.start();
        listening = true;
        showToast("Listening... say something like 'Add DBMS assignment due tomorrow'", "info");
      } catch {
        // Recognition may already be running; ignore.
      }
    });
  });

  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript;
    showToast(`Heard: "${transcript}"`, "info");
    parseVoiceCommandIntoTask(transcript);
  });

  recognition.addEventListener("end", () => { listening = false; });
  recognition.addEventListener("error", () => {
    listening = false;
    showToast("Didn't catch that — please try again.", "error");
  });
}

/**
 * Very lightweight natural-language parser for voice commands.
 * Looks for patterns like "Add X due tomorrow / today / in N hours / on <date>"
 * and pre-fills the Add Task modal so the user can confirm and save.
 */
function parseVoiceCommandIntoTask(transcript) {
  let text = transcript.trim();

  // Strip a leading "add" if present
  text = text.replace(/^add\s+/i, "");

  let deadline = null;
  const now = new Date();

  // "due tomorrow"
  if (/due\s+tomorrow/i.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    deadline = d;
    text = text.replace(/due\s+tomorrow/i, "").trim();
  }
  // "due today"
  else if (/due\s+today/i.test(text)) {
    const d = new Date(now);
    d.setHours(23, 59, 0, 0);
    deadline = d;
    text = text.replace(/due\s+today/i, "").trim();
  }
  // "in N hours"
  else if (/in\s+(\d+)\s+hours?/i.test(text)) {
    const match = text.match(/in\s+(\d+)\s+hours?/i);
    const hrs = parseInt(match[1], 10);
    const d = new Date(now.getTime() + hrs * 3600 * 1000);
    deadline = d;
    text = text.replace(/in\s+\d+\s+hours?/i, "").trim();
  }
  // Default: 24 hours from now if no deadline phrase detected
  else {
    deadline = new Date(now.getTime() + 24 * 3600 * 1000);
  }

  // Clean trailing "due" leftovers
  text = text.replace(/\s+due\s*$/i, "").trim();
  const title = text.charAt(0).toUpperCase() + text.slice(1);

  // Pre-fill and open the Add Task modal for confirmation
  openAddTask();
  document.getElementById("taskTitle").value = title || "New voice task";
  document.getElementById("taskDeadline").value = toDatetimeLocalValue(deadline.toISOString());
}
