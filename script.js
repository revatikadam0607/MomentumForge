/* =========================================================
   MOMENTUMFORGE — APPLICATION LOGIC
   All data is loaded dynamically from roadmap.json.
   Progress/overrides are persisted in Local Storage and
   merged on top of the JSON on every load.
========================================================= */

"use strict";

/* ---------------------------------------------------------
   1. GLOBAL STATE
--------------------------------------------------------- */
let STORAGE_KEY = "momentumForgeState_v1"; // reassigned per-user by auth.js once signed in
const THEME_KEY = "momentumForgeTheme";

let ROADMAP = null;        // raw data loaded from roadmap.json
let STATE = null;          // merged, persisted, mutable state (tasks + notes + streaks)
let currentDailyDate = null;   // Date object for daily view
let currentWeekAnchor = null;  // Date object for weekly view (any day in that week)
let currentMonthAnchor = null; // Date object for monthly view (1st of month)
let selectedCalendarDate = null;
let categoryColors = {};   // category -> color mapping (derived)

const CATEGORY_PALETTE = ["#123A66", "#2E75D6", "#4E8FD9", "#0E5C8C", "#6FA8E8", "#1B4F91"];

/* ---------------------------------------------------------
   2. UTILITIES
--------------------------------------------------------- */
function pad2(n){ return String(n).padStart(2, "0"); }

function toISODate(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function fromISODate(s){
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}
function addDays(date, n){
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function startOfWeek(date){
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  d.setHours(0,0,0,0);
  return d;
}
function startOfMonth(date){
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function formatLongDate(date){
  return date.toLocaleDateString("en-US", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
}
function formatShortDate(date){
  return date.toLocaleDateString("en-US", { day:"numeric", month:"short" });
}
function isSameDay(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
function minutesToHoursLabel(mins){
  const h = mins/60;
  return (Math.round(h*10)/10) + "h";
}
function debounce(fn, wait){
  let t;
  return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), wait); };
}
function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ---------------------------------------------------------
   3. DATA LOADING + PERSISTENCE MERGE
--------------------------------------------------------- */
async function loadRoadmap(){
  const res = await fetch("roadmap.json");
  if(!res.ok) throw new Error("Failed to load roadmap.json");
  ROADMAP = await res.json();
}

const LEGACY_STORAGE_KEYS = ["ascendiaState_v1", "tier1PlannerState_v1"]; // prior app names, checked in order for migration

function loadPersistedState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
    // Fallback: migrate progress saved under an earlier name of this app
    for(const key of LEGACY_STORAGE_KEYS){
      const legacy = localStorage.getItem(key);
      if(legacy) return JSON.parse(legacy);
    }
  }catch(e){ console.warn("Could not parse saved state", e); }
  return null;
}

function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  }catch(e){ console.warn("Could not save state", e); }
}

/**
 * Build the working STATE object. If saved state exists, its tasks
 * (matched by id) override roadmap.json tasks. New tasks added by the
 * user, plus notes and streak/XP data, all live in STATE.
 */
function initState(){
  const saved = loadPersistedState();
  const currentContentVersion = ROADMAP.meta.contentVersion || 1;

  if(saved && saved.tasks){
    // Merge: start from roadmap.json tasks, apply saved overrides, then append user-added tasks.
    // If roadmap.json's content has changed since this browser last saved (a bumped
    // contentVersion), base-task content fields (topic/category/duration/difficulty/
    // priority) are refreshed from the JSON instead of the stale cached copy — only
    // the person's actual progress (completed, current date, order, missed-tracking)
    // carries over. Without this, a task renamed in roadmap.json would stay stuck
    // under its old name forever in any browser that already had it saved.
    const savedContentVersion = saved.contentVersion || 0;
    const contentIsStale = savedContentVersion !== currentContentVersion;

    const baseTasks = JSON.parse(JSON.stringify(ROADMAP.tasks));
    const savedMap = new Map(saved.tasks.map(t=>[t.id, t]));
    const mergedTasks = baseTasks.map(baseTask=>{
      const savedTask = savedMap.get(baseTask.id);
      if(!savedTask) return baseTask;
      if(contentIsStale){
        return {
          ...baseTask,
          completed: savedTask.completed,
          date: savedTask.date,
          order: savedTask.order,
          missedFromDate: savedTask.missedFromDate,
        };
      }
      return {...baseTask, ...savedTask};
    });
    const baseIds = new Set(baseTasks.map(t=>t.id));
    const userAdded = saved.tasks.filter(t => !baseIds.has(t.id));

    STATE = {
      tasks: [...mergedTasks, ...userAdded],
      notes: saved.notes || JSON.parse(JSON.stringify(ROADMAP.notes || {daily:{},weekly:{},monthly:{}})),
      xp: saved.xp || 0,
      streak: saved.streak || 0,
      longestStreak: saved.longestStreak || 0,
      lastCompletionDate: saved.lastCompletionDate || null,
      completedAllRoadmapShown: saved.completedAllRoadmapShown || false,
      nextTaskNumber: saved.nextTaskNumber || (ROADMAP.tasks.length + 1),
      contentVersion: currentContentVersion,
      lastPushAction: saved.lastPushAction || null
    };
  } else {
    STATE = {
      tasks: JSON.parse(JSON.stringify(ROADMAP.tasks)),
      notes: JSON.parse(JSON.stringify(ROADMAP.notes || {daily:{},weekly:{},monthly:{}})),
      xp: 0,
      streak: 0,
      longestStreak: 0,
      lastCompletionDate: null,
      completedAllRoadmapShown: false,
      nextTaskNumber: ROADMAP.tasks.length + 1,
      contentVersion: currentContentVersion,
      lastPushAction: null
    };
  }
}

function getAllTasks(){ return STATE.tasks; }

function getTasksForDate(isoDate){
  return STATE.tasks
    .filter(t => t.date === isoDate)
    .sort((a,b)=> (a.order||0) - (b.order||0));
}

/* ---------------------------------------------------------
   4. CATEGORY COLORS (derived dynamically from roadmap.json)
--------------------------------------------------------- */
function buildCategoryColors(){
  const cats = ROADMAP.meta.categories || [...new Set(STATE.tasks.map(t=>t.category))];
  cats.forEach((c, i) => { categoryColors[c] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]; });
}

/* ---------------------------------------------------------
   5. PROGRESS CALCULATIONS
--------------------------------------------------------- */
function calcProgress(tasks){
  const total = tasks.length;
  const completed = tasks.filter(t=>t.completed).length;
  const pct = total ? Math.round((completed/total)*100) : 0;
  const minutes = tasks.filter(t=>t.completed).reduce((s,t)=>s+(t.durationMinutes||0),0);
  return { total, completed, pending: total-completed, pct, minutes };
}

function overallProgress(){ return calcProgress(STATE.tasks); }

function categoryProgress(category){
  return calcProgress(STATE.tasks.filter(t=>t.category===category));
}

function weekTasks(anchorDate){
  const start = startOfWeek(anchorDate);
  const end = addDays(start, 6);
  const startISO = toISODate(start), endISO = toISODate(end);
  return STATE.tasks.filter(t => t.date >= startISO && t.date <= endISO);
}

function monthTasks(anchorDate){
  const y = anchorDate.getFullYear(), m = anchorDate.getMonth();
  return STATE.tasks.filter(t=>{
    const d = fromISODate(t.date);
    return d.getFullYear()===y && d.getMonth()===m;
  });
}

/* ---------------------------------------------------------
   6. MISSED-TASK AUTO-ROLLOVER
   Any incomplete task whose date has passed is pulled forward
   onto today automatically — the person never has to manually
   reschedule a task just because they ran out of time on it.
   `missedFromDate` is stamped the FIRST time a task goes overdue
   and stays put after that, so "days overdue" keeps counting up
   correctly even across multi-day gaps (e.g. the app wasn't
   opened for 3 days — the task still remembers it was originally
   due 5 days ago, not just "yesterday").
--------------------------------------------------------- */
function rolloverMissedTasks(){
  const todayISO = toISODate(new Date());
  let changed = false;

  STATE.tasks.forEach(t=>{
    if(!t.completed && t.date < todayISO){
      if(!t.missedFromDate) t.missedFromDate = t.date;
      t.date = todayISO;
      changed = true;
    }
  });

  if(changed) saveState();
  return changed;
}

