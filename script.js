/* ==========================================================================
   ClipFinder – Fase 1 funcional
   Vídeo local -> selección -> previsualización -> MP4 real
   El procesamiento del MP4 se hace en el navegador mediante ffmpeg.wasm.
   ========================================================================== */

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    tab: 'url',
    file: null,
    duration: 0,
    editor: null,
    previewing: false,
    previewTimer: 0,
    ffmpeg: null,
    ffmpegLoaded: false,
    exporting: false
  };

  const els = {
    panelSection: $('#analizar'),
    form: $('#inputCard'),
    tabs: $$('.tab'),
    panelUrl: $('#panel-url'),
    panelFile: $('#panel-file'),
    urlInput: $('#videoUrl'),
    dropzone: $('#dropzone'),
    fileInput: $('#fileInput'),
    fileChip: $('#fileChip'),
    fileName: $('#fileName'),
    fileMeta: $('#fileMeta'),
    fileRemove: $('#fileRemove'),
    rights: $('#rightsCheck'),
    consent: $('#consent'),
    error: $('#formError'),
    analyzeBtn: $('#analyzeBtn'),
    analysisCard: $('#analysisCard'),
    results: $('#results'),
    headerCta: $('#headerCta'),
    toastRegion: $('#toastRegion')
  };

  function formatTime(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatShort(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function formatSize(bytes) {
    const mb = bytes / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
  }

  function showError(message, focusEl, markEl) {
    els.error.textContent = message;
    els.error.hidden = false;
    [els.urlInput, els.dropzone].forEach(el => el && el.removeAttribute('aria-invalid'));
    els.consent.classList.remove('is-invalid');
    if (markEl === els.consent) els.consent.classList.add('is-invalid');
    else if (markEl) markEl.setAttribute('aria-invalid', 'true');
    if (focusEl) focusEl.focus();
  }

  function clearError() {
    els.error.hidden = true;
    els.error.textContent = '';
    [els.urlInput, els.dropzone].forEach(el => el && el.removeAttribute('aria-invalid'));
    els.consent.classList.remove('is-invalid');
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    els.toastRegion.appendChild(toast);
    while (els.toastRegion.children.length > 3) {
      els.toastRegion.firstElementChild.remove();
    }
    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 320);
    }, 4200);
  }

  function selectTab(name) {
    state.tab = name;
    els.tabs.forEach(tab => {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    els.panelUrl.hidden = name !== 'url';
    els.panelFile.hidden = name !== 'file';
    clearError();

    if (name === 'url') {
      removeEditor();
    } else if (state.file) {
      buildEditor();
    }
  }

  function releaseFile() {
    stopPreview();
    removeEditor();
    if (state.file) URL.revokeObjectURL(state.file.url);
    state.file = null;
    state.duration = 0;
    els.fileInput.value = '';
    els.fileChip.hidden = true;
    els.dropzone.hidden = false;
  }

  function handleFile(file) {
    clearError();
    if (!file) return;

    const looksLikeVideo =
      file.type.startsWith('video/') ||
      /\.(mp4|mov|m4v|webm|ogv|avi|mkv)$/i.test(file.name);

    if (!looksLikeVideo) {
      showError('Ese archivo no parece un vídeo. Prueba con MP4, MOV o WebM.');
      return;
    }

    releaseFile();

    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;
    probe.playsInline = true;

    probe.onloadedmetadata = () => {
      const duration = probe.duration;
      probe.removeAttribute('src');
      probe.load();

      if (!Number.isFinite(duration) || duration <= 0) {
        URL.revokeObjectURL(url);
        showError('No hemos podido leer la duración del vídeo. Prueba con otro archivo.');
        return;
      }

      state.file = { file, url, duration };
      state.duration = duration;

      els.fileName.textContent = file.name;
      els.fileMeta.textContent = `${formatSize(file.size)}, duración ${formatTime(duration)}`;
      els.dropzone.hidden = true;
      els.fileChip.hidden = false;

      if (state.tab === 'file') {
        buildEditor();
      }
    };

    probe.onerror = () => {
      URL.revokeObjectURL(url);
      showError('No hemos podido leer este vídeo. Prueba con un MP4, MOV o WebM.');
    };

    probe.src = url;
  }

  function createEditorMarkup() {
    const wrap = document.createElement('div');
    wrap.className = 'clip-editor';
    wrap.id = 'clipEditor';
    wrap.innerHTML = `
      <div class="clip-editor__head">
        <div>
          <h2 class="clip-editor__title">Recorta tu clip</h2>
          <p class="clip-editor__sub">Elige el inicio y el final. Después podrás descargar un MP4 real.</p>
        </div>
      </div>

      <div class="clip-editor__video-wrap">
        <video class="clip-editor__video" id="editorVideo" controls playsinline preload="metadata"></video>
      </div>

      <div class="clip-editor__range">
        <div class="clip-editor__range-title">
          <span>Fragmento seleccionado</span>
          <span id="editorSelectionLabel">00:00:00 → 00:00:00</span>
        </div>

        <div class="clip-editor__track" id="editorTrack">
          <input id="editorStart" type="range" min="0" max="1" step="0.01" value="0"
                 aria-label="Inicio del clip">
          <input id="editorEnd" type="range" min="0" max="1" step="0.01" value="1"
                 aria-label="Final del clip">
        </div>

        <div class="clip-editor__times">
          <div class="clip-editor__time">
            <small>Inicio</small>
            <strong id="editorStartText">00:00:00</strong>
          </div>
          <div class="clip-editor__time">
            <small>Final</small>
            <strong id="editorEndText">00:00:00</strong>
          </div>
          <div class="clip-editor__time">
            <small>Duración</small>
            <strong id="editorDurationText">00:00:00</strong>
          </div>
        </div>
      </div>

      <div class="clip-editor__actions">
        <button class="btn btn--ghost" type="button" id="previewClipBtn">Previsualizar fragmento</button>
        <button class="btn btn--primary" type="button" id="downloadClipBtn">Descargar MP4</button>
      </div>

      <div class="clip-editor__progress" id="exportProgress" hidden>
        <span id="exportProgressFill"></span>
      </div>
      <p class="clip-editor__status" id="editorStatus" aria-live="polite">
        Selecciona el fragmento que quieras.
      </p>
    `;
    return wrap;
  }

  function buildEditor() {
    if (!state.file) return;

    removeEditor();

    const editor = createEditorMarkup();
    els.form.insertBefore(editor, els.analyzeBtn);

    state.editor = {
      root: editor,
      video: $('#editorVideo', editor),
      start: $('#editorStart', editor),
      end: $('#editorEnd', editor),
      startText: $('#editorStartText', editor),
      endText: $('#editorEndText', editor),
      durationText: $('#editorDurationText', editor),
      selectionLabel: $('#editorSelectionLabel', editor),
      track: $('#editorTrack', editor),
      previewBtn: $('#previewClipBtn', editor),
      downloadBtn: $('#downloadClipBtn', editor),
      status: $('#editorStatus', editor),
      progress: $('#exportProgress', editor),
      progressFill: $('#exportProgressFill', editor)
    };

    state.editor.video.src = state.file.url;

    const setup = () => {
      const duration = state.duration;
      state.editor.start.max = String(duration);
      state.editor.end.max = String(duration);
      state.editor.start.value = '0';
      state.editor.end.value = String(duration);
      updateEditor();

      state.editor.video.addEventListener('timeupdate', handlePreviewTime);
      state.editor.video.addEventListener('ended', stopPreview);
    };

    if (state.editor.video.readyState >= 1) setup();
    else state.editor.video.addEventListener('loadedmetadata', setup, { once: true });

    state.editor.start.addEventListener('input', () => {
      if (Number(state.editor.start.value) >= Number(state.editor.end.value)) {
        state.editor.start.value = String(Math.max(0, Number(state.editor.end.value) - 0.1));
      }
      updateEditor();
    });

    state.editor.end.addEventListener('input', () => {
      if (Number(state.editor.end.value) <= Number(state.editor.start.value)) {
        state.editor.end.value = String(Math.min(state.duration, Number(state.editor.start.value) + 0.1));
      }
      updateEditor();
    });

    state.editor.previewBtn.addEventListener('click', togglePreview);
    state.editor.downloadBtn.addEventListener('click', exportClip);

    els.analyzeBtn.textContent = 'Seleccionar otro vídeo';
    els.analyzeBtn.type = 'button';
    els.analyzeBtn.onclick = () => {
      releaseFile();
      selectTab('file');
    };

    setStatus('Listo. Puedes mover los dos controles para elegir el fragmento.');
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function removeEditor() {
    stopPreview();

    if (state.editor?.video) {
      state.editor.video.pause();
      state.editor.video.removeAttribute('src');
      state.editor.video.load();
    }

    const old = $('#clipEditor');
    if (old) old.remove();

    state.editor = null;

    if (els.analyzeBtn) {
      els.analyzeBtn.textContent = 'Analizar vídeo';
      els.analyzeBtn.type = 'submit';
      els.analyzeBtn.onclick = null;
    }
  }

  function getSelection() {
    if (!state.editor) return { start: 0, end: 0, duration: 0 };
    const start = Number(state.editor.start.value);
    const end = Number(state.editor.end.value);
    return { start, end, duration: Math.max(0, end - start) };
  }

  function updateEditor() {
    if (!state.editor) return;

    const { start, end, duration } = getSelection();
    state.editor.startText.textContent = formatTime(start);
    state.editor.endText.textContent = formatTime(end);
    state.editor.durationText.textContent = formatTime(duration);
    state.editor.selectionLabel.textContent = `${formatTime(start)} → ${formatTime(end)}`;

    const total = Math.max(0.001, state.duration);
    state.editor.track.style.setProperty('--start-p', `${(start / total) * 100}%`);
    state.editor.track.style.setProperty('--end-p', `${(end / total) * 100}%`);

    if (!state.previewing && state.editor.video) {
      const t = Math.min(Math.max(start, 0), Math.max(0, state.duration - 0.01));
      if (Math.abs(state.editor.video.currentTime - t) > 0.15) {
        try { state.editor.video.currentTime = t; } catch (_) {}
      }
    }
  }

  function setStatus(message, kind = '') {
    if (!state.editor) return;
    state.editor.status.textContent = message;
    state.editor.status.className = `clip-editor__status${kind ? ` is-${kind}` : ''}`;
  }

  function togglePreview() {
    if (!state.editor) return;

    if (state.previewing) {
      stopPreview();
      return;
    }

    const { start, end } = getSelection();
    if (end - start < 0.1) {
      setStatus('El fragmento es demasiado corto.', 'error');
      return;
    }

    const video = state.editor.video;
    state.previewing = true;
    state.editor.previewBtn.textContent = 'Detener previsualización';
    setStatus(`Previsualizando ${formatShort(end - start)}…`);

    const begin = () => {
      try {
        video.currentTime = start;
        const p = video.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            stopPreview();
            setStatus('El navegador no ha podido reproducir este vídeo.', 'error');
          });
        }
      } catch (_) {
        stopPreview();
        setStatus('No se ha podido iniciar la previsualización.', 'error');
      }
    };

    if (video.readyState >= 2) begin();
    else video.addEventListener('loadeddata', begin, { once: true });

    clearInterval(state.previewTimer);
    state.previewTimer = window.setInterval(() => {
      if (!state.previewing) return;
      if (video.currentTime >= end - 0.03 || video.ended) stopPreview();
    }, 50);
  }

  function handlePreviewTime() {
    if (!state.previewing || !state.editor) return;
    const { end } = getSelection();
    if (state.editor.video.currentTime >= end - 0.03) {
      stopPreview();
    }
  }

  function stopPreview() {
    state.previewing = false;
    clearInterval(state.previewTimer);
    state.previewTimer = 0;

    if (!state.editor) return;

    state.editor.video.pause();
    state.editor.previewBtn.textContent = 'Previsualizar fragmento';

    const { start } = getSelection();
    try { state.editor.video.currentTime = start; } catch (_) {}
    setStatus('Listo. Puedes mover los controles para elegir otro fragmento.');
  }

  async function loadFFmpeg() {
    if (state.ffmpegLoaded) return state.ffmpeg;

    setStatus('Preparando el motor de exportación…');
    state.editor.downloadBtn.disabled = true;

    try {
      const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js'),
        import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js')
      ]);

      const ffmpeg = new FFmpeg();

      ffmpeg.on('progress', ({ progress }) => {
        if (!state.editor) return;
        const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
        state.editor.progress.hidden = false;
        state.editor.progressFill.style.width = `${pct}%`;
        setStatus(`Generando MP4… ${pct}%`);
      });

      ffmpeg.on('log', ({ message }) => {
        console.debug('[FFmpeg]', message);
      });

      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
      });

      state.ffmpeg = ffmpeg;
      state.fetchFile = fetchFile;
      state.ffmpegLoaded = true;
      return ffmpeg;
    } finally {
      if (state.editor) state.editor.downloadBtn.disabled = false;
    }
  }

  function safeInputExtension(fileName) {
    const match = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
    const ext = match ? match[1] : 'mp4';
    const allowed = new Set(['mp4', 'mov', 'm4v', 'webm', 'ogv', 'avi', 'mkv']);
    return allowed.has(ext) ? ext : 'mp4';
  }

  async function exportClip() {
    if (state.exporting || !state.file || !state.editor) return;

    clearError();

    if (!els.rights.checked) {
      showError(
        'Confirma primero que tienes los derechos o la autorización necesaria para usar este vídeo.',
        els.rights,
        els.consent
      );
      return;
    }

    const { start, end, duration } = getSelection();

    if (duration < 0.5) {
      setStatus('El fragmento debe durar al menos medio segundo.', 'error');
      return;
    }

    state.exporting = true;
    state.editor.downloadBtn.disabled = true;
    state.editor.previewBtn.disabled = true;
    state.editor.progress.hidden = false;
    state.editor.progressFill.style.width = '0%';

    try {
      const ffmpeg = await loadFFmpeg();
      const inputName = `input.${safeInputExtension(state.file.file.name)}`;
      const outputName = 'clipfinder_clip.mp4';

      setStatus('Cargando el vídeo en el procesador local…');

      await ffmpeg.writeFile(inputName, await state.fetchFile(state.file.file));

      setStatus('Recortando y convirtiendo a MP4…');

      await ffmpeg.exec([
        '-ss', String(start),
        '-i', inputName,
        '-t', String(duration),
        '-map', '0:v:0',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-avoid_negative_ts', 'make_zero',
        outputName
      ]);

      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `clip-${formatFileNumber(start)}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 60000);

      try { await ffmpeg.deleteFile(inputName); } catch (_) {}
      try { await ffmpeg.deleteFile(outputName); } catch (_) {}

      state.editor.progressFill.style.width = '100%';
      setStatus('MP4 generado y descargado correctamente.', 'ok');
      showToast('El clip MP4 se ha descargado en tu ordenador.');
    } catch (error) {
      console.error(error);
      setStatus(
        'No se ha podido generar el MP4. Prueba primero con un vídeo MP4 o WebM más corto.',
        'error'
      );
      showToast('Ha ocurrido un error al exportar el clip.');
    } finally {
      state.exporting = false;
      if (state.editor) {
        state.editor.downloadBtn.disabled = false;
        state.editor.previewBtn.disabled = false;
      }
    }
  }

  function formatFileNumber(start) {
    return String(Math.max(1, Math.floor(start) + 1)).padStart(2, '0');
  }

  function validateForm() {
    clearError();

    if (state.tab === 'url') {
      showError(
        'La Fase 1 funciona con vídeos subidos desde tu ordenador. La función de enlaces la añadiremos después.',
        els.urlInput,
        els.urlInput
      );
      return false;
    }

    if (!state.file) {
      showError('Selecciona primero un archivo de vídeo.', els.fileInput, els.dropzone);
      return false;
    }

    if (!els.rights.checked) {
      showError(
        'Confirma que este vídeo es tuyo o que tienes autorización para usarlo.',
        els.rights,
        els.consent
      );
      return false;
    }

    return true;
  }

  function initForm() {
    els.tabs.forEach(tab => {
      tab.addEventListener('click', () => selectTab(tab.dataset.tab));
      tab.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          selectTab(state.tab === 'url' ? 'file' : 'url');
          $(`.tab[data-tab="${state.tab}"]`).focus();
        }
      });
    });

    els.fileInput.addEventListener('change', () => handleFile(els.fileInput.files[0]));
    els.fileRemove.addEventListener('click', () => {
      releaseFile();
      clearError();
    });

    ['dragenter', 'dragover'].forEach(type => {
      els.dropzone.addEventListener(type, e => {
        e.preventDefault();
        els.dropzone.classList.add('is-over');
      });
    });

    ['dragleave', 'drop'].forEach(type => {
      els.dropzone.addEventListener(type, e => {
        e.preventDefault();
        els.dropzone.classList.remove('is-over');
      });
    });

    els.dropzone.addEventListener('drop', e => {
      handleFile(e.dataTransfer.files[0]);
    });

    ['dragover', 'drop'].forEach(type => {
      window.addEventListener(type, e => e.preventDefault());
    });

    els.form.addEventListener('submit', e => {
      e.preventDefault();

      if (state.editor) {
        if (state.file) {
          state.editor.root.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }

      if (!validateForm()) return;
      buildEditor();
    });

    els.rights.addEventListener('change', () => {
      if (els.rights.checked) clearError();
    });
  }

  function initHeroWave() {
    const box = $('#heroWaveBox');
    const wave = $('#heroWave');
    if (!box || !wave) return;

    const count = 84;
    wave.textContent = '';

    for (let i = 0; i < count; i++) {
      const t = i / count;
      const v =
        0.36 +
        0.24 * Math.sin(t * 23 + 3) +
        0.20 * Math.sin(t * 61 + 6.9) +
        0.14 * Math.sin(t * 137 + 2.1);

      const bar = document.createElement('span');
      bar.className = 'wave__bar';
      bar.style.setProperty('--h', `${Math.round(Math.max(0.14, Math.min(1, v)) * 100)}%`);
      wave.appendChild(bar);
    }

    const segments = [
      { from: 11, to: 15, score: 94 },
      { from: 38, to: 43, score: 91 },
      { from: 62, to: 67, score: 88 }
    ];

    segments.forEach((s, k) => {
      const tag = document.createElement('span');
      tag.className = 'wave__tag';
      tag.textContent = `${s.score}/100`;
      tag.style.left = `${((s.from + s.to + 1) / 2 / count) * 100}%`;
      box.appendChild(tag);

      window.setTimeout(() => {
        for (let i = s.from; i <= s.to; i++) {
          const bar = wave.children[i];
          if (bar) bar.classList.add('is-lit');
        }
        tag.classList.add('is-visible');
      }, 500 + k * 420);
    });
  }

  function resetToInput() {
    releaseFile();
    if (els.results) els.results.hidden = true;
    if (els.analysisCard) els.analysisCard.hidden = true;
    els.panelSection.hidden = false;
    els.form.hidden = false;
    els.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function init() {
    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();

    initHeroWave();
    initForm();

    if (els.headerCta) {
      els.headerCta.addEventListener('click', () => {
        window.setTimeout(() => {
          els.panelSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
      });
    }

    if (els.results) els.results.hidden = true;
    if (els.analysisCard) els.analysisCard.hidden = true;
  }

  init();
})();
