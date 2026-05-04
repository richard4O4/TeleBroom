# TeleBroom

<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="TeleBroom Logo">
</p>

**TeleBroom** (formerly Telegram Group Message Deleter) is a high-performance, Material Design 3 based desktop application to batch delete your messages from Telegram groups and supergroups. Built with Rust (Tauri) and Vanilla JavaScript.

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

Download the latest version from the [Releases](https://github.com/richard4O4/TeleBroom/releases) page.

## 🔑 Telegram API Setup

To use TeleBroom, you need to obtain your own Telegram API credentials. This is a one-time process.

1. **Log in**: Visit [my.telegram.org](https://my.telegram.org) and enter your phone number in international format.
2. **API Development Tools**: Click on the **"API development tools"** link.
3. **Create New Application**: If you haven't created one before, you will see a form. Fill it out as follows:
   - **App title**: `TeleBroom` *(A descriptive name for your app)*
   - **Short name**: `telebroom` *(A short alphanumeric name, no spaces)*
   - **URL**: `https://github.com/richard4O4/TeleBroom` *(Optional, can be left blank)*
   - **Platform**: Select **"Desktop"**
   - **Description**: `Telegram message management tool` *(Optional)*
4. **Submit**: Click **"Create application"**.
5. **Copy Credentials**: You will now see your **`App api_id`** and **`App api_hash`**. 
   - **Keep these secret!** Do not share them or commit them to public repositories.
6. **Configuration**: When you first run TeleBroom, it will prompt you to enter these values to log in.

> [!TIP]
> **Alternative (Official Credentials)**: If you don't want to apply for your own API, you can use the official Telegram Desktop credentials (sourced from [tdesktop/snapcraft.yaml](https://github.com/telegramdesktop/tdesktop/blob/dev/snap/snapcraft.yaml#L55-L56)):
> - **API ID**: `611335`
> - **API Hash**: `d524b414d21f4d37f08684c1df41ac9c`



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