function daysOverdue(task){
  if(!task.missedFromDate) return 0;
  const ms = fromISODate(toISODate(new Date())) - fromISODate(task.missedFromDate);
  return Math.max(1, Math.round(ms / 86400000));
}

function missedTaskMessage(task){
  const pool = (ROADMAP.tips && ROADMAP.tips.missed) ? ROADMAP.tips.missed : ["This is overdue — finish it today."];
  // Pick deterministically per task+day so the message doesn't flicker on every re-render
  const seed = (task.id + toISODate(new Date())).split("").reduce((s,c)=>s + c.charCodeAt(0), 0);
  return pool[seed % pool.length];
}

/**
 * Pushes every incomplete task forward by `days` (default 1) — a manual,
 * whole-schedule version of the automatic missed-task rollover above.
 * Completed tasks are left exactly where they are, so history/streaks
 * stay accurate; `missedFromDate` (the original due date) is untouched
 * too, so "days overdue" keeps counting correctly against the real
 * original date even after a bulk push.
 *
 * The exact set of task IDs that got shifted is remembered in
 * STATE.lastPushAction, so a single "Undo" can precisely reverse just
 * this push — not a blind "shift everything back a day", which would
 * incorrectly touch tasks completed or added after the push happened.
 */
function shiftEntireTimetable(days = 1){
  const affectedIds = [];
  STATE.tasks.forEach(t=>{
    if(!t.completed){
      t.date = toISODate(addDays(fromISODate(t.date), days));
      affectedIds.push(t.id);
    }
  });
  if(affectedIds.length > 0){
    STATE.lastPushAction = { taskIds: affectedIds, days, at: Date.now() };
    saveState();
  }
  return affectedIds.length;
}

/**
 * Reverses the most recent shiftEntireTimetable() call. Only touches
 * tasks that were part of that specific push and are still incomplete
 * (a task finished or deleted since the push is left alone). One-level
 * undo — consumed after use, re-armed by the next push.
 */
function undoLastPush(){
  const action = STATE.lastPushAction;
  if(!action) return 0;

  let count = 0;
  action.taskIds.forEach(id=>{
    const t = STATE.tasks.find(x=>x.id===id);
    if(t && !t.completed){
      t.date = toISODate(addDays(fromISODate(t.date), -action.days));
      count++;
    }
  });

  STATE.lastPushAction = null;
  saveState();
  return count;
}

function updatePushUndoButtonState(){
  const btn = document.getElementById("undoPushBtn");
  if(!btn) return;
  btn.disabled = !STATE.lastPushAction;
}

/* ---------------------------------------------------------
   7. STREAK + XP LOGIC
--------------------------------------------------------- */
function registerCompletionForStreak(){
  const todayISO = toISODate(new Date());
  if(STATE.lastCompletionDate === todayISO) return; // already counted today

  const yesterdayISO = toISODate(addDays(new Date(), -1));
  if(STATE.lastCompletionDate === yesterdayISO){
    STATE.streak += 1;
  } else {
    STATE.streak = 1;
  }
  STATE.lastCompletionDate = todayISO;
  if(STATE.streak > STATE.longestStreak) STATE.longestStreak = STATE.streak;
}

function xpForTask(task){
  const base = { Easy: 10, Medium: 20, Hard: 35 };
  return base[task.difficulty] || 15;
}

function currentLevel(){
  // Level up every 150 XP, capped conceptually at 100
  const lvl = Math.floor(STATE.xp / 150) + 1;
  return Math.min(lvl, 100);
}

/* ---------------------------------------------------------
   8. TOASTS
--------------------------------------------------------- */
function showToast(message, type="default"){
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(()=> el.remove(), 3000);
}

/* ---------------------------------------------------------
   9. CUSTOM CURSOR — "focus bracket" viewfinder style
--------------------------------------------------------- */
function initCustomCursor(){
  const frame = document.querySelector(".cursor-frame");
  const core = document.querySelector(".cursor-core");
  if(!frame || !core) return;
  if(window.matchMedia("(hover: none), (pointer: coarse)").matches) return;

  let mouseX = window.innerWidth/2, mouseY = window.innerHeight/2;
  let frameX = mouseX, frameY = mouseY;
  let spread = 13, targetSpread = 13;     // half-width of the bracket frame, in px
  let rotation = 0, targetRotation = 0;   // subtle rotation for the "focus lock" feel
  let isHovering = false, isClicking = false;

  window.addEventListener("mousemove", (e)=>{
    mouseX = e.clientX; mouseY = e.clientY;
    // Core dot tracks the pointer exactly — zero lag, for precision.
    core.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
  });

  const FOLLOW_EASE = 0.2;
  const SPREAD_EASE = 0.22;
  const ROTATION_EASE = 0.18;

  function animateFrame(){
    frameX += (mouseX - frameX) * FOLLOW_EASE;
    frameY += (mouseY - frameY) * FOLLOW_EASE;

    targetSpread = isClicking ? 9 : (isHovering ? 19 : 13);
    spread += (targetSpread - spread) * SPREAD_EASE;

    targetRotation = isClicking ? -8 : (isHovering ? 8 : 0);
    rotation += (targetRotation - rotation) * ROTATION_EASE;

    const size = (spread * 2).toFixed(1);
    frame.style.width = size + "px";
    frame.style.height = size + "px";
    frame.style.marginTop = (-spread).toFixed(1) + "px";
    frame.style.marginLeft = (-spread).toFixed(1) + "px";
    frame.style.transform = `translate3d(${frameX}px, ${frameY}px, 0) rotate(${rotation.toFixed(2)}deg)`;

    requestAnimationFrame(animateFrame);
  }
  animateFrame();

  document.addEventListener("mousedown", ()=>{
    isClicking = true;
    frame.classList.add("clicking");
    spawnClickPulse(mouseX, mouseY);
  });
  document.addEventListener("mouseup", ()=>{
    isClicking = false;
    frame.classList.remove("clicking");
  });

  const hoverSelector = "button, a, input, select, textarea, .task-card, .card, .weekly-day-card, .calendar-cell, .timeline-item, [role='tab']";
  document.addEventListener("mouseover", (e)=>{
    if(e.target.closest(hoverSelector)){ isHovering = true; frame.classList.add("hovering"); }
  });
  document.addEventListener("mouseout", (e)=>{
    if(e.target.closest(hoverSelector)){ isHovering = false; frame.classList.remove("hovering"); }
  });

  // Fade the cursor out gracefully when it leaves the viewport
  document.addEventListener("mouseleave", ()=>{
    core.style.opacity = "0"; frame.style.opacity = "0";
  });
  document.addEventListener("mouseenter", ()=>{
    core.style.opacity = ""; frame.style.opacity = "";
  });
}

function spawnClickPulse(x,y){
  const p = document.createElement("div");
  p.className = "cursor-pulse";
  p.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  document.body.appendChild(p);
  setTimeout(()=> p.remove(), 420);
}

/* ---------------------------------------------------------
   10. THEME
--------------------------------------------------------- */
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);

  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
}
function toggleTheme(){
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
}

/* ---------------------------------------------------------
   11. NAVBAR / SCROLL / NAV LINKS
--------------------------------------------------------- */
function initNavbar(){
  const navbar = document.getElementById("navbar");
  const hamburger = document.getElementById("hamburger");
  const navMenu = document.getElementById("navMenu");

  window.addEventListener("scroll", ()=>{
    navbar.classList.toggle("scrolled", window.scrollY > 10);
    toggleScrollTopButton();
  });

  hamburger.addEventListener("click", ()=>{
    const open = navMenu.classList.toggle("open");
    hamburger.setAttribute("aria-expanded", String(open));
  });

  const sectionMap = {
    dashboard: "#dashboard",
    daily: "#plannerTabs",
    weekly: "#plannerTabs",
    monthly: "#plannerTabs",
    statistics: "#plannerTabs",
    settings: "#settings"
  };

  document.querySelectorAll(".nav-link").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".nav-link").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const key = btn.dataset.nav;
      if(["daily","weekly","monthly","statistics"].includes(key)){
        activateTab(key);
      }
      const target = document.querySelector(sectionMap[key]);
      if(target) target.scrollIntoView({behavior:"smooth", block:"start"});
      navMenu.classList.remove("open");
      hamburger.setAttribute("aria-expanded","false");
    });
  });
}

