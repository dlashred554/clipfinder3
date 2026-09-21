// ClipFinder local FFmpeg.wasm worker.
// This file is served by GitHub Pages, so the root Worker is same-origin.
// It implements the worker protocol used by @ffmpeg/ffmpeg 0.12.x.

const FFMessageType = {
  LOAD: "LOAD", EXEC: "EXEC", WRITE_FILE: "WRITE_FILE", READ_FILE: "READ_FILE",
  DELETE_FILE: "DELETE_FILE", RENAME: "RENAME", CREATE_DIR: "CREATE_DIR",
  LIST_DIR: "LIST_DIR", DELETE_DIR: "DELETE_DIR", MOUNT: "MOUNT",
  UNMOUNT: "UNMOUNT", ERROR: "ERROR", DOWNLOAD: "DOWNLOAD",
  PROGRESS: "PROGRESS", LOG: "LOG"
};

const ERROR_UNKNOWN_MESSAGE_TYPE = new Error("unknown message type");
const ERROR_NOT_LOADED = new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first");
const ERROR_IMPORT_FAILURE = new Error("failed to import ffmpeg-core.js");

let ffmpeg = null;

async function loadCore(data) {
  const first = !ffmpeg;
  const coreURL = data.coreURL;
  let wasmURL = data.wasmURL;
  let workerURL = data.workerURL;

  if (!coreURL) throw ERROR_IMPORT_FAILURE;

  // Este worker se ejecuta como módulo (importScripts no existe),
  // así que el núcleo debe ser la versión ESM (export default).
  const mod = await import(coreURL);
  self.createFFmpegCore = mod.default;
  if (!self.createFFmpegCore) throw ERROR_IMPORT_FAILURE;

  if (!wasmURL) wasmURL = coreURL.replace(/\.js$/g, ".wasm");
  if (!workerURL) workerURL = coreURL.replace(/\.js$/g, ".worker.js");

  ffmpeg = await self.createFFmpegCore({
    mainScriptUrlOrBlob: coreURL + "#" + btoa(JSON.stringify({wasmURL, workerURL}))
  });

  ffmpeg.setLogger((entry) => {
    self.postMessage({ type: FFMessageType.LOG, data: entry });
  });
  ffmpeg.setProgress((entry) => {
    self.postMessage({ type: FFMessageType.PROGRESS, data: entry });
  });

  return first;
}

function exec(data) {
  ffmpeg.setTimeout(data.timeout ?? -1);
  ffmpeg.exec(...data.args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
}

function readFile(data) {
  return ffmpeg.FS.readFile(data.path, { encoding: data.encoding });
}

function writeFile(data) {
  ffmpeg.FS.writeFile(data.path, data.data);
  return true;
}

function listDir(data) {
  const names = ffmpeg.FS.readdir(data.path);
  return names.map(name => {
    const stat = ffmpeg.FS.stat(`${data.path}/${name}`);
    return {name, isDir: ffmpeg.FS.isDir(stat.mode)};
  });
}

self.onmessage = async ({data: msg}) => {
  const {id, type, data} = msg;
  const trans = [];
  let result;

  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED;

    switch (type) {
      case FFMessageType.LOAD:
        result = await loadCore(data);
        break;
      case FFMessageType.EXEC:
        result = exec(data);
        break;
      case FFMessageType.WRITE_FILE:
        result = writeFile(data);
        break;
      case FFMessageType.READ_FILE:
        result = readFile(data);
        break;
      case FFMessageType.DELETE_FILE:
        ffmpeg.FS.unlink(data.path);
        result = true;
        break;
      case FFMessageType.RENAME:
        ffmpeg.FS.rename(data.oldPath, data.newPath);
        result = true;
        break;
      case FFMessageType.CREATE_DIR:
        ffmpeg.FS.mkdir(data.path);
        result = true;
        break;
      case FFMessageType.LIST_DIR:
        result = listDir(data);
        break;
      case FFMessageType.DELETE_DIR:
        ffmpeg.FS.rmdir(data.path);
        result = true;
        break;
      case FFMessageType.MOUNT: {
        const fs = ffmpeg.FS.filesystems[data.fsType];
        result = !!fs;
        if (fs) ffmpeg.FS.mount(fs, data.options, data.mountPoint);
        break;
      }
      case FFMessageType.UNMOUNT:
        ffmpeg.FS.unmount(data.mountPoint);
        result = true;
        break;
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (e) {
    self.postMessage({
      id,
      type: FFMessageType.ERROR,
      data: String(e && e.stack ? e.stack : e)
    });
    return;
  }

  if (result instanceof Uint8Array) trans.push(result.buffer);
  self.postMessage({id, type, data: result}, trans);
};
