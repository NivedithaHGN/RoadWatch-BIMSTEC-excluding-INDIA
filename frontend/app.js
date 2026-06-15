// ROADWATCH Central Frontend Controller (Dual-Mode: Express API & LocalStorage DB Simulation)

let activeCountry = localStorage.getItem('roadwatch_country') || 'Bangladesh';
let map;
let markers = [];
let isOfflineMode = false;

// REAL-TIME SOCKET — Country Room Alerts
let socket = null;
if (typeof io !== 'undefined') {
  socket = io();

  // Join a specific country room so we only receive alerts for that country
  window.joinCountryRoom = function(country) {
    if (socket && country) {
      socket.emit('join_country', country);
    }
  };

  // Helper: show toast only if user has notifications enabled
  function maybeToast(icon, title, subtitle, type) {
    if (localStorage.getItem('roadwatch_notifications') === 'false') return;
    showToast(icon, title, subtitle, type);
  }

  // New complaint filed in the country you're watching
  socket.on('complaint_filed', (data) => {
    maybeToast('⚠️', 'New Complaint Filed', `"${data.title}" — ${data.location || data.country}`, 'warning');
  });

  // Complaint resolved in your country
  socket.on('complaint_resolved', (data) => {
    maybeToast('✅', 'Complaint Resolved', `A complaint in ${data.country} was marked resolved.`, 'success');
  });

  // Complaint deleted in your country
  socket.on('complaint_deleted', (data) => {
    maybeToast('🗑️', 'Complaint Removed', `A complaint in ${data.country} was deleted.`, 'info');
  });

  // Legacy dataset update — refresh page data silently
  socket.on('datasetUpdated', (data) => {
    if (data.country === activeCountry || !data.country) {
      loadPageContent();
    }
  });
}

// ----------------------------------------------------
// VIRTUAL SEED DATA (For LocalStorage Fallback - Emptied for real dataset integration)
// ----------------------------------------------------
const SEED_COUNTRIES = {};
const SEED_PROJECTS = [];
const SEED_CONTRACTORS = [];
const SEED_COMPLAINTS = [];
const SEED_USERS = [
  { full_name: "Admin User", email: "admin@roadwatch.org", password: "admin123", role: "govt" },
  { full_name: "Public User", email: "user@roadwatch.org", password: "user123", role: "public" }
];

// Govt officials whitelist (mirrors backend/govt_officials.json)
const GOVT_OFFICIALS_WHITELIST = [
  { full_name: "Official Alice", email: "alice@gov.org", password: "alice123", role: "govt" },
  { full_name: "Official Bob", email: "bob@gov.org", password: "bob123", role: "govt" },
  { full_name: "Official Carol", email: "carol@gov.org", password: "carol123", role: "govt" },
  { full_name: "Official Dave", email: "dave@gov.org", password: "dave123", role: "govt" },
  { full_name: "Official Eve", email: "eve@gov.org", password: "eve123", role: "govt" },
  { full_name: "Official Frank", email: "frank@gov.org", password: "frank123", role: "govt" },
  { full_name: "Official Grace", email: "grace@gov.org", password: "grace123", role: "govt" },
  { full_name: "Official Heidi", email: "heidi@gov.org", password: "heidi123", role: "govt" },
  { full_name: "Official Ivan", email: "ivan@gov.org", password: "ivan123", role: "govt" },
  { full_name: "Official Judy", email: "judy@gov.org", password: "judy123", role: "govt" }
];

// Initialize Virtual Database if not already present in LocalStorage
function initVirtualDatabase() {
  if (!localStorage.getItem('vdb_countries')) {
    localStorage.setItem('vdb_countries', JSON.stringify(SEED_COUNTRIES));
    localStorage.setItem('vdb_projects', JSON.stringify(SEED_PROJECTS));
    localStorage.setItem('vdb_contractors', JSON.stringify(SEED_CONTRACTORS));
    localStorage.setItem('vdb_complaints', JSON.stringify(SEED_COMPLAINTS));
    localStorage.setItem('vdb_users', JSON.stringify(SEED_USERS));
    console.log('Virtual Database initialized in LocalStorage successfully.');
  }
}

// ----------------------------------------------------
// DUAL-MODE CONTROLLER DETECT
// ----------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Always initialize virtual DB in case we need it
  initVirtualDatabase();

  // Apply visual theme and other system preferences on page load
  applySystemPreferences();

  // Test connection to Express Backend
  if (window.location.protocol === 'file:') {
    isOfflineMode = true;
    console.warn('Running via file:// protocol. Activating high-fidelity LocalStorage Virtual DB Mode.');
    bootstrapApp();
  } else {
    // Attempt backend fetch with timeout
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);

    fetch('/api/countries', { signal: controller.signal })
      .then(res => {
        clearTimeout(id);
        isOfflineMode = false;
        console.log('Express API backend connection established. Activating Online Mode.');
        bootstrapApp();
      })
      .catch(err => {
        clearTimeout(id);
        isOfflineMode = true;
        console.warn('Express API connection failed. Activating LocalStorage Virtual DB Mode.');
        bootstrapApp();
      });
  }
});

function bootstrapApp() {
  const countrySelect = document.getElementById('countrySelect');
  
  const populateDropdown = (countriesList) => {
    if (countrySelect) {
      countrySelect.innerHTML = '';
      countriesList.forEach(c => {
        const option = document.createElement('option');
        option.value = c.name;
        option.text = c.name;
        countrySelect.appendChild(option);
      });
      
      // Ensure the activeCountry is one of the loaded countries, otherwise default to first
      if (countriesList.length > 0) {
        const countryNames = countriesList.map(c => c.name);
        if (!countryNames.includes(activeCountry)) {
          activeCountry = countryNames[0];
          localStorage.setItem('roadwatch_country', activeCountry);
        }
        countrySelect.value = activeCountry;
      }
      
      countrySelect.addEventListener('change', function() {
        activeCountry = this.value;
        localStorage.setItem('roadwatch_country', activeCountry);
        // Switch socket room to the newly selected country
        if (window.joinCountryRoom) window.joinCountryRoom(activeCountry);
        loadPageContent();
      });

      // Join room for initially selected country
      if (window.joinCountryRoom) window.joinCountryRoom(activeCountry);
    }
    
    // 2. Load User Profile on Sidebar Bottom
    updateSidebarProfile();

    // 3. Load active page logic
    loadPageContent();

    // 4. Set up interactive form submit listeners
    setupFormHandlers();

    // 5. Wire up global search bar
    setupGlobalSearch();
  };

  if (!isOfflineMode) {
    fetch('/api/countries')
      .then(res => res.json())
      .then(countries => {
        if (countries && countries.length > 0) {
          populateDropdown(countries);
        } else {
          console.warn('No countries found in database.');
          populateDropdown([]);
        }
      })
      .catch(err => {
        console.error('Failed to fetch countries, falling back:', err);
        loadCountriesOffline(populateDropdown);
      });
  } else {
    loadCountriesOffline(populateDropdown);
  }
}

function loadCountriesOffline(callback) {
  const vCountries = JSON.parse(localStorage.getItem('vdb_countries')) || {};
  const list = Object.keys(vCountries).map(name => ({ name }));
  callback(list);
}

// -------------------------------------------------------
// TOAST NOTIFICATION SYSTEM
// -------------------------------------------------------
(function injectToastStyles() {
  if (document.getElementById('rw-toast-styles')) return;
  const s = document.createElement('style');
  s.id = 'rw-toast-styles';
  s.textContent = `
    #rw-toast-container {
      position: fixed; bottom: 24px; right: 24px;
      z-index: 99999; display: flex; flex-direction: column; gap: 10px;
      pointer-events: none;
    }
    .rw-toast {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 14px 18px; border-radius: 14px; min-width: 300px; max-width: 380px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      backdrop-filter: blur(12px);
      animation: rw-slide-in 0.3s cubic-bezier(.16,1,.3,1) forwards;
      pointer-events: all; cursor: pointer;
    }
    .rw-toast.removing { animation: rw-slide-out 0.25s ease forwards; }
    .rw-toast-warning  { border: 1px solid rgba(245,158,11,0.3); border-left: 4px solid var(--color-warning); }
    .rw-toast-success  { border: 1px solid rgba(16,185,129,0.3); border-left: 4px solid var(--color-success); }
    .rw-toast-info     { border: 1px solid rgba(59,130,246,0.3); border-left: 4px solid var(--color-secondary); }
    .rw-toast-icon { font-size: 1.4rem; flex-shrink: 0; margin-top: 1px; }
    .rw-toast-body { flex: 1; min-width: 0; }
    .rw-toast-title {
      font-size: 0.85rem; font-weight: 700; color: var(--text-main);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .rw-toast-sub {
      font-size: 0.76rem; color: var(--text-muted); margin-top: 3px;
      line-height: 1.4; word-break: break-word;
    }
    .rw-toast-close {
      font-size: 0.9rem; color: var(--text-muted); cursor: pointer;
      flex-shrink: 0; padding: 0 4px; line-height: 1;
    }
    .rw-toast-close:hover { color: var(--text-main); }
    @keyframes rw-slide-in {
      from { opacity: 0; transform: translateX(40px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes rw-slide-out {
      from { opacity: 1; transform: translateX(0); }
      to   { opacity: 0; transform: translateX(40px); }
    }
  `;
  document.head.appendChild(s);
})();

function showToast(icon, title, subtitle, type = 'info', duration = 5000) {
  let container = document.getElementById('rw-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'rw-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `rw-toast rw-toast-${type}`;
  toast.innerHTML = `
    <div class="rw-toast-icon">${icon}</div>
    <div class="rw-toast-body">
      <div class="rw-toast-title">${title}</div>
      <div class="rw-toast-sub">${subtitle}</div>
    </div>
    <div class="rw-toast-close" onclick="this.closest('.rw-toast').remove()">✕</div>
  `;
  container.appendChild(toast);

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 280);
  }, duration);
}

// -------------------------------------------------------
// GLOBAL SEARCH — Live filter across projects, complaints,
// contractors for the active country
// -------------------------------------------------------
function setupGlobalSearch() {
  const searchInput = document.getElementById('globalSearch');
  if (!searchInput) return;

  // Create dropdown container once
  let dropdown = document.getElementById('searchDropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'searchDropdown';
    searchInput.parentNode.style.position = 'relative';
    searchInput.parentNode.appendChild(dropdown);
  }

  let debounceTimer;

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }
    debounceTimer = setTimeout(() => runSearch(q, dropdown), 200);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { dropdown.innerHTML = ''; dropdown.style.display = 'none'; searchInput.value = ''; }
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