function toggleScrollTopButton(){
  const btn = document.getElementById("scrollTopBtn");
  btn.classList.toggle("visible", window.scrollY > 400);
}

function initScrollTop(){
  document.getElementById("scrollTopBtn").addEventListener("click", ()=>{
    window.scrollTo({top:0, behavior:"smooth"});
  });
}

/* ---------------------------------------------------------
   12. TABS
--------------------------------------------------------- */
function initTabs(){
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(tab=>{
    tab.addEventListener("click", ()=> activateTab(tab.dataset.tab));
  });
  // Position indicator initially
  requestAnimationFrame(()=> positionTabIndicator(document.querySelector(".tab-btn.active")));
  window.addEventListener("resize", debounce(()=>{
    positionTabIndicator(document.querySelector(".tab-btn.active"));
  }, 150));
}

function activateTab(name){
  document.querySelectorAll(".tab-btn").forEach(b=>{
    const active = b.dataset.tab === name;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
    if(active) positionTabIndicator(b);
  });
  document.querySelectorAll(".tab-panel").forEach(p=>{
    p.classList.toggle("active", p.id === `panel-${name}`);
  });
  if(name === "weekly") renderWeekly();
  if(name === "monthly") renderMonthly();
  if(name === "statistics") renderStatistics();
}

function positionTabIndicator(tabEl){
  const indicator = document.getElementById("tabIndicator");
  if(!tabEl || !indicator) return;
  indicator.style.left = tabEl.offsetLeft + "px";
  indicator.style.width = tabEl.offsetWidth + "px";
}

/* ---------------------------------------------------------
   13. HERO (date, greeting, quote, clock, ring)
--------------------------------------------------------- */
function renderHero(){
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  document.getElementById("heroGreeting").textContent = greeting;
  document.getElementById("heroDate").textContent = formatLongDate(now);

  const dayIndex = Math.floor(now.getTime() / 86400000) % ROADMAP.quotes.length;
  document.getElementById("heroQuote").textContent = "“" + ROADMAP.quotes[Math.abs(dayIndex)] + "”";

  updateHeroRing();
}

function updateHeroRing(){
  const { total, completed, pct } = overallProgress();
  const fg = document.getElementById("heroRingFg");
  const circumference = 2 * Math.PI * 60;
  fg.style.strokeDasharray = circumference;
  fg.style.strokeDashoffset = circumference - (pct/100)*circumference;
  document.getElementById("heroRingPercent").textContent = pct + "%";
  document.getElementById("heroRingSub").textContent = `${completed} / ${total} tasks`;
}

function initLiveClock(){
  function tick(){
    const now = new Date();
    document.getElementById("liveClock").textContent =
      now.toLocaleTimeString("en-US", { hour12:true, hour:"2-digit", minute:"2-digit", second:"2-digit" });
  }
  tick();
  setInterval(tick, 1000);
}

/* ---------------------------------------------------------
   14. DASHBOARD STAT CARDS
--------------------------------------------------------- */
function renderDashboard(){
  const todayISO = toISODate(new Date());
  const todayTasks = getTasksForDate(todayISO);
  const todayProg = calcProgress(todayTasks);
  const weekProg = calcProgress(weekTasks(new Date()));
  const monthProg = calcProgress(monthTasks(new Date()));
  const overall = overallProgress();

  const cards = [
    { icon:"📅", label:"Today's Tasks", value:`${todayProg.completed}/${todayProg.total}`, bar: todayProg.pct },
    { icon:"🗓️", label:"This Week", value:`${weekProg.pct}%`, bar: weekProg.pct },
    { icon:"📆", label:"This Month", value:`${monthProg.pct}%`, bar: monthProg.pct },
    { icon:"🏆", label:"Overall Completion", value:`${overall.pct}%`, bar: overall.pct },
    { icon:"🔥", label:"Current Streak", value:`${STATE.streak} days`, bar: Math.min(STATE.streak*10,100) },
    { icon:"⭐", label:"Longest Streak", value:`${STATE.longestStreak} days`, bar: Math.min(STATE.longestStreak*10,100) },
    { icon:"✅", label:"Completed Tasks", value:`${overall.completed}`, bar: overall.pct },
    { icon:"⏳", label:"Pending Tasks", value:`${overall.pending}`, bar: 100-overall.pct },
  ];

  document.getElementById("statsGrid").innerHTML = cards.map(c=>`
    <div class="stat-card">
      <div class="stat-icon">${c.icon}</div>
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
      <div class="stat-bar"><div class="stat-bar-fg" style="width:${c.bar}%"></div></div>
    </div>
  `).join("");

  renderTips();
}

function renderTips(){
  const dayIndex = Math.floor(Date.now() / 86400000);
  const pick = (arr) => arr[Math.abs(dayIndex) % arr.length];
  document.getElementById("dailyTipText").textContent = pick(ROADMAP.tips.daily);
  document.getElementById("placementTipText").textContent = pick(ROADMAP.tips.placement);
  document.getElementById("interviewTipText").textContent = pick(ROADMAP.tips.interview);
  document.getElementById("codingTipText").textContent = pick(ROADMAP.tips.coding);
}

/* ---------------------------------------------------------
   15. SMART SCHEDULE
--------------------------------------------------------- */
function renderSmartSchedule(){
  const sched = ROADMAP.smartSchedule;
  function block(title, items){
    return `<div class="schedule-block">
      <h3>${title}</h3>
      ${items.map(i=>{
        const color = categoryColors[i.category] || "#999";
        const timeLabel = i.hours ? `${i.hours} Hour${i.hours>1?"s":""}` : `${i.minutes} Minutes`;
        return `<div class="schedule-item"><span><span class="cat-dot" style="background:${color}"></span>${escapeHtml(i.category)}</span><strong>${timeLabel}</strong></div>`;
      }).join("")}
    </div>`;
  }
  document.getElementById("scheduleGrid").innerHTML =
    block("Weekdays", sched.weekday) + block("Weekends", sched.weekend);
}

/* ---------------------------------------------------------
   16. WARNING CARDS (auto-shown when topic appears)
--------------------------------------------------------- */
function renderMissedSummary(tasksForContext){
  const zone = document.getElementById("missedZone");
  const missed = tasksForContext.filter(t=>!t.completed && t.missedFromDate);
  if(missed.length === 0){ zone.innerHTML = ""; return; }

  const worstOverdue = Math.max(...missed.map(daysOverdue));
  const headline = missed.length === 1
    ? `You have 1 missed task — ${worstOverdue} day${worstOverdue>1?"s":""} overdue.`
    : `You have ${missed.length} missed tasks — up to ${worstOverdue} day${worstOverdue>1?"s":""} overdue.`;

  zone.innerHTML = `
    <div class="missed-summary-card">
      <span class="missed-summary-icon">⚠</span>
      <div>
        <div class="missed-summary-title">${escapeHtml(headline)}</div>
        <div class="missed-summary-sub">No more pushing it off. Whatever it takes, get these done today.</div>
      </div>
    </div>`;
}

function renderWarnings(tasksForContext){
  const zone = document.getElementById("warningZone");
  const topicsPresent = new Set(tasksForContext.map(t=>t.topic));
  const matches = ROADMAP.warnings.filter(w =>
    [...topicsPresent].some(topic => topic.toLowerCase().includes(w.topic.toLowerCase()))
  );
  if(matches.length === 0){ zone.innerHTML = ""; return; }
  zone.innerHTML = matches.map(w=>`
    <div class="warning-card ${w.level}">
      <span class="w-icon">⚠️</span>
      <div>
        <div class="w-title">Extra Time Required — ${escapeHtml(w.topic)}</div>
        <div class="w-sub">Needs +${w.extraDays} Day${w.extraDays>1?"s":""}</div>
      </div>
    </div>
  `).join("");
}

