import { store } from './store.js';
// Assume global window tools exist for legacy crossover mapping.

export function renderTournaments() {
  const grid = document.getElementById('tournamentsGrid');
  if (!grid) return;
  const formatFilter = document.getElementById('tournamentFormatFilter')?.value || '';
  let filtered = window.extendedTournaments || [];
  if (formatFilter) filtered = filtered.filter(t => t.format?.toLowerCase() === formatFilter.toLowerCase());
  const active = filtered.filter(t => t.status?.toLowerCase() === 'active');
  const draft = filtered.filter(t => t.status?.toLowerCase() === 'draft');
  const completed = filtered.filter(t => t.status?.toLowerCase() === 'completed');

  // Determine current tab (persist via data attr)
  const currentTab = grid.dataset.tab || (active.length ? 'active' : draft.length ? 'draft' : 'completed');
  const tabCounts = {
    active: active.length,
    draft: draft.length,
    completed: completed.length
  };
  const tabList = [{
    key: 'active',
    label: 'Active',
    dot: true
  }, {
    key: 'draft',
    label: 'Draft',
    dot: false
  }, {
    key: 'completed',
    label: 'Completed',
    dot: false
  }];
  const tabsHtml = tabList.map(t => `
        <button class="t-status-tab ${currentTab === t.key ? 'active' : ''}"
                onclick="switchStatusTab('${t.key}')"
                data-tab="${t.key}">
            ${t.dot ? `<span class="t-tab-dot" style="background:#22c55e;animation:blink 1.2s infinite;"></span>` : ''}
            ${t.label}
            ${tabCounts[t.key] > 0 ? `<span class="t-tab-count">${tabCounts[t.key]}</span>` : ''}
        </button>
    `).join('');

  // Patch local tournament player count — tpCountMap has no entry until sync
  const local = window._localTournament;
  if (local?.players?.length) {
    for (const t of active) {
      if (t.id === local.id) {
        t.playerCount = local.players.length;
        t.players = local.players;
      }
    }
  }
  const shown = currentTab === 'active' ? active : currentTab === 'draft' ? draft : completed;
  const cardsHtml = shown.length ? `<div class="tournaments-grid">${shown.map(renderTournamentCard).join('')}</div>` : `<div style="text-align:center;padding:60px 20px;color:var(--text-secondary);">
               <p>No ${currentTab} tournaments.</p>
           </div>`;
  grid.innerHTML = `
        <div class="section-container">
            <div class="t-status-tabs">${tabsHtml}</div>
            ${cardsHtml}
        </div>`;
  grid.dataset.tab = currentTab;
}