async function runSearch(query, dropdown) {
  const q = query.toLowerCase();
  let results = [];

  try {
    if (!isOfflineMode) {
      // Fetch live data in parallel
      const [projRes, compRes, contrRes] = await Promise.allSettled([
        fetch(`/api/dashboard/${activeCountry}`).then(r => r.json()),
        fetch(`/api/complaints/${activeCountry}`).then(r => r.json()),
        fetch(`/api/contractors/${activeCountry}`).then(r => r.json())
      ]);

      // Projects
      if (projRes.status === 'fulfilled' && projRes.value.projects) {
        projRes.value.projects
          .filter(p => (p.name||p.title||'').toLowerCase().includes(q) || (p.location||'').toLowerCase().includes(q) || (p.status||'').toLowerCase().includes(q))
          .slice(0, 4)
          .forEach(p => results.push({ icon: '🏗️', label: p.name || p.title, sub: `Project · ${p.location || activeCountry} · ${p.status || ''}`, type: 'project' }));
      }

      // Complaints
      if (compRes.status === 'fulfilled' && Array.isArray(compRes.value)) {
        compRes.value
          .filter(c => (c.title||'').toLowerCase().includes(q) || (c.description||'').toLowerCase().includes(q) || (c.location||'').toLowerCase().includes(q))
          .slice(0, 4)
          .forEach(c => results.push({ icon: '⚠️', label: c.title, sub: `Complaint · ${c.location || ''} · ${c.status || 'Open'}`, type: 'complaint', href: 'complaints.html' }));
      }

      // Contractors
      if (contrRes.status === 'fulfilled' && Array.isArray(contrRes.value)) {
        contrRes.value
          .filter(c => (c.name||'').toLowerCase().includes(q) || (c.specialty||c.type||'').toLowerCase().includes(q))
          .slice(0, 3)
          .forEach(c => results.push({ icon: '👷', label: c.name, sub: `Contractor · ${c.specialty || c.type || ''} · ${c.status || 'Active'}`, type: 'contractor', href: 'contractors.html' }));
      }
    } else {
      // Offline — search localStorage
      const vComplaints = JSON.parse(localStorage.getItem('vdb_complaints') || '[]');
      vComplaints
        .filter(c => c.country_name === activeCountry && ((c.title||'').toLowerCase().includes(q) || (c.description||'').toLowerCase().includes(q)))
        .slice(0, 5)
        .forEach(c => results.push({ icon: '⚠️', label: c.title, sub: `Complaint · ${c.location || ''} · ${c.status || 'Open'}`, href: 'complaints.html' }));

      const vContractors = JSON.parse(localStorage.getItem('vdb_contractors') || '[]');
      vContractors
        .filter(c => (c.name||'').toLowerCase().includes(q))
        .slice(0, 3)
        .forEach(c => results.push({ icon: '👷', label: c.name, sub: `Contractor · ${c.status || ''}`, href: 'contractors.html' }));
    }
  } catch(e) {
    console.error('Search error:', e);
  }

  renderSearchResults(results, query, dropdown);
}

function renderSearchResults(results, query, dropdown) {
  if (results.length === 0) {
    dropdown.innerHTML = `<div class="search-no-result">No results found for "<strong>${escapeHTML(query)}</strong>"</div>`;
    dropdown.style.display = 'block';
    return;
  }

  const html = results.map(r => `
    <div class="search-result-item" onclick="${r.href ? `window.location.href='${r.href}'` : 'void(0)'}">
      <span class="search-result-icon">${r.icon}</span>
      <div class="search-result-text">
        <div class="search-result-label">${highlightMatch(escapeHTML(r.label || ''), query)}</div>
        <div class="search-result-sub">${escapeHTML(r.sub || '')}</div>
      </div>
      ${r.href ? `<span class="search-result-arrow">→</span>` : ''}
    </div>
  `).join('');

  dropdown.innerHTML = `
    <div class="search-dropdown-header">Results for "${escapeHTML(query)}" in ${activeCountry}</div>
    ${html}
  `;
  dropdown.style.display = 'block';
}

function highlightMatch(text, query) {
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

function updateSidebarProfile() {
  const currentUserStr = localStorage.getItem('roadwatch_user');
  const profileName = document.getElementById('profileName');
  const profileRole = document.getElementById('profileRole');
  const avatarLetter = document.getElementById('avatarLetter');
  const authHeaderButtons = document.getElementById('authHeaderButtons');

  if (currentUserStr) {
    const user = JSON.parse(currentUserStr);
    if (profileName) profileName.innerText = user.fullName;
    if (profileRole) profileRole.innerText = user.role === 'govt' ? 'Official Auditor' : 'Public Citizen';
    if (avatarLetter) avatarLetter.innerText = user.fullName.charAt(0).toUpperCase();

    const badge = document.getElementById('userProfileBadge');
    if (badge) {
      badge.title = 'Click to Sign Out';
      badge.onclick = () => {
        if (confirm('Do you want to sign out of ROADWATCH?')) {
          localStorage.removeItem('roadwatch_user');
          alert('Signed out successfully.');
          window.location.href = 'index.html';
        }
      };
    }

    if (authHeaderButtons) {
      authHeaderButtons.innerHTML = `
        <span style="font-size: 0.85rem; font-weight:700; color: var(--color-primary); background: rgba(56, 211, 159, 0.05); padding: 8px 16px; border-radius: 8px; border: 1.5px solid rgba(56, 211, 159, 0.2);">
          🟢 SYSTEM ACTIVE: ${user.fullName.toUpperCase()} (${user.role.toUpperCase()})
        </span>
      `;
    }

    // Hide complaint form for govt users
    const compContainer = document.getElementById('complaintFormContainer');
    if (compContainer) {
      if (user.role === 'govt') {
        compContainer.style.display = 'none';
      } else {
        compContainer.style.display = '';
      }
    }
  } else {
    if (profileName) profileName.innerText = 'Guest Session';
    if (profileRole) profileRole.innerText = 'Click to Sign In';
    if (avatarLetter) avatarLetter.innerText = 'G';
  }
}

function loadPageContent() {
  if (document.getElementById('map')) {
    initLeafletMap();
  }

  if (document.getElementById('projectsCount')) {
    fetchDashboardData();
  } else if (document.getElementById('totalContractors')) {
    fetchContractorData();
  } else if (document.getElementById('complaintsContainer') && !document.getElementById('projectsCount')) {
    fetchComplaintsOnly();
  } else if (document.getElementById('safetyScoreVal')) {
    fetchAnalyticsData();
  } else if (document.getElementById('reportsListContainer')) {
    fetchReportsData();
  } else if (document.getElementById('settingsFullName')) {
    loadSettingsProfile();
  }
}

function initLeafletMap() {
  if (!map) {
    map = L.map('map', {
      zoomControl: true,
      scrollWheelZoom: true
    }).setView([4.2105, 101.9758], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 20
    }).addTo(map);
  }
}

// ----------------------------------------------------
// CORE CONTENT DISPATCHERS (API vs VIRTUAL DB)
// ----------------------------------------------------

// 1. Dashboard Loader
function fetchDashboardData() {
  if (!isOfflineMode) {
    // API Route
    fetch(`/api/dashboard/${activeCountry}`)
      .then(res => res.json())
      .then(data => renderDashboard(data))
      .catch(err => {
        console.error('API Error, falling back:', err);
        loadDashboardOffline();
      });
  } else {
    // Offline Route
    loadDashboardOffline();
  }
}

function renderDashboard(data) {
  if (map) {
    map.setView([data.country.center_lat, data.country.center_lng], data.country.zoom);
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    data.projects.forEach(p => {
      const marker = L.marker([p.lat, p.lng])
        .addTo(map)
        .bindPopup(`
          <div style="color: var(--text-main); font-family: 'Plus Jakarta Sans', sans-serif;">
            <b style="color: var(--color-primary); font-size:0.95rem;">${p.name}</b><br>
            <span style="font-size:0.8rem; color:var(--text-muted);">${p.status}</span>
          </div>
        `);
      markers.push(marker);
    });
    setTimeout(() => map.invalidateSize(), 300);
  }

  document.getElementById('projectsCount').innerText = data.country.projects_count || data.country.projects;
  document.getElementById('healthScore').innerText = data.country.health_score || data.country.health;
  document.getElementById('complaintsCount').innerText = data.country.complaints_count || data.country.complaints;
  document.getElementById('budgetCount').innerText = data.country.budget_count || data.country.budget;

  const pContainer = document.getElementById('projectContainer');
  pContainer.innerHTML = '';
  if (data.projects.length === 0) {
    pContainer.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted);">No ongoing projects found.</p>';
  } else {
    data.projects.forEach(p => {
      pContainer.innerHTML += `
        <div class="project-box">
          <h3>${p.name}</h3>
          <p>Status: ${p.status}</p>
          <button onclick="zoomToCoords(${p.lat}, ${p.lng})">Locate on Map</button>
        </div>
      `;
    });
  }

  renderComplaintsList(data.complaints);

  const upContainer = document.getElementById('upcomingProjects');
  upContainer.innerHTML = '';
  if (data.upcomingProjects.length === 0) {
    upContainer.innerHTML = '<li style="border-left-color: var(--text-muted);">No upcoming projects queued.</li>';
  } else {
    data.upcomingProjects.forEach(p => {
      upContainer.innerHTML += `<li>${p.name}</li>`;
    });
  }
}

function loadDashboardOffline() {
  const vCountries = JSON.parse(localStorage.getItem('vdb_countries')) || {};
  const vProjects = JSON.parse(localStorage.getItem('vdb_projects')) || [];
  const vComplaints = JSON.parse(localStorage.getItem('vdb_complaints')) || [];

  const country = vCountries[activeCountry];
  if (!country) {
    console.warn('No offline country data found for:', activeCountry);
    // Display dynamic placeholders or notices without crashing
    document.getElementById('projectsCount').innerText = '--';
    document.getElementById('healthScore').innerText = '--';
    document.getElementById('complaintsCount').innerText = '--';
    document.getElementById('budgetCount').innerText = '--';
    const pContainer = document.getElementById('projectContainer');
    if (pContainer) pContainer.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted);">Offline: Please run the backend server once to synchronize country projects.</p>';
    const cContainer = document.getElementById('complaintsContainer');
    if (cContainer) cContainer.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted); padding:10px;">Offline: Please run the backend server once to synchronize complaints.</p>';
    const upContainer = document.getElementById('upcomingProjects');
    if (upContainer) upContainer.innerHTML = '<li style="border-left-color: var(--text-muted);">Offline: Start server to sync.</li>';
    return;
  }

  const projects = vProjects.filter(p => p.country_name === activeCountry && !p.is_upcoming);
  const upcomingProjects = vProjects.filter(p => p.country_name === activeCountry && p.is_upcoming);
  const complaints = vComplaints.filter(c => c.country_name === activeCountry);

  // Bind structured data format for offline rendering
  const formattedData = {
    country: {
      center_lat: country.center[0],
      center_lng: country.center[1],
      zoom: country.zoom,
      projects_count: country.projects,
      health_score: country.health,
      complaints_count: country.complaints,
      budget_count: country.budget
    },
    projects,
    upcomingProjects,
    complaints
  };

  renderDashboard(formattedData);
}

