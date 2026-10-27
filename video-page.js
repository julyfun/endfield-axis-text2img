const source = document.querySelector('#source');
const videoConfigSource = document.querySelector('#poster-config');
const videoPlay = document.querySelector('#video-play');
const videoReset = document.querySelector('#video-reset');
const videoProgress = document.querySelector('#video-progress');
const videoReadout = document.querySelector('#video-readout');
const videoStatus = document.querySelector('#video-status');
const videoErrorDetails = document.querySelector('#error-details');
const videoExport = document.querySelector('#video-export');
let videoData = null, videoTime = 0, videoPlaying = false, videoFrame;

function showVideoFrame() {
  if (!videoData) return;
  drawVideoFrame(videoTime);
  videoProgress.value = videoTime;
  videoReadout.textContent = `${videoTime.toFixed(2)} / ${videoData.duration.toFixed(2)} SEC`;
}

function tick(now) {
  if (!videoPlaying) return;
  if (!tick.last) tick.last = now;
  videoTime = Math.min(videoData.duration, videoTime + (now - tick.last) / 1000);
  tick.last = now;
  showVideoFrame();
  if (videoTime >= videoData.duration) { videoPlaying = false; tick.last = 0; videoPlay.textContent = '播放'; return; }
  videoFrame = requestAnimationFrame(tick);
}

async function loadVideo() {
  try {
    videoStatus.textContent = '正在加载本地素材…'; videoStatus.classList.remove('error');
    videoErrorDetails.hidden = true; videoErrorDetails.textContent = '';
    videoData = await prepareVideo(source.value, videoConfigSource.value);
    videoData.duration = (videoData.frameCount - 1) / videoData.fps;
    videoProgress.max = videoData.duration; videoTime = 0; showVideoFrame();
    videoStatus.textContent = `已加载 ${videoData.actions} 个动作 / ${videoData.groups} 个触发组`;
  } catch (error) { videoStatus.textContent = error.message; videoStatus.classList.add('error'); videoErrorDetails.hidden = false; videoErrorDetails.textContent = error.stack || error.message; }
}

function supportedVideoType() {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(type => MediaRecorder.isTypeSupported(type));
}

async function exportVideo() {
  if (!videoData || videoExport.disabled) return;
  const canvas = document.querySelector('#poster');
  const mimeType = window.MediaRecorder && supportedVideoType();
  if (!canvas.captureStream || !mimeType) {
    throw new Error('当前浏览器不支持 Canvas 视频导出，请使用最新版 Chrome。');
  }
  videoExport.disabled = true;
  videoPlaying = false; videoPlay.textContent = '播放'; cancelAnimationFrame(videoFrame);
  const stream = canvas.captureStream(videoData.fps);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = event => reject(event.error || new Error('视频编码失败')); });
  try {
    recorder.start();
    for (let frame = 0; frame < videoData.frameCount; frame++) {
      videoTime = frame / videoData.fps;
      drawVideoFrame(videoTime);
      if (frame % Math.max(1, Math.floor(videoData.fps / 2)) === 0) {
        videoStatus.textContent = `正在生成视频 ${Math.round(frame / videoData.frameCount * 100)}%`;
        showVideoFrame();
      }
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'endfield-axis.webm';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    videoStatus.textContent = `已生成视频（${(blob.size / 1024 / 1024).toFixed(1)} MB）`;
  } finally {
    stream.getTracks().forEach(track => track.stop());
    videoExport.disabled = false;
    showVideoFrame();
  }
}

videoPlay.addEventListener('click', () => {
  if (!videoData) return;
  videoPlaying = !videoPlaying; videoPlay.textContent = videoPlaying ? '暂停' : '播放';
  tick.last = 0; if (videoPlaying) videoFrame = requestAnimationFrame(tick); else cancelAnimationFrame(videoFrame);
});
videoReset.addEventListener('click', () => { videoPlaying = false; videoPlay.textContent = '播放'; tick.last = 0; videoTime = 0; showVideoFrame(); });
videoProgress.addEventListener('input', () => { videoPlaying = false; videoPlay.textContent = '播放'; videoTime = Number(videoProgress.value); showVideoFrame(); });
videoExport.addEventListener('click', () => exportVideo().catch(error => { videoStatus.textContent = error.message; videoStatus.classList.add('error'); videoErrorDetails.hidden = false; videoErrorDetails.textContent = error.stack || error.message; videoExport.disabled = false; }));
document.addEventListener('editor-file-loaded', () => loadVideo());

Promise.all(['examples/rotation.csv', 'examples/video.toml'].map(url => fetch(url).then(response => response.text())))
  .then(([csv, config]) => { source.value = csv; videoConfigSource.value = config; return loadVideo(); })
  .catch(error => { videoStatus.textContent = error.message; videoStatus.classList.add('error'); videoErrorDetails.hidden = false; videoErrorDetails.textContent = error.stack || error.message; });
