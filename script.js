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

let selectedFile = null;
let videoDuration = 0;
let videoUrl = null;
let ffmpeg = null;
let fetchFile = null;
let toBlobURL = null;
let ffmpegReady = false;

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
  generateBtn.disabled = true;
  resultsSection.classList.add("hidden");
  results.innerHTML = "";

  if(videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  sourceVideo.onloadedmetadata = () => {
    const duration = Number(sourceVideo.duration);
    if (Number.isFinite(duration) && duration > 0) {
      videoDuration = duration;
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

/*
  Este selector crea varios fragmentos repartidos por el vídeo.
  No pretende decidir semánticamente cuál es "el mejor momento":
  esa detección inteligente requeriría un modelo de IA/backend.
*/
function buildSegments(duration){
  let count, length;
  if(duration <= 30){ count=2; length=Math.max(5, duration*0.40); }
  else if(duration <= 90){ count=3; length=18; }
  else if(duration <= 180){ count=4; length=25; }
  else if(duration <= 600){ count=6; length=40; }
  else { count=8; length=45; }

  length = Math.min(length, Math.max(4, duration - 1));
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

async function loadFFmpeg(){
  if(ffmpegReady) return;
  setProgress(3,"Preparando el motor MP4…","Descargando FFmpeg por primera vez puede tardar unos segundos.");

  const coreURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  const ffmpegModule = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js");
  const utilModule = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js");

  ffmpeg = new ffmpegModule.FFmpeg();
  fetchFile = utilModule.fetchFile;
  toBlobURL = utilModule.toBlobURL;

  await ffmpeg.load({
    coreURL: await toBlobURL(`${coreURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${coreURL}/ffmpeg-core.wasm`, "application/wasm")
  });
  ffmpegReady = true;
}

async function writeInput(){
  const inputName = "source_input";
  await ffmpeg.writeFile(inputName, await fetchFile(selectedFile));
  return inputName;
}

async function exportOneClip(start,end,index,total){
  const outputName = `clip_${String(index).padStart(2,"0")}.mp4`;
  const duration = end-start;

  setProgress(
    8 + ((index-1)/total)*88,
    `Generando clip ${index} de ${total}…`,
    `${formatTime(start)} → ${formatTime(end)} · convirtiendo a MP4`
  );

  await ffmpeg.exec([
    "-ss", String(start),
    "-i", "source_input",
    "-t", String(duration),
    "-map", "0:v:0",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-avoid_negative_ts", "make_zero",
    outputName
  ]);

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data.buffer], {type:"video/mp4"});
  await ffmpeg.deleteFile(outputName);
  return URL.createObjectURL(blob);
}

function addClipCard(index,segment,url){
  const card = document.createElement("article");
  card.className = "clip-card";
  card.innerHTML = `
    <div class="clip-number">CLIP ${String(index).padStart(2,"0")}</div>
    <h3>Fragmento ${index}</h3>
    <div class="clip-meta">${formatTime(segment.start)} — ${formatTime(segment.end)} · MP4</div>
    <div class="clip-actions">
      <button class="button button-secondary preview">Previsualizar</button>
      <a class="button button-primary download" download="clip-${String(index).padStart(2,"0")}.mp4">Descargar MP4</a>
    </div>
  `;
  card.querySelector(".preview").addEventListener("click",()=>{
    sourceVideo.src = url;
    sourceVideo.currentTime = 0;
    sourceVideo.classList.remove("hidden");
    sourceVideo.play().catch(()=>{});
  });
  card.querySelector(".download").href = url;
  results.appendChild(card);
}

async function generateClips(){
  if(!selectedFile || !videoDuration) return;

  generateBtn.disabled = true;
  results.innerHTML = "";
  resultsSection.classList.add("hidden");
  clearNotice();

  try{
    const segments = buildSegments(videoDuration);
    if(!segments.length) throw new Error("No se pudieron crear fragmentos.");

    await loadFFmpeg();
    await writeInput();

    resultsSection.classList.remove("hidden");
    resultsSummary.textContent = `Generando ${segments.length} clips MP4 automáticamente…`;

    const urls = [];
    for(let i=0;i<segments.length;i++){
      const url = await exportOneClip(segments[i].start,segments[i].end,i+1,segments.length);
      urls.push(url);
      addClipCard(i+1,segments[i],url);
      resultsSummary.textContent = `${i+1} de ${segments.length} clips listos.`;
    }

    try{ await ffmpeg.deleteFile("source_input"); }catch(_){}
    setProgress(100,"Proceso terminado","Todos los clips están listos para descargar.");
    resultsSummary.textContent = `${segments.length} clips MP4 listos.`;
    showNotice("Listo. Los clips se han generado como archivos MP4 independientes. Pulsa «Descargar MP4» en cualquiera.","ok");
  }catch(error){
    console.error(error);
    showNotice("No se pudo generar el MP4 automáticamente. Si el vídeo es muy grande, prueba primero con un vídeo más corto o un MP4 H.264/AAC.","error");
    setProgress(0,"Error","El procesamiento se ha detenido.");
  }finally{
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener("click",generateClips);
