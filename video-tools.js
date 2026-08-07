import {
    VIDEO_OUTPUT_PROFILES,
    VIDEO_COMPRESSION_PROFILES,
    buildVideoCompressionArgs,
    buildVideoConvertArgs,
    buildVideoTrimArgs,
    clampVideoValue,
    formatVideoBytes,
    formatVideoTime,
    videoFileExtension,
    videoOutputName,
    videoReductionPercent
} from './video-tools-core.js';

const FFMPEG_CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
const FFMPEG_WRAPPER_URL = './vendor/ffmpeg/ffmpeg.js';
const MAX_RECOMMENDED_BYTES = 750 * 1024 * 1024;

let ffmpeg = null;
let enginePromise = null;
let activeJob = null;
let engineBlobUrls = [];

const states = {
    converter: createState('video-converter'),
    compressor: createState('video-compressor'),
    trimmer: createState('video-trimmer')
};

function t(key, params = {}) {
    return window.YYYTools?.t?.(key, params) || key;
}

function notify(key, params = {}, type = 'error') {
    window.YYYTools?.notify?.(t(key, params), type);
}

function conciseVideoError(error) {
    const message = String(error?.message || error || 'Unknown error').replace(/\s+/g, ' ').trim();
    return message.length > 220 ? `${message.slice(0, 217)}…` : message;
}

function createState(prefix) {
    return {
        prefix,
        file: null,
        inputUrl: null,
        outputUrl: null,
        outputBlob: null,
        outputDuration: null,
        mediaDuration: 0,
        status: { key: 'video_status_ready', params: {} },
        root: document.getElementById(`sec-${prefix}`),
        input: document.getElementById(`file-${prefix}`),
        upload: document.getElementById(`drop-${prefix}`),
        controls: document.getElementById(`${prefix}-controls`),
        filename: document.getElementById(`${prefix}-filename`),
        filemeta: document.getElementById(`${prefix}-filemeta`),
        statusEl: document.getElementById(`${prefix}-status`),
        progressTrack: document.getElementById(`${prefix}-progress-track`),
        progressBar: document.getElementById(`${prefix}-progress-bar`),
        processButton: document.getElementById(`${prefix}-process`),
        cancelButton: document.getElementById(`${prefix}-cancel`),
        result: document.getElementById(`${prefix}-result`),
        downloadButton: document.getElementById(`${prefix}-download`)
    };
}

function setStatus(state, key, params = {}) {
    state.status = { key, params };
    state.statusEl.textContent = t(key, params);
}

function setProgress(state, percent, visible = true) {
    const value = clampVideoValue(percent, 0, 100);
    state.progressTrack.classList.toggle('hidden', !visible);
    state.progressTrack.setAttribute('aria-valuenow', String(Math.round(value)));
    state.progressBar.style.width = `${value}%`;
}

function setBusy(state, busy) {
    state.input.disabled = busy;
    state.processButton.disabled = busy || !state.file;
    state.cancelButton.classList.toggle('hidden', !busy);
    state.root?.classList.toggle('is-processing', busy);
    state.root?.querySelectorAll('[data-video-processing-lock]').forEach(control => {
        if (busy) {
            control.dataset.videoWasDisabled = String(control.disabled);
            control.disabled = true;
        } else if ('videoWasDisabled' in control.dataset) {
            control.disabled = control.dataset.videoWasDisabled === 'true';
            delete control.dataset.videoWasDisabled;
        }
    });
}

function releaseUrl(state, key) {
    if (state[key]) URL.revokeObjectURL(state[key]);
    state[key] = null;
}

function clearOutput(state) {
    releaseUrl(state, 'outputUrl');
    state.outputBlob = null;
    state.outputDuration = null;
    state.result.classList.add('hidden');
    state.downloadButton.onclick = null;
    state.root.querySelector('[data-video-preview-unavailable]')?.classList.add('hidden');
    state.root.querySelectorAll('[data-video-output-preview]').forEach(element => {
        element.onerror = null;
        element.classList.add('hidden');
        element.removeAttribute('src');
        element.load?.();
    });
}