/* ---------------------------------------------------------
   17. DAILY VIEW
--------------------------------------------------------- */
function initDailyView(){
  currentDailyDate = new Date();
  document.getElementById("dayPrev").addEventListener("click", ()=>{
    currentDailyDate = addDays(currentDailyDate, -1);
    renderDaily();
  });
  document.getElementById("dayNext").addEventListener("click", ()=>{
    currentDailyDate = addDays(currentDailyDate, 1);
    renderDaily();
  });
  document.getElementById("filterCategory").addEventListener("change", renderDaily);
  document.getElementById("filterStatus").addEventListener("change", renderDaily);

  const notesArea = document.getElementById("dailyNotesArea");
  notesArea.addEventListener("input", debounce(()=>{
    const iso = toISODate(currentDailyDate);
    STATE.notes.daily[iso] = notesArea.value;
    saveState();
  }, 400));

  document.getElementById("addTaskBtn").addEventListener("click", ()=> openTaskModal(null, toISODate(currentDailyDate)));

  document.getElementById("pushTimetableBtn").addEventListener("click", ()=>{
    const pendingCount = STATE.tasks.filter(t=>!t.completed).length;
    if(pendingCount === 0){ showToast("No pending tasks to push", "warning"); return; }
    const ok = confirm(
      `This will push all ${pendingCount} pending task(s) forward by 1 day. ` +
      `Completed tasks stay where they are. Continue?`
    );
    if(!ok) return;
    const count = shiftEntireTimetable(1);
    showToast(`Pushed ${count} pending task(s) forward by 1 day`, "warning");
    updatePushUndoButtonState();
    fullRerender();
  });

  document.getElementById("undoPushBtn").addEventListener("click", ()=>{
    const count = undoLastPush();
    if(count === 0){ showToast("Nothing to undo", "warning"); return; }
    showToast(`Reverted ${count} task(s) — pulled back by 1 day`, "success");
    updatePushUndoButtonState();
    fullRerender();
  });

  updatePushUndoButtonState();
}

function populateCategoryFilter(){
  const sel = document.getElementById("filterCategory");
  const cats = ROADMAP.meta.categories;
  sel.innerHTML = `<option value="all">All Categories</option>` +
    cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
}

function findNextTaskDate(fromDate){
  // Find the nearest date (>= fromDate) that has tasks; used for "upcoming" fallback
  let d = new Date(fromDate);
  for(let i=0;i<365;i++){
    if(getTasksForDate(toISODate(d)).length>0) return d;
    d = addDays(d,1);
  }
  return null;
}

function renderDaily(){
  let viewDate = currentDailyDate;
  let iso = toISODate(viewDate);
  let tasks = getTasksForDate(iso);
  let usingUpcoming = false;

  if(tasks.length === 0 && isSameDay(viewDate, new Date())){
    const upcoming = findNextTaskDate(addDays(viewDate,1));
    if(upcoming){
      viewDate = upcoming;
      iso = toISODate(viewDate);
      tasks = getTasksForDate(iso);
      usingUpcoming = true;
    }
  }

  document.getElementById("dailyViewDate").textContent =
    (usingUpcoming ? "Upcoming — " : "") + formatLongDate(viewDate) + (isSameDay(viewDate,new Date()) && !usingUpcoming ? " (Today)" : "");

  const catFilter = document.getElementById("filterCategory").value;
  const statusFilter = document.getElementById("filterStatus").value;

  let filtered = tasks.filter(t=>{
    if(catFilter !== "all" && t.category !== catFilter) return false;
    if(statusFilter === "pending" && t.completed) return false;
    if(statusFilter === "completed" && !t.completed) return false;
    if(statusFilter === "high" && t.priority !== "High") return false;
    return true;
  });

  renderMissedSummary(tasks);
  renderWarnings(tasks);

  const listEl = document.getElementById("dailyTaskList");
  const emptyEl = document.getElementById("dailyEmptyState");

  if(filtered.length === 0){
    listEl.innerHTML = "";
    emptyEl.hidden = false;
  } else {
    emptyEl.hidden = true;
    listEl.innerHTML = filtered.map(taskCardHTML).join("");
    attachTaskCardEvents(listEl);
    enableDragAndDrop(listEl, iso);
  }

  // Progress ring + mini stats (based on ALL tasks for that date, not filtered)
  const prog = calcProgress(tasks);
  const ringFg = document.getElementById("dayRingFg");
  const circumference = 2 * Math.PI * 50;
  ringFg.style.strokeDasharray = circumference;
  ringFg.style.strokeDashoffset = circumference - (prog.pct/100)*circumference;
  document.getElementById("dayRingPercent").textContent = prog.pct + "%";
  document.getElementById("dayCompletedCount").textContent = prog.completed;
  document.getElementById("dayRemainingCount").textContent = prog.pending;
  document.getElementById("dayHours").textContent = minutesToHoursLabel(prog.minutes);

  document.getElementById("dailyNotesArea").value = STATE.notes.daily[iso] || "";

  updateHeroRing();
}

function taskCardHTML(t){
  const color = categoryColors[t.category] || "#999";
  const estFinish = estimateFinishTime(t);
  const isMissed = !t.completed && !!t.missedFromDate;
  const overdueDays = isMissed ? daysOverdue(t) : 0;

  const missedBanner = isMissed ? `
      <div class="missed-banner">
        <span class="missed-banner-icon">⚠</span>
        <div>
          <div class="missed-banner-title">MISSED — ${overdueDays} day${overdueDays>1?"s":""} overdue (was due ${escapeHtml(formatShortDate(fromISODate(t.missedFromDate)))})</div>
          <div class="missed-banner-msg">${escapeHtml(missedTaskMessage(t))}</div>
        </div>
      </div>` : "";

  return `
  <div class="task-card ${t.completed?"completed":""} ${isMissed?"missed":""}" data-id="${t.id}" draggable="true">
    <button class="task-checkbox ${t.completed?"checked":""}" data-action="toggle" aria-label="Toggle complete">
      <svg viewBox="0 0 24 24" width="14" height="14"><polyline points="4 12 9 18 20 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="task-body">
      <div class="task-top-row">
        <span class="task-topic">${escapeHtml(t.topic)}</span>
        <span class="task-category-badge" style="background:${color}22; color:${color}">${escapeHtml(t.category)}</span>
      </div>
      <div class="task-meta-row">
        <span>⏱ ${t.durationMinutes} min</span>
        <span class="difficulty-pill difficulty-${t.difficulty}">${t.difficulty}</span>
        <span class="priority-pill priority-${t.priority}">${t.priority} Priority</span>
        <span>🕓 Est. Finish ${estFinish}</span>
      </div>
      ${missedBanner}
    </div>
    <div class="task-actions">
      <button class="icon-btn" data-action="edit" aria-label="Edit task" title="Edit">✎</button>
      <button class="icon-btn" data-action="duplicate" aria-label="Duplicate task" title="Duplicate">⧉</button>
      <button class="icon-btn" data-action="reschedule" aria-label="Reschedule task" title="Reschedule">↻</button>
      <button class="icon-btn" data-action="delete" aria-label="Delete task" title="Delete">🗑</button>
    </div>
  </div>`;
}

function estimateFinishTime(task){
  // naive: stack tasks from 9:00 AM in `order` sequence for that date
  const dayTasks = getTasksForDate(task.date);
  let minutesFromNine = 0;
  for(const t of dayTasks){
    minutesFromNine += t.durationMinutes;
    if(t.id === task.id) break;
  }
  const start = new Date(); start.setHours(9,0,0,0);
  const finish = new Date(start.getTime() + minutesFromNine*60000);
  return finish.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit"});
}

function attachTaskCardEvents(container){
  container.querySelectorAll(".task-card").forEach(card=>{
    const id = card.dataset.id;
    card.querySelector('[data-action="toggle"]').addEventListener("click", (e)=>{
      e.stopPropagation();
      toggleTaskCompletion(id, card);
    });
    card.querySelector('[data-action="edit"]').addEventListener("click", ()=> openTaskModal(id));
    card.querySelector('[data-action="duplicate"]').addEventListener("click", ()=> duplicateTask(id));
    card.querySelector('[data-action="delete"]').addEventListener("click", ()=> deleteTask(id));
    card.querySelector('[data-action="reschedule"]').addEventListener("click", ()=> openRescheduleModal(id));
  });
}

