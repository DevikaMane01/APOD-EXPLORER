## APOD Explorer

<p align="center">
<img src="https://img.shields.io/badge/node-%3E%3D14.0-green" alt="Node Version" />
<img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
<img src="https://img.shields.io/badge/status-active-success" alt="Status" />
</p>

<p align="center">
A simple Node.js application to explore NASA's Astronomy Picture of the Day (APOD).
</p>

## 📦 Installation & Setup

You can set up the project using the command line (CLI) or by downloading it manually.

### Method 1: CLI (Git Clone)
**Recommended for developers.**

```bash
# 1. Clone the repository
git clone https://github.com/DevikaMane01/APOD-EXPLORER.git

# 2. Navigate to the project directory
cd APOD-EXPLORER

# 3. Install dependencies
npm install

# 4. Start the application
npm start
```

### Method 2: Manual Download
**If you don't use Git.**

1. Click the green **Code** button at the top of this page.
2. Select **Download ZIP**.
3. Extract the ZIP file to a folder on your computer.
4. Open that folder in your terminal/command prompt.
5. Run `npm install` to get the dependencies.
6. Run `npm start` to launch.

## ⚙️ Configuration (.env)

**Important:** This project requires a `.env` file to function correctly. You must create this file in the root directory of the project.

1. Create a file named `.env` at `apod-explorer/backend` location.
2. Add the following contents:

```env
NASA_API_KEY=your_actual_nasa_api_key_here
PORT=5000
```

**Note:** You can get a free API key from [api.nasa.gov](https://api.nasa.gov).

## ⚠️ Warnings & Troubleshooting

- **API Key Limits:** NASA's demo keys have rate limits. If images stop loading, ensure your `NASA_API_KEY` in the `.env` file is valid and not over its quota.
- **Port Conflicts:** If `PORT=5000` is already in use by another application, change the port number in your `.env` file (e.g., `PORT=3000`).
- **Node Version:** Ensure you have Node.js installed. You can check by running `node -v` in your terminal.

---

