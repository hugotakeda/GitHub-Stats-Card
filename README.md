<div align="center">

# GitHub Stats Card

**A combined GitHub Stats + Languages card with the [Energy Rhythm](https://github.com/hugotakeda/Energy-Rhythm-Contribution-Graph) palette.**  
Automatically generates a premium SVG showing your stats and most used languages side by side.

[![License: MIT](https://img.shields.io/badge/License-MIT-blueviolet?style=flat-square)](./LICENSE)

</div>

---

<div align="center">

## Preview

<p align="center">
  <img src="https://raw.githubusercontent.com/hugotakeda/GitHub-Stats-Card/main/dist/github-stats.svg" />
</p>

</div>

---

## Features

| Left Panel | Right Panel |
|---|---|
| ⭐ Total Stars | 📊 Language bar (proportional) |
| 🔥 Total Commits (year) | 🎨 Top 6 languages with % |
| 🔀 Total PRs | |
| ❗ Total Issues | |
| 📦 Contributed to | |
| 🏅 Grade ring (S → C) | |

- **Dark theme** matching the Energy Rhythm palette
- **CSS animations** (fade-in, ring draw, bar grow)
- **Zero dependencies** — pure Node.js with built-in `fetch`
- **No cron** — updates only on push or manual trigger

---

## Quick Start (5 minutes)

1. **Fork** this repository.

2. Generate a **Personal Access Token (classic)** with `repo` and `read:user` scopes at [github.com/settings/tokens](https://github.com/settings/tokens).

3. In your fork, go to **Settings → Secrets and variables → Actions** and add a new secret:
   - **Name:** `STATS_TOKEN`
   - **Value:** *(your generated token)*

4. Go to the **Actions** tab, select **Generate GitHub Stats SVG**, and click **Run workflow**.

5. Add the generated SVG to your profile README:

```markdown
<p align="center">
  <img src="https://raw.githubusercontent.com/YOUR_USERNAME/GitHub-Stats-Card/main/dist/github-stats.svg" />
</p>
```

---

## Grade Scale

| Grade | Percentile | Meaning |
|:---:|:---:|---|
| **S** | ≥ 95% | Legendary |
| **A+** | ≥ 85% | Outstanding |
| **A** | ≥ 70% | Excellent |
| **B+** | ≥ 55% | Great |
| **B** | ≥ 40% | Good |
| **C** | < 40% | Getting started |

---

## License

[MIT](./LICENSE)