function loadScriptOnce(src) {
    if (window.FFmpegWASM?.FFmpeg) return Promise.resolve();
    let existing = document.querySelector(`script[data-ffmpeg-wrapper="${src}"]`);
    if (existing?.dataset.loadState === 'error' || existing?.dataset.loadState === 'loaded') {
        existing.remove();
        existing = null;
    }
    if (existing) {
        return new Promise((resolve, reject) => {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', reject, { once: true });
        });
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.dataset.ffmpegWrapper = src;
        script.dataset.loadState = 'loading';
        script.addEventListener('load', () => {
            script.dataset.loadState = 'loaded';
            if (window.FFmpegWASM?.FFmpeg) resolve();
            else reject(new Error('The FFmpeg wrapper loaded without an FFmpeg export'));
        }, { once: true });
        script.addEventListener('error', () => {
            script.dataset.loadState = 'error';
            script.remove();
            reject(new Error('Unable to load the FFmpeg wrapper'));
        }, { once: true });
        document.head.appendChild(script);
    });
}

async function fetchBlobUrl(url, mime, onProgress, signal) {
    const response = await fetch(url, { cache: 'force-cache', signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading FFmpeg`);
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body) {
        const blobUrl = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: mime }));
        onProgress?.(100);
        return blobUrl;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (total) onProgress?.(received / total * 100);
    }
    onProgress?.(100);
    return URL.createObjectURL(new Blob(chunks, { type: mime }));
}

function resetEngine() {
    ffmpeg = null;
    enginePromise = null;
    engineBlobUrls.forEach(url => URL.revokeObjectURL(url));
    engineBlobUrls = [];
}

async function ensureEngine(job) {
    if (ffmpeg?.loaded) return ffmpeg;
    if (enginePromise) return enginePromise;
    enginePromise = (async () => {
        job.onStatus('video_status_engine_download', { percent: 0 });
        await loadScriptOnce(FFMPEG_WRAPPER_URL);
        const coreURL = await fetchBlobUrl(
            `${FFMPEG_CORE_BASE}/ffmpeg-core.js`,
            'text/javascript',
            null,
            job.controller.signal
        );
        const wasmURL = await fetchBlobUrl(
            `${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`,
            'application/wasm',
            percent => {
                job.onProgress(percent * 0.9);
                job.onStatus('video_status_engine_download', { percent: Math.round(percent) });
            },
            job.controller.signal
        );
        engineBlobUrls = [coreURL, wasmURL];
        const instance = new window.FFmpegWASM.FFmpeg();
        instance.on('progress', ({ progress }) => {
            if (!activeJob) return;
            const percent = clampVideoValue(progress * 100, 0, 100);
            activeJob.reportProcessingProgress(percent);
        });
        instance.on('log', ({ message }) => {
            if (!activeJob) return;
            activeJob.lastLog = message;
            const match = message.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (match && activeJob.expectedDuration > 0) {
                const elapsed = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
                activeJob.reportProcessingProgress(elapsed / activeJob.expectedDuration * 100);
            }
        });
        ffmpeg = instance;
        job.onStatus('video_status_engine_starting');
        job.onProgress(95);
        await instance.load({ coreURL, wasmURL }, { signal: job.controller.signal });
        job.onProgress(100);
        return instance;
    })().catch(error => {
        resetEngine();
        throw error;
    });
    return enginePromise;
}

function cancelledError() {
    return new DOMException('Video processing cancelled', 'AbortError');
}

async function runVideoJob({ state, file, outputExtension, mime, buildArgs, expectedDuration = 0 }) {
    if (activeJob) throw new Error(t('video_error_busy'));
    const controller = new AbortController();
    const job = {
        controller,
        lastLog: '',
        expectedDuration,
        reportedProgress: 0,
        onProgress: percent => setProgress(state, percent, true),
        onStatus: (key, params) => setStatus(state, key, params),
        reportProcessingProgress(percent) {
            const value = clampVideoValue(percent, 0, 99);
            if (value <= this.reportedProgress) return;
            this.reportedProgress = value;
            this.onProgress(value);
            this.onStatus('video_status_processing', { percent: Math.round(value) });
        }
    };
    activeJob = job;
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputPath = `input-${stamp}.${videoFileExtension(file.name)}`;
    const outputPath = `output-${stamp}.${outputExtension}`;
    let instance;
    try {
        instance = await ensureEngine(job);
        if (controller.signal.aborted) throw cancelledError();
        setStatus(state, 'video_status_preparing');
        setProgress(state, 0, true);
        const inputData = new Uint8Array(await file.arrayBuffer());
        if (controller.signal.aborted) throw cancelledError();
        await instance.writeFile(inputPath, inputData, { signal: controller.signal });
        setStatus(state, 'video_status_processing', { percent: 0 });
        const exitCode = await instance.exec(buildArgs(inputPath, outputPath), -1, { signal: controller.signal });
        if (exitCode !== 0) throw new Error(job.lastLog || `FFmpeg exited with code ${exitCode}`);
        const outputData = await instance.readFile(outputPath, 'binary', { signal: controller.signal });
        return new Blob([outputData], { type: mime });
    } finally {
        if (instance?.loaded) {
            await instance.deleteFile(inputPath).catch(() => {});
            await instance.deleteFile(outputPath).catch(() => {});
        }
        if (activeJob === job) activeJob = null;
    }
}

function cancelCurrentJob(state) {
    if (!activeJob) return;
    activeJob.controller.abort();
    if (ffmpeg?.loaded) ffmpeg.terminate();
    resetEngine();
    activeJob = null;
    setBusy(state, false);
    setProgress(state, 0, false);
    setStatus(state, 'video_status_cancelled');
}

function isVideoFile(file) {
    return Boolean(file && (file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpeg|mpg|3gp|ogv)$/i.test(file.name)));
}

function setSelectedFile(state, file) {
    state.file = file;
    state.mediaDuration = 0;
    clearOutput(state);
    releaseUrl(state, 'inputUrl');
    state.inputUrl = URL.createObjectURL(file);
    state.filename.textContent = file.name;
    state.filemeta.textContent = formatVideoBytes(file.size);
    state.controls.classList.remove('hidden');
    state.processButton.disabled = false;
    setStatus(state, 'video_status_ready');
    setProgress(state, 0, false);
    if (file.size > MAX_RECOMMENDED_BYTES) notify('video_warning_large', {}, 'error');
}

function renderOutput(state, blob, filename, profile = { mime: blob.type }) {
    clearOutput(state);
    state.outputBlob = blob;
    state.outputUrl = URL.createObjectURL(blob);
    state.result.classList.remove('hidden');
    const previewKind = profile.mime.startsWith('audio/') ? 'audio' : profile.mime === 'image/gif' ? 'image' : 'video';
    const preview = state.root.querySelector(`[data-video-output-preview="${previewKind}"]`);
    const unavailable = state.root.querySelector('[data-video-preview-unavailable]');
    const previewMime = profile.previewMime || profile.mime;
    const supportsPreview = previewKind === 'image' || !preview?.canPlayType || preview.canPlayType(previewMime) !== '';
    const showUnavailable = () => {
        preview?.classList.add('hidden');
        unavailable?.classList.remove('hidden');
    };
    if (preview && supportsPreview) {
        preview.onerror = showUnavailable;
        preview.src = state.outputUrl;
        preview.classList.remove('hidden');
    } else showUnavailable();
    state.downloadButton.onclick = () => {
        if (window.saveAs) window.saveAs(blob, filename);
        else {
            const link = document.createElement('a');
            link.href = state.outputUrl;
            link.download = filename;
            link.click();
        }
    };
}

async function processState(state, task) {
    if (!state.file) return notify('video_error_select');
    setBusy(state, true);
    clearOutput(state);
    try {
        const result = await task();
        setProgress(state, 100, true);
        setStatus(state, 'video_status_done');
        notify('video_status_done', {}, 'success');
        return result;
    } catch (error) {
        if (error?.name === 'AbortError') {
            setStatus(state, 'video_status_cancelled');
        } else {
            setStatus(state, 'video_status_failed');
            notify('video_error_process', { message: conciseVideoError(error) });
        }
        setProgress(state, 0, false);
        return null;
    } finally {
        setBusy(state, false);
    }
}

function setupFileInput(state, onSelected) {
    state.input.addEventListener('change', () => {
        const file = state.input.files?.[0];
        if (!file) return;
        if (!isVideoFile(file)) {
            state.input.value = '';
            notify('video_error_type');
            return;
        }
        setSelectedFile(state, file);
        onSelected?.(file);
    });
    state.cancelButton.addEventListener('click', () => cancelCurrentJob(state));
}

const converter = states.converter;
const converterFormat = document.getElementById('video-converter-format');
const converterInputPreview = document.getElementById('video-converter-input-preview');
setupFileInput(converter, () => {
    converterInputPreview.src = converter.inputUrl;
    converterInputPreview.classList.remove('hidden');
});
converterInputPreview.addEventListener('loadedmetadata', () => {
    converter.mediaDuration = Number.isFinite(converterInputPreview.duration) ? converterInputPreview.duration : 0;
});
converter.processButton.addEventListener('click', async () => {
    const profileKey = converterFormat.value;
    const profile = VIDEO_OUTPUT_PROFILES[profileKey];
    const blob = await processState(converter, () => runVideoJob({
        state: converter,
        file: converter.file,
        outputExtension: profile.extension,
        mime: profile.mime,
        expectedDuration: converter.mediaDuration,
        buildArgs: (input, output) => buildVideoConvertArgs(profileKey, input, output)
    }));
    if (!blob) return;
    const filename = videoOutputName(converter.file.name, 'converted', profile.extension);
    renderOutput(converter, blob, filename, profile);
    document.getElementById('video-converter-result-meta').textContent = `${profile.extension.toUpperCase()} · ${formatVideoBytes(blob.size)}`;
});

const compressor = states.compressor;
const compressorInputPreview = document.getElementById('video-compressor-input-preview');
setupFileInput(compressor, () => {
    compressorInputPreview.src = compressor.inputUrl;
    compressorInputPreview.classList.remove('hidden');
});
compressorInputPreview.addEventListener('loadedmetadata', () => {
    compressor.mediaDuration = Number.isFinite(compressorInputPreview.duration) ? compressorInputPreview.duration : 0;
});
compressor.processButton.addEventListener('click', async () => {
    const quality = document.getElementById('video-compressor-quality').value;
    const resolution = document.getElementById('video-compressor-resolution').value;
    const codec = document.getElementById('video-compressor-codec').value;
    const profile = VIDEO_COMPRESSION_PROFILES[codec];
    const blob = await processState(compressor, () => runVideoJob({
        state: compressor,
        file: compressor.file,
        outputExtension: profile.extension,
        mime: profile.mime,
        expectedDuration: compressor.mediaDuration,
        buildArgs: (input, output) => buildVideoCompressionArgs(quality, resolution, input, output, codec)
    }));
    if (!blob) return;
    renderOutput(compressor, blob, videoOutputName(compressor.file.name, 'compressed', profile.extension), profile);
    const reduction = videoReductionPercent(compressor.file.size, blob.size);
    document.getElementById('video-compressor-result-meta').textContent = t('video_compressor_result_meta', {
        original: formatVideoBytes(compressor.file.size),
        output: formatVideoBytes(blob.size),
        percent: reduction
    });
});

const trimmer = states.trimmer;
const trimPreview = document.getElementById('video-trimmer-input-preview');
const trimStart = document.getElementById('video-trimmer-start');
const trimEnd = document.getElementById('video-trimmer-end');
const trimStartValue = document.getElementById('video-trimmer-start-value');
const trimEndValue = document.getElementById('video-trimmer-end-value');
const trimCurrentValue = document.getElementById('video-trimmer-current-value');
const trimSetStartButton = document.getElementById('video-trimmer-set-start');
const trimSetEndButton = document.getElementById('video-trimmer-set-end');
let trimDuration = 0;

function updateTrimLabels() {
    trimStartValue.textContent = formatVideoTime(trimStart.value, true);
    trimEndValue.textContent = formatVideoTime(trimEnd.value, true);
}

function enforceTrimRange(changed) {
    const minimumGap = Math.min(0.05, trimDuration);
    let start = Number(trimStart.value);
    let end = Number(trimEnd.value);
    if (end - start < minimumGap) {
        if (changed === 'start') start = Math.max(0, end - minimumGap);
        else end = Math.min(trimDuration, start + minimumGap);
    }
    trimStart.value = String(start);
    trimEnd.value = String(end);
    updateTrimLabels();
}

setupFileInput(trimmer, () => {
    trimDuration = 0;
    trimPreview.src = trimmer.inputUrl;
    trimPreview.classList.remove('hidden');
    trimStart.disabled = true;
    trimEnd.disabled = true;
    trimSetStartButton.disabled = true;
    trimSetEndButton.disabled = true;
    trimmer.processButton.disabled = true;
    setStatus(trimmer, 'video_status_metadata');
});

trimPreview.addEventListener('loadedmetadata', () => {
    trimDuration = Number.isFinite(trimPreview.duration) ? trimPreview.duration : 0;
    if (!trimDuration) {
        setStatus(trimmer, 'video_status_preview_unsupported');
        return;
    }
    const step = trimDuration > 3600 ? 0.1 : 0.01;
    [trimStart, trimEnd].forEach(input => {
        input.max = String(trimDuration);
        input.step = String(step);
        input.disabled = false;
    });
    trimStart.value = '0';
    trimEnd.value = String(trimDuration);
    trimSetStartButton.disabled = false;
    trimSetEndButton.disabled = false;
    trimmer.processButton.disabled = false;
    updateTrimLabels();
    setStatus(trimmer, 'video_status_ready');
});

trimPreview.addEventListener('error', () => {
    trimDuration = 0;
    trimStart.disabled = true;
    trimEnd.disabled = true;
    trimSetStartButton.disabled = true;
    trimSetEndButton.disabled = true;
    trimmer.processButton.disabled = true;
    setStatus(trimmer, 'video_status_preview_unsupported');
});

trimPreview.addEventListener('timeupdate', () => {
    trimCurrentValue.textContent = formatVideoTime(trimPreview.currentTime, true);
});

trimStart.addEventListener('input', () => {
    enforceTrimRange('start');
    trimPreview.currentTime = Number(trimStart.value);
});
trimEnd.addEventListener('input', () => {
    enforceTrimRange('end');
    trimPreview.currentTime = Number(trimEnd.value);
});
trimSetStartButton.addEventListener('click', () => {
    trimStart.value = String(trimPreview.currentTime);
    enforceTrimRange('start');
});
trimSetEndButton.addEventListener('click', () => {
    trimEnd.value = String(trimPreview.currentTime);
    enforceTrimRange('end');
});
trimmer.processButton.addEventListener('click', async () => {
    const start = Number(trimStart.value);
    const end = Number(trimEnd.value);
    const blob = await processState(trimmer, () => runVideoJob({
        state: trimmer,
        file: trimmer.file,
        outputExtension: 'mp4',
        mime: 'video/mp4',
        expectedDuration: end - start,
        buildArgs: (input, output) => buildVideoTrimArgs(start, end, trimDuration, input, output)
    }));
    if (!blob) return;
    renderOutput(trimmer, blob, videoOutputName(trimmer.file.name, 'trimmed', 'mp4'), VIDEO_OUTPUT_PROFILES.mp4);
    trimmer.outputDuration = end - start;
    document.getElementById('video-trimmer-result-meta').textContent = t('video_trimmer_result_meta', {
        duration: formatVideoTime(trimmer.outputDuration, true),
        size: formatVideoBytes(blob.size)
    });
});

document.addEventListener('keydown', event => {
    if (trimmer.root.classList.contains('hidden') || !trimmer.file || event.target.matches('input, select, button, textarea')) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        trimStart.value = String(trimPreview.currentTime);
        enforceTrimRange('start');
    } else if (modifier && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        trimEnd.value = String(trimPreview.currentTime);
        enforceTrimRange('end');
    } else if (event.key === ' ') {
        event.preventDefault();
        if (trimPreview.paused) trimPreview.play();
        else trimPreview.pause();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const amount = event.shiftKey ? 1 : 0.1;
        trimPreview.currentTime = clampVideoValue(
            trimPreview.currentTime + (event.key === 'ArrowLeft' ? -amount : amount),
            0,
            trimDuration
        );
    }
});

window.addEventListener('yyy:languagechange', () => {
    Object.values(states).forEach(state => setStatus(state, state.status.key, state.status.params));
    if (compressor.outputBlob) {
        const reduction = videoReductionPercent(compressor.file.size, compressor.outputBlob.size);
        document.getElementById('video-compressor-result-meta').textContent = t('video_compressor_result_meta', {
            original: formatVideoBytes(compressor.file.size),
            output: formatVideoBytes(compressor.outputBlob.size),
            percent: reduction
        });
    }
    if (trimmer.outputBlob) {
        document.getElementById('video-trimmer-result-meta').textContent = t('video_trimmer_result_meta', {
            duration: formatVideoTime(trimmer.outputDuration, true),
            size: formatVideoBytes(trimmer.outputBlob.size)
        });
    }
});

window.addEventListener('beforeunload', () => {
    Object.values(states).forEach(state => {
        releaseUrl(state, 'inputUrl');
        releaseUrl(state, 'outputUrl');
    });
});

Object.values(states).forEach(state => {
    setStatus(state, 'video_status_ready');
    setProgress(state, 0, false);
    setBusy(state, false);
});
