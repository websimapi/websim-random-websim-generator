let currentUser = null;
const room = new WebsimSocket();
let discoveredSources = new Set();
let queriedUsernames = new Set();
let discoveredUsernames = new Set();
let lastQueryTime = 0;
const QUERY_COOLDOWN = 2000; // 2 seconds cooldown between queries

// Initialize from database
async function initializeFromDatabase() {
  // Load discovered sources
  const sources = await room.collection('discovered_source').getList();
  sources.forEach(record => {
    discoveredSources.add(record.sourceKey);
  });

  // Load queried usernames
  const queried = await room.collection('queried_username').getList();
  queried.forEach(record => {
    queriedUsernames.add(record.username);
  });

  // Load discovered usernames
  const discovered = await room.collection('discovered_username').getList();
  discovered.forEach(record => {
    discoveredUsernames.add(record.username);
  });

  updateSourceCount();
}

// Subscribe to database changes
room.collection('discovered_source').subscribe((sources) => {
  discoveredSources = new Set(sources.map(s => s.sourceKey));
  updateSourceCount();
});

room.collection('queried_username').subscribe((queried) => {
  queriedUsernames = new Set(queried.map(q => q.username)); 
  updateSourceCount();
});

room.collection('discovered_username').subscribe((discovered) => {
  discoveredUsernames = new Set(discovered.map(d => d.username));
});

