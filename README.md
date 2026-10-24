# Localify

A Spotify-style player for your local MP3/OGG music library. It runs as a
single web page in any Chromium browser, or as a desktop app on Windows,
macOS and Linux with exactly the same UI.

The desktop app adds:

- an app icon in your Applications menu / Start menu / Launchpad
- **Open with Localify** for `.mp3`, `.ogg` and `.oga` files. Opening a file
  adds it to your library and plays it.

## Install

Download the installer for your system from the
[latest release](https://github.com/sweetld/localify/releases/latest).

| OS | File | Notes |
|---|---|---|
| Windows | `Localify-<version>-win-x64.exe` | The installer isn't code-signed, so SmartScreen may warn: choose **More info → Run anyway**. |
| macOS (Apple Silicon) | `Localify-<version>-mac-arm64.dmg` | Not notarized by Apple. After dragging it to Applications, right-click the app → **Open** the first time, or run `xattr -cr /Applications/Localify.app`. |
| macOS (Intel) | `Localify-<version>-mac-x64.dmg` | As above. |
| Linux (Debian/Ubuntu) | `Localify-<version>-linux-amd64.deb` | `sudo apt install ./Localify-*.deb` |
| Linux (any) | `Localify-<version>-linux-x86_64.AppImage` | `chmod +x` and run. |

Every installer registers Localify for MP3 and OGG files, so it appears
under **Open With** in your file manager. It doesn't take over as the
default player unless you choose that.

## Use it in a browser

Open `index.html` in Chrome, Edge or another Chromium browser. Firefox and
Safari work too, but can't delete files from disk (they lack the File System
Access API).

## Develop

```sh
npm install
npm start                 # run the desktop app from source
npm run icons             # regenerate build/icon*.png after editing build/icon.svg
npm run dist              # build installers for the current OS into dist/
npm run install:linux     # Linux: per-user install from source, no sudo
```

Windows installers need a Windows machine (or Wine), and macOS installers need
a Mac. The [Build installers](.github/workflows/build.yml) workflow builds all
three on GitHub's runners. Push a tag such as `v1.0.1` to publish a release.

## License

[MIT](LICENSE) © 2026 Daud Sweetland

`chromaprint.js` is a JavaScript port of the MIT-licensed parts of
[Chromaprint](https://github.com/acoustid/chromaprint), © 2010-2016 Lukas
Lalinsky. Its copyright and license notice are kept at the top of that file.
