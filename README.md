# MomentumForge

**Turn daily effort into placement-ready progress.**

A premium, fully interactive placement-preparation planner built with pure HTML, CSS, and vanilla JavaScript — designed to feel like a modern productivity SaaS product (in the spirit of Notion, Linear, and Todoist) rather than a static checklist or PDF.

---

## ✨ Project Description

MomentumForge turns a static study roadmap into a living, data-driven web app. Every task, date, category, tip, warning, and timeline milestone is loaded dynamically from a single `roadmap.json` file — nothing is hardcoded into the HTML or JavaScript. Swap in a new `roadmap.json` and the entire app (dashboard, daily/weekly/monthly views, statistics, timeline) reflects the new plan automatically.

The app tracks daily DSA, Development, DSA-Sheet, and Revision tasks, auto-calculates weekly/monthly/overall progress from daily completions, and includes an automatic rescheduling engine: mark a task for a new date and every task scheduled afterward shifts by the same number of days — no manual re-entry required.

---

## 🎨 Design System

MomentumForge uses a single-hue, all-blue professional palette — no secondary accent colors — for a clean, corporate-SaaS feel:

| Token | Hex | Use |
|---|---|---|
| Background | `#FFFFFF` | Page background |
| Surface | `#F4F7FB` | Cards, panels |
| Border | `#E1E8F1` | Card borders, dividers |
| Primary | `#123A66` | Headings, primary buttons, ring charts |
| Primary Light | `#1F5691` | Hover states |
| Accent | `#2E75D6` | Interactive highlights, active states, links |
| Text | `#1C2B3A` | Body copy |
| Text Muted | `#63758A` | Secondary copy |
| Success | `#2E9E6B` | Completed states |
| Warning | `#D98324` | Warning cards |
| Danger | `#D1495B` | Destructive actions |

A matching dark theme swaps these for lighter blue tones on a near-navy background, toggled from the navbar and persisted in Local Storage.

---

## 🚀 Features

### Core Planning
- **Dynamic data model** — all tasks, dates, categories, difficulty, priority, tips, warnings, smart-schedule numbers, and timeline milestones are read from `roadmap.json`
- **Daily / Weekly / Monthly / Statistics** tabs, fully interconnected — completing a daily task instantly updates weekly, monthly, and overall progress
- **Missed-task auto-rollover** — if a task isn't completed by the end of its day, it automatically moves onto today's list — no manual rescheduling needed just because you ran out of time. It's tagged with a danger-red banner showing exactly how many days overdue it is (this count keeps climbing correctly even if the app isn't opened for several days) and a rotating, no-excuses accountability message. A summary banner at the top of the Daily view flags the total when there's more than one. Clearing it is simple: finish the task, or use the reschedule button to explicitly move it and reset the count.
- **Auto-scheduling engine** — reschedule any task to tomorrow, next week, or a custom date, and every task on or after it shifts automatically
- **Drag-and-drop reordering** within a day
- **Add / Edit / Duplicate / Delete** for every task
- **Smart warning cards** — topics like Recursion, Graphs, Dynamic Programming, Trees, React, and Backend Mega Project automatically surface an "extra time required" card when they appear in the current view
- **Smart Time Management panel** — recommended weekday/weekend hour allocation, sourced from JSON

### Dashboard & Insights
- Live stat cards: today's tasks, weekly/monthly/overall completion, current & longest streak, completed/pending counts
- Daily tip, interview tip, coding tip, and placement tip — rotate daily, sourced from JSON
- Pure-CSS/JS bar chart (category completion) and donut/ring chart (overall completion) — **no chart libraries**
- Vertical interactive roadmap timeline, clickable milestones

