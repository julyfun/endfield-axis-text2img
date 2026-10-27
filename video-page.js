const videoFile = document.querySelector('#video-file');
const videoConfigFile = document.querySelector('#video-config-file');
const videoPlay = document.querySelector('#video-play');
const videoReset = document.querySelector('#video-reset');
const videoProgress = document.querySelector('#video-progress');
const videoReadout = document.querySelector('#video-readout');
const videoStatus = document.querySelector('#video-status');
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
    videoData = await prepareVideo(document.querySelector('#source').value, document.querySelector('#poster-config').value);
    videoData.duration = (videoData.frameCount - 1) / videoData.fps;
    videoProgress.max = videoData.duration; videoTime = 0; showVideoFrame();
    videoStatus.textContent = `已加载 ${videoData.triggers.length} 个动作`;
  } catch (error) { videoStatus.textContent = error.message; videoStatus.classList.add('error'); }
}

videoPlay.addEventListener('click', () => {
  if (!videoData) return;
  videoPlaying = !videoPlaying; videoPlay.textContent = videoPlaying ? '暂停' : '播放';
  tick.last = 0; if (videoPlaying) videoFrame = requestAnimationFrame(tick); else cancelAnimationFrame(videoFrame);
});
videoReset.addEventListener('click', () => { videoPlaying = false; videoPlay.textContent = '播放'; tick.last = 0; videoTime = 0; showVideoFrame(); });
videoProgress.addEventListener('input', () => { videoPlaying = false; videoPlay.textContent = '播放'; videoTime = Number(videoProgress.value); showVideoFrame(); });
videoFile.addEventListener('change', async event => { if (event.target.files[0]) document.querySelector('#source').value = await event.target.files[0].text(); event.target.value = ''; loadVideo(); });
videoConfigFile.addEventListener('change', async event => { if (event.target.files[0]) document.querySelector('#poster-config').value = await event.target.files[0].text(); event.target.value = ''; loadVideo(); });

Promise.all(['examples/rotation.csv', 'examples/video.toml'].map(url => fetch(url).then(response => response.text())))
  .then(([source, config]) => { document.querySelector('#source').value = source; document.querySelector('#poster-config').value = config; return loadVideo(); })
  .catch(error => { videoStatus.textContent = error.message; videoStatus.classList.add('error'); });
