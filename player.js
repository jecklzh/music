document.addEventListener('DOMContentLoaded', () => {
  // Recommender 对象代码保留原样
  const Recommender = {
    skipHistory: {}, currentPreferredTags: [],
    init() { this.skipHistory = JSON.parse(localStorage.getItem('skipHistory') || '{}'); },
    save() { localStorage.setItem('skipHistory', JSON.stringify(this.skipHistory)); },
    getCombos(tags) {
      const combos = []; const generate = (arr, combo = [], start = 0) => {
        if (combo.length >= 2) { combos.push([...combo].sort().join('|')); }
        for (let i = start; i < arr.length; i++) { combo.push(arr[i]); generate(arr, combo, i + 1); combo.pop(); }
      }; generate(tags); return combos;
    },
    recordSkip(tags) {
      tags.forEach(tag => { this.skipHistory[tag] = Math.min((this.skipHistory[tag] || 0) + 0.5, 10); });
      this.getCombos(tags).forEach(combo => { const base = this.skipHistory[combo] || 0; this.skipHistory[combo] = Math.min(base + (base * 0.3 + 1), 15); });
      this.save();
    },
    recordCompleted(tags) {
      this.currentPreferredTags = tags;
      tags.forEach(tag => { if (this.skipHistory[tag]) { this.skipHistory[tag] *= 0.5; } });
      this.getCombos(tags).forEach(combo => { if (this.skipHistory[combo]) { this.skipHistory[combo] *= 0.3; } });
      this.save();
    },
    computeWeight(song) {
      const tags = song.tags; const combos = this.getCombos(tags); let totalPenalty = 0, totalCount = 0;
      tags.forEach(tag => { totalPenalty += (this.skipHistory[tag] || 0) * 0.1; totalCount++; });
      combos.forEach(combo => { totalPenalty += (this.skipHistory[combo] || 0) * 0.3; totalCount++; });
      const avgPenalty = totalCount > 0 ? totalPenalty / totalCount : 0; const baseWeight = Math.max(1 - avgPenalty, 0.1);
      let tagBonus = 0; if (Array.isArray(this.currentPreferredTags)) { const overlap = tags.filter(t => this.currentPreferredTags.includes(t)).length; tagBonus = overlap / tags.length; }
      const finalWeight = baseWeight * 0.22 + tagBonus * 0.78; return Math.max(finalWeight, 0.1);
    },
    pick(list) {
      const weights = list.map((song, idx) => ({ idx, weight: this.computeWeight(song) })); const total = weights.reduce((sum, w) => sum + w.weight, 0);
      const rand = Math.random() * total; let acc = 0;
      for (const w of weights) { acc += w.weight; if (rand < acc) return w.idx; }
      return 0;
    }
  };

  const MusicPlayer = {
    state: { currentIndex: 0, musicList: [], historyStack: [], fadeInterval: null, isPausing: false },
    dom: {
      audio: document.getElementById('audio'),
      title: document.getElementById('song-title'),
      tags: document.getElementById('song-tags'),
      relatedContainer: document.getElementById('related-songs'),
      searchResults: document.getElementById('search-results'),
      searchInput: document.getElementById('tag-search'),
      prevBtn: document.getElementById('prev-btn'),
      nextBtn: document.getElementById('next-btn'),
      playPauseBtn: document.getElementById('play-pause-btn'), // 直接从HTML获取
      progressContainer: document.getElementById('progress-container'),
      progressBar: document.getElementById('progress-bar'),
      currentTime: document.getElementById('current-time'),
      duration: document.getElementById('duration'),
      volumeIcon: document.getElementById('volume-icon'),
      volumeSliderContainer: document.getElementById('volume-slider-container'),
      volumeSlider: document.getElementById('volume-slider'),
    },
    async init() {
      console.log('Player initializing...');
      Recommender.init();
      await this.loadMusicList();
      this.bindEvents();
      this.initializeVolume();
      const lastIndex = localStorage.getItem('lastSongIndex'), lastTime = parseFloat(localStorage.getItem('lastSongTime') || 0);
      if (lastIndex !== null && this.state.musicList[lastIndex]) {
        this.updatePlayer(parseInt(lastIndex), lastTime, true);
      } else if (this.state.musicList.length > 0) {
        this.updatePlayer(Recommender.pick(this.state.musicList), 0, true);
      } else {
        this.dom.title.textContent = "音乐列表为空";
      }
    },
    initializeVolume() {
      const savedVolume = localStorage.getItem('playerVolume');
      const volume = savedVolume !== null ? parseFloat(savedVolume) : 0.75;
      this.dom.audio.volume = volume;
      this.dom.volumeSlider.value = volume;
      this.updateVolumeIcon(volume);
    },
    async loadMusicList() {
      try {
        const response = await fetch('list.json'); if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        this.state.musicList = await response.json(); console.log('Music list loaded:', this.state.musicList);
      } catch (error) { console.error('加载音乐列表失败:', error); this.dom.title.textContent = "加载列表失败"; }
    },
    formatTime(seconds) { const min = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60).toString().padStart(2, '0'); return `${min}:${sec}`; },
    bindEvents() {
      this.dom.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
      this.dom.nextBtn.addEventListener('click', () => {
        const song = this.state.musicList[this.state.currentIndex]; const audio = this.dom.audio;
        if (!isNaN(audio.duration) && audio.currentTime < audio.duration * 0.5) { Recommender.recordSkip(song.tags); }
        this.fadeOut(() => this.playNext());
      });
      this.dom.prevBtn.addEventListener('click', () => this.fadeOut(() => this.playPrevious()));
      this.dom.audio.addEventListener('play', () => { this.dom.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>'; this.state.isPausing = false; });
      this.dom.audio.addEventListener('pause', () => { this.dom.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>'; });
      this.dom.audio.addEventListener('ended', () => { Recommender.recordCompleted(this.state.musicList[this.state.currentIndex].tags); this.playNext(true); });
      this.dom.audio.addEventListener('timeupdate', () => this.updateProgress());
      this.dom.audio.addEventListener('loadedmetadata', () => this.updateProgress());
      this.dom.progressContainer.addEventListener('click', (e) => this.seek(e));
      this.dom.searchInput.addEventListener('input', () => this.handleSearch());
      this.dom.audio.addEventListener('contextmenu', e => e.preventDefault());
      this.dom.audio.onerror = () => { console.error("音频播放错误:", this.dom.audio.error); this.dom.title.textContent = "音频加载失败, 5秒后尝试下一首..."; setTimeout(() => this.playNext(true), 5000); };
      
      this.dom.volumeIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dom.volumeSliderContainer.classList.toggle('show');
      });
      this.dom.volumeSlider.addEventListener('input', (e) => {
          this.setVolume(e.target.value);
      });
      document.addEventListener('click', (e) => {
          if (!this.dom.volumeSliderContainer.contains(e.target) && !this.dom.volumeIcon.contains(e.target)) {
              this.dom.volumeSliderContainer.classList.remove('show');
          }
      });
    },
    setVolume(value) {
        this.dom.audio.volume = value;
        this.updateVolumeIcon(value);
        localStorage.setItem('playerVolume', value);
    },
    updateVolumeIcon(volume) {
        const icon = this.dom.volumeIcon.querySelector('i');
        if (volume == 0) { icon.className = 'fas fa-volume-mute'; } 
        else if (volume < 0.5) { icon.className = 'fas fa-volume-down'; } 
        else { icon.className = 'fas fa-volume-up'; }
    },
    updateProgress() {
      const { duration, currentTime } = this.dom.audio;
      if(duration) { this.dom.progressBar.style.width = `${(currentTime / duration) * 100}%`; this.dom.duration.textContent = this.formatTime(duration); this.dom.currentTime.textContent = this.formatTime(currentTime); }
    },
    seek(e) { const { clientWidth } = this.dom.progressContainer, { offsetX } = e, { duration } = this.dom.audio; if(duration){ this.dom.audio.currentTime = (offsetX / clientWidth) * duration; } },
    togglePlayPause() { if (this.dom.audio.paused) { this.state.isPausing = false; this.fadeIn(); } else { this.state.isPausing = true; this.fadeOut(); } },
    updatePlayer(index, startTime = 0, initialLoad = false) {
      if (!this.state.musicList[index]) return; this.state.currentIndex = index; const song = this.state.musicList[index];
      this.dom.title.textContent = song.title; this.dom.tags.textContent = song.tags.join(', ');
      this.dom.audio.src = `https://music.stevel.eu.org/${encodeURIComponent(song.file)}`;
      this.dom.audio.onloadedmetadata = () => { this.dom.audio.currentTime = startTime; this.updateProgress(); if (!initialLoad) { this.fadeIn(); } };
      this.renderRelatedSongs(song);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: song.title });
        navigator.mediaSession.setActionHandler('play', () => this.togglePlayPause());
        navigator.mediaSession.setActionHandler('pause', () => this.togglePlayPause());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.fadeOut(() => this.playPrevious()));
        navigator.mediaSession.setActionHandler('nexttrack', () => { Recommender.recordSkip(song.tags); this.fadeOut(() => this.playNext()); });
      }
    },
    playSongByIndex(index) { this.state.historyStack.push(this.state.currentIndex); this.fadeOut(() => this.updatePlayer(index)); },
    playNext(isAutoPlay = false) {
      let nextIndex = null, attempts = 0, maxAttempts = 20;
      do {
        const candidate = Recommender.pick(this.state.musicList);
        if (SleepController.isSongAllowed(this.state.musicList[candidate])) { nextIndex = candidate; break; }
        attempts++;
      } while (attempts < maxAttempts);

      if (nextIndex !== null) {
        this.state.historyStack.push(this.state.currentIndex);
        if (isAutoPlay) { this.updatePlayer(nextIndex); } 
        else { this.fadeOut(() => this.updatePlayer(nextIndex)); }
      } else {
        console.log('在睡眠模式下，未找到符合条件的歌曲，暂停播放。');
        this.fadeOut(() => this.dom.audio.pause());
      }
    },
    stopPlaybackDueToTimer() {
        console.log("Timer expired. Fading out and pausing audio.");
        this.state.isPausing = true;
        this.fadeOut(() => this.dom.audio.pause());
    },
    playPrevious() { if (this.state.historyStack.length > 0) { const prevIndex = this.state.historyStack.pop(); this.updatePlayer(prevIndex); } },
    renderRelatedSongs(currentSong) {
      this.dom.relatedContainer.innerHTML = '';
      const related = this.state.musicList.filter(song => song.file !== currentSong.file && song.tags.some(tag => currentSong.tags.includes(tag)))
        .map(song => ({ song, weight: Recommender.computeWeight(song) })).sort((a, b) => b.weight - a.weight).slice(0, 5);
      related.forEach(({ song }) => {
        const songElement = document.createElement('div'); songElement.className = 'related-song';
        songElement.innerHTML = `${song.title} <span class="song-tags">(${song.tags.join(', ')})</span>`;
        songElement.addEventListener('click', () => { const songIndex = this.state.musicList.findIndex(item => item.file === song.file); if (songIndex !== -1) this.playSongByIndex(songIndex); });
        this.dom.relatedContainer.appendChild(songElement);
      });
    },
    handleSearch() {
      const query = this.dom.searchInput.value.trim().toLowerCase(); this.dom.searchResults.innerHTML = ''; if (!query) return;
      const results = this.state.musicList.filter(song => song.title.toLowerCase().includes(query) || song.tags.some(tag => tag.toLowerCase().includes(query))).slice(0, 5);
      results.forEach(song => {
        const resultItem = document.createElement('div'); resultItem.className = 'search-result-item';
        resultItem.innerHTML = `${song.title} <span class="song-tags">${song.tags.join(', ')}</span>`;
        resultItem.addEventListener('click', () => { const songIndex = this.state.musicList.findIndex(item => item.file === song.file); if (songIndex !== -1) this.playSongByIndex(songIndex); this.dom.searchInput.value = ''; this.dom.searchResults.innerHTML = ''; });
        this.dom.searchResults.appendChild(resultItem);
      });
    },
    savePlaybackPosition() { if (!isNaN(this.dom.audio.currentTime) && this.dom.audio.currentTime > 0) { localStorage.setItem('lastSongIndex', this.state.currentIndex); localStorage.setItem('lastSongTime', this.dom.audio.currentTime); } },
    fadeOut(callback) {
      const initialVolume = this.dom.audio.volume;
      if (initialVolume === 0) { if (this.state.isPausing) this.dom.audio.pause(); if (callback) callback(); return; }
      clearInterval(this.state.fadeInterval); const step = initialVolume / 10, interval = 25, audio = this.dom.audio;
      this.state.fadeInterval = setInterval(() => {
        if (audio.volume > step) { audio.volume = Math.max(0, audio.volume - step); } 
        else { audio.volume = 0; clearInterval(this.state.fadeInterval); if (this.state.isPausing) { audio.pause(); } if (callback) callback(); }
      }, interval);
    },
    fadeIn() {
      const targetVolume = parseFloat(localStorage.getItem('playerVolume') || '0.75');
      this.dom.audio.volume = 0;
      clearInterval(this.state.fadeInterval); const step = targetVolume > 0 ? targetVolume / 10 : 0.1, interval = 25, audio = this.dom.audio;
      if(audio.paused) { audio.play().catch(e => console.warn('自动播放可能被浏览器阻止:', e)); }
      if (audio.volume >= targetVolume) return;
      this.state.fadeInterval = setInterval(() => {
        if (audio.volume < targetVolume - step) { audio.volume = Math.min(targetVolume, audio.volume + step); } 
        else { audio.volume = targetVolume; clearInterval(this.state.fadeInterval); }
      }, interval);
    }
  };

  const SleepController = {
    endTime: null, tagFilter: [], intervalId: null,
    isActive() { return this.endTime !== null; },
    start(minutes, tag) {
      this.stop(); this.endTime = Date.now() + minutes * 60 * 1000; this.tagFilter = [tag];
      this.intervalId = setInterval(() => this.updateRemainingTime(), 1000);
      document.getElementById('sleep-status').textContent = `已启用：播放 ${minutes} 分钟，「${tag}」`;
      this.updateRemainingTime(); 
    },
    stop() {
      clearInterval(this.intervalId); this.intervalId = null; this.endTime = null; this.tagFilter = [];
      document.getElementById('sleep-status').textContent = '未启用';
    },
    isSongAllowed(song) { if (!this.isActive() || this.tagFilter.length === 0) return true; return song.tags.some(tag => this.tagFilter.includes(tag)); },
    updateRemainingTime() {
      if (!this.isActive()) return;
      const msLeft = this.endTime - Date.now();
      if (msLeft <= 0) { console.log("Timer has expired. Issuing stop command."); MusicPlayer.stopPlaybackDueToTimer(); this.stop(); return; }
      const min = Math.floor(msLeft / 60000); const sec = Math.floor((msLeft % 60000) / 1000).toString().padStart(2, '0');
      document.getElementById('sleep-status').textContent = `剩余: ${min}:${sec}，仅播放「${this.tagFilter[0]}」`;
    }
  };

  document.getElementById('sleep-toggle').addEventListener('click', () => { 
      const panel = document.getElementById('sleep-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  document.querySelectorAll('.tag-btn').forEach(btn => { 
      btn.addEventListener('click', () => { 
          document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
      }); 
  });
  document.getElementById('sleep-minutes').addEventListener('change', () => {
    const selectedTagBtn = document.querySelector('.tag-btn.selected'); const minutes = parseInt(document.getElementById('sleep-minutes').value);
    if (selectedTagBtn && minutes) { SleepController.start(minutes, selectedTagBtn.dataset.tag); }
  });
  document.getElementById('sleep-stop-btn').addEventListener('click', () => { SleepController.stop(); });

  MusicPlayer.init();
});