function toggleTaskCompletion(id, cardEl){
  const task = STATE.tasks.find(t=>t.id===id);
  if(!task) return;
  task.completed = !task.completed;

  if(task.completed){
    delete task.missedFromDate; // clearing the debt the moment it's actually paid off
    STATE.xp += xpForTask(task);
    registerCompletionForStreak();
    cardEl.querySelector(".task-checkbox").classList.add("checked");
    cardEl.classList.add("completed");
    showToast(`+${xpForTask(task)} XP · ${task.topic} completed`, "success");
    maybeCelebrateDayCompletion(task.date);
    maybeShowCertificate();
  } else {
    cardEl.querySelector(".task-checkbox").classList.remove("checked");
    cardEl.classList.remove("completed");
  }

  saveState();
  renderDaily();
  renderDashboard();
  if(document.getElementById("panel-weekly").classList.contains("active")) renderWeekly();
  if(document.getElementById("panel-monthly").classList.contains("active")) renderMonthly();
  if(document.getElementById("panel-statistics").classList.contains("active")) renderStatistics();
}

function maybeCelebrateDayCompletion(dateISO){
  const tasks = getTasksForDate(dateISO);
  if(tasks.length>0 && tasks.every(t=>t.completed)){
    fireConfetti();
    showToast("🎉 All tasks complete for the day!", "success");
  }
}

function maybeShowCertificate(){
  const { total, completed } = overallProgress();
  if(total>0 && completed===total && !STATE.completedAllRoadmapShown){
    STATE.completedAllRoadmapShown = true;
    saveState();
    document.getElementById("certDate").textContent = "Completed on " + formatLongDate(new Date());
    openModal("certModalOverlay");
    fireConfetti(true);
  }
}

function duplicateTask(id){
  const task = STATE.tasks.find(t=>t.id===id);
  if(!task) return;
  const newTask = { ...task, id: `task-user-${Date.now()}`, completed:false };
  STATE.tasks.push(newTask);
  saveState();
  showToast("Task duplicated", "success");
  renderDaily(); renderDashboard();
}

function deleteTask(id){
  STATE.tasks = STATE.tasks.filter(t=>t.id!==id);
  saveState();
  showToast("Task deleted", "danger");
  renderDaily(); renderDashboard();
}

/* --- Drag and drop reordering within a day --- */
function enableDragAndDrop(container, dateISO){
  let dragEl = null;
  container.querySelectorAll(".task-card").forEach(card=>{
    card.addEventListener("dragstart", ()=>{
      dragEl = card;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", ()=>{
      card.classList.remove("dragging");
      dragEl = null;
      persistOrderFromDOM(container, dateISO);
    });
    card.addEventListener("dragover", (e)=>{
      e.preventDefault();
      const after = getDragAfterElement(container, e.clientY);
      if(!dragEl) return;
      if(after == null){
        container.appendChild(dragEl);
      } else {
        container.insertBefore(dragEl, after);
      }
    });
  });
}
function getDragAfterElement(container, y){
  const els = [...container.querySelectorAll(".task-card:not(.dragging)")];
  return els.reduce((closest, child)=>{
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height/2;
    if(offset < 0 && offset > closest.offset){
      return { offset, element: child };
    } else return closest;
  }, { offset: -Infinity }).element;
}
function persistOrderFromDOM(container, dateISO){
  const ids = [...container.querySelectorAll(".task-card")].map(c=>c.dataset.id);
  ids.forEach((id, idx)=>{
    const task = STATE.tasks.find(t=>t.id===id);
    if(task) task.order = idx+1;
  });
  saveState();
}

/* ---------------------------------------------------------
   18. RESCHEDULE (auto-shift dependent tasks)
--------------------------------------------------------- */
let rescheduleTaskId = null;

function openRescheduleModal(id){
  rescheduleTaskId = id;
  const task = STATE.tasks.find(t=>t.id===id);
  document.getElementById("rescheduleTaskName").textContent = `${task.topic} — currently ${formatShortDate(fromISODate(task.date))}`;
  document.getElementById("rescheduleCustomDate").value = task.date;
  openModal("rescheduleModalOverlay");
}

function performReschedule(newDateISO){
  const task = STATE.tasks.find(t=>t.id===rescheduleTaskId);
  if(!task) return;

  const oldDate = fromISODate(task.date);
  const newDate = fromISODate(newDateISO);
  const dayShift = Math.round((newDate - oldDate) / 86400000);
  if(dayShift === 0){ closeModal("rescheduleModalOverlay"); return; }

  // Shift this task and every task scheduled on/after the old date within the same category chain,
  // per spec: "everything after it shifts automatically" — apply to ALL tasks on/after old date.
  STATE.tasks.forEach(t=>{
    if(t.date >= task.date){
      t.date = toISODate(addDays(fromISODate(t.date), dayShift));
    }
  });

  // A manual reschedule is a fresh, explicit commitment to a new date —
  // clear this task's "missed" status rather than carrying the old debt forward.
  delete task.missedFromDate;

  saveState();
  closeModal("rescheduleModalOverlay");
  showToast(`Rescheduled — all later tasks shifted by ${dayShift>0?"+":""}${dayShift} day(s)`, "warning");
  renderDaily(); renderDashboard();
  if(document.getElementById("panel-weekly").classList.contains("active")) renderWeekly();
  if(document.getElementById("panel-monthly").classList.contains("active")) renderMonthly();
}

function initRescheduleModal(){
  document.getElementById("rescheduleModalClose").addEventListener("click", ()=>closeModal("rescheduleModalOverlay"));
  document.querySelectorAll("[data-reschedule]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const task = STATE.tasks.find(t=>t.id===rescheduleTaskId);
      const base = fromISODate(task.date);
      let target;
      if(btn.dataset.reschedule === "tomorrow") target = addDays(base,1);
      if(btn.dataset.reschedule === "nextweek") target = addDays(base,7);
      performReschedule(toISODate(target));
    });
  });
  document.getElementById("rescheduleConfirmBtn").addEventListener("click", ()=>{
    const val = document.getElementById("rescheduleCustomDate").value;
    if(val) performReschedule(val);
  });
}

/* ---------------------------------------------------------
   19. TASK MODAL (Add / Edit)
--------------------------------------------------------- */
function initTaskModal(){
  document.getElementById("taskModalClose").addEventListener("click", ()=>closeModal("taskModalOverlay"));
  document.getElementById("taskFormCancel").addEventListener("click", ()=>closeModal("taskModalOverlay"));
  document.getElementById("taskForm").addEventListener("submit", (e)=>{
    e.preventDefault();
    saveTaskFromForm();
  });

  const catSel = document.getElementById("taskFormCategory");
  catSel.innerHTML = ROADMAP.meta.categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
}

function openTaskModal(id, prefillDate){
  const isEdit = !!id;
  document.getElementById("taskModalTitle").textContent = isEdit ? "Edit Task" : "Add Task";
  const form = document.getElementById("taskForm");
  form.reset();
  document.getElementById("taskFormId").value = id || "";

  if(isEdit){
    const task = STATE.tasks.find(t=>t.id===id);
    document.getElementById("taskFormTopic").value = task.topic;
    document.getElementById("taskFormCategory").value = task.category;
    document.getElementById("taskFormDate").value = task.date;
    document.getElementById("taskFormDuration").value = task.durationMinutes;
    document.getElementById("taskFormDifficulty").value = task.difficulty;
    document.getElementById("taskFormPriority").value = task.priority;
  } else {
    document.getElementById("taskFormDate").value = prefillDate || toISODate(currentDailyDate);
    document.getElementById("taskFormDuration").value = 30;
  }
  openModal("taskModalOverlay");
}

