# 3Y Toolbox (YYPDFTools)

<p align="center">
  <strong>A privacy-first PDF and image toolbox that runs entirely in your browser</strong>
</p>

<p align="center">
  <a href="README.md">繁體中文</a> ｜ English ｜ <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img alt="Frontend only" src="https://img.shields.io/badge/architecture-frontend_only-2563eb">
  <img alt="No file uploads" src="https://img.shields.io/badge/privacy-no_file_uploads-16803c">
  <img alt="Three languages" src="https://img.shields.io/badge/UI-ZH・EN・JA-7c3aed">
</p>

![3Y Toolbox home screen in Traditional Chinese](docs/images/yyypdftools-home.jpg)

## Overview

3Y Toolbox is a single-page collection of PDF and image utilities. Selected files remain on the user's device: conversion, merging, and output generation are performed by JavaScript inside the browser, with no document upload to a backend server.

It works well for quick everyday document tasks and can be deployed as a static site. The interface supports Traditional Chinese, English, and Japanese, and automatically follows the operating system's light or dark color preference.

## Features

| Tool | What it does | Output |
| --- | --- | --- |
| PDF to Image | Converts every PDF page to JPG or PNG | Images or ZIP |
| Images to PDF | Combines multiple JPG/PNG images into one document | PDF |
| Merge PDF | Combines PDFs with drag-to-reorder support | PDF |
| Split PDF | Splits after a selected page, or extracts a range into individual pages | PDF or ZIP |
| Compress PDF | Rasterizes pages and rebuilds the PDF at a selected image quality | PDF |
| Unlock PDF | Uses a known password to rebuild an unprotected PDF | PDF |
| Rotate PDF | Rotates every page clockwise by 90°, 180°, or 270° | PDF |
| HEIC to JPG | Converts one or more HEIC/HEIF photos to JPG | JPG |

Interface highlights:

- Instant Traditional Chinese, English, and Japanese switching
- Drag-and-drop and file-picker input
- Automatic light and dark themes
- Progress indicators, success notifications, and recovery-focused errors
- Visible keyboard focus, semantic tabs, and live status announcements
- Responsive desktop and mobile layouts

## Privacy and Processing Model

All file content is processed in the current browser tab. The project has no upload API and requires no account.

The page loads its frontend libraries from CDNs on first visit, so an internet connection is still required for the initial load. Once those resources are loaded, document processing itself is local. For a fully offline build, download the CDN dependencies listed below and replace their URLs with local paths.

> [!IMPORTANT]
> **Compress PDF** and **Unlock PDF** rasterize every page before rebuilding the document. This makes browser-only processing possible, but text in the output can no longer be selected or searched. Unlocking only works when you know the original password and the browser PDF engine supports that document.

## How to Use

1. Open the toolbox and choose a tool from the navigation bar.
2. Click the upload area or drag files onto it.
3. Configure the format, page range, image quality, password, or rotation angle when applicable.
4. Start processing; the browser downloads the result when it is ready.

Everything happens on the current device. Large or high-resolution documents may take more time and memory depending on device performance, page count, and image dimensions.

## Run Locally

This is a static site with no build step or npm installation. Clone it and start any simple HTTP server:

```bash
git clone https://github.com/YenYuY/YYPDFTools.git
cd YYPDFTools
python3 -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000). VS Code Live Server, Caddy, Nginx, or any other static server will also work.

Opening `index.html` through `file://` is not recommended because some browsers restrict Workers, downloads, or cross-origin resources in that mode.

## Technology

- HTML, CSS, and vanilla JavaScript
- [Tailwind CSS](https://tailwindcss.com/) via CDN
- [PDF.js](https://mozilla.github.io/pdf.js/) for reading and rendering PDF pages
- [pdf-lib](https://pdf-lib.js.org/) for creating, merging, splitting, and rotating PDFs
- [JSZip](https://stuk.github.io/jszip/) for multi-file archives
- [FileSaver.js](https://github.com/eligrey/FileSaver.js/) for saving generated files
- [heic-to](https://github.com/hoppergee/heic-to) for HEIC/HEIF conversion

## Project Structure

```text
YYPDFTools/
├── index.html                 # Main application and default entry point
├── index-layout-v2.html       # Alternative layout iteration
├── inden-1.html               # Earlier layout backup
├── PRODUCT.md                 # Product direction and design principles
├── README.md                  # Traditional Chinese (GitHub default)
├── README.en.md               # English
├── README.ja.md               # Japanese
└── docs/images/
    └── yyypdftools-home.jpg   # README interface screenshot
```

## Browser Requirements and Limitations

- The latest Chrome, Edge, Firefox, or Safari is recommended.
- Large PDFs can consume significant memory. If the browser tab is terminated, process fewer pages or split the work into batches.
- Encrypted PDF support depends on PDF.js; some encryption methods cannot be unlocked in the browser.
- Rasterized compression is most useful for scanned PDFs and may not reduce text-heavy documents.
- HEIC support depends on the browser's WebAssembly and image-decoding capabilities.

## Contributing

Issues and pull requests are welcome. When changing features, please verify all three languages, light and dark themes, keyboard behavior, and both desktop and mobile layouts.

---

If you find this project useful, consider giving it a ⭐ on GitHub.
