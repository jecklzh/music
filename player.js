document.addEventListener('DOMContentLoaded', () => {
  const Recommender = {
    skipHistory: {},

    init() {
      this.skipHistory = JSON.parse(localStorage.getItem('skipHistory') || '{}');
    },

    save() {
      localStorage.setItem('skipHistory', JSON.stringify(this.skipHistory));
    },

    getCombos(tags) {
      const combos = [];
      for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
          combos.push(`${tags[i]}|${tags[j]}`);
        }
      }
      return combos;
    },

    recordSkip(tags) {
      tags.forEach(tag => {
        const base = this.skipHistory[tag] || 0;
        this.skipHistory[tag] = Math.min(base + 0.5, 10);
      });
      this.getCombos(tags).forEach(combo => {
        const base = this.skipHistory[combo] || 0;
        const inc = base * 0.3 + 1;
        this.skipHistory[combo] = Math.min(base + inc, 15);
      });
      this.save();
    },

    recordCompleted(tags) {
      tags.forEach(tag => {
        if (this.skipHistory[tag]) this.skipHistory[tag] *= 0.5;
      });
      this.getCombos(tags).forEach(combo => {
        if (this.skipHistory[combo]) this.skipHistory[combo] *= 0.3;
      });
      this.save();
    },

    computeWeight(song) {
      let weight = 1;
      song.tags.forEach(tag => {
        weight -= (this.skipHistory[tag] || 0) * 0.1;
      });
      this.getCombos(song.tags).forEach(combo => {
        weight -= (this.skipHistory[combo] || 0) * 0.3;
      });
      return Math.max(weight, 0.1);
    },

    pick(list) {
      const weights = list.map((song, idx) => ({ idx, weight: this.computeWeight(song) }));
      const total = weights.reduce((sum, w) => sum + w.weight, 0);
      const rand = Math.random() * total;
      let acc = 0;
      for (const w of weights) {
        acc += w.weight;
        if (rand < acc) return w.idx;
      }
      return 0;
    }
  };

  const MusicPlayer = {
    state: {
      currentIndex: 0,
      musicList: [],
      historyStack: [],
    },

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

    async init() {
      console.log('Player initializing...');
      Recommender.init();
      await this.loadMusicList();
      this.bindEvents();

      const lastIndex = localStorage.getItem('lastSongIndex');
      const lastTime = parseFloat(localStorage.getItem('lastSongTime') || 0);

      if (lastIndex !== null && this.state.musicList[lastIndex]) {
        this.updatePlayer(parseInt(lastIndex), lastTime);
      } else if (this.state.musicList.length > 0) {
        this.playNext();
      } else {
        this.dom.title.textContent = "音乐列表为空";
      }
    },

    async loadMusicList() {
      try {
        const response = await fetch('list.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        this.state.musicList = await response.json();
        console.log('Music list loaded:', this.state.musicList);
      } catch (error) {
        console.error('加载音乐列表失败:', error);
        this.dom.title.textContent = "加载列表失败";
      }
    },

    bindEvents() {
      this.dom.prevBtn.addEventListener('click', () => this.playPrevious());
      this.dom.nextBtn.addEventListener('click', () => {
        Recommender.recordSkip(this.state.musicList[this.state.currentIndex].tags);
        this.playNext();
      });
      this.dom.searchInput.addEventListener('input', () => this.handleSearch());

      this.dom.audio.addEventListener('ended', () => {
        Recommender.recordCompleted(this.state.musicList[this.state.currentIndex].tags);
        this.playNext();
      });
      this.dom.audio.addEventListener('timeupdate', () => this.savePlaybackPosition());
      this.dom.audio.addEventListener('contextmenu', e => e.preventDefault());
      this.dom.audio.onerror = () => {
        console.error("音频播放错误:", this.dom.audio.error);
        this.dom.title.textContent = "音频加载失败, 5秒后尝试下一首...";
        setTimeout(() => this.playNext(), 5000);
      };
    },

    updatePlayer(index, startTime = 0) {
      if (!this.state.musicList[index]) return;
      this.state.currentIndex = index;
      const song = this.state.musicList[index];

      this.dom.title.textContent = song.title;
      this.dom.tags.textContent = song.tags.join(', ');
      const encodedFile = encodeURIComponent(song.file);
      this.dom.audio.src = `https://music.stevel.eu.org/${encodedFile}`;


      this.dom.audio.onloadedmetadata = () => {
        this.dom.audio.currentTime = startTime;
        this.dom.audio.play().catch(e => console.warn('自动播放失败:', e));
      };

      this.renderRelatedSongs(song);
    },

    playSongByIndex(index) {
      this.state.historyStack.push(this.state.currentIndex);
      this.updatePlayer(index);
    },

    playNext() {
      const nextIndex = Recommender.pick(this.state.musicList);
      this.state.historyStack.push(this.state.currentIndex);
      this.updatePlayer(nextIndex);
    },

    playPrevious() {
      if (this.state.historyStack.length > 0) {
        const prevIndex = this.state.historyStack.pop();
        this.updatePlayer(prevIndex);
      }
    },

    renderRelatedSongs(currentSong) {
      this.dom.relatedContainer.innerHTML = '';
      const related = this.state.musicList.filter(song =>
        song.file !== currentSong.file &&
        song.tags.some(tag => currentSong.tags.includes(tag))
      ).slice(0, 5);

      related.forEach(song => {
        const songElement = document.createElement('div');
        songElement.className = 'related-song';
        songElement.innerHTML = `${song.title} <span class="song-tags">(${song.tags.join(', ')})</span>`;
        songElement.addEventListener('click', () => {
          const songIndex = this.state.musicList.findIndex(item => item.file === song.file);
          if (songIndex !== -1) this.playSongByIndex(songIndex);
        });
        this.dom.relatedContainer.appendChild(songElement);
      });
    },

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
          if (songIndex !== -1) this.playSongByIndex(songIndex);
          this.dom.searchInput.value = '';
          this.dom.searchResults.innerHTML = '';
        });
        this.dom.searchResults.appendChild(resultItem);
      });
    },

    savePlaybackPosition() {
      if (!isNaN(this.dom.audio.currentTime) && this.dom.audio.currentTime > 0) {
        localStorage.setItem('lastSongIndex', this.state.currentIndex);
        localStorage.setItem('lastSongTime', this.dom.audio.currentTime);
      }
    },
  };

  MusicPlayer.init();
});