function saveTaskFromForm(){
  const id = document.getElementById("taskFormId").value;
  const topic = document.getElementById("taskFormTopic").value.trim();
  const category = document.getElementById("taskFormCategory").value;
  const date = document.getElementById("taskFormDate").value;
  const durationMinutes = parseInt(document.getElementById("taskFormDuration").value, 10);
  const difficulty = document.getElementById("taskFormDifficulty").value;
  const priority = document.getElementById("taskFormPriority").value;

  if(!topic || !date) return;

  if(id){
    const task = STATE.tasks.find(t=>t.id===id);
    Object.assign(task, { topic, category, date, durationMinutes, difficulty, priority });
    // Explicit edit to the date is a fresh commitment — drop any carried-over "missed" status.
    if(date >= toISODate(new Date())) delete task.missedFromDate;
    showToast("Task updated", "success");
  } else {
    const newId = `task-user-${Date.now()}`;
    const order = getTasksForDate(date).length + 1;
    STATE.tasks.push({ id:newId, date, category, topic, durationMinutes, difficulty, priority, completed:false, order });
    showToast("Task added", "success");
  }

  saveState();
  closeModal("taskModalOverlay");
  renderDaily(); renderDashboard();
  if(document.getElementById("panel-weekly").classList.contains("active")) renderWeekly();
  if(document.getElementById("panel-monthly").classList.contains("active")) renderMonthly();
}

/* ---------------------------------------------------------
   20. WEEKLY VIEW
--------------------------------------------------------- */
function initWeeklyView(){
  currentWeekAnchor = new Date();
  document.getElementById("weekPrev").addEventListener("click", ()=>{
    currentWeekAnchor = addDays(currentWeekAnchor, -7);
    renderWeekly();
  });
  document.getElementById("weekNext").addEventListener("click", ()=>{
    currentWeekAnchor = addDays(currentWeekAnchor, 7);
    renderWeekly();
  });
  const notesArea = document.getElementById("weeklyNotesArea");
  notesArea.addEventListener("input", debounce(()=>{
    const key = toISODate(startOfWeek(currentWeekAnchor));
    STATE.notes.weekly[key] = notesArea.value;
    saveState();
  }, 400));
}

function renderWeekly(){
  const start = startOfWeek(currentWeekAnchor);
  const end = addDays(start,6);
  document.getElementById("weeklyViewLabel").textContent = `${formatShortDate(start)} – ${formatShortDate(end)}`;

  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  let html = "";
  for(let i=0;i<7;i++){
    const d = addDays(start,i);
    const iso = toISODate(d);
    const tasks = getTasksForDate(iso);
    const prog = calcProgress(tasks);
    const today = isSameDay(d, new Date());
    html += `
      <div class="weekly-day-card ${today?"today":""}" data-date="${iso}">
        <div class="weekly-day-name">${dayNames[i]}</div>
        <div class="weekly-day-date">${formatShortDate(d)}</div>
        <div class="weekly-mini-bar"><div class="weekly-mini-bar-fg" style="width:${prog.pct}%"></div></div>
        <div class="weekly-day-stats">
          <span>${prog.completed} done · ${prog.pending} left</span>
          <span>${minutesToHoursLabel(prog.minutes)} studied</span>
        </div>
      </div>`;
  }
  const grid = document.getElementById("weeklyGrid");
  grid.innerHTML = html;
  grid.querySelectorAll(".weekly-day-card").forEach(card=>{
    card.addEventListener("click", ()=>{
      currentDailyDate = fromISODate(card.dataset.date);
      activateTab("daily");
      renderDaily();
    });
  });

  const weekKey = toISODate(start);
  document.getElementById("weeklyNotesArea").value = STATE.notes.weekly[weekKey] || "";
}

/* ---------------------------------------------------------
   21. MONTHLY VIEW
--------------------------------------------------------- */
function initMonthlyView(){
  currentMonthAnchor = startOfMonth(new Date());
  document.getElementById("monthPrev").addEventListener("click", ()=>{
    currentMonthAnchor = new Date(currentMonthAnchor.getFullYear(), currentMonthAnchor.getMonth()-1, 1);
    renderMonthly();
  });
  document.getElementById("monthNext").addEventListener("click", ()=>{
    currentMonthAnchor = new Date(currentMonthAnchor.getFullYear(), currentMonthAnchor.getMonth()+1, 1);
    renderMonthly();
  });
  const notesArea = document.getElementById("monthlyNotesArea");
  notesArea.addEventListener("input", debounce(()=>{
    const key = `${currentMonthAnchor.getFullYear()}-${pad2(currentMonthAnchor.getMonth()+1)}`;
    STATE.notes.monthly[key] = notesArea.value;
    saveState();
  }, 400));
}

