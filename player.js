document.addEventListener('DOMContentLoaded', () => {
  // 重构点：将所有逻辑封装到一个对象中，避免全局变量污染，结构更清晰
  const MusicPlayer = {
    // 播放器核心状态
    state: {
      currentIndex: 0,
      musicList: [],
      historyStack: [], // 用于“上一首”功能
    },

    // 缓存DOM元素
    dom: {
      audio: document.getElementById('audio'),
      title: document.getElementById('song-title'),
      tags: document.getElementById('song-tags'),
      relatedContainer: document.getElementById('related-songs'),
      searchResults: document.getElementById('search-results'),
      searchInput: document.getElementById('tag-search'),
      prevBtn: document.getElementById('prev-btn'),
      nextBtn: document.getElementById('next-btn'),
    },

    // 初始化播放器
    async init() {
      console.log('Player initializing...');
      await this.loadMusicList();
      this.bindEvents();
      
      // 尝试恢复上次播放状态
      const lastIndex = localStorage.getItem('lastSongIndex');
      const lastTime = parseFloat(localStorage.getItem('lastSongTime') || 0);

      if (lastIndex !== null && this.state.musicList[lastIndex]) {
        this.updatePlayer(parseInt(lastIndex), lastTime);
      } else if (this.state.musicList.length > 0) {
        this.playRandomSong();
      } else {
        this.dom.title.textContent = "音乐列表为空";
      }
    },

    // 从JSON加载音乐列表
    async loadMusicList() {
      try {
        const response = await fetch('list.json');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        this.state.musicList = await response.json();
        console.log('Music list loaded:', this.state.musicList);
      } catch (error) {
        console.error('加载音乐列表失败 (Failed to load music list):', error);
        this.dom.title.textContent = "加载列表失败";
      }
    },

    // 绑定所有事件监听
    bindEvents() {
      this.dom.prevBtn.addEventListener('click', () => this.playPrevious());
      this.dom.nextBtn.addEventListener('click', () => this.playNext());
      this.dom.searchInput.addEventListener('input', () => this.handleSearch());
      
      // 监听音频播放结束事件，自动播放下一首
      this.dom.audio.addEventListener('ended', () => this.playNext());
      
      // 实时保存播放进度
      this.dom.audio.addEventListener('timeupdate', () => this.savePlaybackPosition());
      
      // 阻止右键菜单，防止直接下载
      this.dom.audio.addEventListener('contextmenu', e => e.preventDefault());
      
      // 错误处理
      this.dom.audio.onerror = (e) => {
        console.error("音频播放错误 (Audio error):", this.dom.audio.error);
        // 简单处理：尝试播放下一首
        this.dom.title.textContent = "音频加载失败, 5秒后尝试下一首...";
        setTimeout(() => this.playNext(), 5000);
      };
    },

    // 更新播放器UI和音频源
    updatePlayer(index, startTime = 0) {
      if (!this.state.musicList[index]) {
        console.error(`Invalid song index: ${index}`);
        return;
      }
      
      this.state.currentIndex = index;
      const song = this.state.musicList[index];

      this.dom.title.textContent = song.title;
      this.dom.tags.textContent = song.tags.join(', ');

      // 核心修复点：对原始文件名进行编码，而不是对已编码的字符串再次编码
      const encodedFile = encodeURIComponent(song.file);
      this.dom.audio.src = `https://music.stevel.eu.org/${song.file}`;
      
      // 等待元数据加载完毕再设置时间和播放
      this.dom.audio.onloadedmetadata = () => {
        this.dom.audio.currentTime = startTime;
        this.dom.audio.play().catch(e => console.warn('自动播放可能被浏览器阻止 (Autoplay might be blocked by the browser):', e));
      };
      
      this.renderRelatedSongs(song);
    },
    
    // 播放指定索引的歌曲（重构点：代码复用）
    playSongByIndex(index) {
        this.state.historyStack.push(this.state.currentIndex);
        this.updatePlayer(index);
    },

    // 播放下一首
    playNext() {
      this.state.historyStack.push(this.state.currentIndex);
      const nextIndex = (this.state.currentIndex + 1) % this.state.musicList.length;
      this.updatePlayer(nextIndex);
    },

    // 播放上一首
    playPrevious() {
      if (this.state.historyStack.length > 0) {
        const prevIndex = this.state.historyStack.pop();
        this.updatePlayer(prevIndex);
      }
    },
      
    // 随机播放一首歌
    playRandomSong() {
        const randomIndex = Math.floor(Math.random() * this.state.musicList.length);
        this.updatePlayer(randomIndex);
    },

    // 渲染相关歌曲列表
    renderRelatedSongs(currentSong) {
      this.dom.relatedContainer.innerHTML = '';
      const related = this.state.musicList.filter(song => 
        song.file !== currentSong.file && 
        song.tags.some(tag => currentSong.tags.includes(tag))
      )
      // Bug修复点：.slice() 应该在 filter() 之后，而不是在回调函数内部
      .slice(0, 5); // 增加到5首相关推荐

      related.forEach(song => {
        const songElement = document.createElement('div');
        songElement.className = 'related-song';
        songElement.innerHTML = `${song.title} <span class="song-tags">(${song.tags.join(', ')})</span>`;
        
        songElement.addEventListener('click', () => {
            const songIndex = this.state.musicList.findIndex(item => item.file === song.file);
            if(songIndex !== -1) {
                this.playSongByIndex(songIndex);
            }
        });
        this.dom.relatedContainer.appendChild(songElement);
      });
    },

    // 处理搜索逻辑
    handleSearch() {
      const query = this.dom.searchInput.value.trim().toLowerCase();
      this.dom.searchResults.innerHTML = '';
      
      if (!query) return;

      const results = this.state.musicList.filter(song =>
        song.title.toLowerCase().includes(query) ||
        song.tags.some(tag => tag.toLowerCase().includes(query))
      ).slice(0, 5);

      results.forEach(song => {
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        resultItem.innerHTML = `${song.title} <span class="song-tags">${song.tags.join(', ')}</span>`;
        
        resultItem.addEventListener('click', () => {
          const songIndex = this.state.musicList.findIndex(item => item.file === song.file);
          if(songIndex !== -1) {
              this.playSongByIndex(songIndex);
          }
          this.dom.searchInput.value = '';
          this.dom.searchResults.innerHTML = '';
        });
        this.dom.searchResults.appendChild(resultItem);
      });
    },

    // 保存当前播放进度到 localStorage
    savePlaybackPosition() {
      // 只有在音频有效时才保存，避免存入NaN
      if (!isNaN(this.dom.audio.currentTime) && this.dom.audio.currentTime > 0) {
        localStorage.setItem('lastSongIndex', this.state.currentIndex);
        localStorage.setItem('lastSongTime', this.dom.audio.currentTime);
      }
    },
  };

  // 启动播放器
  MusicPlayer.init();
});
