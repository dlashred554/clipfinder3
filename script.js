
const videoInput = document.getElementById("videoInput");
const dropzone = document.getElementById("dropzone");
const sourceVideo = document.getElementById("sourceVideo");
const fileInfo = document.getElementById("fileInfo");
const generateBtn = document.getElementById("generateBtn");
const progressArea = document.getElementById("progressArea");
const progressText = document.getElementById("progressText");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");
const progressDetail = document.getElementById("progressDetail");
const resultsSection = document.getElementById("resultsSection");
const results = document.getElementById("results");
const resultsSummary = document.getElementById("resultsSummary");
const notice = document.getElementById("notice");
const reactionEnable = document.getElementById("reactionEnable");
const reactionUpload = document.getElementById("reactionUpload");
const reactionInput = document.getElementById("reactionInput");
const reactionFileLabel = document.getElementById("reactionFileLabel");
const reactionClear = document.getElementById("reactionClear");

let selectedFile = null;
let videoDuration = 0;
let videoUrl = null;
let ffmpeg = null;
let fetchFile = null;
let toBlobURL = null;
let ffmpegReady = false;
let currentJob = {kind:"none"};   // trabajo de FFmpeg en curso (para la barra de progreso)
let ffmpegQueue = Promise.resolve();
let videoWidth = 0;
let videoHeight = 0;
let enginePromise = null;         // carga del motor (una sola vez)
let inputPromise = null;          // vídeo original ya escrito en la memoria de FFmpeg
let inputName = null;
let outputToken = 0;              // cambia al generar de nuevo o al subir otro vídeo
const outputCache = new Map();
const EXPORT_TIMEOUT_MS = 120000; // 2 minutos por exportación    // "clip-formato" -> URL del MP4 ya convertido
let previewStop = null;

// Reacción opcional superpuesta en la franja superior del clip (imagen o vídeo).
let reactionFile = null;
let reactionInputPromise = null;  // reacción ya escrita en la memoria de FFmpeg
let reactionInputName = null;
const REACTION_HEIGHT_RATIO = 0.4; // proporción de la altura total que ocupa la reacción

// Altura máxima de los clips en modo "Original". Bájala (p. ej. 540) para ir más rápido.
const MAX_HEIGHT = 720;

// Todas las operaciones de FFmpeg pasan por una cola: así nunca se mezclan
// la generación de clips y las conversiones de formato al descargar.
function enqueue(fn){
  const run = ffmpegQueue.then(fn);
  ffmpegQueue = run.catch(() => {});
  return run;
}

const FORMATS = {
  "original": {label:"Original"},
  "9x16": {w:720,  h:1280, label:"9:16"},
  "16x9": {w:1280, h:720,  label:"16:9"}
};

function getDownloadFormat(){
  const checked = document.querySelector('input[name="downloadFormat"]:checked');
  return checked && FORMATS[checked.value] ? checked.value : "original";
}

