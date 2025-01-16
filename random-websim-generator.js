let currentUser = null;
const room = new WebsimSocket();
let discoveredUrls = new Set();
let lastQueryTime = 0;
const QUERY_COOLDOWN = 2000; // 2 seconds cooldown between queries

// Initialize from database
async function initializeFromDatabase() {
  const urlRecords = await room.collection('websim_urls').getList();
  if (urlRecords.length > 0) {
    discoveredUrls = new Set(JSON.parse(urlRecords[0].urls || '[]'));
  } else {
    // Create initial empty record if none exists
    await room.collection('websim_urls').create({
      urls: '[]'
    });
  }
  updateSourceCount();
}

// Subscribe to database changes
room.collection('websim_urls').subscribe((records) => {
  if (records.length > 0) {
    discoveredUrls = new Set(JSON.parse(records[0].urls || '[]'));
    updateSourceCount();
  }
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

// Store a URL in the database
async function storeUrl(url) {
  if (!discoveredUrls.has(url)) {
    try {
      const records = await room.collection('websim_urls').getList();
      const record = records[0];
      const urls = new Set(JSON.parse(record.urls || '[]'));
      urls.add(url);
      await room.collection('websim_urls').update(record.id, {
        urls: JSON.stringify([...urls])
      });
      discoveredUrls.add(url);
      updateSourceCount();
    } catch (error) {
      console.error('Error storing URL:', error);
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
  if (depth <= 0) return;

  try {
    const userFeed = await fetchWithPagination(`/api/v1/users/${username}/feed`);
    await addSources(userFeed.feed?.data);

    const followers = await fetchWithPagination(`/api/v1/users/${username}/followers`);
    for (const {follow} of (followers.followers?.data || []).slice(0, 3)) {
      if (follow?.user?.username) {
        await fetchUserFeeds(follow.user.username, depth - 1);
      }
    }

    const following = await fetchWithPagination(`/api/v1/users/${username}/following`);
    for (const {follow} of (following.following?.data || []).slice(0, 3)) {
      if (follow?.user?.username) {
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
      if (item?.site?.id) {
        const url = `https://websim.ai/c/${item.site.id}`;
        await storeUrl(url);
      }
    }
  }
}

function updateSourceCount() {
  const countElement = document.getElementById('sourceCount');
  if (countElement) {
    countElement.textContent = discoveredUrls.size;
  }
}

async function getAllSources() {
  const user = await getCurrentUser();
  const now = Date.now();
  
  if (now - lastQueryTime < QUERY_COOLDOWN) {
    return Array.from(discoveredUrls);
  }
  
  lastQueryTime = now;

  try {
    if (discoveredUrls.size < 100) {
      const trending = await fetchWithPagination('/api/v1/feed/trending');
      await addSources(trending.feed?.data);
    }

    if (user) {
      const userFeed = await fetchWithPagination('/api/v1/user/feed');
      await addSources(userFeed.feed?.data);

      const likes = await fetchWithPagination(`/api/v1/users/${user.username}/likes`);
      await addSources(likes.likes?.data);

      const projects = await fetchWithPagination(`/api/v1/users/${user.username}/projects`);
      await addSources(projects.projects?.data);

      await fetchUserFeeds(user.username);
    }

  } catch (error) {
    console.error('Error fetching sources:', error);
  }

  return Array.from(discoveredUrls);
}

function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function createWebSimCard(url) {
  const match = url.match(/\/c\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  
  const siteId = match[1];
  
  const card = document.createElement('div');
  card.className = 'websim-card';
  
  const imageUrl = `https://images.websim.ai/v1/site/${siteId}/600`;

  card.innerHTML = `
    <a href="${url}" target="_blank" class="card-link">
      <div class="image-container">
        <img class="websim-image" src="${imageUrl}" alt="WebSim Preview" 
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect width=%221%22 height=%221%22 fill=%22%23eee%22/></svg>'">
      </div>
    </a>
  `;

  // Fetch site details asynchronously
  fetch(`/api/v1/sites/${siteId}`).then(async response => {
    if (response.ok) {
      const data = await response.json();
      const title = data.site?.title || data.project?.title || 'Untitled WebSim';
      const username = data.site?.owner?.username || 'Anonymous';
      const avatarUrl = username ? `https://images.websim.ai/avatar/${username}` : '';
      
      const infoDiv = document.createElement('div');
      infoDiv.className = 'websim-info';
      infoDiv.innerHTML = `
        <h3 class="websim-title">${title}</h3>
        <div class="websim-creator">
          ${avatarUrl ? `<img class="creator-avatar" src="${avatarUrl}" alt="${username}" onerror="this.style.display='none'">` : ''}
          <span>@${username}</span>
        </div>
      `;
      card.appendChild(infoDiv);
    }
  }).catch(console.error);

  return card;
}

async function generateRandomWebSims() {
  const websimList = document.getElementById('websimList');
  const button = document.querySelector('.generate-btn');
  
  websimList.innerHTML = '<div class="loading">Loading WebSims...</div>';
  button.disabled = true;
  button.textContent = 'Loading...';

  try {
    const urls = await getAllSources();
    const randomUrls = shuffleArray(urls).slice(0, 12);
    
    websimList.innerHTML = '';
    randomUrls.forEach(url => {
      const card = createWebSimCard(url);
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