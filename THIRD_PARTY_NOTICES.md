# Third-party notices

## IMG.LY Background Removal

The optional image background-removal feature dynamically loads
[`@imgly/background-removal` 1.7.0](https://github.com/imgly/background-removal-js)
and its ONNX Runtime Web assets only when a user processes an image.

Copyright © IMG.LY GmbH and contributors. The package is available under the
[GNU Affero General Public License, version 3](https://github.com/imgly/background-removal-js/blob/main/LICENSE.md).
The unmodified upstream source is available from the linked repository.

Images selected by users remain in their browser. The browser downloads the
runtime and model assets, but image data is not sent to IMG.LY or this site's
hosting server.

## ffmpeg.wasm

The video converter, compressor, and trimmer include the unmodified UMD wrapper
from [`@ffmpeg/ffmpeg` 0.12.15](https://github.com/ffmpegwasm/ffmpeg.wasm)
under the MIT License. The tools download the single-thread
[`@ffmpeg/core` 0.12.10](https://www.npmjs.com/package/@ffmpeg/core) runtime
on first use. That core package is distributed under GPL-2.0-or-later and
contains FFmpeg plus enabled codec libraries.

The upstream source and build instructions are available from the linked
ffmpeg.wasm repository. User media remains in the browser's in-memory file
system and is removed after each completed or failed job.
