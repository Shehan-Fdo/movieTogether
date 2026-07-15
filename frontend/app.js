let ws = null;
let activeFileName = null;
let isSyncing = false;
let activeTasksPollInterval = null;

const wsStatusDot = document.querySelector('#ws-status .status-dot');
const wsStatusLabel = document.querySelector('#ws-status .status-label');
const downloadForm = document.getElementById('download-form');
const downloadBtn = document.getElementById('download-btn');
const btnLoader = downloadBtn.querySelector('.btn-loader');
const progressContainer = document.getElementById('progress-container');
const progressList = document.getElementById('progress-list');
const refreshLibraryBtn = document.getElementById('refresh-library-btn');
const emptyLibrary = document.getElementById('empty-library');
const movieGrid = document.getElementById('movie-grid');
const activeMovieTitle = document.getElementById('active-movie-title');
const playerPlaceholder = document.getElementById('player-placeholder');
const sharedVideo = document.getElementById('shared-video');
const syncBanner = document.getElementById('sync-banner');
const syncMsg = document.getElementById('sync-msg');
const resyncBtn = document.getElementById('resync-btn');

// --- WebSockets Connection ---
function connectWS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    wsStatusDot.className = 'status-dot online';
    wsStatusLabel.textContent = 'Sync Room Connected';
    sendWS({ type: 'join' });
  };

  ws.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'state-request':
          // Respond with current playback state
          if (activeFileName && !sharedVideo.paused) {
            sendWS({
              type: 'state-response',
              targetId: data.targetId,
              playing: !sharedVideo.paused,
              time: sharedVideo.currentTime,
              fileName: activeFileName
            });
          }
          break;

        case 'movie-change':
          console.log(`Movie changed by peer: ${data.fileName}`);
          if (activeFileName !== data.fileName) {
            await loadMovie(data.fileName);
          }
          showSyncMessage(`Loaded movie: ${data.fileName}`);
          break;

        case 'sync':
          console.log(`Sync action received: ${data.action} at ${data.time}`);
          if (activeFileName !== data.fileName && data.fileName) {
            await loadMovie(data.fileName);
          }
          
          isSyncing = true;
          sharedVideo.currentTime = data.time;
          
          if (data.action === 'play') {
            sharedVideo.play().then(() => {
              setTimeout(() => { isSyncing = false; }, 250);
            }).catch(e => {
              console.warn('Playback block:', e);
              isSyncing = false;
            });
            showSyncMessage('GF pressed Play');
          } else if (data.action === 'pause') {
            sharedVideo.pause();
            setTimeout(() => { isSyncing = false; }, 250);
            showSyncMessage('GF pressed Pause');
          } else if (data.action === 'seek') {
            setTimeout(() => { isSyncing = false; }, 250);
            showSyncMessage(`GF jumped to ${formatTime(data.time)}`);
          } else {
            isSyncing = false;
          }
          break;

        default:
          console.warn('Unhandled WS message:', data);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected. Reconnecting in 3s...');
    wsStatusDot.className = 'status-dot offline';
    wsStatusLabel.textContent = 'Offline (Sync Disconnected)';
    setTimeout(connectWS, 3000);
  };
}

function sendWS(messageObj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(messageObj));
  }
}

function showSyncMessage(text) {
  syncBanner.classList.remove('hidden');
  syncMsg.textContent = text;
  
  // Fade out message after 3 seconds if playing
  setTimeout(() => {
    if (text === syncMsg.textContent) {
      syncMsg.textContent = 'Synced';
    }
  }, 3000);
}

// --- HTML5 Video Event Listeners ---
sharedVideo.addEventListener('play', () => {
  if (isSyncing) return;
  sendWS({ type: 'play', time: sharedVideo.currentTime, fileName: activeFileName });
  showSyncMessage('You started playing');
});

sharedVideo.addEventListener('pause', () => {
  if (isSyncing) return;
  sendWS({ type: 'pause', time: sharedVideo.currentTime, fileName: activeFileName });
  showSyncMessage('You paused');
});

sharedVideo.addEventListener('seeked', () => {
  if (isSyncing) return;
  sendWS({ type: 'seek', time: sharedVideo.currentTime, fileName: activeFileName });
  showSyncMessage(`You jumped to ${formatTime(sharedVideo.currentTime)}`);
});

// Force sync local state to others
resyncBtn.addEventListener('click', () => {
  if (!activeFileName) return;
  sendWS({
    type: 'play',
    time: sharedVideo.currentTime,
    fileName: activeFileName
  });
  showSyncMessage('Forced sync broadcast');
});