async function getCurrentUser() {
  if (!currentUser) {
    try {
      currentUser = await window.websim.getUser();
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  }
  return currentUser;
}

// Store a discovered source in the database
async function storeDiscoveredSource(source) {
  const sourceKey = JSON.stringify({
    site: source.site,
    project: source.project,
    cursor: source.cursor
  });
  
  if (!discoveredSources.has(sourceKey)) {
    try {
      await room.collection('discovered_source').create({
        sourceKey: sourceKey,
        timestamp: new Date().toISOString()
      });
      discoveredSources.add(sourceKey);
      updateSourceCount();
    } catch (error) {
      console.error('Error storing discovered source:', error);
    }
  }
}

// Store a queried username in the database
async function storeQueriedUsername(username) {
  if (!queriedUsernames.has(username)) {
    try {
      await room.collection('queried_username').create({
        username: username,
        timestamp: new Date().toISOString()
      });
      queriedUsernames.add(username);
      updateSourceCount();
    } catch (error) {
      console.error('Error storing queried username:', error);
    }
  }
}

// Store a discovered username in the database
async function storeDiscoveredUsername(username) {
  if (!discoveredUsernames.has(username)) {
    try {
      await room.collection('discovered_username').create({
        username: username,
        timestamp: new Date().toISOString()
      });
      discoveredUsernames.add(username);
    } catch (error) {
      console.error('Error storing discovered username:', error);
    }
  }
}

async function fetchWithPagination(url, params = {}) {
  try {
    const queryParams = new URLSearchParams({
      ...params,
      first: 50
    }).toString();
    
    const response = await fetch(`${url}?${queryParams}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return { data: [] };
  }
}

async function fetchUserFeeds(username, depth = 2) {
  if (depth <= 0 || queriedUsernames.has(username)) return;
  await storeQueriedUsername(username);

  try {
    const userFeed = await fetchWithPagination(`/api/v1/users/${username}/feed`);
    await addSources(userFeed.feed?.data);

    const followers = await fetchWithPagination(`/api/v1/users/${username}/followers`);
    for (const {follow} of (followers.followers?.data || []).slice(0, 3)) {
      if (follow?.user?.username && !queriedUsernames.has(follow.user.username)) {
        await storeDiscoveredUsername(follow.user.username);
        await fetchUserFeeds(follow.user.username, depth - 1);
      }
    }

    const following = await fetchWithPagination(`/api/v1/users/${username}/following`);
    for (const {follow} of (following.following?.data || []).slice(0, 3)) {
      if (follow?.user?.username && !queriedUsernames.has(follow.user.username)) {
        await storeDiscoveredUsername(follow.user.username);
        await fetchUserFeeds(follow.user.username, depth - 1);
      }
    }
  } catch (error) {
    console.error(`Error fetching feeds for ${username}:`, error);
  }
}

async function addSources(items) {
  if (Array.isArray(items)) {
    for (const item of items) {
      if (item?.site && item?.project) {
        await storeDiscoveredSource(item);
      }
    }
  }
}

function updateSourceCount() {
  const countElement = document.getElementById('sourceCount');
  if (countElement) {
    countElement.textContent = `${discoveredSources.size} (${queriedUsernames.size} users queried)`;
  }
}

async function getAllSources() {
  const user = await getCurrentUser();
  const now = Date.now();
  
  if (now - lastQueryTime < QUERY_COOLDOWN) {
    return Array.from(discoveredSources).map(s => JSON.parse(s));
  }
  
  lastQueryTime = now;

  try {
    if (discoveredSources.size < 100) {
      const trending = await fetchWithPagination('/api/v1/feed/trending');
      await addSources(trending.feed?.data);
    }

    if (user && !queriedUsernames.has(user.username)) {
      const userFeed = await fetchWithPagination('/api/v1/user/feed');
      await addSources(userFeed.feed?.data);

      const likes = await fetchWithPagination(`/api/v1/users/${user.username}/likes`);
      await addSources(likes.likes?.data);

      const projects = await fetchWithPagination(`/api/v1/users/${user.username}/projects`);
      await addSources(projects.projects?.data);

      await fetchUserFeeds(user.username);
    }

    for (const username of discoveredUsernames) {
      if (!queriedUsernames.has(username)) {
        const userProjects = await fetchWithPagination(`/api/v1/users/${username}/projects`);
        await addSources(userProjects.projects?.data);
        await storeQueriedUsername(username);
      }
    }

  } catch (error) {
    console.error('Error fetching sources:', error);
  }

  return Array.from(discoveredSources).map(s => JSON.parse(s));
}

function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function createWebSimCard(item) {
  if (!item?.site || !item?.project) return null;
  
  const { site, project } = item;
  
  const card = document.createElement('div');
  card.className = 'websim-card';
  
  const imageUrl = `https://images.websim.ai/v1/site/${site.id}/600`;
  const siteUrl = `https://websim.ai/c/${site.id}`;
  const creatorUrl = site.owner?.username ? `https://websim.ai/@${site.owner.username}` : '#';
  const avatarUrl = site.owner?.username ? `https://images.websim.ai/avatar/${site.owner.username}` : '';
  const title = site.title || project.title || 'Untitled WebSim';
  const username = site.owner?.username || 'Anonymous';

  card.innerHTML = `
    <a href="${siteUrl}" target="_blank" class="card-link">
      <div class="image-container">
        <img class="websim-image" src="${imageUrl}" alt="${title}" 
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect width=%221%22 height=%221%22 fill=%22%23eee%22/></svg>'">
      </div>
      <div class="websim-info">
        <h3 class="websim-title">${title}</h3>
        <div class="websim-creator">
          ${avatarUrl ? `<img class="creator-avatar" src="${avatarUrl}" alt="${username}" onerror="this.style.display='none'">` : ''}
          <span>@${username}</span>
        </div>
      </div>
    </a>
  `;

  return card;
}

async function generateRandomWebSims() {
  const websimList = document.getElementById('websimList');
  const button = document.querySelector('.generate-btn');
  
  websimList.innerHTML = '<div class="loading">Loading WebSims...</div>';
  button.disabled = true;
  button.textContent = 'Loading...';

  try {
    const sources = await getAllSources();
    const randomSources = shuffleArray(sources).slice(0, 12);
    
    websimList.innerHTML = '';
    randomSources.forEach(item => {
      const card = createWebSimCard(item);
      if (card) websimList.appendChild(card);
    });

    if (websimList.children.length === 0) {
      websimList.innerHTML = '<div class="loading">No WebSims found. Try again?</div>';
    }
  } catch (error) {
    console.error('Error generating random WebSims:', error);
    websimList.innerHTML = '<div class="loading">Error loading WebSims. Please try again.</div>';
  } finally {
    button.disabled = false;
    button.textContent = 'Generate Random WebSims';
  }
}

// Initialize database and generate initial set on page load
initializeFromDatabase().then(() => {
  generateRandomWebSims();
});