let currentUser = null;

async function getCurrentUser() {
  if (!currentUser) {
    currentUser = await window.websim.getUser();
  }
  return currentUser;
}

async function fetchWithPagination(url, params = {}) {
  const queryParams = new URLSearchParams({
    ...params,
    first: 100
  }).toString();
  
  const response = await fetch(`${url}?${queryParams}`);
  const data = await response.json();
  return data;
}

async function getAllSources() {
  const user = await getCurrentUser();
  if (!user) return [];

  const sources = [];

  try {
    // Get trending feed
    const trending = await fetchWithPagination('/api/v1/feed/trending');
    sources.push(...trending.feed.data);

    // Get user feed
    const userFeed = await fetchWithPagination('/api/v1/user/feed');
    sources.push(...userFeed.feed.data);

    // Get followers
    const followers = await fetchWithPagination(`/api/v1/users/${user.username}/followers`);
    for (const {follow} of followers.followers.data) {
      const followerFeed = await fetchWithPagination(`/api/v1/users/${follow.user.username}/feed`);
      sources.push(...followerFeed.feed.data);
    }

    // Get following
    const following = await fetchWithPagination(`/api/v1/users/${user.username}/following`);
    for (const {follow} of following.following.data) {
      const followingFeed = await fetchWithPagination(`/api/v1/users/${follow.user.username}/feed`);
      sources.push(...followingFeed.feed.data);
    }

    // Get likes
    const likes = await fetchWithPagination(`/api/v1/users/${user.username}/likes`);
    sources.push(...likes.likes.data);

    // Get projects
    const projects = await fetchWithPagination(`/api/v1/users/${user.username}/projects`);
    for (const {project, site} of projects.projects.data) {
      if (site) {
        sources.push({
          site,
          project,
          cursor: null
        });
      }
    }

  } catch (error) {
    console.error('Error fetching sources:', error);
  }

  return sources;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function createWebSimCard(item) {
  const { site, project } = item;
  
  const card = document.createElement('div');
  card.className = 'websim-card';
  
  const imageUrl = `https://images.websim.ai/v1/site/${site.id}/600`;
  const siteUrl = `https://websim.ai/c/${site.id}`;
  const creatorUrl = `https://websim.ai/@${site.owner.username}`;
  const avatarUrl = `https://images.websim.ai/avatar/${site.owner.username}`;

  card.innerHTML = `
    <a href="${siteUrl}" target="_blank">
      <img class="websim-image" src="${imageUrl}" alt="${site.title || 'Untitled WebSim'}">
    </a>
    <div class="websim-info">
      <h3 class="websim-title">
        <a href="${siteUrl}" target="_blank" style="color: inherit; text-decoration: none;">
          ${site.title || 'Untitled WebSim'}
        </a>
      </h3>
      <a href="${creatorUrl}" class="websim-creator" style="text-decoration: none; color: inherit;">
        <img class="creator-avatar" src="${avatarUrl}" alt="${site.owner.username}">
        <span>@${site.owner.username}</span>
      </a>
    </div>
  `;

  return card;
}

async function generateRandomWebSims() {
  const websimList = document.getElementById('websimList');
  websimList.innerHTML = '<div class="loading">Loading WebSims...</div>';

  try {
    const sources = await getAllSources();
    const uniqueSources = Array.from(new Set(sources.map(s => s.site.id)))
      .map(id => sources.find(s => s.site.id === id));
    
    const randomSources = shuffleArray(uniqueSources).slice(0, 12);
    
    websimList.innerHTML = '';
    randomSources.forEach(item => {
      websimList.appendChild(createWebSimCard(item));
    });
  } catch (error) {
    console.error('Error generating random WebSims:', error);
    websimList.innerHTML = '<div class="loading">Error loading WebSims. Please try again.</div>';
  }
}

// Generate initial set on page load
generateRandomWebSims();