/* ═══════════════════════════════════════════════════════════
   WallDrop — app.js
   Pexels-powered wallpaper explorer with infinite scroll
══════════════════════════════════════════════════════════════ */

const API_KEY = 'yfDBTL9Y8yIGSNA7PFw8NOucwU4q04KaI6KFVlJyh3ENYAoDDs2lEnSY';
const BASE    = 'https://api.pexels.com/v1';

/* ── State ────────────────────────────────────────────────── */
let currentPage    = 1;
let currentQuery   = '';
let isFetching     = false;
let hasMore        = true;
let activeFilter   = 'all';
let currentPhotos  = [];   // full photo objects for lightbox
let lightboxCurrent = null;

/* ── DOM ──────────────────────────────────────────────────── */
const grid         = document.getElementById('masonryGrid');
const loader       = document.getElementById('loader');
const endMsg       = document.getElementById('endMessage');
const galleryTitle = document.getElementById('galleryTitle');
const galleryEyebrow = document.getElementById('galleryEyebrow');
const trendingScroll = document.getElementById('trendingScroll');
const lightbox     = document.getElementById('lightbox');
const lbImage      = document.getElementById('lbImage');
const lbSkeleton   = document.getElementById('lbSkeleton');
const lbPhotographer = document.getElementById('lbPhotographer');
const lbAvatar     = document.getElementById('lbAvatar');
const lbDims       = document.getElementById('lbDims');
const lbDownloadBtn = document.getElementById('lbDownloadBtn');
const lbPexelsLink = document.getElementById('lbPexelsLink');
const toast        = document.getElementById('toast');
const backTop      = document.getElementById('backTop');

/* ── API helpers ──────────────────────────────────────────── */
async function pexelsFetch(url) {
  const res = await fetch(url, { headers: { Authorization: API_KEY } });
  if (!res.ok) throw new Error(`Pexels API error: ${res.status}`);
  return res.json();
}

function buildCuratedUrl(page, perPage = 24) {
  return `${BASE}/curated?page=${page}&per_page=${perPage}`;
}

function buildSearchUrl(query, page, perPage = 24) {
  return `${BASE}/search?query=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`;
}

/* ── Photo rendering ──────────────────────────────────────── */
function filterPhotos(photos) {
  if (activeFilter === 'all') return photos;
  return photos.filter(p => {
    const ratio = p.width / p.height;
    if (activeFilter === 'landscape') return ratio > 1.2;
    if (activeFilter === 'portrait')  return ratio < 0.85;
    if (activeFilter === 'square')    return ratio >= 0.85 && ratio <= 1.2;
    return true;
  });
}