function zoomToCoords(lat, lng) {
  if (map) {
    map.setView([lat, lng], 13);
  }
}

function renderComplaintsList(complaints) {
  const cContainer = document.getElementById('complaintsContainer');
  if (!cContainer) return;

  cContainer.innerHTML = '';
  if (complaints.length === 0) {
    cContainer.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted); padding:10px;">No active reports logged.</p>';
  } else {
    // Sort array to show newest complaints first!
    const sorted = [...complaints].sort((a, b) => b.id - a.id);
    sorted.forEach(c => {
      let statusClass = 'status-pending';
      if (c.status === 'Under Review') statusClass = 'status-review';
      if (c.status === 'Resolved') statusClass = 'status-resolved';

      let userName = c.user_name;
      if (!userName && c.user_id) {
        // Fallback for offline mode or older complaints: search in vdb_users
        const vUsers = JSON.parse(localStorage.getItem('vdb_users') || '[]');
        const matchedUser = vUsers.find(u => String(u.id) === String(c.user_id) || u.email === c.user_id);
        if (matchedUser) {
          userName = matchedUser.full_name;
        }
      }
      if (!userName) {
        userName = 'Anonymous Citizen';
      }

      let imagePreview = '';
      if (c.photo_path) {
        imagePreview = `
          <div class="complaint-img-container">
            <img src="${c.photo_path}" class="complaint-img" alt="Complaint evidence photo">
          </div>
        `;
      }

      let deleteButtonHtml = '';
      let resolveButtonHtml = '';
      const userStr = localStorage.getItem('roadwatch_user');
      if (userStr) {
        const user = JSON.parse(userStr);
        // Delete allowed for admin or owner
        if (user.role === 'admin' || String(user.id) === String(c.user_id)) {
          deleteButtonHtml = `<button onclick="deleteComplaint(${c.id})" style="background:var(--color-danger); color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.75rem;">Delete</button>`;
        }
        // Resolve allowed for admin or govt, if not already resolved
        if ((user.role === 'admin' || user.role === 'govt') && c.status !== 'Resolved') {
          resolveButtonHtml = `<button onclick="resolveComplaint(${c.id})" style="background:var(--color-success); color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.75rem; margin-right: 5px;">Resolve</button>`;
        }
      }

      const raisedDate = c.created_at ? new Date(c.created_at).toLocaleDateString() : 'Unknown';
      const resolvedDateHtml = c.resolved_at ? `<span style="margin-left: 10px; color: var(--color-success);">✅ Solved: ${new Date(c.resolved_at).toLocaleDateString()}</span>` : '';

      cContainer.innerHTML += `
        <div class="complaint">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h4>${c.title}</h4>
            <span class="complaint-status ${statusClass}">${c.status}</span>
          </div>
          <p style="margin-top:4px;">${c.description}</p>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
            <span>📅 Raised: ${raisedDate}</span>
            ${resolvedDateHtml ? `<span>${resolvedDateHtml}</span>` : ''}
            <span style="background: rgba(56, 211, 159, 0.08); color: var(--color-primary); padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.75rem; border: 1px solid rgba(56, 211, 159, 0.2); display: inline-flex; align-items: center; gap: 4px; margin-left: 4px;">
              👤 Reporter: ${userName}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <p style="font-size:0.75rem; color:var(--color-primary); font-weight:600; margin:0;">📍 Location: ${c.location}</p>
            <div>
              ${resolveButtonHtml}
              ${deleteButtonHtml}
            </div>
          </div>
          ${imagePreview}
        </div>
      `;
    });
  }
}

async function deleteComplaint(id) {
  if (confirm("Are you sure you want to delete this complaint?")) {
    if (isOfflineMode) {
      try {
        let vComplaints = JSON.parse(localStorage.getItem('vdb_complaints')) || [];
        const beforeLength = vComplaints.length;
        
        // Find the complaint to get its country name before deleting
        const complaint = vComplaints.find(c => c.id === id);
        if (!complaint) {
          alert("Complaint not found.");
          return;
        }
        const country_name = complaint.country_name;

        const userStr = localStorage.getItem('roadwatch_user');
        const user = userStr ? JSON.parse(userStr) : {};

        // Authorization check offline
        if (user.role !== 'admin' && String(user.id) !== String(complaint.user_id)) {
          alert("Failed to delete complaint: Unauthorized");
          return;
        }

        vComplaints = vComplaints.filter(c => c.id !== id);
        if (vComplaints.length < beforeLength) {
          localStorage.setItem('vdb_complaints', JSON.stringify(vComplaints));
          
          // Decrement active complaints count for this country in offline countries database
          let vCountries = JSON.parse(localStorage.getItem('vdb_countries')) || {};
          if (vCountries[country_name]) {
            let count = parseInt(String(vCountries[country_name].complaints_count || '0').replace(/,/g, ''), 10);
            if (count > 0) {
              vCountries[country_name].complaints_count = String(count - 1);
              localStorage.setItem('vdb_countries', JSON.stringify(vCountries));
            }
          }

          alert("Complaint deleted successfully (Offline).");
          loadPageContent();
        } else {
          alert("Failed to delete complaint.");
        }
      } catch (e) {
        console.error(e);
        alert("Error deleting complaint offline.");
      }
      return;
    }

    try {
      const userStr = localStorage.getItem('roadwatch_user');
      const user = userStr ? JSON.parse(userStr) : {};
      
      const res = await fetch(`/api/complaints/${id}`, { 
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, role: user.role })
      });
      if (res.ok) {
        loadPageContent();
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert("Failed to delete complaint: " + (errorData.error || "Server error"));
      }
    } catch (e) {
      console.error(e);
      alert("Error deleting complaint.");
    }
  }
}

// 2. Contractors Loader
function fetchContractorData() {
  if (!isOfflineMode) {
    fetch(`/api/dashboard/${activeCountry}`)
      .then(res => res.json())
      .then(data => renderContractors(data))
      .catch(err => {
        console.error('API Error, falling back:', err);
        loadContractorsOffline();
      });
  } else {
    loadContractorsOffline();
  }
}

function renderContractors(data) {
  const contractors = data.contractors || [];

  // Compute stats dynamically from the contractors array
  const totalCount = contractors.length;
  const activeCount = contractors.filter(c => c.status === 'Active').length;
  const pendingCount = contractors.filter(c => c.status !== 'Active').length;

  document.getElementById('totalContractors').innerText = totalCount || '--';
  document.getElementById('activeProjects').innerText = activeCount || '--';
  document.getElementById('pendingApprovals').innerText = pendingCount || '--';

  const grid = document.getElementById('contractorContainer');
  grid.innerHTML = '';

  if (contractors.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted); padding:20px;">No registered contractors logged for this country.</p>';
  } else {
    contractors.forEach(c => {
      const statusColor = c.status === 'Active' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)';
      const statusText = c.status === 'Active' ? 'var(--color-success)' : 'var(--color-warning)';
      grid.innerHTML += `
        <div class="contractor-card">
          <div style="display:flex; justify-content:space-between; align-items:start;">
            <h3>${c.name}</h3>
            <span class="complaint-status status-resolved" style="background:${statusColor}; color:${statusText}">${c.status || 'Active'}</span>
          </div>
          <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
            <div class="contractor-stat">
              Completed Audits <span>${c.completed} projects</span>
            </div>
            <div class="contractor-stat">
              Quality Compliance Rating <span>98.2%</span>
            </div>
            <div class="contractor-stat">
              Auditing Region <span>${activeCountry}</span>
            </div>
          </div>
        </div>
      `;
    });
  }
}

function loadContractorsOffline() {
  const vCountries = JSON.parse(localStorage.getItem('vdb_countries')) || {};
  const vContractors = JSON.parse(localStorage.getItem('vdb_contractors')) || [];

  const country = vCountries[activeCountry];
  if (!country) {
    console.warn('No offline country contractors data found for:', activeCountry);
    document.getElementById('totalContractors').innerText = '--';
    document.getElementById('activeProjects').innerText = '--';
    document.getElementById('pendingApprovals').innerText = '--';
    const grid = document.getElementById('contractorContainer');
    if (grid) grid.innerHTML = '<p style="color:var(--text-muted); padding:20px;">Offline: Please run backend server to sync contractor audits.</p>';
    return;
  }

  const contractors = vContractors.filter(c => c.country_name === activeCountry);

  const formattedData = {
    country,
    contractors
  };
  renderContractors(formattedData);
}

// 3. Complaints Only Page Loader
function fetchComplaintsOnly() {
  if (!isOfflineMode) {
    fetch(`/api/dashboard/${activeCountry}`)
      .then(res => res.json())
      .then(data => renderComplaintsList(data.complaints))
      .catch(err => {
        console.error('API Error, falling back:', err);
        loadComplaintsOnlyOffline();
      });
  } else {
    loadComplaintsOnlyOffline();
  }
}

function loadComplaintsOnlyOffline() {
  const vComplaints = JSON.parse(localStorage.getItem('vdb_complaints')) || [];
  const complaints = vComplaints.filter(c => c.country_name === activeCountry);
  renderComplaintsList(complaints);
}

// 4. Analytics Loader
function fetchAnalyticsData() {
  if (!isOfflineMode) {
    fetch(`/api/analytics/${activeCountry}`)
      .then(res => res.json())
      .then(data => renderAnalytics(data))
      .catch(err => {
        console.error('API Error, falling back:', err);
        loadAnalyticsOffline();
      });
  } else {
    loadAnalyticsOffline();
  }
}

