export const VIDEO_OUTPUT_PROFILES = Object.freeze({
    mp4: Object.freeze({ extension: 'mp4', mime: 'video/mp4' }),
    webm: Object.freeze({ extension: 'webm', mime: 'video/webm' }),
    mov: Object.freeze({ extension: 'mov', mime: 'video/quicktime' }),
    mkv: Object.freeze({ extension: 'mkv', mime: 'video/x-matroska' }),
    avi: Object.freeze({ extension: 'avi', mime: 'video/x-msvideo' }),
    ts: Object.freeze({ extension: 'ts', mime: 'video/mp2t' }),
    gif: Object.freeze({ extension: 'gif', mime: 'image/gif' }),
    mp3: Object.freeze({ extension: 'mp3', mime: 'audio/mpeg' }),
    m4a: Object.freeze({ extension: 'm4a', mime: 'audio/mp4' }),
    aac: Object.freeze({ extension: 'aac', mime: 'audio/aac' }),
    ogg: Object.freeze({ extension: 'ogg', mime: 'audio/ogg' }),
    flac: Object.freeze({ extension: 'flac', mime: 'audio/flac' }),
    wav: Object.freeze({ extension: 'wav', mime: 'audio/wav' })
});

export const VIDEO_COMPRESSION_PROFILES = Object.freeze({
    h264: Object.freeze({ extension: 'mp4', mime: 'video/mp4', previewMime: 'video/mp4; codecs="avc1.42E01E"' }),
    h265: Object.freeze({ extension: 'mp4', mime: 'video/mp4', previewMime: 'video/mp4; codecs="hvc1"' }),
    vp9: Object.freeze({ extension: 'webm', mime: 'video/webm', previewMime: 'video/webm; codecs="vp9,opus"' })
});

const COMPRESSION_PRESETS = Object.freeze({
    high: Object.freeze({ crf: '23', preset: 'medium', audioBitrate: '160k' }),
    balanced: Object.freeze({ crf: '28', preset: 'veryfast', audioBitrate: '128k' }),
    small: Object.freeze({ crf: '32', preset: 'veryfast', audioBitrate: '96k' })
});

const RESOLUTION_FILTERS = Object.freeze({
    original: null,
    '1080': 'scale=-2:min(1080\\,ih)',
    '720': 'scale=-2:min(720\\,ih)',
    '480': 'scale=-2:min(480\\,ih)'
});

export function clampVideoValue(value, min, max) {
    return Math.min(Math.max(Number(value) || 0, min), max);
}

export function videoFileExtension(filename, fallback = 'mp4') {
    const match = String(filename || '').match(/\.([a-z0-9]{1,8})$/i);
    return match ? match[1].toLowerCase() : fallback;
}

export function videoOutputName(filename, suffix, extension) {
    const base = String(filename || 'video')
        .replace(/\.[^.]+$/i, '')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .trim() || 'video';
    return `${base}_${suffix}.${extension}`;
}

export function formatVideoTime(value, includeMilliseconds = false) {
    const total = Math.max(0, Number(value) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = Math.floor(total % 60);
    const base = [hours, minutes, seconds].map(part => String(part).padStart(2, '0')).join(':');
    if (!includeMilliseconds) return base;
    const milliseconds = Math.floor((total - Math.floor(total)) * 1000);
    return `${base}.${String(milliseconds).padStart(3, '0')}`;
}

export function formatVideoBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let current = bytes / 1024;
    let unit = units[0];
    for (let index = 1; index < units.length && current >= 1024; index += 1) {
        current /= 1024;
        unit = units[index];
    }
    return `${current.toFixed(current >= 10 ? 1 : 2)} ${unit}`;
}

export function videoReductionPercent(originalSize, outputSize) {
    if (!(originalSize > 0) || !(outputSize >= 0)) return 0;
    return Math.round((1 - outputSize / originalSize) * 100);
}

export function buildVideoConvertArgs(profile, inputPath, outputPath) {
    if (!VIDEO_OUTPUT_PROFILES[profile]) throw new Error(`Unsupported output profile: ${profile}`);
    const common = ['-i', inputPath];
    const profiles = {
        mp4: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
        webm: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus', '-b:a', '96k'],
        mov: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'],
        mkv: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k'],
        avi: ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', '-q:a', '4'],
        ts: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-f', 'mpegts'],
        gif: ['-vf', 'fps=12,scale=960:960:force_original_aspect_ratio=decrease:flags=lanczos', '-loop', '0', '-an'],
        mp3: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
        m4a: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
        aac: ['-vn', '-c:a', 'aac', '-b:a', '192k', '-f', 'adts'],
        ogg: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'],
        flac: ['-vn', '-c:a', 'flac'],
        wav: ['-vn', '-c:a', 'pcm_s16le']
    };
    return [...common, ...profiles[profile], outputPath];
}

export function buildVideoCompressionArgs(quality, resolution, inputPath, outputPath, codec = 'h264') {
    const preset = COMPRESSION_PRESETS[quality];
    if (!preset) throw new Error(`Unsupported compression quality: ${quality}`);
    if (!(resolution in RESOLUTION_FILTERS)) throw new Error(`Unsupported resolution: ${resolution}`);
    if (!VIDEO_COMPRESSION_PROFILES[codec]) throw new Error(`Unsupported compression codec: ${codec}`);
    const codecArgs = {
        h264: ['-c:v', 'libx264', '-preset', preset.preset, '-crf', preset.crf, '-pix_fmt', 'yuv420p'],
        h265: ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', String(Number(preset.crf) + 2), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'],
        vp9: ['-c:v', 'libvpx-vp9', '-crf', String(Number(preset.crf) + 5), '-b:v', '0', '-deadline', 'good', '-cpu-used', '4']
    };
    const args = ['-i', inputPath, ...codecArgs[codec]];
    const filter = RESOLUTION_FILTERS[resolution];
    if (filter) args.push('-vf', filter);
    if (codec === 'vp9') args.push('-c:a', 'libopus', '-b:a', preset.audioBitrate, outputPath);
    else args.push('-c:a', 'aac', '-b:a', preset.audioBitrate, '-movflags', '+faststart', outputPath);
    return args;
}

export function normalizeVideoTrimRange(start, end, duration) {
    const safeDuration = Math.max(0, Number(duration) || 0);
    const safeStart = clampVideoValue(start, 0, safeDuration);
    const safeEnd = clampVideoValue(end, 0, safeDuration);
    if (safeEnd - safeStart < 0.05) throw new Error('Trim range must be at least 0.05 seconds');
    return { start: safeStart, end: safeEnd, duration: safeEnd - safeStart };
}

export function buildVideoTrimArgs(start, end, duration, inputPath, outputPath) {
    const range = normalizeVideoTrimRange(start, end, duration);
    return [
        '-i', inputPath,
        '-ss', range.start.toFixed(3),
        '-t', range.duration.toFixed(3),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath
    ];
}