function formatTime(seconds){
  seconds = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function formatSize(bytes){
  if(bytes < 1024*1024) return `${(bytes/1024).toFixed(0)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}
function showNotice(message,type=""){
  notice.textContent = message;
  notice.className = `notice ${type}`;
  notice.classList.remove("hidden");
}
function setProgress(percent,text,detail=""){
  progressArea.classList.remove("hidden");
  progressBar.style.width = `${Math.max(0,Math.min(100,percent))}%`;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressText.textContent = text;
  progressDetail.textContent = detail;
}
function clearNotice(){notice.className="notice hidden";notice.textContent=""}

function setVideoFile(file){
  clearNotice();
  if(!file) return;

  const allowed = ["video/mp4","video/quicktime","video/webm","video/x-matroska","video/mpeg"];
  const looksVideo = file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|mpeg|mpg)$/i.test(file.name);
  if(!looksVideo || (!allowed.includes(file.type) && !/\.(mp4|mov|webm|mkv|mpeg|mpg)$/i.test(file.name))){
    showNotice("Ese archivo no parece ser un vídeo compatible. Prueba con un MP4 (H.264) si es posible.","error");
    return;
  }

  selectedFile = file;
  videoDuration = 0;
  videoWidth = 0;
  videoHeight = 0;
  resetInput();
  clearOutputs();
  generateBtn.disabled = true;
  resultsSection.classList.add("hidden");
  results.innerHTML = "";

  if(videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  sourceVideo.onloadedmetadata = () => {
    const duration = Number(sourceVideo.duration);
    if (Number.isFinite(duration) && duration > 0) {
      videoDuration = duration;
      videoWidth = sourceVideo.videoWidth;
      videoHeight = sourceVideo.videoHeight;
      fileInfo.innerHTML = `<b>${escapeHtml(file.name)}</b><span>${formatSize(file.size)} · ${formatTime(videoDuration)}</span>`;
      generateBtn.disabled = false;
    } else {
      showNotice("No se ha podido leer la duración del vídeo. Prueba con otro MP4.","error");
      generateBtn.disabled = true;
    }
  };

  sourceVideo.oncanplay = () => {
    const duration = Number(sourceVideo.duration);
    if (!videoDuration && Number.isFinite(duration) && duration > 0) {
      videoDuration = duration;
      videoWidth = sourceVideo.videoWidth;
      videoHeight = sourceVideo.videoHeight;
      fileInfo.innerHTML = `<b>${escapeHtml(file.name)}</b><span>${formatSize(file.size)} · ${formatTime(videoDuration)}</span>`;
      generateBtn.disabled = false;
    }
  };

  sourceVideo.src = videoUrl;
  sourceVideo.load();
  sourceVideo.classList.remove("hidden");

  fileInfo.innerHTML = `<b>${escapeHtml(file.name)}</b><span>${formatSize(file.size)} · leyendo duración…</span>`;
  fileInfo.classList.remove("hidden");
  sourceVideo.onerror = () => {
    showNotice("El navegador no puede reproducir este archivo. Para evitar el problema de MP4, utiliza un MP4 H.264/AAC.","error");
    generateBtn.disabled = true;
  };
}

videoInput.addEventListener("change", e => setVideoFile(e.target.files[0]));
dropzone.addEventListener("dragover", e => {e.preventDefault();dropzone.classList.add("dragover")});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", e => {
  e.preventDefault();dropzone.classList.remove("dragover");
  setVideoFile(e.dataTransfer.files[0]);
});

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

/* ---------- Reacción opcional (imagen/vídeo superpuesto arriba) ---------- */

function updateFormatAvailability(){
  const originalRadio = document.querySelector('input[name="downloadFormat"][value="original"]');
  if(!originalRadio) return;
  const active = !!reactionFile;
  originalRadio.disabled = active;
  const wrap = originalRadio.closest(".length-option");
  if(wrap) wrap.classList.toggle("is-disabled", active);
  if(active && originalRadio.checked){
    const alt = document.querySelector('input[name="downloadFormat"][value="9x16"]');
    if(alt) alt.checked = true;
  }
}

function setReactionFile(file){
  if(file){
    const okType = file.type.startsWith("image/") || file.type.startsWith("video/");
    if(!okType){
      showNotice("El archivo de reacción debe ser una imagen o un vídeo.","error");
      return;
    }
  }
  reactionFile = file || null;
  resetReactionInput();
  clearOutputs();
  reactionFileLabel.textContent = file ? file.name : "Elegir imagen o vídeo…";
  reactionClear.classList.toggle("hidden", !file);
  updateFormatAvailability();
}

reactionEnable.addEventListener("change", () => {
  reactionUpload.classList.toggle("hidden", !reactionEnable.checked);
  if(!reactionEnable.checked && reactionFile) setReactionFile(null);
});

reactionInput.addEventListener("change", e => setReactionFile(e.target.files[0]));

reactionClear.addEventListener("click", () => {
  reactionInput.value = "";
  setReactionFile(null);
});

/*
  Este selector crea varios fragmentos repartidos por el vídeo.
  No pretende decidir semánticamente cuál es "el mejor momento":
  esa detección inteligente requeriría un modelo de IA/backend.

  Duraciones disponibles (segundos): 15 y 25 (menos de 30 s),
  40 y 60 (de 30 a 60 s). Se cambian en el HTML (value de cada opción).
*/
const DEFAULT_CLIP_LENGTH = 25;

function getSelectedLength(){
  const checked = document.querySelector('input[name="clipLength"]:checked');
  const value = checked ? Number(checked.value) : DEFAULT_CLIP_LENGTH;
  return Number.isFinite(value) && value >= 3 ? value : DEFAULT_CLIP_LENGTH;
}

// Nº de clips que se intenta generar siempre que el vídeo dé para ello.
const TARGET_CLIP_COUNT = 10;

function buildSegments(duration, target = DEFAULT_CLIP_LENGTH){
  // Si el vídeo es más corto que la duración pedida, se usa el vídeo entero.
  const length = Math.min(target, duration);

  // Nº de clips deseado: hasta 10, limitado por lo que quepa sin solaparse.
  const desired = TARGET_CLIP_COUNT;

  let count = Math.max(1, Math.min(desired, Math.floor(duration / length)));
  // Si solo cabría 1 clip pero el vídeo da para 2 con algo de solape, se generan 2.
  if(count === 1 && desired > 1 && duration >= length * 1.5) count = 2;

  const usable = Math.max(0, duration - length);
  const segments = [];
  for(let i=0;i<count;i++){
    const ratio = count === 1 ? .5 : i/(count-1);
    const start = usable * ratio;
    const end = Math.min(duration, start + length);
    if(end-start >= 3) segments.push({start,end});
  }
  return segments;
}


function getInputExtension(file){
  const name = (file?.name || "").toLowerCase();
  const match = name.match(/\.(mp4|mov|webm|mkv|mpeg|mpg|m4v)$/);
  if(match) return match[1];
  if(file?.type === "video/webm") return "webm";
  if(file?.type === "video/quicktime") return "mov";
  return "mp4";
}

function addFfmpegLog(message){
  const log = document.getElementById("ffmpegLog");
  if(!log) return;
  log.classList.remove("hidden");
  log.textContent = (log.textContent + message + "\n").slice(-6000);
}

/* ---------- Motor FFmpeg ---------- */

async function loadFFmpeg(){
  if(ffmpegReady) return;
  setProgress(3,"Preparando el motor de vídeo…","Descargando el motor MP4. Solo ocurre la primera vez.");

  const ffmpegModule = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js");
  const utilModule = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js");

  ffmpeg = new ffmpegModule.FFmpeg();
  fetchFile = utilModule.fetchFile;
  toBlobURL = utilModule.toBlobURL;

  ffmpeg.on("log", ({message}) => {
    console.log("[ClipFinder FFmpeg]", message);
    if(/error|invalid|failed|unable|unknown|no such|not supported/i.test(message)) addFfmpegLog(message);
  });

  // Progreso real del clip que se está convirtiendo (0..1).
  // "time" son microsegundos ya codificados; se compara con la duración del clip
  // (el "progress" de la librería se calcula sobre el vídeo entero y no sirve aquí).
  ffmpeg.on("progress", ({progress,time}) => {
    if(currentJob.kind !== "export") return;
    let p = Number.isFinite(time) && time > 0 && currentJob.duration
      ? (time / 1e6) / currentJob.duration
      : progress;
    if(!Number.isFinite(p)) return;
    currentJob.onProgress(Math.max(0, Math.min(1, p)));
  });

  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
  const localWorkerURL = new URL("./ffmpeg-worker.js", document.baseURI).href;

  const loadPromise = ffmpeg.load({
    // El worker principal debe ser del mismo origen (GitHub Pages).
    classWorkerURL: localWorkerURL,
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm")
  });

  // Si falla la carga, mostramos un error en vez de quedarnos en el 3 %.
  await Promise.race([
    loadPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout cargando FFmpeg (90 s). Revisa la consola (F12).")), 90000)
    )
  ]);
  ffmpegReady = true;
}

function ensureEngine(){
  if(!enginePromise){
    enginePromise = loadFFmpeg().catch(err => {
      enginePromise = null;
      try{ ffmpeg && ffmpeg.terminate(); }catch(_){}
      ffmpeg = null;
      throw err;
    });
  }
  return enginePromise;
}

// Copia el vídeo original a la memoria de FFmpeg (una sola vez por vídeo).
function ensureInput(){
  if(!inputPromise){
    const file = selectedFile;
    inputPromise = (async () => {
      await ensureEngine();
      setProgress(6,"Preparando el vídeo…","Cargando el vídeo en el motor. Solo ocurre una vez.");
      const name = `input.${getInputExtension(file)}`;
      await ffmpeg.writeFile(name, await fetchFile(file));
      inputName = name;
      return name;
    })().catch(err => { inputPromise = null; throw err; });
  }
  return inputPromise;
}

function resetInput(){
  if(ffmpegReady && inputName){
    const old = inputName;
    ffmpeg.deleteFile(old).catch(()=>{});
  }
  inputPromise = null;
  inputName = null;
}

function getReactionExtension(file){
  const name = (file?.name || "").toLowerCase();
  if(file.type.startsWith("image/")){
    const m = name.match(/\.(png|jpe?g|webp|gif|bmp)$/);
    return m ? m[1] : (file.type.split("/")[1] || "png");
  }
  const m = name.match(/\.(mp4|mov|webm|mkv|m4v)$/);
  if(m) return m[1];
  if(file.type === "video/webm") return "webm";
  if(file.type === "video/quicktime") return "mov";
  return "mp4";
}

// Copia el archivo de reacción a la memoria de FFmpeg (una sola vez por archivo).
function ensureReactionInput(){
  if(!reactionFile) return Promise.resolve(null);
  if(!reactionInputPromise){
    const file = reactionFile;
    const isImage = file.type.startsWith("image/");
    reactionInputPromise = (async () => {
      await ensureEngine();
      const name = `reaction.${getReactionExtension(file)}`;
      await ffmpeg.writeFile(name, await fetchFile(file));
      reactionInputName = name;
      return {name, isImage};
    })().catch(err => { reactionInputPromise = null; throw err; });
  }
  return reactionInputPromise;
}

function resetReactionInput(){
  if(ffmpegReady && reactionInputName){
    const old = reactionInputName;
    ffmpeg.deleteFile(old).catch(()=>{});
  }
  reactionInputPromise = null;
  reactionInputName = null;
}

function clearOutputs(){
  outputToken++;
  for(const url of outputCache.values()) URL.revokeObjectURL(url);
  outputCache.clear();
  if(previewStop){
    sourceVideo.removeEventListener("timeupdate", previewStop);
    previewStop = null;
  }
}

// Deja el motor y el vídeo listos en segundo plano mientras miras los clips.
function warmUp(){
  ensureInput().then(() => {
    setProgress(100,"Motor listo","Elige el formato y pulsa Descargar en el clip que quieras.");
  }).catch(error => {
    console.error(error);
    showNotice("No se ha podido preparar el conversor MP4. Detalle: " + (error?.message || error) + " · Se reintentará al pulsar Descargar.","error");
    setProgress(0,"Error al preparar el motor","El detalle técnico aparece debajo si FFmpeg ha devuelto información.");
  });
}

/* ---------- Exportación de un clip ---------- */

function buildExportArgs(fmt, start, duration, input, output, reaction){
  // ORIGINAL: copia directa, sin recodificar. Es la ruta mas rapida.
  // (La reacción no se aplica aquí: al no recodificar no se puede superponer nada.)
  if(fmt === "original"){
    return [
      "-ss", String(start),
      "-i", input,
      "-t", String(duration),
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c", "copy",
      "-y", output
    ];
  }

  // Los formatos vertical/horizontal necesitan recodificacion.
  const {w:W,h:H} = FORMATS[fmt];
  const srcAspect = videoWidth && videoHeight ? videoWidth/videoHeight : 16/9;

  // Sin reacción: comportamiento original (fondo desenfocado a pantalla completa).
  if(!reaction){
    let filter;
    if(Math.abs(srcAspect/(W/H) - 1) < 0.02){
      filter = `[0:v]scale=${W}:${H},setsar=1,format=yuv420p[v]`;
    }else{
      const bw=Math.round(W/8), bh=Math.round(H/8);
      filter =
        `[0:v]split=2[bgsrc][fgsrc];` +
        `[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=3:2,scale=${W}:${H},setsar=1[bg];` +
        `[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`;
    }
    return [
      "-ss", String(start), "-i", input, "-t", String(duration),
      "-filter_complex", filter, "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
      "-y", output
    ];
  }

  // Con reacción: franja superior con la imagen/vídeo de reacción, y debajo
  // el vídeo original con el mismo tratamiento de fondo desenfocado de siempre.
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  const Hr = even(H * REACTION_HEIGHT_RATIO);
  const Hc = H - Hr;
  const bw = Math.round(W / 8), bh = Math.round(Hc / 8);

  const contentFilter =
    `[0:v]split=2[bgsrc][fgsrc];` +
    `[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=3:2,scale=${W}:${Hc},setsar=1[bg];` +
    `[fgsrc]scale=${W}:${Hc}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[fg];` +
    `[bg][fg]overlay=(W-w)/2:(${Hc}-h)/2,format=yuv420p[content]`;
  const reactionFilter =
    `[1:v]scale=${W}:${Hr}:force_original_aspect_ratio=increase,crop=${W}:${Hr},setsar=1,format=yuv420p[reaction]`;
  const filter = `${contentFilter};${reactionFilter};[reaction][content]vstack=2,format=yuv420p[v]`;

  // La reacción no tiene por qué durar lo mismo que el clip:
  // una imagen se mantiene fija todo el clip, un vídeo se repite en bucle si hace falta.
  const reactionInputArgs = reaction.isImage
    ? ["-loop", "1", "-t", String(duration), "-i", reaction.name]
    : ["-stream_loop", "-1", "-i", reaction.name];

  return [
    "-ss", String(start), "-i", input,
    ...reactionInputArgs,
    "-t", String(duration),
    "-filter_complex", filter,
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
    "-y", output
  ];
}
function cancelledError(){
  const e = new Error("cancelado");
  e.cancelled = true;
  return e;
}

// Convierte UN clip, directamente desde el vídeo original (una sola codificación).
function renderClip(index, segment, fmt, onProgress){
  const key = `${index}-${fmt}`;
  if(outputCache.has(key)) return Promise.resolve(outputCache.get(key));

  const token = outputToken;
  return enqueue(async () => {
    if(token !== outputToken) throw cancelledError();
    if(outputCache.has(key)) return outputCache.get(key);

    const input = await ensureInput();
    const reaction = (fmt !== "original" && reactionFile) ? await ensureReactionInput() : null;
    const output = `out_${index}_${fmt}.mp4`;
    const duration = Math.max(1, segment.end - segment.start);

    currentJob = {kind:"export", duration, onProgress};
    try{
      // FFmpeg no siempre emite progreso útil con -c copy (Original).
      // Los eventos iniciales de 0 % NO cuentan como progreso real.
      // La barra avanza suavemente mientras FFmpeg trabaja y salta a 99 %
      // únicamente cuando FFmpeg ha terminado de verdad.
      let lastProgress = 0.05;
      let realProgressSeen = false;
      const reportProgress = p => {
        p = Number(p);
        if(!Number.isFinite(p)) return;

        // Ignorar eventos iniciales 0 % / valores demasiado pequeños.
        // Así no se bloquea la barra en 5 %.
        if(p > 0.02){
          realProgressSeen = true;
          p = Math.max(lastProgress, Math.min(0.98, p));
          lastProgress = p;
          onProgress(p);
          console.log("[ClipFinder FFmpeg] progreso real:", Math.round(p * 100) + "%");
        }
      };

      onProgress(lastProgress);
      currentJob.onProgress = reportProgress;

      // Respaldo visual solo cuando FFmpeg no proporciona progreso útil.
      // No usa la antigua curva que terminaba clavada en 97 %.
      const progressStarted = Date.now();
      const progressTimer = setInterval(() => {
        if(realProgressSeen) return;
        const elapsed = Date.now() - progressStarted;
        const visual = Math.min(0.97, 0.05 + (elapsed / 120000) * 0.92);
        if(visual > lastProgress){
          lastProgress = visual;
          onProgress(visual);
        }
        // Cuando no hay progreso real, dejamos claro que FFmpeg sigue trabajando.
        if(!realProgressSeen && lastProgress >= 0.90){
          // No es un porcentaje real: evita dar sensación de bloqueo en 90 %.
          onProgress(lastProgress);
        }
      }, 400);

      const exportArgs = buildExportArgs(fmt, segment.start, duration, input, output, reaction);
      console.log("[ClipFinder FFmpeg] iniciando exportación", {
        clip: index, formato: fmt, inicio: segment.start, duracion: duration, timeoutMs: EXPORT_TIMEOUT_MS
      });
      addFfmpegLog(`Iniciando FFmpeg · clip ${index} · ${fmt} · límite ${EXPORT_TIMEOUT_MS / 1000}s`);

      // Límite real. Si FFmpeg se queda bloqueado, destruimos el motor para
      // evitar que la interfaz permanezca esperando indefinidamente.
      let code;
      try {
        const execPromise = ffmpeg.exec(exportArgs, EXPORT_TIMEOUT_MS);
        // Evita una promesa rechazada sin consumidor si terminate() la provoca.
        execPromise.catch(() => {});
        code = await Promise.race([
          execPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("FFmpeg ha tardado más de 2 minutos y se ha detenido para evitar un bloqueo.")), EXPORT_TIMEOUT_MS + 1000))
        ]);
      } catch (error) {
        const timedOut = /más de 2 minutos|timeout|timed out/i.test(error?.message || "");
        if (timedOut) {
          addFfmpegLog("FFmpeg no respondió dentro del límite. Reiniciando el motor…");
          try { ffmpeg?.terminate(); } catch (_) {}
          ffmpeg = null;
          ffmpegReady = false;
          enginePromise = null;
          inputPromise = null;
          inputName = null;
          throw new Error("FFmpeg se ha detenido porque llevaba más de 2 minutos. Pulsa Descargar de nuevo para reintentarlo.");
        }
        throw error;
      }
      console.log("[ClipFinder FFmpeg] exec terminó con código:", code);
      if(code !== 0) throw new Error(`FFmpeg terminó con código ${code}. Mira el registro de abajo.`);

      // FFmpeg ya terminó; ahora leemos el MP4 generado.
      onProgress(0.99);
      const data = await ffmpeg.readFile(output);
      await ffmpeg.deleteFile(output);
      const url = URL.createObjectURL(new Blob([data], {type:"video/mp4"}));
      if(token !== outputToken){ URL.revokeObjectURL(url); throw cancelledError(); }
      outputCache.set(key, url);
      return url;
    }finally{
      clearInterval(progressTimer);
      currentJob = {kind:"none"};
    }
  });
}

function triggerDownload(url, filename){
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------- Interfaz ---------- */

function generateClips(){
  if(!selectedFile || !videoDuration) return;

  clearNotice();
  clearOutputs();
  results.innerHTML = "";

  const log = document.getElementById("ffmpegLog");
  if(log){ log.textContent=""; log.classList.add("hidden"); }

  const segments = buildSegments(videoDuration, getSelectedLength());
  if(!segments.length){
    showNotice("No se pudieron crear fragmentos.","error");
    resultsSection.classList.add("hidden");
    return;
  }

  // Los clips son solo tramos del vídeo: aparecen al instante.
  // El MP4 se crea al pulsar "Descargar", ya en el formato elegido.
  segments.forEach((seg,i) => addClipCard(i+1, seg));
  resultsSection.classList.remove("hidden");
  resultsSummary.textContent = reactionFile
    ? `${segments.length} clips listos. Con reacción activa, descarga en 9:16 o 16:9 para verla.`
    : `${segments.length} clips listos. Elige el formato y pulsa Descargar.`;
  showNotice("Listo. Previsualiza los clips y descarga los que quieras; el MP4 se genera al descargar.","ok");
  resultsSection.scrollIntoView({behavior:"smooth", block:"start"});

  warmUp();
}

function previewSegment(segment){
  sourceVideo.classList.remove("hidden");
  if(previewStop) sourceVideo.removeEventListener("timeupdate", previewStop);

  previewStop = () => {
    if(sourceVideo.currentTime >= segment.end){
      sourceVideo.pause();
      sourceVideo.removeEventListener("timeupdate", previewStop);
      previewStop = null;
    }
  };
  sourceVideo.addEventListener("timeupdate", previewStop);

  sourceVideo.currentTime = segment.start;
  sourceVideo.play().catch(()=>{});
  sourceVideo.scrollIntoView({behavior:"smooth", block:"center"});
}

function addClipCard(index,segment){
  const nn = String(index).padStart(2,"0");
  const seconds = Math.round(segment.end - segment.start);
  const card = document.createElement("article");
  card.className = "clip-card";
  card.innerHTML = `
    <div class="clip-number">CLIP ${nn}</div>
    <h3>Fragmento ${index}</h3>
    <div class="clip-meta">${formatTime(segment.start)} — ${formatTime(segment.end)} · ${seconds} s · MP4</div>
    <div class="clip-actions">
      <button class="button button-secondary preview">Previsualizar</button>
      <button class="button button-primary download">Descargar MP4</button>
    </div>
  `;

  card.querySelector(".preview").addEventListener("click", () => previewSegment(segment));

  const dl = card.querySelector(".download");
  const label = dl.textContent;

  dl.addEventListener("click", async () => {
    if(dl.classList.contains("is-busy")) return;

    const fmt = getDownloadFormat();
    const fmtLabel = fmt === "original" ? "Original · rápido" : FORMATS[fmt].label;
    dl.classList.add("is-busy");
    dl.textContent = outputCache.has(`${index}-${fmt}`) ? "Descargando…" : "En cola…";

    try{
      const url = await renderClip(index, segment, fmt, p => {
        dl.textContent = `Convirtiendo ${fmtLabel}… ${Math.round(p*100)}%`;
        setProgress(p*100, `Generando clip ${index} (${fmtLabel})…`, `${formatTime(segment.start)} → ${formatTime(segment.end)}`);
      });
      triggerDownload(url, fmt === "original" ? `clip-${nn}.mp4` : `clip-${nn}-${fmt}.mp4`);
      setProgress(100, "Clip listo", `Clip ${nn} (${fmtLabel}) descargado.`);
    }catch(error){
      if(error && error.cancelled) return;
      console.error(error);
      showNotice("No se ha podido generar el clip." + (error?.message ? ` Detalle: ${error.message}` : ""),"error");
      setProgress(0,"Error al generar el MP4","El detalle técnico aparece debajo si FFmpeg ha devuelto información.");
    }finally{
      dl.classList.remove("is-busy");
      dl.textContent = label;
    }
  });

  results.appendChild(card);
}

generateBtn.addEventListener("click", generateClips);