function createCard(photo) {
  // Keep photo in global store for lightbox
  if (!currentPhotos.find(p => p.id === photo.id)) {
    currentPhotos.push(photo);
  }

  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = photo.id;

  const aspectPct = ((photo.height / photo.width) * 100).toFixed(2);

  card.innerHTML = `
    <div style="position:relative;padding-bottom:${aspectPct}%;background:${photo.avg_color || '#1c1c22'}">
      <img
        src="${photo.src.medium}"
        alt="${photo.alt || 'Wallpaper'}"
        loading="lazy"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
        onload="this.style.opacity=1"
        onerror="this.closest('.card').style.display='none'"
      />
    </div>
    <div class="card-overlay">
      <p class="card-photographer">📷 ${escHtml(photo.photographer)}</p>
      <div class="card-actions">
        <button class="card-dl-btn" onclick="downloadPhoto(event, ${photo.id})" title="Download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </button>
        <button class="card-view-btn" onclick="openLightbox(event, ${photo.id})" title="Preview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  return card;
}

function createTrendingCard(photo) {
  const card = document.createElement('div');
  card.className = 'trending-card';
  card.onclick = () => openLightboxById(photo.id);

  card.innerHTML = `
    <img src="${photo.src.medium}" alt="${photo.alt || 'Trending wallpaper'}" loading="lazy" />
    <div class="trending-card-overlay">
      <p class="trending-card-photographer">📷 ${escHtml(photo.photographer)}</p>
      <button class="trending-card-dl" onclick="event.stopPropagation();downloadPhoto(event,${photo.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download
      </button>
    </div>
  `;

  if (!currentPhotos.find(p => p.id === photo.id)) {
    currentPhotos.push(photo);
  }

  return card;
}

function addSkeletons(count = 8) {
  const heights = [200, 280, 180, 320, 240, 260, 200, 290];
  for (let i = 0; i < count; i++) {
    const sk = document.createElement('div');
    sk.className = 'card-skeleton';
    sk.style.height = heights[i % heights.length] + 'px';
    grid.appendChild(sk);
  }
}

function removeSkeletons() {
  grid.querySelectorAll('.card-skeleton').forEach(el => el.remove());
}

/* ── Data loading ─────────────────────────────────────────── */
async function loadPhotos(replace = false) {
  if (isFetching || !hasMore) return;
  isFetching = true;
  loader.classList.remove('hidden');
  endMsg.style.display = 'none';

  if (replace) {
    grid.innerHTML = '';
    addSkeletons();
  }

  try {
    const url = currentQuery
      ? buildSearchUrl(currentQuery, currentPage)
      : buildCuratedUrl(currentPage);

    const data = await pexelsFetch(url);
    removeSkeletons();

    const photos = data.photos || [];
    const filtered = filterPhotos(photos);

    if (photos.length === 0) {
      hasMore = false;
      endMsg.style.display = 'block';
    } else {
      filtered.forEach(p => grid.appendChild(createCard(p)));
      currentPage++;
      if (!data.next_page) {
        hasMore = false;
        endMsg.style.display = 'block';
      }
    }
  } catch (err) {
    removeSkeletons();
    showToast('⚠ Failed to load photos. Check your connection.');
    console.error(err);
  }

  loader.classList.add('hidden');
  isFetching = false;
}

async function loadTrending() {
  // Add skeletons
  for (let i = 0; i < 8; i++) {
    const sk = document.createElement('div');
    sk.className = 'trending-skeleton';
    trendingScroll.appendChild(sk);
  }

  try {
    const data = await pexelsFetch(buildCuratedUrl(1, 12));
    trendingScroll.innerHTML = '';
    (data.photos || []).forEach(p => {
      trendingScroll.appendChild(createTrendingCard(p));
    });
  } catch (err) {
    trendingScroll.innerHTML = '<p style="color:var(--muted);padding:20px;">Unable to load trending photos.</p>';
  }
}

/* ── Search ───────────────────────────────────────────────── */
function handleSearch(e) {
  if (e) e.preventDefault();
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  startSearch(q);
}

function startSearch(q) {
  currentQuery = q;
  currentPage  = 1;
  hasMore      = true;
  currentPhotos = [];
  galleryEyebrow.textContent = 'Search results';
  galleryTitle.textContent   = `"${q}"`;
  scrollToGallery();
  loadPhotos(true);
}

function quickSearch(tag) {
  document.getElementById('searchInput').value = tag;
  startSearch(tag);
}

function loadCategory(cat) {
  document.getElementById('searchInput').value = cat;
  startSearch(cat);
}

function resetToHome() {
  currentQuery = '';
  currentPage  = 1;
  hasMore      = true;
  currentPhotos = [];
  activeFilter  = 'all';
  galleryEyebrow.textContent = 'Discover';
  galleryTitle.textContent   = 'All Wallpapers';
  document.querySelectorAll('.filter-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  loadPhotos(true);
}

/* ── Filters ──────────────────────────────────────────────── */
function setFilter(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentPage  = 1;
  hasMore      = true;
  currentPhotos = [];
  loadPhotos(true);
}

/* ── Lightbox ─────────────────────────────────────────────── */
function openLightbox(e, id) {
  e.stopPropagation();
  openLightboxById(id);
}

function openLightboxById(id) {
  const photo = currentPhotos.find(p => p.id === id);
  if (!photo) return;

  lightboxCurrent = photo;
  lightbox.classList.add('open');
  document.body.style.overflow = 'hidden';

  lbSkeleton.classList.remove('hidden');
  lbImage.style.opacity = '0';
  lbImage.src = photo.src.large2x || photo.src.large || photo.src.original;
  lbImage.alt = photo.alt || 'Wallpaper';

  lbImage.onload = () => {
    lbSkeleton.classList.add('hidden');
    lbImage.style.opacity = '1';
    lbImage.style.transition = 'opacity 0.3s';
  };

  const initials = photo.photographer
    .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  lbAvatar.textContent = initials;
  lbPhotographer.textContent = photo.photographer;
  lbDims.textContent = `${photo.width} × ${photo.height}`;
  lbPexelsLink.href = photo.url;

  lbDownloadBtn.onclick = () => triggerDownload(photo);
}

function closeLightbox(e) {
  if (e && e.target !== lightbox) return;
  lightbox.classList.remove('open');
  document.body.style.overflow = '';
  lbImage.src = '';
  lightboxCurrent = null;
}

/* ── Download ─────────────────────────────────────────────── */
async function downloadPhoto(e, id) {
  e.stopPropagation();
  const photo = currentPhotos.find(p => p.id === id);
  if (!photo) return;
  triggerDownload(photo);
}

async function triggerDownload(photo) {
  showToast('⬇ Preparing download…');
  try {
    const url = photo.src.original;
    const res  = await fetch(url);
    const blob = await res.blob();
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `walldrop-${photo.id}.jpg`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('✓ Download started!');
  } catch {
    // Fallback: open in new tab
    window.open(photo.src.original, '_blank');
    showToast('✓ Opened in new tab.');
  }
}

/* ── Infinite Scroll ──────────────────────────────────────── */
const observer = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting) loadPhotos();
}, { rootMargin: '400px' });

observer.observe(loader);

/* ── Scroll helpers ───────────────────────────────────────── */
function scrollToGallery() {
  document.getElementById('gallerySection').scrollIntoView({ behavior: 'smooth' });
}

window.addEventListener('scroll', () => {
  backTop.classList.toggle('visible', window.scrollY > 600);
});

/* ── Mobile nav ───────────────────────────────────────────── */
const menuToggle = document.getElementById('menuToggle');
const mobileNav  = document.getElementById('mobileNav');

menuToggle.addEventListener('click', () => {
  mobileNav.classList.toggle('open');
});

function closeMobileNav() {
  mobileNav.classList.remove('open');
}

function closeDropdown() {
  // blur the toggle so dropdown closes on mouse-leave
  document.activeElement?.blur();
}

/* ── Toast ────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

/* ── Keyboard nav ─────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && lightbox.classList.contains('open')) {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }
  if (e.key === '/') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
});

/* ── Hero background mosaic ───────────────────────────────── */
async function loadHeroBg() {
  try {
    const data = await pexelsFetch(buildCuratedUrl(1, 6));
    const photos = (data.photos || []).slice(0, 4);
    const heroBg = document.getElementById('heroBg');
    if (!photos.length) return;

    // Create a subtle grid of blurred photos as hero bg
    const urls = photos.map(p => p.src.small);
    heroBg.style.backgroundImage = urls.map(u => `url(${u})`).join(', ');
    heroBg.style.backgroundSize = '50% 50%';
    heroBg.style.backgroundPosition = 'top left, top right, bottom left, bottom right';
    heroBg.style.backgroundRepeat = 'no-repeat';
    heroBg.style.filter = 'blur(40px) saturate(0.5) brightness(0.25)';
    heroBg.style.opacity = '0.7';
    heroBg.style.transition = 'opacity 1s';
  } catch { /* silent fail – CSS gradient fallback is fine */ }
}

/* ── Utility ──────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Init ─────────────────────────────────────────────────── */
(function init() {
  loadHeroBg();
  loadTrending();
  loadPhotos();
})();