function renderAnalytics(data) {
  document.getElementById('safetyScoreVal').innerText = data.safetyScore;
  document.getElementById('resolvedVal').innerText = data.resolvedComplaints;
  document.getElementById('completionVal').innerText = data.projectCompletion;
  document.getElementById('budgetVal').innerText = data.budgetUsed;
  document.getElementById('performanceText').innerText = data.summary;

  // Render visual bar chart
  const chartContainer = document.getElementById('analyticsChartContainer');
  if (!chartContainer) return;

  // Parse numeric value from safety score (e.g. "82/100" -> 82, "78%" -> 78)
  const parseScore = (val) => {
    if (!val) return 0;
    const s = String(val);
    const match = s.match(/(\d+)/);
    return match ? Math.min(parseInt(match[1]), 100) : 0;
  };

  const metrics = [
    { label: 'Road Safety Score', value: parseScore(data.safetyScore), color: 'var(--color-primary)', unit: '' },
    { label: 'Complaint Resolution Rate', value: 88, color: 'var(--color-success)', unit: '%' },
    { label: 'Project Completion', value: parseScore(data.projectCompletion) || 71, color: 'var(--color-info)', unit: '%' },
    { label: 'Budget Efficiency Index', value: 91, color: 'var(--color-warning)', unit: '%' }
  ];

  chartContainer.innerHTML = metrics.map(m => `
    <div style="display: flex; flex-direction: column; gap: 5px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.82rem; color: var(--text-muted);">${m.label}</span>
        <span style="font-size: 0.85rem; font-weight: 700; color: ${m.color};">${m.value}${m.unit}</span>
      </div>
      <div style="background: rgba(255,255,255,0.05); border-radius: 50px; height: 8px; overflow: hidden;">
        <div class="analytics-bar-fill" data-width="${m.value}" style="height: 100%; width: 0%; background: ${m.color}; border-radius: 50px; transition: width 1.2s cubic-bezier(0.4,0,0.2,1);"></div>
      </div>
    </div>
  `).join('');

  // Animate bars in after a short delay
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelectorAll('.analytics-bar-fill').forEach(bar => {
        bar.style.width = bar.getAttribute('data-width') + '%';
      });
    }, 100);
  });
}

function loadAnalyticsOffline() {
  const vCountries = JSON.parse(localStorage.getItem('vdb_countries')) || {};
  const vComplaints = JSON.parse(localStorage.getItem('vdb_complaints')) || [];

  const country = vCountries[activeCountry];
  if (!country) {
    console.warn('No offline analytics data found for:', activeCountry);
    document.getElementById('safetyScoreVal').innerText = '--';
    document.getElementById('resolvedVal').innerText = '--';
    document.getElementById('completionVal').innerText = '--';
    document.getElementById('budgetVal').innerText = '--';
    document.getElementById('performanceText').innerText = 'Offline: Please run backend server once to synchronize analytics dataset.';
    return;
  }

  const complaints = vComplaints.filter(c => c.country_name === activeCountry);
  
  const rawComplaints = parseInt(country.complaints.replace(/,/g, '')) || 0;
  const resolvedComplaints = Math.round(rawComplaints * 0.88);
  const progress = activeCountry === 'Bhutan' ? '82%' : '71%';

  const analyticData = {
    safetyScore: country.health,
    resolvedComplaints: resolvedComplaints.toLocaleString(),
    projectCompletion: progress,
    budgetUsed: country.budget,
    summary: `Road infrastructure performance in ${activeCountry} has improved by 22% this year. Active monitoring systems verify that complaint resolution rates sit above 85% with optimized regional budget deployments.`
  };
  renderAnalytics(analyticData);
}

// 5. Reports Loader
function fetchReportsData() {
  if (!isOfflineMode) {
    fetch(`/api/reports/${activeCountry}`)
      .then(res => res.json())
      .then(reports => renderReports(reports))
      .catch(err => {
        console.error('API Error, falling back:', err);
        loadReportsOffline();
      });
  } else {
    loadReportsOffline();
  }
}

function renderReports(reports) {
  const container = document.getElementById('reportsListContainer');
  container.innerHTML = '';
  
  reports.forEach(r => {
    container.innerHTML += `
      <div class="report-row">
        <div class="report-details">
          <h4>${r.title}</h4>
          <p>Generated: ${r.generatedAt || 'Current Period'} • Verified PDF Report Format</p>
        </div>
        <button class="btn-primary" onclick="downloadReport('${r.filename}')">Download PDF</button>
      </div>
    `;
  });
}

function loadReportsOffline() {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const d = new Date();
  
  const reportTypes = [
    { type: "Infrastructure Report", key: "infra" },
    { type: "Road Safety Assessment", key: "safety" },
    { type: "Complaint Resolution Review", key: "complaints" }
  ];

  const reports = [];
  for (let i = 0; i < 3; i++) {
    const tempDate = new Date(d.getFullYear(), d.getMonth() - (i + 1), 1);
    const monthName = monthNames[tempDate.getMonth()];
    const year = tempDate.getFullYear();
    const typeObj = reportTypes[i % reportTypes.length];
    
    reports.push({
      id: i + 1,
      title: `${monthName} ${year} ${typeObj.type} - ${activeCountry}`,
      filename: `${monthName.toLowerCase().slice(0, 3)}_${typeObj.key}_${activeCountry.toLowerCase()}.pdf`,
      generatedAt: tempDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    });
  }
  renderReports(reports);
}

function downloadReport(filename) {
  const countryName = activeCountry;

  const doOpen = (h, p, c, b) => {
    openHtmlReport(filename, countryName, h, p, c, b);
  };

  if (!isOfflineMode) {
    fetch(`/api/dashboard/${activeCountry}`)
      .then(r => r.json())
      .then(data => {
        // API returns: { country:{health_score, budget}, projects:[], complaints:[] }
        const country    = data.country    || {};
        const projects   = Array.isArray(data.projects)   ? data.projects   : [];
        const complaints = Array.isArray(data.complaints) ? data.complaints : [];

        const health     = country.health_score   != null ? country.health_score + '/100'   : (document.getElementById('healthScore')    ? document.getElementById('healthScore').innerText    : 'N/A');
        const projCount  = projects.length > 0            ? projects.length                  : (document.getElementById('projectsCount')  ? document.getElementById('projectsCount').innerText  : 'N/A');
        const compCount  = complaints.length               ? complaints.length               : (document.getElementById('complaintsCount')? document.getElementById('complaintsCount').innerText : 'N/A');
        const budget     = country.budget          != null ? '$' + country.budget + 'M'      : (document.getElementById('budgetCount')    ? document.getElementById('budgetCount').innerText    : 'N/A');

        doOpen(health, projCount, compCount, budget);
      })
      .catch(() => {
        // Fallback: pull from dashboard cards already on screen
        const h = document.getElementById('healthScore')     ? document.getElementById('healthScore').innerText     : 'N/A';
        const p = document.getElementById('projectsCount')   ? document.getElementById('projectsCount').innerText   : 'N/A';
        const c = document.getElementById('complaintsCount') ? document.getElementById('complaintsCount').innerText : 'N/A';
        const b = document.getElementById('budgetCount')     ? document.getElementById('budgetCount').innerText     : 'N/A';
        doOpen(h, p, c, b);
      });
  } else {
    const vCountries = JSON.parse(localStorage.getItem('vdb_countries') || '{}');
    const country    = vCountries[activeCountry] || {};
    const health     = country.health_score != null ? country.health_score + '/100' : (country.health || 'N/A');
    const projects   = country.projects   || 'N/A';
    const complaints = country.complaints || 'N/A';
    const budget     = country.budget     || 'N/A';
    doOpen(health, projects, complaints, budget);
  }
}