### Experience & Polish
- **Theme toggle** — animated sun/moon switch, persisted in Local Storage, respects system preference on first load
- **Custom cursor** — a "focus bracket" viewfinder design: four L-shaped corner marks frame the pointer like a camera locking onto its subject, with a precise center dot. The core dot tracks the pointer with zero lag; the bracket frame trails with light, GPU-composited easing (`translate3d`, not `left`/`top`) so it stays smooth at 60fps. The frame breathes outward and rotates slightly on hover, snaps inward on click with a soft focus-lock flash — no generic ripple bursts. Automatically disabled on touch devices.
- **Command palette** (`Ctrl/Cmd + K`) — instant task search across the whole roadmap
- **Floating Action Button** with quick actions (Add Task / Command Palette / Scroll to Top)
- **Scroll-to-top** button with smooth fade/slide
- **Confetti micro-interaction** when a full day's tasks are completed, and a **certificate modal** when the entire roadmap is finished
- **XP + Level system** (Level 1 → 100) awarded per completed task by difficulty
- **Branded Print / Export PDF** — Settings → Printable Planner builds a dedicated, letter-formatted document (not just a stripped-down copy of the on-screen UI): a MomentumForge letterhead, a stats summary strip, and a clean checkbox task table. Choose the scope — **Today**, **This Week**, or **Full Roadmap** — then print or "Save as PDF" from the browser's print dialog.
- **Backup & Restore** — export all progress/notes/streaks as JSON, re-import anytime
- Keyboard shortcuts: `Ctrl/Cmd+K` search, `T` theme toggle, `1–5` section jump, `Esc` close dialogs

### Technical
- 100% Vanilla JS — no React/Vue/Angular/jQuery/Firebase/Tailwind/Bootstrap
- Fully responsive: mobile, tablet, desktop, large screens
- Local Storage persistence for tasks, notes, theme, streaks, and reschedules — survives refresh
- Accessible: skip link, ARIA roles/labels on tabs and controls, keyboard-navigable, high-contrast palette

---

## 📁 Folder Structure

```
momentumforge/
├── index.html          # App shell & semantic markup
├── style.css            # Full design system, theme variables, responsive rules, animations
├── script.js             # All application logic (data loading, rendering, state, interactions)
├── roadmap.json         # ALL roadmap data — tasks, tips, warnings, timeline, schedule
├── assets/          # (placeholder for future custom imagery)
│   └── icons/           # (placeholder for future custom icons)
└── README.md
```

---

## 🎨 Technologies Used

| Layer      | Technology                          |
|------------|--------------------------------------|
| Structure  | Semantic HTML5                       |
| Styling    | CSS3 (custom properties, Grid, Flexbox, keyframe animations) |
| Behavior   | Vanilla JavaScript (ES6+)            |
| Fonts      | Google Fonts — Poppins (headings), Inter (body) |
| Data       | Static JSON (`roadmap.json`), Local Storage for persistence |

No build tools, bundlers, or frameworks required.

---

## 📄 Using Print / Export PDF

1. Go to **Settings → Printable Planner**.
2. Choose a scope: **Today's Tasks**, **This Week**, or **Full Roadmap**.
3. Click **Print / Export PDF** — the browser's print dialog opens with a clean, branded document (MomentumForge letterhead, summary stats, and a checkbox task table grouped by day).
4. In the print dialog, choose **Save as PDF** as the destination to export a file instead of printing on paper.

---

## 🔄 Reusing This Planner for a Different Roadmap

Replace the contents of `roadmap.json` with your own data (same schema: `meta`, `quotes`, `tips`, `warnings`, `smartSchedule`, `timeline`, `tasks`, `notes`) and the entire application — dashboard, daily/weekly/monthly views, statistics, warning cards, timeline, and the printable document — updates automatically. No HTML, CSS, or JS changes needed.

---

## 🔭 Future Improvements

- Cloud sync (Firebase/Supabase) for cross-device persistence
- Native PDF export using a headless rendering library instead of browser print
- Recurring/templated tasks (e.g. "every weekday at 9 AM")
- Multi-roadmap support with a roadmap switcher in Settings
- Push/browser notifications for upcoming tasks
- Collaborative/shared roadmaps for study groups
- Chart library integration (optional) for more advanced analytics

