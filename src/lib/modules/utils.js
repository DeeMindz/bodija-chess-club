import { store } from './store.js';

export function showLoadingModal(message = 'Saving...') {
  let modal = document.getElementById('loadingModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'loadingModal';
    modal.className = 'loading-modal';
    modal.innerHTML = `
            <div class="loading-modal-content">
                <div class="loading-spinner"></div>
                <p id="loadingModalMessage">${message}</p>
            </div>
        `;
    document.body.appendChild(modal);
  }
  const messageEl = document.getElementById('loadingModalMessage');
  if (messageEl) messageEl.textContent = message;
  modal.style.display = 'flex';
  modal.onclick = e => e.stopPropagation();

  // Safety timeout — always hide after 30s no matter what
  if (_loadingModalTimeout) clearTimeout(_loadingModalTimeout);
  _loadingModalTimeout = setTimeout(() => {
    hideLoadingModal();
    console.warn('[BCC] Loading modal force-closed after timeout');
  }, 30000);
}

export function hideLoadingModal() {
  if (_loadingModalTimeout) {
    clearTimeout(_loadingModalTimeout);
    _loadingModalTimeout = null;
  }
  const modal = document.getElementById('loadingModal');
  if (modal) modal.style.display = 'none';
}

// Silent refresh — refetches data and re-renders current page without any flash

export function showToast(message, type = 'info') {
  // Remove existing toast if any
  const existingToast = document.querySelector('.custom-toast');
  if (existingToast) {
    existingToast.remove();
  }
  const toast = document.createElement('div');
  toast.className = `custom-toast toast-${type}`;
  const icons = {
    success: '✓',
    error: '✗',
    info: 'ℹ',
    warning: '⚠️¸'
  };
  if (toast) toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
    `;
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 10);

  // Auto remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }, 4000);
}

// Make showToast globally available

export function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

export // Compress image File → Blob (JPEG), max maxSize px on longest side.
// Returns a Blob — NOT a base64 string — so it can be streamed to Storage.
function _compressImageToBlob(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width,
          h = img.height;
        if (w > h) {
          if (w > maxSize) {
            h = Math.round(h * maxSize / w);
            w = maxSize;
          }
        } else {
          if (h > maxSize) {
            w = Math.round(w * maxSize / h);
            h = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);else reject(new Error('Canvas toBlob failed'));
        }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Legacy helper kept in case anything else calls it (returns base64 data-URL)

export // Legacy helper kept in case anything else calls it (returns base64 data-URL)
function _compressImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width,
          h = img.height;
        if (w > h) {
          if (w > maxSize) {
            h = Math.round(h * maxSize / w);
            w = maxSize;
          }
        } else {
          if (h > maxSize) {
            w = Math.round(w * maxSize / h);
            h = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

