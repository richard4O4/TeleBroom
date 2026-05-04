# TeleBroom

**TeleBroom** (formerly Telegram Group Message Deleter) is a high-performance, Material Design 3 based desktop application to batch delete your messages from Telegram groups and supergroups. Built with Rust (Tauri) and Vanilla JavaScript.

![App Screenshot](https://raw.githubusercontent.com/username/repo/main/screenshot.png)

## 🚀 Features

- **High Speed**: Leverages Telegram's indexed search to find and delete messages instantly.
- **Material Design 3**: A premium, responsive UI with smooth animations and dynamic "Red/Gray" pulse status.
- **Smart Cleanup**: Automatically identifies and grays out groups with 0 messages.
- **Real-time Progress**: Detailed progress bars with per-chat status and global ETA calculation.
- **Rate Limit Aware**: Handles `FLOOD_WAIT` gracefully with transparent countdown timers.
- **Cross Platform**: Supports macOS (Apple Silicon/Intel), Windows, and Linux (Debian/Fedora).

## ⏳ Flood Wait Handling

Telegram imposes rate limits ("Flood Wait") on frequent API calls like message deletion. TeleBroom handles them automatically:
- **Intelligent Backoff**: If a limit is hit, the app pauses for the duration required by Telegram (displayed in the UI).
- **Safe Intervals**: A built-in 300ms delay between batches minimizes the chance of hitting limits.
- **Transparent Feedback**: You'll see a real-time countdown badge on affected chats.

## 🛠 Installation

Download the latest version from the [Releases](https://github.com/username/repo/releases) page.

## 🏗️ Development

### Prerequisites
- [Rust](https://www.rust-lang.org/)
- [Node.js](https://nodejs.org/)
- [Tauri Dependencies](https://tauri.app/v1/guides/getting-started/prerequisites)

### Setup
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run in development mode:
   ```bash
   npm run tauri dev
   ```
4. Build for production:
   ```bash
   npm run tauri build
   ```

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚖️ Disclaimer

This tool is for personal use only. Please respect Telegram's Terms of Service. The developers are not responsible for any account bans or data loss.
