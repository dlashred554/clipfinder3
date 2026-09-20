/* ==========================================================================
   ClipFinder – Lógica de la interfaz (versión de demostración, sin backend)

   Índice:
   1. Datos de ejemplo        2. Utilidades           3. Onda de audio
   4. Formulario de entrada   5. Análisis simulado    6. Resultados
   7. Previsualización        8. Descarga (simulada)  9. Avisos e inicio

   PUNTOS DE CONEXIÓN CON EL BACKEND (cuando exista):
   - startAnalysis()  -> aquí se enviaría el vídeo/URL al servidor y se
                         recibiría la lista real de clips.
   - downloadClip()   -> aquí se pediría al servidor el archivo MP4 del clip.
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------
     1. DATOS DE EJEMPLO
     Lista en orden cronológico. En la versión real vendrá del servidor.
     start = segundo de inicio, len = duración en segundos, score = 0-100
     ------------------------------------------------------------------ */
  const DEMO_DURATION = 1935; // 00:32:15

  const CLIP_TEMPLATES = [
    { start: 95,   len: 24, score: 71, title: 'Una apertura con gancho',
      why: 'Arranca con una pregunta directa y un cambio de tono que atrapa la atención desde el primer segundo.',
      tags: ['Buen arranque', 'Pregunta directa'] },
    { start: 272,  len: 36, score: 94, title: 'El momento más sorprendente',
      why: 'Pico de energía en la voz seguido de una pausa dramática. Es el fragmento con más probabilidades de compartirse.',
      tags: ['Pico de energía', 'Pausa dramática'] },
    { start: 468,  len: 52, score: 88, title: 'La explicación que lo aclara todo',
      why: 'Resume una idea compleja en pocas frases, con ritmo constante y un cierre claro y fácil de recordar.',
      tags: ['Idea clara', 'Ritmo constante'] },
    { start: 690,  len: 18, score: 76, title: 'Una reacción espontánea',
      why: 'Reacción natural y breve, con risas y un cambio de expresión que conecta con la audiencia.',
      tags: ['Risas', 'Espontáneo'] },
    { start: 905,  len: 68, score: 91, title: 'La anécdota que engancha',
      why: 'Historia personal con planteamiento, tensión y desenlace dentro del mismo fragmento. Se entiende sin contexto previo.',
      tags: ['Historia completa', 'Tensión'] },
    { start: 1120, len: 29, score: 83, title: 'Un consejo práctico en 30 segundos',
      why: 'Da un consejo concreto y accionable, ideal para quien busca aprender algo rápido.',
      tags: ['Consejo útil', 'Autocontenido'] },
    { start: 1310, len: 45, score: 79, title: 'El dato que todos querrán compartir',
      why: 'Incluye una cifra llamativa explicada con calma. Los datos concretos suelen generar más comentarios.',
      tags: ['Dato llamativo', 'Compartible'] },
    { start: 1490, len: 84, score: 86, title: 'El debate más intenso',
      why: 'Intercambio con mucha energía y opiniones enfrentadas. Mantiene el interés durante todo el fragmento.',
      tags: ['Alta energía', 'Opiniones'] },
    { start: 1690, len: 21, score: 68, title: 'Un momento de humor',
      why: 'Broma breve con buena respuesta. Se entiende sin haber visto el resto del vídeo.',
      tags: ['Humor', 'Corto'] },
    { start: 1822, len: 58, score: 82, title: 'Un cierre con mensaje',
      why: 'Resumen final con una llamada a la acción clara. Buen punto de salida para redes sociales.',
      tags: ['Conclusión', 'Llamada a la acción'] }
  ];

  const STAGES = [
    { at: 0,  name: 'Preparar vídeo',   msg: 'Preparando el vídeo…' },
    { at: 12, name: 'Extraer audio',    msg: 'Extrayendo el audio…' },
    { at: 32, name: 'Analizar voz',     msg: 'Analizando voz, ritmo y energía…' },
    { at: 62, name: 'Detectar picos',   msg: 'Detectando los momentos con más interés…' },
    { at: 86, name: 'Puntuar y ordenar', msg: 'Puntuando y ordenando los clips…' }
  ];

  const ANALYSIS_MS = 8000;
  const MIN_VIDEO_SECONDS = 20;
  const PREVIEW_HUES = [255, 215, 185, 285, 330, 20];

  /* ------------------------------------------------------------------
     2. UTILIDADES
     ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, '0');
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function formatTime(sec) {
    sec = Math.max(0, Math.round(sec));
    return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
  }

  function formatShort(sec) {
    sec = Math.max(0, Math.floor(sec));
    return `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
  }

  function formatSize(bytes) {
    const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
    const mb = bytes / (1024 * 1024);
    return mb >= 1024 ? `${nf.format(mb / 1024)} GB` : `${nf.format(mb)} MB`;
  }

  function scrollToEl(el) {
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  const ICON_PLAY = '<svg class="icon-play" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.4-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5z"/></svg>';
  const ICON_PAUSE = '<svg class="icon-pause" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>';
  const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>';

  /* ------------------------------------------------------------------
     Estado y referencias al DOM
     ------------------------------------------------------------------ */
  const state = {
    tab: 'url',
    file: null,          // { file, url, duration }
    source: null,        // { type, name, duration, real, url }
    clips: [],           // en orden cronológico
    filter: 'all',
    sort: 'score',
    raf: 0,              // animación del análisis
    analyzing: false
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
    consent: $('#consent'),
    rights: $('#rightsCheck'),
    error: $('#formError'),

    analysisCard: $('#analysisCard'),
    analysisSource: $('#analysisSource'),
    analysisNote: $('#analysisNote'),
    analysisWave: $('#analysisWave'),
    cancelBtn: $('#cancelBtn'),
    progressBar: $('#progressBar'),
    progressFill: $('#progressFill'),
    statusText: $('#statusText'),
    percentText: $('#percentText'),
    statDuration: $('#statDuration'),
    statFound: $('#statFound'),
    statEta: $('#statEta'),
    stages: $('#stages'),

    results: $('#results'),
    resultsMeta: $('#resultsMeta'),
    newBtn: $('#newBtn'),
    overviewTrack: $('#overviewTrack'),
    overviewEnd: $('#overviewEnd'),
    chips: $$('#filterChips .chip'),
    sortSelect: $('#sortSelect'),
    resultsCount: $('#resultsCount'),
    clipList: $('#clipList'),
    emptyState: $('#emptyState'),
    showAllBtn: $('#showAllBtn'),

    headerCta: $('#headerCta'),
    toastRegion: $('#toastRegion')
  };

  /* ------------------------------------------------------------------
     3. ONDA DE AUDIO (decorativa)
     ------------------------------------------------------------------ */
  function buildWave(container, count, seed) {
    container.textContent = '';
    const bars = [];
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const v = 0.36
        + 0.24 * Math.sin(t * 23 + seed)
        + 0.20 * Math.sin(t * 61 + seed * 2.3)
        + 0.14 * Math.sin(t * 137 + seed * 0.7);
      const bar = document.createElement('span');
      bar.className = 'wave__bar';
      bar.style.setProperty('--h', `${Math.round(Math.max(0.14, Math.min(1, v)) * 100)}%`);
      container.appendChild(bar);
      bars.push(bar);
    }
    return bars;
  }

  function initHeroWave() {
    const box = $('#heroWaveBox');
    const N = 84;
    const bars = buildWave($('#heroWave'), N, 3);
    const segments = [
      { from: 11, to: 15, score: 94 },
      { from: 38, to: 43, score: 91 },
      { from: 62, to: 67, score: 88 }
    ];

    const tags = segments.map((s) => {
      const tag = document.createElement('span');
      tag.className = 'wave__tag';
      tag.textContent = `${s.score}/100`;
      tag.style.left = `${((s.from + s.to + 1) / 2 / N) * 100}%`;
      box.appendChild(tag);
      return tag;
    });

    // Un único momento animado: las barras doradas se encienden una a una.
    const light = () => {
      segments.forEach((s, k) => {
        for (let i = s.from; i <= s.to; i++) {
          bars[i].style.transitionDelay = reduceMotion() ? '0ms' : `${k * 420 + (i - s.from) * 70}ms`;
          bars[i].classList.add('is-lit');
        }
        tags[k].style.transitionDelay = reduceMotion() ? '0ms' : `${k * 420 + 300}ms`;
        tags[k].classList.add('is-visible');
      });
    };
    window.setTimeout(light, reduceMotion() ? 0 : 500);
  }

  /* ------------------------------------------------------------------
     4. FORMULARIO DE ENTRADA
     ------------------------------------------------------------------ */
  function showError(message, focusEl, markEl) {
    els.error.textContent = message;
    els.error.hidden = false;
    [els.urlInput, els.dropzone].forEach((el) => el.removeAttribute('aria-invalid'));
    els.consent.classList.remove('is-invalid');
    if (markEl === els.consent) els.consent.classList.add('is-invalid');
    else if (markEl) markEl.setAttribute('aria-invalid', 'true');
    if (focusEl) focusEl.focus();
  }

  function clearError() {
    els.error.hidden = true;
    els.error.textContent = '';
    [els.urlInput, els.dropzone].forEach((el) => el.removeAttribute('aria-invalid'));
    els.consent.classList.remove('is-invalid');
  }

  function selectTab(name) {
    state.tab = name;
    els.tabs.forEach((tab) => {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    els.panelUrl.hidden = name !== 'url';
    els.panelFile.hidden = name !== 'file';
    clearError();
  }

  function releaseFile() {
    if (state.file) URL.revokeObjectURL(state.file.url);
    state.file = null;
    els.fileInput.value = '';
    els.fileChip.hidden = true;
    els.dropzone.hidden = false;
  }

  function handleFile(file) {
    clearError();
    if (!file) return;

    const looksLikeVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|ogv)$/i.test(file.name);
    if (!looksLikeVideo) {
      showError('Ese archivo no parece un vídeo. Prueba con MP4, MOV o WebM.');
      return;
    }

    releaseFile();
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;

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
      els.fileName.textContent = file.name;
      els.fileMeta.textContent = `${formatSize(file.size)}, duración ${formatTime(duration)}`;
      els.dropzone.hidden = true;
      els.fileChip.hidden = false;
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      showError('No hemos podido leer este vídeo. Prueba con un archivo MP4, MOV o WebM.');
    };
    probe.src = url;
  }

  function initForm() {
    els.tabs.forEach((tab) => {
      tab.addEventListener('click', () => selectTab(tab.dataset.tab));
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const next = state.tab === 'url' ? 'file' : 'url';
          selectTab(next);
          $(`.tab[data-tab="${next}"]`).focus();
        }
      });
    });

    els.fileInput.addEventListener('change', () => handleFile(els.fileInput.files[0]));
    els.fileRemove.addEventListener('click', () => { releaseFile(); clearError(); });

    ['dragenter', 'dragover'].forEach((type) =>
      els.dropzone.addEventListener(type, (e) => { e.preventDefault(); els.dropzone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((type) =>
      els.dropzone.addEventListener(type, (e) => { e.preventDefault(); els.dropzone.classList.remove('is-over'); }));
    els.dropzone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

    // Evita que el navegador abra el vídeo si se suelta fuera de la zona
    ['dragover', 'drop'].forEach((type) => window.addEventListener(type, (e) => e.preventDefault()));

    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const source = validateForm();
      if (source) startAnalysis(source);
    });
    els.rights.addEventListener('change', () => { if (els.rights.checked) clearError(); });
  }

  /** Devuelve el objeto "source" si todo es correcto, o null si hay un error. */
  function validateForm() {
    clearError();
    let source;

    if (state.tab === 'url') {
      const raw = els.urlInput.value.trim();
      if (!raw) {
        showError('Pega la URL de tu vídeo o cambia a «Subir archivo».', els.urlInput, els.urlInput);
        return null;
      }
      let parsed = null;
      try { parsed = new URL(raw); } catch (_) { /* URL no válida */ }
      if (!parsed || !/^https?:$/.test(parsed.protocol)) {
        showError('La URL no parece válida. Debe empezar por http:// o https://', els.urlInput, els.urlInput);
        return null;
      }
      const name = parsed.hostname.replace(/^www\./, '') + (parsed.pathname === '/' ? '' : parsed.pathname);
      source = { type: 'url', name, duration: DEMO_DURATION, real: false, url: null };
    } else {
      if (!state.file) {
        showError('Selecciona un archivo de vídeo para continuar.', $('#fileInput'), els.dropzone);
        return null;
      }
      if (state.file.duration < MIN_VIDEO_SECONDS) {
        showError(`El vídeo es demasiado corto. Necesitamos al menos ${MIN_VIDEO_SECONDS} segundos.`);
        return null;
      }
      source = {
        type: 'file', name: state.file.file.name, duration: state.file.duration,
        real: true, url: state.file.url
      };
    }

    if (!els.rights.checked) {
      showError('Confirma que el vídeo es tuyo o que tienes autorización para usarlo.', els.rights, els.consent);
      return null;
    }
    return source;
  }

  /* ------------------------------------------------------------------
     5. ANÁLISIS SIMULADO
     ------------------------------------------------------------------ */

  /** Crea los clips de ejemplo. Con un archivo real, los reparte por su duración. */
  function buildClips(duration, real) {
    let items = CLIP_TEMPLATES.map((t) => ({ ...t }));

    if (real) {
      items = items.filter((t) => t.len <= duration * 0.8);
      const total = () => items.reduce((sum, t) => sum + t.len, 0);
      while (items.length && total() > duration * 0.85) {
        const worst = items.reduce((a, b) => (a.score <= b.score ? a : b));
        items = items.filter((t) => t !== worst);
      }
      const gap = (duration - total()) / (items.length + 1);
      let cursor = gap;
      items.forEach((t) => {
        t.start = Math.round(cursor);
        cursor += t.len + gap;
      });
    }

    items.forEach((t) => {
      if (t.start + t.len > duration) t.start = Math.max(0, Math.floor(duration - t.len));
      t.end = t.start + t.len;
    });

    [...items].sort((a, b) => b.score - a.score).forEach((t, i) => {
      t.rank = i + 1;   // el nº de clip es su posición por puntuación
      t.id = t.rank;
    });
    return items;
  }

  function buildStageList() {
    els.stages.textContent = '';
    STAGES.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'stage';
      li.innerHTML = '<span class="stage__dot" aria-hidden="true"></span><span class="stage__name"></span>';
      li.querySelector('.stage__name').textContent = s.name;
      els.stages.appendChild(li);
    });
  }

  function startAnalysis(source) {
    if (state.analyzing) return;
    state.analyzing = true;
    state.source = source;
    state.clips = buildClips(source.duration, source.real);
    state.filter = 'all';
    state.sort = 'score';

    // Interfaz
    els.form.hidden = true;
    els.analysisCard.hidden = false;
    els.analysisSource.textContent = source.name;
    els.analysisNote.hidden = source.real;
    els.statDuration.textContent = formatTime(source.duration);
    els.statFound.textContent = '0';
    buildStageList();

    const N = window.matchMedia('(max-width: 600px)').matches ? 56 : 100;
    const bars = buildWave(els.analysisWave, N, 7);
    const ranges = state.clips.map((c) => {
      const a = Math.min(N - 2, Math.floor((c.start / source.duration) * N));
      const b = Math.min(N - 1, Math.max(a + 1, Math.floor((c.end / source.duration) * N)));
      return { a, b, lit: false };
    });
    const wave = { bars, N, ranges, idx: -1 };

    scrollToEl(els.panelSection);

    const t0 = performance.now();
    let lastStage = -1;

    // PUNTO DE CONEXIÓN CON EL BACKEND: aquí se enviaría el vídeo o la URL
    // al servidor. Ahora solo simulamos el avance del análisis.
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / ANALYSIS_MS);
      const pct = 100 * (0.5 - 0.5 * Math.cos(Math.PI * p));   // arranca y termina suave
      const shown = Math.min(100, Math.round(pct));

      els.progressFill.style.width = `${pct}%`;
      els.progressBar.setAttribute('aria-valuenow', String(shown));
      els.percentText.textContent = `${shown}%`;
      els.statEta.textContent = p >= 1 ? '0 s' : `~${Math.ceil((1 - p) * ANALYSIS_MS / 1000)} s`;
      els.statFound.textContent = String(
        state.clips.filter((c) => (c.start / source.duration) * 100 <= pct).length
      );

      lastStage = updateStages(pct, lastStage);
      updateWave(wave, pct);

      if (p < 1) {
        state.raf = requestAnimationFrame(frame);
      } else {
        els.statusText.textContent = 'Análisis completado';
        $$('.stage', els.stages).forEach((li) => { li.classList.remove('is-active'); li.classList.add('is-done'); });
        state.raf = window.setTimeout(showResults, 700);
      }
    };
    state.raf = requestAnimationFrame(frame);
  }

  function updateStages(pct, last) {
    let active = 0;
    STAGES.forEach((s, i) => { if (pct >= s.at) active = i; });
    if (active === last) return last;

    $$('.stage', els.stages).forEach((li, i) => {
      li.classList.toggle('is-done', i < active);
      li.classList.toggle('is-active', i === active);
    });
    els.statusText.textContent = STAGES[active].msg;
    return active;
  }

  function updateWave(w, pct) {
    const idx = Math.min(w.N - 1, Math.floor((pct / 100) * w.N));
    for (let i = w.idx + 1; i <= idx; i++) w.bars[i].classList.add('is-scanned');
    w.idx = idx;
    w.ranges.forEach((r) => {
      if (!r.lit && idx >= r.b) {
        r.lit = true;
        for (let i = r.a; i <= r.b; i++) w.bars[i].classList.add('is-peak');
      }
    });
    els.analysisWave.style.setProperty('--pos', `${pct}%`);
  }

  function stopAnalysis() {
    cancelAnimationFrame(state.raf);
    clearTimeout(state.raf);
    state.analyzing = false;
  }

  /* ------------------------------------------------------------------
     6. RESULTADOS
     ------------------------------------------------------------------ */
  function inRange(clip, filter) {
    switch (filter) {
      case '15-30': return clip.len >= 15 && clip.len <= 30;
      case '30-60': return clip.len > 30 && clip.len <= 60;
      case '60-90': return clip.len > 60 && clip.len <= 90;
      default: return true;
    }
  }

  function getVisibleClips() {
    const sorters = {
      score: (a, b) => b.score - a.score,
      duration: (a, b) => b.len - a.len || b.score - a.score,
      time: (a, b) => a.start - b.start
    };
    return state.clips.filter((c) => inRange(c, state.filter)).sort(sorters[state.sort]);
  }

  function showResults() {
    state.analyzing = false;
    els.analysisCard.hidden = true;
    els.panelSection.hidden = true;
    els.results.hidden = false;

    // Cabecera con datos del vídeo (textContent: el nombre del archivo es texto del usuario)
    els.resultsMeta.textContent = '';
    [
      { text: state.source.name, cls: 'meta__name' },
      { text: `Duración ${formatTime(state.source.duration)}` },
      { text: `${state.clips.length} clips detectados` }
    ].forEach((item) => {
      const span = document.createElement('span');
      span.textContent = item.text;
      if (item.cls) span.className = item.cls;
      els.resultsMeta.appendChild(span);
    });

    // Contadores de los filtros
    els.chips.forEach((chip) => {
      const n = state.clips.filter((c) => inRange(c, chip.dataset.filter)).length;
      $('.chip__count', chip).textContent = `(${n})`;
    });
    els.sortSelect.value = state.sort;
    setFilterUI();

    buildOverview();
    renderList(true);
    scrollToEl(els.results);
  }

  function buildOverview() {
    const total = state.source.duration;
    els.overviewEnd.textContent = formatTime(total);
    els.overviewTrack.textContent = '';
    state.clips.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'overview__clip';
      btn.dataset.id = c.id;
      btn.style.setProperty('--x', ((c.start / total) * 100).toFixed(3));
      btn.style.setProperty('--w', (((c.end - c.start) / total) * 100).toFixed(3));
      btn.setAttribute('aria-label', `Ir al clip ${c.rank}, ${formatTime(c.start)}`);
      btn.title = `Clip #${c.rank}: ${formatTime(c.start)}`;
      els.overviewTrack.appendChild(btn);
    });
  }

  function clipCardHTML(c) {
    const real = state.source.real;
    const hue = PREVIEW_HUES[(c.rank - 1) % PREVIEW_HUES.length];
    return `
      <div class="preview">
        <div class="preview__stage">
          ${real ? `<video class="preview__video" src="${state.source.url}" preload="metadata" playsinline></video>` : ''}
          <span class="preview__tag">${real ? 'Tu vídeo' : 'Vista previa simulada'}</span>
          <span class="preview__time-tag">${formatTime(c.start)}</span>
          <button class="preview__toggle" type="button" data-action="preview" aria-label="Previsualizar clip ${c.rank}">
            <span class="icon-wrap">${ICON_PLAY}${ICON_PAUSE}</span>
          </button>
          <span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        </div>
        <div class="preview__controls">
          <div class="preview__bar"><span class="preview__fill"></span></div>
          <span class="preview__time">0:00 / ${formatShort(c.len)}</span>
        </div>
      </div>
      <div class="clip__body">
        <div class="clip__top">
          <span class="clip__num">Clip #${c.rank}</span>
          <div class="score" aria-label="Puntuación: ${c.score} de 100">
            <span class="score__ring" style="--p:${c.score}" aria-hidden="true"></span>
            <span class="score__text"><small>Puntuación</small><strong>${c.score}/100</strong></span>
          </div>
        </div>
        <h3 class="clip__title">${c.title}</h3>
        <p class="clip__time">
          <span class="clip__range">${formatTime(c.start)} → ${formatTime(c.end)}</span>
          <span class="clip__duration">Duración: ${c.len} segundos</span>
        </p>
        <p class="clip__why">${c.why}</p>
        <ul class="tags">${c.tags.map((t) => `<li>${t}</li>`).join('')}</ul>
        <div class="clip__actions">
          <button class="btn btn--ghost" type="button" data-action="preview"><span class="js-preview-label">Previsualizar</span></button>
          <button class="btn btn--primary" type="button" data-action="download">${ICON_DOWNLOAD}<span>Descargar clip</span></button>
        </div>
      </div>`;
  }

  function renderList(animate) {
    stopPreview();
    const list = getVisibleClips();
    els.clipList.textContent = '';

    list.forEach((c, i) => {
      const card = document.createElement('article');
      card.className = 'clip' + (state.source.real ? ' clip--real' : '') + (animate ? ' clip--enter' : '');
      card.id = `clip-${c.id}`;
      card.dataset.id = c.id;
      card.style.setProperty('--h', PREVIEW_HUES[(c.rank - 1) % PREVIEW_HUES.length]);
      card.style.setProperty('--i', Math.min(i, 6));
      card.innerHTML = clipCardHTML(c);
      if (animate) card.addEventListener('animationend', () => card.classList.remove('clip--enter'), { once: true });

      const video = $('video', card);
      if (video) {
        // Muestra el primer fotograma del clip como miniatura
        video.addEventListener('loadedmetadata', () => {
          video.currentTime = Math.min(c.start + 0.1, Math.max(0, video.duration - 0.1));
        }, { once: true });
      }
      els.clipList.appendChild(card);
    });

    const visibleIds = new Set(list.map((c) => c.id));
    $$('.overview__clip', els.overviewTrack).forEach((btn) => {
      btn.classList.toggle('is-dim', !visibleIds.has(Number(btn.dataset.id)));
    });

    els.resultsCount.textContent = `Mostrando ${list.length} de ${state.clips.length} clips`;
    els.emptyState.hidden = list.length > 0;
  }

  function setFilterUI() {
    els.chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.filter)));
  }

  function initResults() {
    els.chips.forEach((chip) => chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter;
      setFilterUI();
      renderList(false);
    }));

    els.sortSelect.addEventListener('change', () => {
      state.sort = els.sortSelect.value;
      renderList(false);
    });

    els.showAllBtn.addEventListener('click', () => {
      state.filter = 'all';
      setFilterUI();
      renderList(false);
    });

    els.newBtn.addEventListener('click', resetToInput);
    els.cancelBtn.addEventListener('click', resetToInput);

    // Botón del mapa del vídeo: salta al clip
    els.overviewTrack.addEventListener('click', (e) => {
      const btn = e.target.closest('.overview__clip');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (!$(`#clip-${id}`)) {
        state.filter = 'all';
        setFilterUI();
        renderList(false);
      }
      const card = $(`#clip-${id}`);
      card.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      card.classList.remove('is-flash');
      void card.offsetWidth;              // reinicia la animación
      card.classList.add('is-flash');
    });

    // Acciones de cada clip (delegación de eventos)
    els.clipList.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      const card = e.target.closest('.clip');
      if (!actionEl || !card) return;
      const clip = state.clips.find((c) => c.id === Number(card.dataset.id));
      if (actionEl.dataset.action === 'preview') togglePreview(clip, card);
      if (actionEl.dataset.action === 'download') downloadClip(clip, actionEl);
    });

    // El botón de cabecera "Probar ahora" vuelve al formulario si estás viendo resultados
    els.headerCta.addEventListener('click', (e) => {
      if (!els.results.hidden) { e.preventDefault(); resetToInput(); }
    });
  }

  function resetToInput() {
    stopAnalysis();
    stopPreview();
    els.clipList.textContent = '';          // libera los elementos <video>
    state.clips = [];
    els.results.hidden = true;
    els.analysisCard.hidden = true;
    els.panelSection.hidden = false;
    els.form.hidden = false;
    scrollToEl(els.panelSection);
  }

  /* ------------------------------------------------------------------
     7. PREVISUALIZACIÓN
     - Con un archivo subido: se reproduce de verdad el fragmento.
     - Con una URL: reproducción simulada (barra de progreso).
     ------------------------------------------------------------------ */
  let current = null;

  function togglePreview(clip, card) {
    if (current && current.clip.id === clip.id) { stopPreview(); return; }
    stopPreview();
    startPreview(clip, card);
  }

  function setPreviewLabels(card, clip, playing) {
    $('.preview__toggle', card).setAttribute('aria-label',
      `${playing ? 'Detener la previsualización del' : 'Previsualizar'} clip ${clip.rank}`);
    $('.js-preview-label', card).textContent = playing ? 'Detener' : 'Previsualizar';
  }

  function startPreview(clip, card) {
    const video = $('video', card);
    const fill = $('.preview__fill', card);
    const time = $('.preview__time', card);
    const cur = { clip, card, video, raf: 0 };
    current = cur;

    card.classList.add('is-playing');
    setPreviewLabels(card, clip, true);

    const t0 = performance.now();
    const tick = (now) => {
      if (current !== cur) return;
      const elapsed = video ? video.currentTime - clip.start : (now - t0) / 1000;
      const done = video ? (video.currentTime >= clip.end || video.ended) : elapsed >= clip.len;
      const shown = Math.min(Math.max(elapsed, 0), clip.len);
      fill.style.width = `${(shown / clip.len) * 100}%`;
      time.textContent = `${formatShort(shown)} / ${formatShort(clip.len)}`;
      if (done) { stopPreview(); return; }
      cur.raf = requestAnimationFrame(tick);
    };

    if (video) {
      video.currentTime = clip.start;
      video.play().then(() => { cur.raf = requestAnimationFrame(tick); }).catch(() => {
        stopPreview();
        showToast('Tu navegador no ha podido reproducir este vídeo.');
      });
    } else {
      cur.raf = requestAnimationFrame(tick);
    }
  }

  function stopPreview() {
    if (!current) return;
    const { clip, card, video, raf } = current;
    current = null;
    cancelAnimationFrame(raf);
    if (video) {
      video.pause();
      video.currentTime = Math.min(clip.start + 0.1, Math.max(0, (video.duration || clip.start) - 0.1));
    }
    card.classList.remove('is-playing');
    $('.preview__fill', card).style.width = '0';
    $('.preview__time', card).textContent = `0:00 / ${formatShort(clip.len)}`;
    setPreviewLabels(card, clip, false);
  }

  /* ------------------------------------------------------------------
     8. DESCARGA (simulada)
     ------------------------------------------------------------------ */
  function downloadClip(clip, button) {
    if (button.disabled) return;
    const label = $('span', button);
    const original = label.textContent;
    button.disabled = true;
    label.textContent = 'Preparando…';

    // PUNTO DE CONEXIÓN CON EL BACKEND: aquí se pediría al servidor el MP4
    // del tramo clip.start → clip.end y se lanzaría la descarga real.
    window.setTimeout(() => {
      button.disabled = false;
      label.textContent = original;
      showToast(
        `Demostración: aquí se descargaría clip-${pad(clip.rank)}.mp4 (${formatTime(clip.start)} → ${formatTime(clip.end)}). ` +
        'La exportación real llegará con el servidor de análisis.'
      );
    }, 900);
  }

  /* ------------------------------------------------------------------
     9. AVISOS E INICIO
     ------------------------------------------------------------------ */
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    els.toastRegion.appendChild(toast);
    while (els.toastRegion.children.length > 3) els.toastRegion.firstElementChild.remove();

    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 320);
    }, 5200);
  }

  function init() {
    $('#year').textContent = new Date().getFullYear();
    initHeroWave();
    initForm();
    initResults();
  }

  init();
})();