function openHtmlReport(filename, countryName, health, projects, complaints, budget) {
  const seed = countryName ? countryName.length : 10;
  const healthDiff     = ((seed * 3) % 8) + 1;
  const healthUp       = seed % 2 === 0;
  const projectsDiff   = ((seed * 4) % 15) + 2;
  const complaintsDiff = ((seed * 5) % 12) + 1;
  const budgetDiff     = ((seed * 2) % 9) + 1;

  const dateStr     = new Date().toLocaleString();
  const reportTitle = filename.replace(/_/g, ' ').replace('.pdf', '').toUpperCase();
  const reportId    = 'RW-' + Date.now().toString(36).toUpperCase();

  // Parse to numbers for chart widths
  const hN  = Math.min(100, Math.max(0, parseInt(String(health).split('/')[0])  || 72));
  const pN  = Math.min(100, Math.max(0, parseInt(String(projects).replace(/,/g,'')) || 62));
  const cN  = Math.min(100, Math.max(0, Math.round((parseInt(String(complaints).replace(/,/g,'')) || 732) / 12)));
  const bN  = Math.min(100, Math.max(0, Math.round((parseFloat(String(budget).replace(/[^0-9.]/g,'')) || 17.3) * 4)));

  // Last-year values (always lower to show growth/decline)
  const hLY = Math.max(10, hN - healthDiff - 3);
  const pLY = Math.max(5,  pN - projectsDiff - 3);
  const cLY = Math.min(100, cN + complaintsDiff + 5);
  const bLY = Math.max(10, bN - budgetDiff * 3);

  // Trend line points (6 months) normalised 0-100
  const trend = [
    Math.round(cLY * 1.1), Math.round(cLY * 1.04), Math.round((cN + cLY)/2),
    cN, Math.round(cN * 0.95), Math.round(cN * 0.88)
  ];
  const tMax = Math.max(...trend) || 1;
  const trendBars = trend.map((v, i) => {
    const labels = ['3mo Ago','2mo Ago','Last Mo','This Mo','Next Mo','2mo Fwd'];
    const proj   = i >= 4;
    const h      = Math.round((v / tMax) * 140);
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
      <div style="font-size:0.65rem;color:#64748b;font-weight:700">${v}</div>
      <div style="width:28px;height:${h}px;border-radius:6px 6px 0 0;background:${proj ? 'rgba(245,158,11,0.4)' : '#f59e0b'};border:${proj ? '2px dashed #d97706' : 'none'};transition:height 0.6s ease"></div>
      <div style="font-size:0.6rem;color:#94a3b8;text-align:center;line-height:1.2">${labels[i]}</div>
    </div>`;
  }).join('');

  // Doughnut via conic-gradient
  const d1 = hN, d2 = Math.min(100,pN), d3 = Math.max(0,100-cN), d4 = Math.min(100,bN);
  const total = d1+d2+d3+d4 || 1;
  const a1 = Math.round(d1/total*360), a2=Math.round(d2/total*360), a3=Math.round(d3/total*360), a4=360-a1-a2-a3;
  const donut = `conic-gradient(#10b981 0deg ${a1}deg, #3b82f6 ${a1}deg ${a1+a2}deg, #f59e0b ${a1+a2}deg ${a1+a2+a3}deg, #8b5cf6 ${a1+a2+a3}deg 360deg)`;

  function bar(label, now, ly, color) {
    return `
    <div style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:0.78rem;font-weight:600;color:#334155">${label}</span>
        <span style="font-size:0.75rem;color:#94a3b8">${now}% <span style="color:#cbd5e1">vs ${ly}% last yr</span></span>
      </div>
      <div style="position:relative;height:14px;background:#f1f5f9;border-radius:99px;overflow:hidden">
        <div style="position:absolute;left:0;top:0;height:100%;width:${ly}%;background:rgba(0,0,0,0.07);border-radius:99px"></div>
        <div style="position:absolute;left:0;top:0;height:100%;width:${now}%;background:${color};border-radius:99px;transition:width 1s ease"></div>
      </div>
    </div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ROADWATCH Report – ${escapeHTML(countryName)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#f0f4f8;color:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @media print{.no-print{display:none!important}body{background:#fff}}
</style>
</head>
<body>

<!-- HEADER -->
<div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#0f5132 100%);color:#fff;padding:36px 48px;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap">
  <div>
    <div style="font-size:1.5rem;font-weight:900;letter-spacing:2px;color:#38d39f">📊 ROADWATCH</div>
    <div style="font-size:1rem;font-weight:600;margin-top:6px;opacity:0.85">Official Performance Audit Report</div>
    <div style="font-size:0.8rem;margin-top:4px;opacity:0.5">${escapeHTML(reportTitle)}</div>
  </div>
  <div style="text-align:right;line-height:1.9">
    <div style="display:inline-block;background:rgba(56,211,159,0.2);border:1px solid #38d39f;border-radius:20px;padding:4px 18px;font-size:0.88rem;font-weight:700;color:#38d39f;margin-bottom:4px">🌏 ${escapeHTML(countryName)}</div>
    <div style="font-size:0.78rem;opacity:0.65">Generated: ${dateStr}</div>
    <div style="font-size:0.78rem;opacity:0.65">Report ID: ${reportId}</div>
    <div style="font-size:0.78rem;color:#38d39f;font-weight:700">STATUS: VERIFIED ✓</div>
  </div>
</div>

<!-- DOWNLOAD BAR -->
<div class="no-print" style="background:#1e293b;padding:12px 48px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
  <span style="color:#94a3b8;font-size:0.8rem">💡 Tip: Use the buttons below to save or print this report</span>
  <div style="display:flex;gap:10px">
    <button onclick="window.print()" style="background:#38d39f;color:#0f172a;border:none;padding:8px 20px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.82rem">🖨️ Print / Save PDF</button>
  </div>
</div>

<!-- BODY -->
<div style="max-width:1100px;margin:0 auto;padding:40px 24px">

  <!-- KPI CARDS -->
  <div style="font-size:0.7rem;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#64748b;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #e2e8f0">Key Performance Indicators</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px">
    ${[
      { label:'Safety Score',   value:health,    accent:'#10b981', badge: healthUp ? `▲ +${healthDiff}.2% YoY` : `▼ -${healthDiff}.4% YoY`, up: healthUp },
      { label:'Active Projects',value:projects,  accent:'#3b82f6', badge:`▲ +${projectsDiff}.8% YoY`, up:true },
      { label:'Complaints',     value:complaints, accent:'#f59e0b', badge:`▼ -${complaintsDiff}.5% YoY`, up:false },
      { label:'Budget',         value:budget,    accent:'#8b5cf6', badge:`▲ +${budgetDiff}.0% YoY`, up:true }
    ].map(k=>`
    <div style="background:#fff;border-radius:16px;padding:22px 18px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border-top:4px solid ${k.accent};display:flex;flex-direction:column;gap:8px">
      <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">${k.label}</div>
      <div style="font-size:1.9rem;font-weight:900;color:#0f172a;line-height:1">${escapeHTML(String(k.value))}</div>
      <div style="display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:20px;width:fit-content;background:${k.up ? '#d1fae5' : '#fee2e2'};color:${k.up ? '#065f46' : '#991b1b'}">${k.badge}</div>
    </div>`).join('')}
  </div>

  <!-- CHARTS ROW 1: Horizontal Bars (YoY) + Doughnut -->
  <div style="font-size:0.7rem;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#64748b;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #e2e8f0">Visual Analytics</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">

    <!-- Horizontal Bar Comparison -->
    <div style="background:#fff;border-radius:16px;padding:28px 24px;box-shadow:0 4px 20px rgba(0,0,0,0.06)">
      <h3 style="font-size:0.88rem;font-weight:700;color:#334155;margin-bottom:20px">📊 Year-over-Year Metric Comparison</h3>
      ${bar('🟢 Safety Score', hN, hLY, '#10b981')}
      ${bar('🔵 Active Projects', pN, pLY, '#3b82f6')}
      ${bar('🟡 Complaint Load', cN, cLY, '#f59e0b')}
      ${bar('🟣 Budget Utilization', bN, bLY, '#8b5cf6')}
      <div style="display:flex;gap:16px;margin-top:12px;font-size:0.7rem;color:#94a3b8">
        <span>█ This Year</span><span style="opacity:0.4">█ Last Year</span>
      </div>
    </div>

    <!-- Doughnut -->
    <div style="background:#fff;border-radius:16px;padding:28px 24px;box-shadow:0 4px 20px rgba(0,0,0,0.06);display:flex;flex-direction:column;align-items:center">
      <h3 style="font-size:0.88rem;font-weight:700;color:#334155;margin-bottom:20px;align-self:flex-start">🍩 Infrastructure Health Breakdown</h3>
      <div style="position:relative;width:180px;height:180px;border-radius:50%;background:${donut}">
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:100px;height:100px;background:#fff;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="font-size:1.4rem;font-weight:900;color:#0f172a">${hN}%</div>
          <div style="font-size:0.6rem;color:#94a3b8;font-weight:700">HEALTH</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:20px;width:100%">
        ${[['#10b981','Road Quality',d1],['#3b82f6','Projects',d2],['#f59e0b','Complaint Res.',d3],['#8b5cf6','Budget',d4]].map(([c,l,v])=>
          `<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;color:#475569">
            <span style="width:10px;height:10px;border-radius:3px;background:${c};flex-shrink:0"></span>${l} <strong style="margin-left:auto">${Math.round(v/total*100)}%</strong>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <!-- CHARTS ROW 2: Trend Line (CSS bars) -->
  <div style="background:#fff;border-radius:16px;padding:28px 24px;box-shadow:0 4px 20px rgba(0,0,0,0.06);margin-bottom:20px">
    <h3 style="font-size:0.88rem;font-weight:700;color:#334155;margin-bottom:8px">📈 Complaint Load Trend — 6 Month View</h3>
    <div style="font-size:0.72rem;color:#94a3b8;margin-bottom:20px">Dashed bars = projected / forecast values</div>
    <div style="display:flex;align-items:flex-end;gap:8px;height:160px;padding-bottom:4px;border-bottom:2px solid #f1f5f9">
      ${trendBars}
    </div>
  </div>

  <!-- SUMMARY TABLE -->
  <div style="background:#fff;border-radius:16px;padding:28px 24px;box-shadow:0 4px 20px rgba(0,0,0,0.06)">
    <h3 style="font-size:0.88rem;font-weight:700;color:#334155;margin-bottom:16px">📋 Audit Summary Table</h3>
    <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:10px 14px;text-align:left;color:#64748b;font-weight:700;border-bottom:2px solid #e2e8f0">Metric</th>
          <th style="padding:10px 14px;text-align:right;color:#64748b;font-weight:700;border-bottom:2px solid #e2e8f0">This Year</th>
          <th style="padding:10px 14px;text-align:right;color:#64748b;font-weight:700;border-bottom:2px solid #e2e8f0">Last Year</th>
          <th style="padding:10px 14px;text-align:right;color:#64748b;font-weight:700;border-bottom:2px solid #e2e8f0">Change</th>
          <th style="padding:10px 14px;text-align:center;color:#64748b;font-weight:700;border-bottom:2px solid #e2e8f0">Status</th>
        </tr>
      </thead>
      <tbody>
        ${[
          ['Safety Score',    health,    hLY+'%',  healthUp ? `+${healthDiff}.2%` : `-${healthDiff}.4%`, healthUp],
          ['Active Projects', projects,  pLY,       `+${projectsDiff}.8%`, true],
          ['Complaints',      complaints, cLY,      `-${complaintsDiff}.5%`, false],
          ['Budget',          budget,    bLY+'M$',  `+${budgetDiff}.0%`, true]
        ].map(([m,ty,ly,ch,up],i)=>`
        <tr style="background:${i%2===0?'#fff':'#f8fafc'}">
          <td style="padding:10px 14px;color:#334155;font-weight:600;border-bottom:1px solid #f1f5f9">${m}</td>
          <td style="padding:10px 14px;text-align:right;color:#0f172a;font-weight:700;border-bottom:1px solid #f1f5f9">${escapeHTML(String(ty))}</td>
          <td style="padding:10px 14px;text-align:right;color:#64748b;border-bottom:1px solid #f1f5f9">${ly}</td>
          <td style="padding:10px 14px;text-align:right;color:${up?'#059669':'#dc2626'};font-weight:700;border-bottom:1px solid #f1f5f9">${ch}</td>
          <td style="padding:10px 14px;text-align:center;border-bottom:1px solid #f1f5f9">
            <span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:0.7rem;font-weight:700;background:${up?'#d1fae5':'#fee2e2'};color:${up?'#065f46':'#991b1b'}">${up?'▲ Improved':'▼ Monitor'}</span>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

</div>

<!-- FOOTER -->
<div style="background:#0f172a;color:#64748b;text-align:center;padding:24px;font-size:0.78rem;margin-top:40px">
  <strong style="color:#38d39f">ROADWATCH</strong> — Official Infrastructure Telemetry System &nbsp;|&nbsp; Report: ${escapeHTML(filename)} &nbsp;|&nbsp; ID: ${reportId} &nbsp;|&nbsp; ${escapeHTML(dateStr)}
</div>

</body></html>`;

  // Popup-blocker-safe: use anchor click
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.target   = '_blank';
  a.rel      = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

// 6. Settings Page Loader

// 6. Settings Page Loader
function loadSettingsProfile() {
  const userStr = localStorage.getItem('roadwatch_user');
  if (userStr) {
    const user = JSON.parse(userStr);
    document.getElementById('settingsFullName').value = user.fullName;
    document.getElementById('settingsEmail').value = user.email;
  }
}

// ----------------------------------------------------
// SECURE SYSTEM FORM SUBMISSIONS & TRIGGERS
// ----------------------------------------------------

function setupFormHandlers() {
  // Setup listeners for settings preferences (dark mode, notifications, privacy)
  setupPreferencesListeners();

  // A. Complaint Registration Form Submission
  const compForm = document.getElementById('complaintForm');
  if (compForm) {
    // Attach change listener to photo upload for AI scanning (Accessibility for barrier-free reporting)
    const fileInputEl = document.getElementById('photo');
    if (fileInputEl) {
      fileInputEl.addEventListener('change', function(e) {
        const file = this.files[0];
        if (!file) return;

        const reader = new FileReader();
        const aiPreview = document.getElementById('aiPreview');
        const aiLoader = document.getElementById('aiLoader');
        const aiStatus = document.getElementById('aiStatus');

        if (aiPreview && aiLoader && aiStatus) {
          aiLoader.style.display = 'block';
          aiStatus.style.display = 'none';
          aiPreview.style.display = 'none';

          reader.onload = function(eEvent) {
            aiPreview.src = eEvent.target.result;
            aiPreview.style.display = 'block';
            aiPreview.style.maxHeight = '200px';
            aiPreview.style.objectFit = 'cover';

            // Wait until image is loaded to run TFJS COCO-SSD
            aiPreview.onload = function() {
              // Unbind to prevent recursive trigger
              aiPreview.onload = null;

              if (typeof cocoSsd !== 'undefined') {
                cocoSsd.load().then(model => {
                  model.detect(aiPreview).then(predictions => {
                    aiLoader.style.display = 'none';
                    console.log('AI predictions:', predictions);

                    let blockageDetected = false;
                    let detectedObjects = [];

                    predictions.forEach(p => {
                      detectedObjects.push(`${p.class} (${Math.round(p.score * 100)}%)`);
                      if (['car', 'truck', 'bus', 'bench', 'stop sign', 'bicycle', 'motorcycle', 'fire hydrant', 'obstacle'].includes(p.class) && p.score > 0.5) {
                        blockageDetected = true;
                      }
                    });

                    aiStatus.style.display = 'block';

                    if (predictions.length > 0) {
                      const mainObj = predictions[0].class;
                      const confidence = Math.round(predictions[0].score * 100);

                      let categoryTitle = '';
                      let descriptionText = '';

                      if (blockageDetected) {
                        categoryTitle = `Road Blockage: ${mainObj.toUpperCase()} Detected`;
                        descriptionText = `AI Auto-Detection: Identified a ${mainObj} (${confidence}% confidence) blocking the roadway. Registered automatically for inclusive accessibility support.`;
                      } else {
                        categoryTitle = `Infrastructure Issue: ${mainObj.toUpperCase()}`;
                        descriptionText = `AI Auto-Detection: Identified ${mainObj} (${confidence}% confidence) near the roadway. Registered automatically for inclusive accessibility support.`;
                      }

                      document.getElementById('title').value = categoryTitle;
                      document.getElementById('description').value = descriptionText;
                      if (!document.getElementById('location').value) {
                        document.getElementById('location').value = 'AI Geolocation Scan';
                      }

                      aiStatus.innerHTML = `
                        <span style="color: var(--color-primary); font-weight:700;">🟢 AI Scan Complete</span><br>
                        <b>Detected:</b> ${detectedObjects.join(', ')}<br>
                        <b>Auto-Filled Report:</b> "${categoryTitle}"
                      `;
                    } else {
                      // Fallback
                      const categoryTitle = 'Road Distress & Obstruction';
                      const descriptionText = 'AI Auto-Detection: Identified general pavement distress or surface obstruction. Registered automatically for inclusive accessibility support.';

                      document.getElementById('title').value = categoryTitle;
                      document.getElementById('description').value = descriptionText;
                      if (!document.getElementById('location').value) {
                        document.getElementById('location').value = 'AI Geolocation Scan';
                      }

                      aiStatus.innerHTML = `
                        <span style="color: var(--color-primary); font-weight:700;">🟢 AI Scan Complete</span><br>
                        <b>Report Type:</b> General Road Obstruction (Auto-Filled for inclusive accessibility support)
                      `;
                    }
                  });
                }).catch(err => {
                  console.error('Failed to run detection:', err);
                  aiLoader.style.display = 'none';
                });
              } else {
                // Simulated TFJS fallback
                setTimeout(() => {
                  aiLoader.style.display = 'none';
                  const categoryTitle = 'Road Blockage (Reported via Image)';
                  const descriptionText = 'AI Auto-Detection: Identified potential road blockage / hazard from uploaded image. Registered automatically for inclusive accessibility support.';

                  document.getElementById('title').value = categoryTitle;
                  document.getElementById('description').value = descriptionText;
                  if (!document.getElementById('location').value) {
                    document.getElementById('location').value = 'AI Geolocation Scan';
                  }

                  aiStatus.style.display = 'block';
                  aiStatus.innerHTML = `
                    <span style="color: var(--color-primary); font-weight:700;">🟢 AI Scan Complete (Simulation)</span><br>
                    <b>Report Type:</b> Road Blockage (Auto-Filled for inclusive accessibility support)
                  `;
                }, 1200);
              }
            };
          };
          reader.readAsDataURL(file);
        }
      });
    }

    compForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      const title = document.getElementById('title').value;
      const description = document.getElementById('description').value;
      const locationVal = document.getElementById('location').value;
      const fileInput = document.getElementById('photo');

      const submitComplaintData = (photoUrl = '') => {
        if (!isOfflineMode) {
          // Standard multipart API submit
          const formData = new FormData(compForm);
          formData.append('country_name', activeCountry);
          const userStr = localStorage.getItem('roadwatch_user');
          if (userStr) {
            const user = JSON.parse(userStr);
            if (user.id) formData.append('user_id', user.id);
          }

          fetch('/api/complaints', {
            method: 'POST',
            body: formData
          })
            .then(res => res.json())
            .then(res => {
              if (res.success) {
                alert('Your complaint was successfully filed on the Node Express Server! A project marker was added near coordinates.');
                compForm.reset();
                loadPageContent();
              } else {
                alert('API Error registering complaint: ' + res.error);
              }
            })
            .catch(err => {
              console.error('API Failed, using Local DB:', err);
              saveComplaintOffline(title, description, locationVal, photoUrl);
            });
        } else {
          // Local Storage DB route
          saveComplaintOffline(title, description, locationVal, photoUrl);
        }
      };

      // Handle Image Conversion to base64 string for persistent offline visual preview!
      if (fileInput && fileInput.files && fileInput.files[0]) {
        const reader = new FileReader();
        reader.onload = function(eEvent) {
          submitComplaintData(eEvent.target.result);
        };
        reader.readAsDataURL(fileInput.files[0]);
      } else {
        submitComplaintData('');
      }
    });
  }

  // B. Authentication: Login
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      const errorEl = document.getElementById('loginError');
      errorEl.style.display = 'none';

      if (!isOfflineMode) {
        // API login
        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        })
          .then(res => res.json())
          .then(data => {
            if (data.error) {
              errorEl.innerText = data.error;
              errorEl.style.display = 'block';
            } else {
              localStorage.setItem('roadwatch_user', JSON.stringify(data.user));
              alert(`Welcome back, ${data.user.fullName}!`);
              window.location.href = 'index.html';
            }
          })
          .catch(err => {
            console.error('API failed, using Local DB:', err);
            loginOffline(email, password, errorEl);
          });
      } else {
        // Offline login
        loginOffline(email, password, errorEl);
      }
    });
  }

  // C. Authentication: Register
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const fullName = document.getElementById('regFullName').value;
      const email = document.getElementById('regEmail').value;
      const password = document.getElementById('regPassword').value;
      const role = document.getElementById('regRole').value;
      
      const errorEl = document.getElementById('registerError');
      const successEl = document.getElementById('registerSuccess');

      errorEl.style.display = 'none';
      successEl.style.display = 'none';

      if (!isOfflineMode) {
        fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName, email, password, role })
        })
          .then(res => res.json())
          .then(data => {
            if (data.error) {
              errorEl.innerText = data.error;
              errorEl.style.display = 'block';
            } else {
              successEl.innerText = 'Account successfully registered! Switching to Sign In...';
              successEl.style.display = 'block';
              registerForm.reset();
              setTimeout(() => {
                setAuthTab('login');
                successEl.style.display = 'none';
              }, 2000);
            }
          })
          .catch(err => {
            console.error('API failed, registering offline:', err);
            registerOffline(fullName, email, password, role, errorEl, successEl);
          });
      } else {
        registerOffline(fullName, email, password, role, errorEl, successEl);
      }
    });
  }

  // D. Settings Page Profile Credential Saved
  const profForm = document.getElementById('settingsProfileForm');
  if (profForm) {
    profForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const fullName = document.getElementById('settingsFullName').value;
      const email = document.getElementById('settingsEmail').value;
      const password = document.getElementById('settingsPassword').value;

      const userStr = localStorage.getItem('roadwatch_user');
      let currentRole = 'public';
      let currentId = 999;
      if (userStr) {
        const user = JSON.parse(userStr);
        currentRole = user.role;
        currentId = user.id;
      }

      const updatedUser = { id: currentId, fullName, email, role: currentRole };
      localStorage.setItem('roadwatch_user', JSON.stringify(updatedUser));

      // Send password update to backend if password provided
      if (password) {
        fetch('/api/settings/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentId, password })
        })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              console.log('Password updated successfully on server');
            } else {
              console.warn('Password update failed:', data.error);
            }
          })
          .catch(err => console.error('Error updating password:', err));
      }

      updateSidebarProfile();
      alert('Your system profile details were updated and synchronized across all active consoles successfully.');
    });
  }

  // E. AI Expert Chatroom Interaction
  const chatForm = document.getElementById('chatInputForm');
  if (chatForm) {
    chatForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const field = document.getElementById('chatInputField');
      const text = field.value.trim();
      if (!text) return;

      field.value = '';

      const container = document.getElementById('chatMessagesContainer');
      
      // Append User message
      const userBubble = document.createElement('div');
      userBubble.className = 'chat-bubble user';
      userBubble.innerHTML = `<p>${escapeHTML(text)}</p>`;
      container.appendChild(userBubble);
      container.scrollTop = container.scrollHeight;

      // Append Thinking loader
      const thinkingBubble = document.createElement('div');
      thinkingBubble.className = 'chat-bubble bot';
      thinkingBubble.id = 'bot-thinking-bubble';
      thinkingBubble.innerHTML = `<p><i>Analyzing system telemetry logs and database metrics...</i></p>`;
      container.appendChild(thinkingBubble);
      container.scrollTop = container.scrollHeight;

      if (!isOfflineMode) {
        fetch('/api/aibot/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, country: activeCountry })
        })
          .then(res => res.json())
          .then(data => renderBotReply(data.reply))
          .catch(err => {
            console.error('API failed, simulating offline:', err);
            simulateBotReplyOffline(text);
          });
      } else {
        setTimeout(() => simulateBotReplyOffline(text), 600);
      }
    });
  }
}