function renderMonthly(){
  const y = currentMonthAnchor.getFullYear(), m = currentMonthAnchor.getMonth();
  document.getElementById("monthlyViewLabel").textContent =
    currentMonthAnchor.toLocaleDateString("en-US", { month:"long", year:"numeric" });

  const firstDay = new Date(y,m,1);
  const daysInMonth = new Date(y,m+1,0).getDate();
  const startOffset = firstDay.getDay();

  let html = "";
  for(let i=0;i<startOffset;i++){ html += `<div class="calendar-cell empty"></div>`; }

  for(let day=1; day<=daysInMonth; day++){
    const d = new Date(y,m,day);
    const iso = toISODate(d);
    const tasks = getTasksForDate(iso);
    const prog = calcProgress(tasks);
    const today = isSameDay(d, new Date());
    const selected = selectedCalendarDate === iso;
    const cats = [...new Set(tasks.map(t=>t.category))].slice(0,4);
    html += `
      <div class="calendar-cell ${today?"today":""} ${selected?"selected":""}" data-date="${iso}">
        <span class="cal-day-num">${day}</span>
        <span class="cal-day-dot-row">${cats.map(c=>`<span class="cal-dot" style="background:${categoryColors[c]||"#999"}"></span>`).join("")}</span>
        <span class="cal-progress-text">${tasks.length? prog.pct+"%":""}</span>
      </div>`;
  }

  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = html;
  grid.querySelectorAll(".calendar-cell:not(.empty)").forEach(cell=>{
    cell.addEventListener("click", ()=>{
      selectedCalendarDate = cell.dataset.date;
      renderMonthly();
      showMonthDayDetail(cell.dataset.date);
    });
  });

  if(selectedCalendarDate) showMonthDayDetail(selectedCalendarDate);

  const monthKey = `${y}-${pad2(m+1)}`;
  document.getElementById("monthlyNotesArea").value = STATE.notes.monthly[monthKey] || "";
}

function showMonthDayDetail(iso){
  const panel = document.getElementById("monthDayDetail");
  const tasks = getTasksForDate(iso);
  const prog = calcProgress(tasks);
  document.getElementById("monthDayDetailTitle").textContent = formatLongDate(fromISODate(iso));

  if(tasks.length === 0){
    document.getElementById("monthDayDetailBody").innerHTML = `<p class="muted">No tasks scheduled for this day.</p>`;
  } else {
    document.getElementById("monthDayDetailBody").innerHTML = `
      <p class="muted" style="margin-bottom:14px;">${prog.completed}/${prog.total} completed · ${prog.pct}% · ${minutesToHoursLabel(prog.minutes)} studied</p>
      <div class="task-list">${tasks.map(taskCardHTML).join("")}</div>
    `;
    attachTaskCardEvents(document.getElementById("monthDayDetailBody"));
  }
  panel.hidden = false;
}

/* ---------------------------------------------------------
   22. STATISTICS VIEW
--------------------------------------------------------- */
function renderStatistics(){
  const overall = overallProgress();
  const cards = [
    { label:"Current Streak", value: `${STATE.streak} days` },
    { label:"Longest Streak", value: `${STATE.longestStreak} days` },
    { label:"Total Study Hours", value: minutesToHoursLabel(overall.minutes) },
    { label:"Tasks Remaining", value: overall.pending },
    { label:"Tasks Completed", value: overall.completed },
    { label:"Completion %", value: overall.pct + "%" },
    { label:"Level", value: `Lvl ${currentLevel()}` },
    { label:"XP", value: STATE.xp },
  ];
  document.getElementById("statsDetailGrid").innerHTML = cards.map(c=>`
    <div class="stat-card">
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div>
  `).join("");

  const cats = ROADMAP.meta.categories;
  document.getElementById("categoryBarChart").innerHTML = cats.map(c=>{
    const p = categoryProgress(c);
    const color = categoryColors[c] || "#999";
    return `<div class="bar-row">
      <span class="bar-label">${escapeHtml(c)}</span>
      <div class="bar-track"><div class="bar-fg" style="width:${p.pct}%; background:${color}"></div></div>
      <span class="bar-pct">${p.pct}%</span>
    </div>`;
  }).join("");

  const fg = document.getElementById("statsDonutFg");
  const circumference = 2*Math.PI*60;
  fg.style.strokeDasharray = circumference;
  fg.style.strokeDashoffset = circumference - (overall.pct/100)*circumference;
  document.getElementById("statsDonutPercent").textContent = overall.pct + "%";
}

/* ---------------------------------------------------------
   23. TIMELINE
--------------------------------------------------------- */
function renderTimeline(){
  const now = new Date();
  document.getElementById("timelineWrap").innerHTML = ROADMAP.timeline.map(item=>{
    const itemDate = fromISODate(item.date);
    const active = itemDate <= now;
    return `<div class="timeline-item ${active?"active":""}" data-date="${item.date}">
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-label">${escapeHtml(item.label)}</div>
        <div class="timeline-sub">${escapeHtml(item.sublabel)}</div>
        <div class="timeline-date">${formatShortDate(itemDate)}</div>
      </div>
    </div>`;
  }).join("");

  document.querySelectorAll(".timeline-item").forEach(item=>{
    item.addEventListener("click", ()=>{
      currentDailyDate = fromISODate(item.dataset.date);
      activateTab("daily");
      document.querySelector('.nav-link[data-nav="daily"]').click();
    });
  });
}

/* ---------------------------------------------------------
   24. SEARCH / COMMAND PALETTE
--------------------------------------------------------- */
function initCommandPalette(){
  const overlay = document.getElementById("cmdOverlay");
  const input = document.getElementById("cmdInput");

  document.getElementById("searchToggle").addEventListener("click", ()=> openCommandPalette());

  document.addEventListener("keydown", (e)=>{
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="k"){
      e.preventDefault();
      openCommandPalette();
    }
    if(e.key === "Escape"){
      closeCommandPalette();
      closeAllModals();
    }
    if(e.key.toLowerCase()==="t" && !isTypingContext(e.target)){
      toggleTheme();
    }
  });

  overlay.addEventListener("click", (e)=>{ if(e.target===overlay) closeCommandPalette(); });
  input.addEventListener("input", debounce(()=> renderSearchResults(input.value), 120));
}

function isTypingContext(el){
  return ["INPUT","TEXTAREA","SELECT"].includes(el.tagName);
}

function openCommandPalette(){
  document.getElementById("cmdOverlay").classList.add("open");
  const input = document.getElementById("cmdInput");
  input.value = "";
  renderSearchResults("");
  setTimeout(()=> input.focus(), 50);
}
function closeCommandPalette(){
  document.getElementById("cmdOverlay").classList.remove("open");
}

function renderSearchResults(query){
  const q = query.trim().toLowerCase();
  const resultsEl = document.getElementById("cmdResults");

  let matches = STATE.tasks;
  if(q){
    matches = STATE.tasks.filter(t =>
      t.topic.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
    );
  }
  matches = matches.slice(0, 30).sort((a,b)=> a.date.localeCompare(b.date));

  if(matches.length === 0){
    resultsEl.innerHTML = `<div class="cmd-result-item"><span class="r-meta">No matching tasks found.</span></div>`;
    return;
  }

  resultsEl.innerHTML = matches.map(t=>`
    <div class="cmd-result-item" data-id="${t.id}" data-date="${t.date}">
      <div>
        <div class="r-topic">${escapeHtml(t.topic)}</div>
        <div class="r-meta">${escapeHtml(t.category)} · ${formatShortDate(fromISODate(t.date))}</div>
      </div>
      <span class="priority-pill priority-${t.priority}">${t.priority}</span>
    </div>
  `).join("");

  resultsEl.querySelectorAll(".cmd-result-item[data-date]").forEach(el=>{
    el.addEventListener("click", ()=>{
      currentDailyDate = fromISODate(el.dataset.date);
      closeCommandPalette();
      document.querySelector('.nav-link[data-nav="daily"]').click();
    });
  });
}

/* ---------------------------------------------------------
   25. MODALS (generic open/close)
--------------------------------------------------------- */
function openModal(id){ document.getElementById(id).classList.add("open"); }
function closeModal(id){ document.getElementById(id).classList.remove("open"); }
function closeAllModals(){
  document.querySelectorAll(".modal-overlay").forEach(m=>m.classList.remove("open"));
}
function initModalDismiss(){
  document.querySelectorAll(".modal-overlay").forEach(overlay=>{
    overlay.addEventListener("click", (e)=>{ if(e.target === overlay) overlay.classList.remove("open"); });
  });
  document.getElementById("certModalClose").addEventListener("click", ()=>closeModal("certModalOverlay"));
}

/* ---------------------------------------------------------
   26. FAB
--------------------------------------------------------- */
function initFab(){
  const fab = document.getElementById("fabMain");
  const menu = document.getElementById("fabMenu");
  fab.addEventListener("click", ()=>{
    const open = menu.classList.toggle("open");
    fab.classList.toggle("open", open);
    fab.setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll("[data-fab]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const action = btn.dataset.fab;
      if(action==="addTask") openTaskModal(null, toISODate(currentDailyDate || new Date()));
      if(action==="cmd") openCommandPalette();
      if(action==="top") window.scrollTo({top:0, behavior:"smooth"});
      menu.classList.remove("open");
      fab.classList.remove("open");
    });
  });
}

/* ---------------------------------------------------------
   27. SETTINGS: EXPORT / IMPORT / PRINT / RESET
--------------------------------------------------------- */
function initSettings(){
  document.getElementById("exportJsonBtn").addEventListener("click", exportProgress);
  document.getElementById("importJsonInput").addEventListener("change", importProgress);
  document.getElementById("printBtn").addEventListener("click", ()=>{
    const scope = document.getElementById("printScope").value;
    buildPrintDocument(scope);
    // Let the browser paint the freshly-built print DOM before opening the dialog.
    requestAnimationFrame(()=> requestAnimationFrame(()=> window.print()));
  });
  document.getElementById("resetBtn").addEventListener("click", resetProgress);
}

/* --- Branded print/PDF document builder --- */
function buildPrintDocument(scope){
  const now = new Date();
  const generatedStr = now.toLocaleString("en-US", { dateStyle:"medium", timeStyle:"short" });
  let title = "";
  let summaryHTML = "";
  let bodyHTML = "";

  if(scope === "week"){
    const anchor = currentWeekAnchor || new Date();
    const start = startOfWeek(anchor);
    const end = addDays(start,6);
    const tasks = weekTasks(anchor);
    const prog = calcProgress(tasks);
    title = `Weekly Planner — ${formatShortDate(start)} to ${formatShortDate(end)}`;
    summaryHTML = printSummaryRow([
      { val:`${prog.completed}/${prog.total}`, label:"Tasks" },
      { val:`${prog.pct}%`, label:"Completion" },
      { val: minutesToHoursLabel(prog.minutes), label:"Study Hours" },
      { val:`${ROADMAP.meta.weeklyGoalHours}h`, label:"Weekly Goal" },
    ]);
    let days = "";
    for(let i=0;i<7;i++){
      const iso = toISODate(addDays(start,i));
      const dayTasks = getTasksForDate(iso);
      if(dayTasks.length) days += printDaySection(iso, dayTasks, true);
    }
    bodyHTML = days || `<p class="print-empty-note">No tasks scheduled this week.</p>`;

  } else if(scope === "all"){
    const overall = overallProgress();
    title = `Full Roadmap — ${ROADMAP.meta.projectName}`;
    summaryHTML = printSummaryRow([
      { val:`${overall.completed}/${overall.total}`, label:"Tasks" },
      { val:`${overall.pct}%`, label:"Overall Completion" },
      { val: minutesToHoursLabel(overall.minutes), label:"Study Hours" },
      { val:`${STATE.longestStreak} days`, label:"Longest Streak" },
    ]);
    const datesSorted = [...new Set(STATE.tasks.map(t=>t.date))].sort();
    bodyHTML = datesSorted.map(iso => printDaySection(iso, getTasksForDate(iso), true)).join("")
      || `<p class="print-empty-note">No tasks in the roadmap yet.</p>`;

  } else { // "today"
    const iso = toISODate(currentDailyDate || new Date());
    const tasks = getTasksForDate(iso);
    const prog = calcProgress(tasks);
    title = `Daily Planner — ${formatLongDate(fromISODate(iso))}`;
    summaryHTML = printSummaryRow([
      { val:`${prog.completed}/${prog.total}`, label:"Tasks" },
      { val:`${prog.pct}%`, label:"Completion" },
      { val: minutesToHoursLabel(prog.minutes), label:"Study Hours" },
      { val:`${STATE.streak} days`, label:"Current Streak" },
    ]);
    bodyHTML = tasks.length
      ? printDaySection(iso, tasks, false)
      : `<p class="print-empty-note">No tasks scheduled for this day.</p>`;
  }

  const html = `
    <div class="print-doc">
      <div class="print-header">
        <div class="print-logo-row">
          <span class="print-logo-mark">${printLogoSVG()}</span>
          <div>
            <div class="print-brand-name">MomentumForge</div>
            <div class="print-brand-tagline">${escapeHtml(ROADMAP.meta.tagline || "")}</div>
          </div>
        </div>
        <div class="print-doc-meta">
          <strong>${escapeHtml(title)}</strong>
          Generated ${generatedStr}
        </div>
      </div>
      ${summaryHTML}
      ${bodyHTML}
      <div class="print-footer">
        <span>MomentumForge — Placement Preparation Planner</span>
        <span>Page generated automatically</span>
      </div>
    </div>`;

  document.getElementById("printArea").innerHTML = html;
}

function printLogoSVG(){
  return `<svg viewBox="0 0 36 36" width="18" height="18">
    <path d="M8 27 L26 9" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M16 9 L26 9 L26 19" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M4 23 L9 23" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" opacity="0.55"/>
    <path d="M4 18 L7 18" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" opacity="0.3"/>
  </svg>`;
}

function printSummaryRow(items){
  return `<div class="print-summary-row">
    ${items.map(i=>`<div class="print-summary-chip"><div class="p-val">${escapeHtml(String(i.val))}</div><div class="p-label">${escapeHtml(i.label)}</div></div>`).join("")}
  </div>`;
}

function printDaySection(iso, tasks, showDateHeading){
  if(!tasks.length) return "";
  const heading = showDateHeading
    ? `<div class="print-section-title">${escapeHtml(formatLongDate(fromISODate(iso)))}</div>`
    : `<div class="print-section-title">Today's Tasks</div>`;
  const rows = tasks.map(t=>`
    <tr>
      <td class="col-check"><span class="print-checkbox"></span></td>
      <td class="col-topic">${escapeHtml(t.topic)}<br><span style="font-weight:400; color:#5C6B7A; font-size:.78rem;">${escapeHtml(t.category)}</span></td>
      <td class="col-meta">${t.durationMinutes} min</td>
      <td class="col-meta">${escapeHtml(t.difficulty)}</td>
      <td class="col-meta">${escapeHtml(t.priority)} priority</td>
    </tr>`).join("");
  return `
    ${heading}
    <table class="print-task-table">
      <thead><tr><th></th><th>Topic</th><th>Duration</th><th>Difficulty</th><th>Priority</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function exportProgress(){
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `momentumforge-backup-${toISODate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Progress exported", "success");
}

function importProgress(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const imported = JSON.parse(reader.result);
      if(!imported.tasks) throw new Error("Invalid backup file");
      STATE = imported;
      rolloverMissedTasks();
      saveState();
      showToast("Progress restored", "success");
      fullRerender();
    }catch(err){
      showToast("Invalid backup file", "danger");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

function resetProgress(){
  if(!confirm("This will clear all completed checkboxes, notes, and streaks. Continue?")) return;
  localStorage.removeItem(STORAGE_KEY);
  initState();
  buildCategoryColors();
  rolloverMissedTasks();
  showToast("Progress reset", "warning");
  fullRerender();
}

/* ---------------------------------------------------------
   28. CONFETTI
--------------------------------------------------------- */
function fireConfetti(big=false){
  const canvas = document.getElementById("confettiCanvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext("2d");
  const colors = ["#2E75D6", "#123A66", "#5AA0F2", "#0E5C8C", "#93C1F5"];
  const count = big ? 220 : 90;

  const particles = Array.from({length:count}, ()=> ({
    x: Math.random()*canvas.width,
    y: -20 - Math.random()*canvas.height*0.3,
    r: 4 + Math.random()*5,
    color: colors[Math.floor(Math.random()*colors.length)],
    vy: 2 + Math.random()*3,
    vx: -1.5 + Math.random()*3,
    rot: Math.random()*360,
    vr: -6 + Math.random()*12
  }));

  let frame = 0;
  const maxFrames = big ? 220 : 130;

  function draw(){
    ctx.clearRect(0,0,canvas.width, canvas.height);
    particles.forEach(p=>{
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI/180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r/2, -p.r/2, p.r, p.r*0.6);
      ctx.restore();
    });
    frame++;
    if(frame < maxFrames){
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0,0,canvas.width, canvas.height);
    }
  }
  draw();
}

/* ---------------------------------------------------------
   29. FULL RE-RENDER (used after import/reset)
--------------------------------------------------------- */
function fullRerender(){
  renderHero();
  renderDashboard();
  renderSmartSchedule();
  renderDaily();
  renderWeekly();
  renderMonthly();
  renderStatistics();
  renderTimeline();
}

/* ---------------------------------------------------------
   30. KEYBOARD SHORTCUTS (section jump 1-5)
--------------------------------------------------------- */
function initKeyboardShortcuts(){
  document.addEventListener("keydown", (e)=>{
    if(isTypingContext(e.target)) return;
    const map = { "1":"dashboard", "2":"daily", "3":"weekly", "4":"monthly", "5":"statistics" };
    if(map[e.key]){
      document.querySelector(`.nav-link[data-nav="${map[e.key]}"]`)?.click();
    }
  });
}

/* ---------------------------------------------------------
   31. INIT
--------------------------------------------------------- */
async function init(){
  try{
    await loadRoadmap();
  }catch(err){
    document.body.innerHTML = `<div style="padding:60px;text-align:center;font-family:sans-serif;">
      <h2>Could not load roadmap.json</h2>
      <p>Make sure roadmap.json is in the same folder as index.html and you're running this via a local server (not file://).</p>
    </div>`;
    console.error(err);
    return;
  }

  initState();
  buildCategoryColors();
  rolloverMissedTasks();

  // initTheme() already ran once in auth.js, before sign-in even resolved
  // (so the login screen itself respects dark/light preference) — calling
  // it again here would double-register the toggle's click handler.
  initCustomCursor();
  initNavbar();
  initScrollTop();
  initTabs();
  initLiveClock();
  initDailyView();
  populateCategoryFilter();
  initRescheduleModal();
  initTaskModal();
  initWeeklyView();
  initMonthlyView();
  initCommandPalette();
  initModalDismiss();
  initFab();
  initSettings();
  initKeyboardShortcuts();

  renderHero();
  renderDashboard();
  renderSmartSchedule();
  renderDaily();
  renderTimeline();

  toggleScrollTopButton();

  // Refresh hero clock-dependent greeting/quote once per minute in case of long sessions
  setInterval(()=> renderHero(), 60000);

  // Re-check for newly-overdue tasks periodically, in case the tab stays
  // open across midnight — without this, a task due "today" would just
  // sit there unflagged until the next full page load.
  setInterval(()=>{
    if(rolloverMissedTasks()){
      renderDaily();
      renderDashboard();
      if(document.getElementById("panel-weekly").classList.contains("active")) renderWeekly();
      if(document.getElementById("panel-monthly").classList.contains("active")) renderMonthly();
      if(document.getElementById("panel-statistics").classList.contains("active")) renderStatistics();
    }
  }, 5 * 60000);
}

// App startup is now gated behind authentication (see auth.js) instead
// of running automatically on DOMContentLoaded — auth.js calls this once
// a user is signed in (either fresh, or via a remembered session).
window.startMomentumForgeApp = init;