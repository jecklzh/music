// 初始化音乐播放器
document.addEventListener('DOMContentLoaded', () => {
  // 全局状态
  let currentIndex = 0;
  let historyStack = [];
  let musicList = [];
  const skipHistory = JSON.parse(localStorage.getItem('skipHistory') || {});

  // 获取DOM元素
  const audioElement = document.getElementById('audio');
  const songTitleElement = document.getElementById('song-title');
  const songTagsElement = document.getElementById('song-tags');
  const relatedSongsElement = document.getElementById('related-songs');
  const searchResultsElement = document.getElementById('search-results');
  const searchInputElement = document.getElementById('tag-search');
  const prevButton = document.getElementById('prev-btn');
  const nextButton = document.getElementById('next-btn');

  // 初始化播放器
  const initPlayer = async () => {
    await loadMusicList();
    bindEvents();
    
    if (localStorage.getItem('lastSongIndex')) {
      currentIndex = parseInt(localStorage.getItem('lastSongIndex'));
      const lastTime = parseFloat(localStorage.getItem('lastSongTime') || 0);
      updatePlayer(musicList[currentIndex], lastTime);
    } else {
      playRandomSong();
    }
  };

  // 加载音乐列表
  const loadMusicList = async () => {
    try {
      const response = await fetch('list.json');
      musicList = await response.json();
    } catch (error) {
      console.error('加载音乐列表失败:', error);
    }
  };

  // 绑定事件
  const bindEvents = () => {
    prevButton.addEventListener('click', playPrevious);
    nextButton.addEventListener('click', playNext);
    searchInputElement.addEventListener('input', handleSearch);
    audioElement.addEventListener('contextmenu', e => e.preventDefault());
    audioElement.addEventListener('timeupdate', savePlaybackPosition);
  };

  // 更新播放器界面
  const updatePlayer = (song, startTime = 0) => {
    songTitleElement.textContent = song.title;
    songTagsElement.textContent = song.tags.join(', ');
    audioElement.src = `https://music.yourdomain.com/${encodeURIComponent(song.file)}`;
    
    audioElement.onloadedmetadata = () => {
      audioElement.currentTime = startTime;
      audioElement.play().catch(e => console.log('自动播放被阻止:', e));
    };
    
    renderRelatedSongs(song);
  };

  // 随机播放
  const playRandomSong = () => {
    currentIndex = Math.floor(Math.random() * musicList.length);
    updatePlayer(musicList[currentIndex]);
  };

  // 下一首
  const playNext = () => {
    historyStack.push(currentIndex);
    currentIndex = (currentIndex + 1) % musicList.length;
    updatePlayer(musicList[currentIndex]);
  };

  // 上一首
  const playPrevious = () => {
    if (historyStack.length > 0) {
      currentIndex = historyStack.pop();
      updatePlayer(musicList[currentIndex]);
    }
  };

  // 渲染相关歌曲
  const renderRelatedSongs = (currentSong) => {
    relatedSongsElement.innerHTML = '';
    
    const related = musicList.filter(song => 
      song !== currentSong && 
      song.tags.some(tag => currentSong.tags.includes(tag))
      .slice(0, 3);
    
    related.forEach(song => {
      const songElement = document.createElement('div');
      songElement.className = 'related-song';
      songElement.innerHTML = `
        ${song.title} 
        <span class="song-tags">(${song.tags.join(', ')})</span>
      `;
      songElement.addEventListener('click', () => {
        historyStack.push(currentIndex);
        currentIndex = musicList.indexOf(song);
        updatePlayer(song);
      });
      relatedSongsElement.appendChild(songElement);
    });
  };

  // 处理搜索
  const handleSearch = () => {
    const query = searchInputElement.value.trim().toLowerCase();
    searchResultsElement.innerHTML = '';
    
    if (!query) return;

    const results = musicList.filter(song =>
      song.tags.some(tag => tag.toLowerCase().includes(query))
    ).slice(0, 5);

    results.forEach(song => {
      const resultItem = document.createElement('div');
      resultItem.className = 'search-result-item';
      resultItem.innerHTML = `
        ${song.title} 
        <span class="song-tags">${song.tags.join(', ')}</span>
      `;
      resultItem.addEventListener('click', () => {
        historyStack.push(currentIndex);
        currentIndex = musicList.indexOf(song);
        updatePlayer(song);
        searchInputElement.value = '';
        searchResultsElement.innerHTML = '';
      });
      searchResultsElement.appendChild(resultItem);
    });
  };

  // 保存播放进度
  const savePlaybackPosition = () => {
    localStorage.setItem('lastSongIndex', currentIndex);
    localStorage.setItem('lastSongTime', audioElement.currentTime);
  };

  // 启动播放器
  initPlayer();
});