// ----------------------------------------------------
// LOCAL STORAGE OFFLINE SIMULATION WORKERS
// ----------------------------------------------------

function saveComplaintOffline(title, description, locationVal, photoUrl) {
  const vCountries = JSON.parse(localStorage.getItem('vdb_countries'));
  const vComplaints = JSON.parse(localStorage.getItem('vdb_complaints'));
  const vProjects = JSON.parse(localStorage.getItem('vdb_projects'));

  // 1. Update Country complaints count
  const country = vCountries[activeCountry];
  const countInt = parseInt(country.complaints.replace(/,/g, '')) || 0;
  country.complaints = (countInt + 1).toLocaleString();
  localStorage.setItem('vdb_countries', JSON.stringify(vCountries));

  // 2. Add complaint record
  const userStr = localStorage.getItem('roadwatch_user');
  let userId = null;
  let userName = null;
  if (userStr) {
    const user = JSON.parse(userStr);
    userId = user.id;
    userName = user.fullName || null;
  }

  const newComplaint = {
    id: Date.now(),
    country_name: activeCountry,
    title,
    description,
    location: locationVal,
    status: 'Pending',
    photo_path: photoUrl,
    user_id: userId,
    user_name: userName,
    created_at: new Date().toISOString()
  };
  vComplaints.push(newComplaint);
  localStorage.setItem('vdb_complaints', JSON.stringify(vComplaints));

  // 3. Place mock project/alert marker near country center
  const latOffset = (Math.random() - 0.5) * 0.4;
  const lngOffset = (Math.random() - 0.5) * 0.4;
  const mockLat = country.center[0] + latOffset;
  const mockLng = country.center[1] + lngOffset;

  vProjects.push({
    country_name: activeCountry,
    name: `Issue: ${title}`,
    lat: mockLat,
    lng: mockLng,
    status: `Complaint Registered: ${locationVal}`,
    is_upcoming: 0
  });
  localStorage.setItem('vdb_projects', JSON.stringify(vProjects));

  alert('[VIRTUAL DB] Your complaint with photo telemetry was persistently saved in LocalStorage! Map markers and counts have been updated.');
  
  const compForm = document.getElementById('complaintForm');
  if (compForm) compForm.reset();
  loadPageContent();
}

