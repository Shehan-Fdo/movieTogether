let ws = null;
let activeFileName = null;
let isSyncing = false;
let activeTasksPollInterval = null;
let player = null;
let currentUser = null;

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
    sendWS({ type: 'join', username: currentUser });
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

        case 'users-update':
          updateStatusBanner(data.users);
          break;

        case 'pause-for-buffer':
          console.log(`Buffering lock from: ${data.username}`);
          isSyncing = true;
          sharedVideo.pause();
          setTimeout(() => { isSyncing = false; }, 250);
          showSyncMessage(`Waiting for ${data.username}'s connection...`);
          break;

        case 'resume-from-buffer':
          console.log('Buffering lock resolved');
          isSyncing = true;
          sharedVideo.play().then(() => {
            setTimeout(() => { isSyncing = false; }, 250);
          }).catch(e => {
            console.warn('Playback block:', e);
            isSyncing = false;
          });
          showSyncMessage('Resumed');
          break;

        case 'sync':
          console.log(`Sync action received: ${data.action} at ${data.time}`);
          if (activeFileName !== data.fileName && data.fileName) {
            await loadMovie(data.fileName);
          }
          
          isSyncing = true;
          sharedVideo.currentTime = data.time;
          
          const peerName = data.senderUsername || (currentUser === 'Duck' ? 'Von' : 'Duck');
          if (data.action === 'play') {
            sharedVideo.play().then(() => {
              setTimeout(() => { isSyncing = false; }, 250);
            }).catch(e => {
              console.warn('Playback block:', e);
              isSyncing = false;
            });
            showSyncMessage(`${peerName} pressed Play`);
          } else if (data.action === 'pause') {
            sharedVideo.pause();
            setTimeout(() => { isSyncing = false; }, 250);
            showSyncMessage(`${peerName} pressed Pause`);
          } else if (data.action === 'seek') {
            setTimeout(() => { isSyncing = false; }, 250);
            showSyncMessage(`${peerName} jumped to ${formatTime(data.time)}`);
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

function updateStatusBanner(users) {
  const isDuckOnline = users.includes('Duck');
  const isVonOnline = users.includes('Von');

  if (isDuckOnline && isVonOnline) {
    wsStatusDot.className = 'status-dot online';
    wsStatusLabel.textContent = 'Duck & Von Connected';
  } else {
    wsStatusDot.className = 'status-dot syncing';
    const otherUser = currentUser === 'Duck' ? 'Von' : 'Duck';
    wsStatusLabel.textContent = `Waiting for ${otherUser}...`;
  }
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

sharedVideo.addEventListener('waiting', () => {
  if (isSyncing) return;
  sendWS({ type: 'buffering', username: currentUser });
});

sharedVideo.addEventListener('playing', () => {
  if (isSyncing) return;
  sendWS({ type: 'buffered', username: currentUser });
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
    
    if (!player) {
      player = new Plyr(sharedVideo, {
        controls: [
          'play-large', 'play', 'progress', 'current-time', 
          'duration', 'mute', 'volume', 'settings', 'fullscreen'
        ]
      });
    }

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
        else if (task.status === 'cancelled') statusText = 'Cancelled';

        const isPending = task.status === 'connecting' || task.status === 'downloading';

        item.innerHTML = `
          <div class="progress-item-info">
            <span class="progress-item-name" title="${escapeHtml(task.filename)}">${escapeHtml(task.filename)}</span>
            <span class="progress-item-percent">${task.progress}%</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${task.progress}%"></div>
          </div>
          <div class="progress-item-status" style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; gap: 8px;">
              <span>Status: ${task.status.toUpperCase()}</span>
              <span>•</span>
              <span>${statusText}</span>
            </div>
            ${isPending ? `<button class="btn btn-secondary btn-sm btn-cancel" data-id="${task.id}" style="padding: 2px 6px; font-size: 10px; border-radius: 4px; color: var(--danger); border-color: rgba(255, 74, 90, 0.2);">Cancel</button>` : ''}
          </div>
        `;

        if (isPending) {
          const cancelBtn = item.querySelector('.btn-cancel');
          cancelBtn.addEventListener('click', async () => {
            if (confirm('Cancel this download?')) {
              try {
                cancelBtn.disabled = true;
                cancelBtn.textContent = '...';
                const res = await fetch('/api/movies/cancel-download', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId: task.id })
                });
                if (!res.ok) throw new Error('Failed to cancel');
              } catch (err) {
                console.error(err);
                alert('Cancel failed: ' + err.message);
                cancelBtn.disabled = false;
                cancelBtn.textContent = 'Cancel';
              }
            }
          });
        }
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
const userModal = document.getElementById('user-modal');
const btnDuck = document.getElementById('btn-duck');
const btnVon = document.getElementById('btn-von');

function selectUser(user) {
  currentUser = user;
  localStorage.setItem('movieTogether_user', user);
  userModal.style.opacity = '0';
  setTimeout(() => userModal.classList.add('hidden'), 200);
  
  connectWS();
  loadLibrary();
  refreshLibraryBtn.addEventListener('click', loadLibrary);
  pollDownloadProgress();
}

const storedUser = localStorage.getItem('movieTogether_user');
if (storedUser && (storedUser === 'Duck' || storedUser === 'Von')) {
  currentUser = storedUser;
  userModal.classList.add('hidden');
  connectWS();
  loadLibrary();
  refreshLibraryBtn.addEventListener('click', loadLibrary);
  pollDownloadProgress();
} else {
  btnDuck.addEventListener('click', () => selectUser('Duck'));
  btnVon.addEventListener('click', () => selectUser('Von'));
}