// --- Movie Library Management ---
async function loadLibrary() {
  try {
    const res = await fetch('/api/movies');
    if (!res.ok) throw new Error('Failed to fetch library');
    
    const movies = await res.json();
    movieGrid.innerHTML = '';

    if (movies.length === 0) {
      emptyLibrary.classList.remove('hidden');
      return;
    }

    emptyLibrary.classList.add('hidden');
    movies.forEach(movie => {
      const card = document.createElement('div');
      card.className = 'movie-card';
      card.innerHTML = `
        <div class="movie-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
            <line x1="7" y1="2" x2="7" y2="22"></line>
            <line x1="17" y1="2" x2="17" y2="22"></line>
            <line x1="2" y1="12" x2="22" y2="12"></line>
          </svg>
        </div>
        <div class="movie-card-details">
          <div class="movie-card-title" title="${escapeHtml(movie.fileName)}">${escapeHtml(movie.fileName)}</div>
          <div class="movie-card-meta">
            <span>${formatBytes(movie.size)}</span>
            <span>${formatDate(movie.uploadedAt)}</span>
          </div>
        </div>
        <div class="movie-card-play">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </div>
      `;

      card.addEventListener('click', () => {
        selectMovie(movie.fileName);
      });

      movieGrid.appendChild(card);
    });
  } catch (err) {
    console.error('Library loading error:', err);
  }
}

async function selectMovie(fileName) {
  // Broadcast file selection to peer first
  sendWS({ type: 'movie-select', fileName });
  await loadMovie(fileName);
}

async function loadMovie(fileName) {
  try {
    activeMovieTitle.textContent = fileName;
    activeFileName = fileName;

    const res = await fetch(`/api/movies/play?fileName=${encodeURIComponent(fileName)}`);
    if (!res.ok) throw new Error('Failed to retrieve streaming link');
    
    const data = await res.json();
    
    playerPlaceholder.classList.add('hidden');
    sharedVideo.classList.remove('hidden');
    syncBanner.classList.remove('hidden');

    sharedVideo.src = data.playUrl;
    sharedVideo.load();
    
    // Play movie
    isSyncing = true;
    sharedVideo.play().then(() => {
      setTimeout(() => { isSyncing = false; }, 250);
    }).catch(e => {
      console.warn('Autoplay blocked, user interaction required:', e);
      isSyncing = false;
    });

  } catch (err) {
    console.error('Failed to load movie:', err);
    alert('Failed to play movie: ' + err.message);
  }
}

// --- Downloader Form & Tracker ---
downloadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const urlInput = document.getElementById('movie-url');
  const nameInput = document.getElementById('movie-name');

  const url = urlInput.value.trim();
  const customName = nameInput.value.trim();

  if (!url) return;

  try {
    downloadBtn.disabled = true;
    btnLoader.classList.remove('hidden');

    const res = await fetch('/api/movies/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, customName })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }

    urlInput.value = '';
    nameInput.value = '';
    
    // Start tracking downloads
    progressContainer.classList.remove('hidden');
    pollDownloadProgress();

  } catch (err) {
    console.error(err);
    alert('Failed to initiate download: ' + err.message);
  } finally {
    downloadBtn.disabled = false;
    btnLoader.classList.add('hidden');
  }
});

async function pollDownloadProgress() {
  if (activeTasksPollInterval) return;

  activeTasksPollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/movies/progress');
      if (!res.ok) throw new Error('Polling failed');

      const tasks = await res.json();
      
      const activeTasks = tasks.filter(t => t.status === 'connecting' || t.status === 'downloading');
      
      // Update UI list
      progressList.innerHTML = '';
      if (tasks.length > 0) {
        progressContainer.classList.remove('hidden');
      }

      tasks.forEach(task => {
        const item = document.createElement('div');
        item.className = 'progress-item';
        
        let statusText = '';
        if (task.status === 'connecting') statusText = 'Connecting...';
        else if (task.status === 'downloading') {
          statusText = `${formatBytes(task.bytesTransferred)} / ${task.bytesTotal > 0 ? formatBytes(task.bytesTotal) : 'Unknown'}`;
        } else if (task.status === 'completed') statusText = 'Completed';
        else if (task.status === 'failed') statusText = `Failed: ${task.error}`;

        item.innerHTML = `
          <div class="progress-item-info">
            <span class="progress-item-name" title="${escapeHtml(task.filename)}">${escapeHtml(task.filename)}</span>
            <span class="progress-item-percent">${task.progress}%</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${task.progress}%"></div>
          </div>
          <div class="progress-item-status">
            <span>Status: ${task.status.toUpperCase()}</span>
            <span>${statusText}</span>
          </div>
        `;
        progressList.appendChild(item);
      });

      // If no tasks are currently active, stop polling and refresh library
      if (activeTasks.length === 0) {
        clearInterval(activeTasksPollInterval);
        activeTasksPollInterval = null;
        loadLibrary();
      }
    } catch (e) {
      console.error(e);
    }
  }, 1000);
}

// --- Utility Functions ---
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- Init ---
connectWS();
loadLibrary();
refreshLibraryBtn.addEventListener('click', loadLibrary);
// Check for existing/stale progress on load
pollDownloadProgress();
