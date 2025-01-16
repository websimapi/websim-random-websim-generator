let currentUser = null;

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

async function fetchWithPagination(url, params = {}) {
  try {
    const queryParams = new URLSearchParams({
      ...params,
      first: 20 
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

async function getAllSources() {
  const user = await getCurrentUser();
  if (!user) {
    const trending = await fetchWithPagination('/api/v1/feed/trending');
    return trending.feed?.data || [];
  }

  const sources = new Set();
  const addSources = (items) => {
    if (Array.isArray(items)) {
      items.forEach(item => {
        if (item?.site && item?.project) {
          sources.add(JSON.stringify({
            site: item.site,
            project: item.project,
            cursor: item.cursor
          }));
        }
      });
    }
  };

  try {
    const trending = await fetchWithPagination('/api/v1/feed/trending');
    addSources(trending.feed?.data);

    const userFeed = await fetchWithPagination('/api/v1/user/feed');
    addSources(userFeed.feed?.data);

    const followers = await fetchWithPagination(`/api/v1/users/${user.username}/followers`);
    for (const {follow} of (followers.followers?.data || []).slice(0, 5)) {
      if (follow?.user?.username) {
        const followerFeed = await fetchWithPagination(`/api/v1/users/${follow.user.username}/feed`);
        addSources(followerFeed.feed?.data);
      }
    }

    const following = await fetchWithPagination(`/api/v1/users/${user.username}/following`);
    for (const {follow} of (following.following?.data || []).slice(0, 5)) {
      if (follow?.user?.username) {
        const followingFeed = await fetchWithPagination(`/api/v1/users/${follow.user.username}/feed`);
        addSources(followingFeed.feed?.data);
      }
    }

    const likes = await fetchWithPagination(`/api/v1/users/${user.username}/likes`);
    addSources(likes.likes?.data);

    const projects = await fetchWithPagination(`/api/v1/users/${user.username}/projects`);
    addSources(projects.projects?.data);

  } catch (error) {
    console.error('Error fetching sources:', error);
  }

  return Array.from(sources).map(s => JSON.parse(s));
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

// Generate initial set on page load
generateRandomWebSims();