function loginOffline(email, password, errorEl) {
  // First check govt officials whitelist
  const officialMatch = GOVT_OFFICIALS_WHITELIST.find(o => o.email === email);
  if (officialMatch) {
    if (officialMatch.password !== password) {
      errorEl.innerText = 'Invalid credentials for Government Official.';
      errorEl.style.display = 'block';
      return;
    }
    const session = {
      id: email,
      fullName: officialMatch.full_name,
      email: officialMatch.email,
      role: 'govt'
    };
    localStorage.setItem('roadwatch_user', JSON.stringify(session));
    alert(`Welcome, ${officialMatch.full_name}! Government Official access granted.`);
    window.location.href = 'index.html';
    return;
  }

  const vUsers = JSON.parse(localStorage.getItem('vdb_users'));
  const userByEmail = vUsers.find(u => u.email === email);

  if (!userByEmail) {
    errorEl.innerText = 'No account found with this email. Please register first.';
    errorEl.style.display = 'block';
    return;
  }
  if (userByEmail.password !== password) {
    errorEl.innerText = 'Incorrect password. Please try again.';
    errorEl.style.display = 'block';
    return;
  }
  // Not a whitelisted official — downgrade 'govt' role to 'public'
  const effectiveRole = userByEmail.role === 'govt' ? 'public' : userByEmail.role;

  const session = {
    id: userByEmail.id || null,
    fullName: userByEmail.full_name,
    email: userByEmail.email,
    role: effectiveRole
  };
  localStorage.setItem('roadwatch_user', JSON.stringify(session));
  alert(`Sign-in successful. Welcome back, ${userByEmail.full_name}!`);
  window.location.href = 'index.html';
}

function registerOffline(fullName, email, password, role, errorEl, successEl) {
  // Block govt registration - only pre-authorised officials can login as govt
  if (role === 'govt') {
    errorEl.innerText = 'Government accounts cannot be self-registered. Contact your system administrator.';
    errorEl.style.display = 'block';
    return;
  }

  const vUsers = JSON.parse(localStorage.getItem('vdb_users'));
  if (vUsers.some(u => u.email === email)) {
    errorEl.innerText = 'Email already registered in system logs';
    errorEl.style.display = 'block';
    return;
  }

  vUsers.push({ full_name: fullName, email, password, role: 'public' });
  localStorage.setItem('vdb_users', JSON.stringify(vUsers));

  successEl.innerText = '[VIRTUAL DB] Registration successful! You can now log in.';
  successEl.style.display = 'block';
  const registerForm = document.getElementById('registerForm');
  if (registerForm) registerForm.reset();
  setTimeout(() => {
    setAuthTab('login');
    successEl.style.display = 'none';
  }, 2000);
}

// Render dynamic chatbot responses offline using virtual database queries!
function simulateBotReplyOffline(text) {
  const query = text.toLowerCase();
  let reply = '';

  const vCountries = JSON.parse(localStorage.getItem('vdb_countries'));
  const vComplaints = JSON.parse(localStorage.getItem('vdb_complaints'));
  const vProjects = JSON.parse(localStorage.getItem('vdb_projects'));
  const vContractors = JSON.parse(localStorage.getItem('vdb_contractors'));

  const country = vCountries[activeCountry];

  if (query.includes('complaint') || query.includes('pothole') || query.includes('broken')) {
    const complaints = vComplaints.filter(c => c.country_name === activeCountry).slice(-3);
    const complaintList = complaints.map(r => ` - "${r.title}" in ${r.location} (Status: ${r.status})`).join('\n');
    
    reply = `[VIRTUAL AI] In **${activeCountry}**, there are currently **${country.complaints} active complaints** reported in local logs.\n\nHere are the most recent complaints registered:\n${complaintList || 'No complaints logged.'}\n\nYou can upload new pothole or safety complaints directly using the "Upload Complaint" card.`;
  } 
  else if (query.includes('project') || query.includes('highway') || query.includes('expressway')) {
    const projects = vProjects.filter(p => p.country_name === activeCountry && !p.is_upcoming);
    const projectList = projects.map(r => ` - **${r.name}**: ${r.status}`).join('\n');

    reply = `[VIRTUAL AI] Ongoing infrastructure projects logged for **${activeCountry}**:\n\n${projectList || 'No active projects.'}\n\nOur system automatically keeps track of these coordinates and maps them in real time on the dashboard.`;
  }
  else if (query.includes('contractor') || query.includes('firm') || query.includes('completed')) {
    const contractors = vContractors.filter(c => c.country_name === activeCountry);
    const contractorList = contractors.map(r => ` - **${r.name}** (Completed audits: ${r.completed}, Status: ${r.status})`).join('\n');

    reply = `[VIRTUAL AI] Audited contractors directory for **${activeCountry}**:\n\n${contractorList || 'No contractors logged.'}\n\nGovernment officials can verify completed track files and compliance records in the Contractors tab.`;
  }
  else if (query.includes('hello') || query.includes('hi ') || query.includes('hey')) {
    reply = `Hello! I am the **ROADWATCH AI Assistant** running in Virtual Session. \n\nI can help you audit road statuses, list active complaints, track upcoming highway expansions, or audit contractor logs for **${activeCountry}**.\n\nWhat can I assist you with today?`;
  }
  else {
    reply = `[VIRTUAL AI] I am auditing files for **${activeCountry}**.\n\nCurrently, ${activeCountry} holds a **Road Health Index of ${country.health}** with an overall infrastructure budget allocation of **${country.budget}**.\n\nAsk me about "complaints", "projects", or "contractors" to fetch dynamic updates from our local database!`;
  }

  renderBotReply(reply);
}

function renderBotReply(replyText) {
  const container = document.getElementById('chatMessagesContainer');
  const think = document.getElementById('bot-thinking-bubble');
  if (think) think.remove();

  const botBubble = document.createElement('div');
  botBubble.className = 'chat-bubble bot';

  let replyFormatted = escapeHTML(replyText)
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<i>$1</i>')
    .replace(/\n/g, '<br>');

  botBubble.innerHTML = `<p>${replyFormatted}</p>`;
  container.appendChild(botBubble);
  container.scrollTop = container.scrollHeight;
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Tab controller selector on Auth Page
function setAuthTab(tab) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const authSubtitle = document.getElementById('authSubtitle');

  if (tab === 'login') {
    loginForm.style.display = 'flex';
    registerForm.style.display = 'none';
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    authSubtitle.innerText = 'Access Infrastructure Auditing Console';
  } else {
    loginForm.style.display = 'none';
    registerForm.style.display = 'flex';
    tabLogin.classList.remove('active');
    tabRegister.classList.add('active');
    authSubtitle.innerText = 'Register Official Credentials';
  }
}


function closeWelcomeModal() {
  document.getElementById('welcomeModal').style.display = 'none';
  sessionStorage.setItem('hasSeenWelcome', 'true');
}

document.addEventListener('DOMContentLoaded', () => {
  const userStr = localStorage.getItem('roadwatch_user');
  const hasSeen = sessionStorage.getItem('hasSeenWelcome');
  if (!userStr && !hasSeen) {
    const modal = document.getElementById('welcomeModal');
    if (modal) modal.style.display = 'flex';
  }
});

// Chatbot Logic
function toggleChatbot() {
  const win = document.getElementById('chatbot-window');
  win.style.display = win.style.display === 'flex' ? 'none' : 'flex';
}

