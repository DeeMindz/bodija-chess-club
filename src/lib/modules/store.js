// Global Store
export const store = {
    players: [],
    games: [],
    tournaments: [],
    medalsCache: {},
    activeLeaderboardCategory: 'rapid'
};

// Allow easy window access for inline HTML handlers
if (typeof window !== 'undefined') window.bccStore = store;
