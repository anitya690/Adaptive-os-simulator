# 🖥️ Adaptive Resource Allocation — OS Simulator

A cyberpunk-themed, interactive **Operating System simulator** built with pure HTML, CSS, and JavaScript.  
Simulates **CPU scheduling**, **memory allocation**, and **process management** in real time.

---

## 📁 Project Structure

```
adaptive-os-simulator/
├── index.html    ← Main HTML structure
├── style.css     ← All styling (cyberpunk dark theme)
├── script.js     ← All simulation logic
└── README.md     ← This file
```

---

## ✨ Features

- **5 CPU Scheduling Algorithms** — Round Robin, SJF, Priority, FCFS, MLFQ
- **3 Memory Allocation Policies** — First Fit, Best Fit, Worst Fit
- **Real-time Charts** — CPU/Memory trend line chart + process state doughnut
- **Gantt Chart** — Last 24 ticks of CPU execution
- **Memory Map** — Visual 1024 MB allocation bar
- **Process Aging** — Prevents starvation by boosting priority over time
- **I/O Simulation** — Processes randomly block/unblock on I/O
- **Bottleneck Detection** — Alerts when memory > 85% or too many blocked processes
- **Preset Processes** — Load Chrome, Compiler, Database, WebServer etc.

---

## 🚀 How to Run Locally

Just open `index.html` in any browser. No server or installation needed.

```bash
# Option 1: Simply double-click index.html
# Option 2: Use VS Code Live Server extension
# Option 3: Use Python server
python -m http.server 8000
# Then open http://localhost:8000
```

---

## 👥 Team / Contributors

| Name | Role |
|------|------|
| Your Name | Developer |
| Teammate 1 | Developer |
| Teammate 2 | Developer |

---

## 🛠️ Technologies Used

- HTML5
- CSS3 (CSS Variables, Grid, Flexbox, Animations)
- Vanilla JavaScript (ES6+)
- [Chart.js](https://www.chartjs.org/) — for trend and doughnut charts
- [Google Fonts](https://fonts.google.com/) — Orbitron + JetBrains Mono

---

## 📄 License

MIT License — free to use and modify.