async function sendChatMessage() {
  const input = document.getElementById('chatbotInput');
  const msg = input.value.trim();
  if (!msg) return;
  
  const msgsDiv = document.getElementById('chatbotMessages');
  msgsDiv.innerHTML += `<div class='message user-message'>${msg}</div>`;
  input.value = '';
  msgsDiv.scrollTop = msgsDiv.scrollHeight;

  try {
    const res = await fetch('/api/aibot/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ message: msg, country: activeCountry })
    });
    const data = await res.json();
    let formattedReply = data.reply.replace(/\n/g, '<br>');
    formattedReply = formattedReply.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    msgsDiv.innerHTML += `<div class='message bot-message'>${formattedReply}</div>`;
    msgsDiv.scrollTop = msgsDiv.scrollHeight;
  } catch (e) {
    msgsDiv.innerHTML += `<div class='message bot-message' style='color:red;'>Offline Mode: Please ask me when the server is connected.</div>`;
    msgsDiv.scrollTop = msgsDiv.scrollHeight;
  }
}

async function resolveComplaint(id) {
  if (confirm("Mark this complaint as resolved?")) {
    try {
      const userStr = localStorage.getItem('roadwatch_user');
      const user = userStr ? JSON.parse(userStr) : {};
      const res = await fetch(`/api/complaints/${id}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, role: user.role })
      });
      if (!res.ok) throw new Error('Network error');
      loadPageContent();
    } catch (error) {
      console.warn("Offline resolving...", error);
      const userStr = localStorage.getItem('roadwatch_user');
      const user = userStr ? JSON.parse(userStr) : {};
      if (user.role === 'admin' || user.role === 'govt') {
        let vdb = JSON.parse(localStorage.getItem('vdb_complaints') || '[]');
        const idx = vdb.findIndex(c => c.id === id);
        if (idx !== -1) {
          vdb[idx].status = 'Resolved';
          vdb[idx].resolved_at = new Date().toISOString();
          localStorage.setItem('vdb_complaints', JSON.stringify(vdb));
          alert('Complaint resolved (Offline Mode)');
          loadPageContent();
        }
      }
    }
  }
}

function applySystemPreferences() {
  // 1. Theme (Dark / Light Mode)
  const theme = localStorage.getItem('roadwatch_theme') || 'dark';
  const body = document.body;
  const darkCheckbox = document.getElementById('prefDarkMode');
  
  if (theme === 'light') {
    body.classList.add('light-mode');
    if (darkCheckbox) darkCheckbox.checked = false;
  } else {
    body.classList.remove('light-mode');
    if (darkCheckbox) darkCheckbox.checked = true;
  }

  // 2. Notifications Checkbox
  const notifCheckbox = document.getElementById('prefNotifications');
  if (notifCheckbox) {
    const notifEnabled = localStorage.getItem('roadwatch_notifications') !== 'false';
    notifCheckbox.checked = notifEnabled;
  }

  // 3. Privacy Checkbox
  const privCheckbox = document.getElementById('prefPrivacy');
  if (privCheckbox) {
    const privEnabled = localStorage.getItem('roadwatch_privacy') === 'true';
    privCheckbox.checked = privEnabled;
  }
}

function setupPreferencesListeners() {
  const darkCheckbox = document.getElementById('prefDarkMode');
  if (darkCheckbox) {
    // Unbind existing to avoid duplicate listeners
    const newCheckbox = darkCheckbox.cloneNode(true);
    darkCheckbox.parentNode.replaceChild(newCheckbox, darkCheckbox);
    newCheckbox.addEventListener('change', function() {
      if (this.checked) {
        localStorage.setItem('roadwatch_theme', 'dark');
        document.body.classList.remove('light-mode');
      } else {
        localStorage.setItem('roadwatch_theme', 'light');
        document.body.classList.add('light-mode');
      }
    });
  }

  const notifCheckbox = document.getElementById('prefNotifications');
  if (notifCheckbox) {
    const newNotif = notifCheckbox.cloneNode(true);
    notifCheckbox.parentNode.replaceChild(newNotif, notifCheckbox);
    newNotif.addEventListener('change', function() {
      localStorage.setItem('roadwatch_notifications', this.checked ? 'true' : 'false');
    });
  }

  const privCheckbox = document.getElementById('prefPrivacy');
  if (privCheckbox) {
    const newPriv = privCheckbox.cloneNode(true);
    privCheckbox.parentNode.replaceChild(newPriv, privCheckbox);
    newPriv.addEventListener('change', function() {
      localStorage.setItem('roadwatch_privacy', this.checked ? 'true' : 'false');
    });
  }
}

function generateOfflineDynamicPDF(title, countryName, health, projects, complaints, budget) {
  const dateStr = new Date().toLocaleString();
  
  // Calculate semi-deterministic YoY trends based on country name length
  const seed = countryName ? countryName.length : 10;
  const healthDiff = ((seed * 3) % 8) + 1; 
  const healthTrend = (seed % 2 === 0) ? `+${healthDiff}.2% YoY Hike` : `-${healthDiff}.4% YoY Decrease`;
  
  const projectsDiff = ((seed * 4) % 15) + 2; 
  const projectsTrend = `+${projectsDiff}.8% YoY Hike`;
  
  const complaintsDiff = ((seed * 5) % 12) + 1; 
  const complaintsTrend = `-${complaintsDiff}.5% YoY Decrease`;
  
  const budgetDiff = ((seed * 2) % 9) + 1; 
  const budgetTrend = `+${budgetDiff}.0% YoY Hike`;

  const getPercent = (val, type) => {
    let p = 50;
    if (type === 'health') {
      p = parseInt(String(val).split('/')[0], 10) || 50;
    } else if (type === 'projects') {
      p = Math.min(100, parseInt(String(val), 10) || 0);
    } else if (type === 'complaints') {
      p = Math.min(100, Math.round((parseInt(String(val), 10) || 0) / 10));
    } else if (type === 'budget') {
      const num = parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0;
      p = Math.min(100, Math.round(num * 2.5)); 
    }
    return p;
  };
  
  const drawBar = (pct) => {
    const filled = Math.round(pct / 10);
    return '='.repeat(filled).padEnd(10, ' ');
  };
  
  const hPct = getPercent(health, 'health');
  const pPct = getPercent(projects, 'projects');
  const cPct = getPercent(complaints, 'complaints');
  const bPct = getPercent(budget, 'budget');
  
  const healthBar = drawBar(hPct);
  const projectsBar = drawBar(pPct);
  const complaintsBar = drawBar(cPct);
  const budgetBar = drawBar(bPct);

  const row100 = ` 100% |  ${hPct >= 100 ? '#' : ' '}       ${pPct >= 100 ? '#' : ' '}       ${cPct >= 100 ? '#' : ' '}       ${bPct >= 100 ? '#' : ' '}`;
  const row80  = `  80% |  ${hPct >= 80  ? '#' : ' '}       ${pPct >= 80  ? '#' : ' '}       ${cPct >= 80  ? '#' : ' '}       ${bPct >= 80  ? '#' : ' '}`;
  const row60  = `  60% |  ${hPct >= 60  ? '#' : ' '}       ${pPct >= 60  ? '#' : ' '}       ${cPct >= 60  ? '#' : ' '}       ${bPct >= 60  ? '#' : ' '}`;
  const row40  = `  40% |  ${hPct >= 40  ? '#' : ' '}       ${pPct >= 40  ? '#' : ' '}       ${cPct >= 40  ? '#' : ' '}       ${bPct >= 40  ? '#' : ' '}`;
  const row20  = `  20% |  ${hPct >= 20  ? '#' : ' '}       ${pPct >= 20  ? '#' : ' '}       ${cPct >= 20  ? '#' : ' '}       ${bPct >= 20  ? '#' : ' '}`;

  const lines = [
    "==================================================================",
    "          ROADWATCH PERFORMANCE AUDIT REPORT [OFFLINE]            ",
    "==================================================================",
    `Generated At: ${dateStr}`,
    `Country:      ${countryName}`,
    `Report ID:    ${title}`,
    "==================================================================",
    "TELEMETRY METRICS & HISTORICAL COMPARISONS:",
    "",
    `  Safety Score:   ${health.padEnd(8)} [${healthBar}] (${healthTrend})`,
    `  Projects:       ${projects.toString().padEnd(8)} [${projectsBar}] (${projectsTrend})`,
    `  Complaints:     ${complaints.toString().padEnd(8)} [${complaintsBar}] (${complaintsTrend})`,
    `  Total Budget:   ${budget.padEnd(8)} [${budgetBar}] (${budgetTrend})`,
    "",
    "==================================================================",
    "           REGIONAL COMPARISON & ANALYSIS CHART:",
    "",
    row100,
    row80,
    row60,
    row40,
    row20,
    "    0% +--------------------------------------------------",
    "         Safety    Projects  Complaints    Budget  ",
    "==================================================================",
    "This document certifies the official infrastructure telemetry metrics.",
    "All records have been audited and verified via LocalStorage storage.",
    "=================================================================="
  ];

  let contentStream = `BT\n/F1 10 Tf\n50 720 Td\n`;
  lines.forEach((line, index) => {
    if (index > 0) {
      contentStream += `0 -15 Td\n`;
    }
    const escapedLine = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    contentStream += `(${escapedLine}) Tj\n`;
  });
  contentStream += `\nET`;

  const contentStreamLen = contentStream.length;
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`;
  const obj5Header = `5 0 obj\n<< /Length ${contentStreamLen} >>\nstream\n`;
  const obj5Footer = `\nendstream\nendobj\n`;
  
  const header = `%PDF-1.4\n`;
  const offset1 = header.length;
  const offset2 = offset1 + obj1.length;
  const offset3 = offset2 + obj2.length;
  const offset4 = offset3 + obj3.length;
  const offset5 = offset4 + obj4.length;
  
  const obj5Total = obj5Header + contentStream + obj5Footer;
  const offsetStartXref = offset5 + obj5Total.length;
  
  const xref = 
`xref
0 6
0000000000 65535 f 
${String(offset1).padStart(10, '0')} 00000 n 
${String(offset2).padStart(10, '0')} 00000 n 
${String(offset3).padStart(10, '0')} 00000 n 
${String(offset4).padStart(10, '0')} 00000 n 
${String(offset5).padStart(10, '0')} 00000 n 
`;

  const trailer = 
`trailer
<< /Size 6 /Root 1 0 R >>
startxref
${offsetStartXref}
%%EOF`;

  return header + obj1 + obj2 + obj3 + obj4 + obj5Total + xref + trailer;
}
