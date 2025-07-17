// 你只需要复制这个文件里的所有代码，替换掉你自己的 player.js 即可

document.addEventListener('DOMContentLoaded', () => {
  // Recommender 对象是你的推荐算法，它的逻辑是独立的，我们保留原样。
  const Recommender = {
    skipHistory: {},
    currentPreferredTags: [],

    init() {
      this.skipHistory = JSON.parse(localStorage.getItem('skipHistory') || '{}');
    },

    save() {
      localStorage.setItem('skipHistory', JSON.stringify(this.skipHistory));
    },

    getCombos(tags) {
      const combos = [];
      const generate = (arr, combo = [], start = 0) => {
        if (combo.length >= 2) {
          combos.push([...combo].sort().join('|'));
        }
        for (let i = start; i < arr.length; i++) {
          combo.push(arr[i]);
          generate(arr, combo, i + 1);
          combo.pop();
        }
      };
      generate(tags);
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
      this.currentPreferredTags = tags;
      tags.forEach(tag => {
        if (this.skipHistory[tag]) {
          this.skipHistory[tag] *= 0.5;
        }
      });
      this.getCombos(tags).forEach(combo => {
        if (this.skipHistory[combo]) {
          this.skipHistory[combo] *= 0.3;
        }
      });
      this.save();
    },

    computeWeight(song) {
      const tags = song.tags;
      const combos = this.getCombos(tags);
      let totalPenalty = 0;
      let totalCount = 0;

      tags.forEach(tag => {
        totalPenalty += (this.skipHistory[tag] || 0) * 0.1;
        totalCount++;
      });
      combos.forEach(combo => {
        totalPenalty += (this.skipHistory[combo] || 0) * 0.3;
        totalCount++;
      });

      const avgPenalty = totalCount > 0 ? totalPenalty / totalCount : 0;
      const baseWeight = Math.max(1 - avgPenalty, 0.1);
      let tagBonus = 0;
      if (Array.isArray(this.currentPreferredTags)) {
        const overlap = tags.filter(t => this.currentPreferredTags.includes(t)).length;
        tagBonus = overlap / tags.length;
      }
      const finalWeight = baseWeight * 0.22 + tagBonus * 0.78;
      return Math.max(finalWeight, 0.1);
    },

    pick(list) {
      const weights = list.map((song, idx) => ({
        idx,
        weight: this.computeWeight(song)
      }));
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
      // --- 优化点 1: 添加新状态，用于管理淡入淡出动画 ---
      // 这个变量会持有 setInterval 的 ID，确保任何时候只有一个音量动画在运行，防止冲突。
      fadeInterval: null
    },

    dom: {
      audio: document.getElementById('audio'),
      originalVolume: 1,
      title: document.getElementById('song-title'),
      tags: document.getElementById('song-tags'),
      relatedContainer: document.getElementById('related-songs'),
      searchResults: document.getElementById('search-results'),
      searchInput: document.getElementById('tag-search'),
      prevBtn: document.getElementById('prev-btn'),
      nextBtn: document.getElementById('next-btn')
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
        // --- 修改点: 首次加载时直接播放，无需淡出 ---
        this.updatePlayer(Recommender.pick(this.state.musicList));
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
      // 点击下一首：先淡出，再播放
      this.dom.nextBtn.addEventListener('click', () => {
        const song = this.state.musicList[this.state.currentIndex];
        const audio = this.dom.audio;
        if (!isNaN(audio.duration) && audio.currentTime < audio.duration * 0.5) {
          Recommender.recordSkip(song.tags);
        }
        this.fadeOut(() => this.playNext());
      });
      
      // 点击上一首：先淡出，再播放
      this.dom.prevBtn.addEventListener('click', () => this.fadeOut(() => this.playPrevious()));

      // 只有在主动播放时，才需要淡入
      this.dom.audio.addEventListener('play', () => this.fadeIn());

      // --- 核心修复点 1: 删除冲突的 'pause' 监听器 ---
      // 下面这行被注释掉的代码是导致所有问题的根源。
      // 它会在 audio.src 改变时被意外触发，导致音量混乱和播放停止。必须删除。
      // this.dom.audio.addEventListener('pause', () => this.fadeOut(() => this.dom.audio.pause()));

      // --- 核心修复点 2: 区分自动播放和手动播放 ---
      // 当歌曲自然播放结束时，我们希望无缝切换到下一首，而不是先淡出再淡入。
      this.dom.audio.addEventListener('ended', () => {
        Recommender.recordCompleted(this.state.musicList[this.state.currentIndex].tags);
        this.playNext(true); // 传入 true 代表是“自动播放”
      });

      // 以下监听器保持不变
      this.dom.searchInput.addEventListener('input', () => this.handleSearch());
      this.dom.audio.addEventListener('timeupdate', () => this.savePlaybackPosition());
      this.dom.audio.addEventListener('contextmenu', e => e.preventDefault());
      this.dom.audio.onerror = () => {
        console.error("音频播放错误:", this.dom.audio.error);
        this.dom.title.textContent = "音频加载失败, 5秒后尝试下一首...";
        setTimeout(() => this.playNext(true), 5000); // 错误重试也应该是无缝的
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
        // 只有在非自动播放的场景（如页面首次加载）才需要手动调用fadeIn
        // 其他情况（如点击按钮）是由 fadeOut -> playNext -> updatePlayer -> audio 'play' event -> fadeIn 自动触发
        if(this.dom.audio.paused) {
            this.fadeIn();
        }
      };

      this.renderRelatedSongs(song);

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: song.title
        });
        
        // --- 核心修复点 3: 简化系统媒体控件的行为 ---
        navigator.mediaSession.setActionHandler('play', () => this.fadeIn());
        // 直接暂停，而不是调用我们复杂的淡出逻辑，避免冲突和循环。
        navigator.mediaSession.setActionHandler('pause', () => this.dom.audio.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.fadeOut(() => this.playPrevious()));
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          Recommender.recordSkip(song.tags);
          this.fadeOut(() => this.playNext());
        });
      }
    },

    playSongByIndex(index) {
      this.state.historyStack.push(this.state.currentIndex);
      // 点击相关歌曲或搜索结果时，也使用淡出效果，体验更好
      this.fadeOut(() => this.updatePlayer(index));
    },

    playNext(isAutoPlay = false) {
      const nextIndex = Recommender.pick(this.state.musicList);

      // (你的睡眠控制器逻辑可以放在这里，暂时简化)
      
      this.state.historyStack.push(this.state.currentIndex);

      // --- 核心修复点 4: 根据播放类型决定是否淡出 ---
      if (isAutoPlay) {
        // 如果是自动播放下一首，直接更新播放器，实现无缝切换
        this.updatePlayer(nextIndex);
      } else {
        // 如果是手动点击，则执行淡出动画
        this.fadeOut(() => this.updatePlayer(nextIndex));
      }
    },

    playPrevious() {
      if (this.state.historyStack.length > 0) {
        const prevIndex = this.state.historyStack.pop();
        // 上一首是由 fadeOut 调用的，所以这里直接更新即可
        this.updatePlayer(prevIndex);
      }
    },

    renderRelatedSongs(currentSong) {
      this.dom.relatedContainer.innerHTML = '';
      const related = this.state.musicList
        .filter(song =>
          song.file !== currentSong.file &&
          song.tags.some(tag => currentSong.tags.includes(tag))
        )
        .map(song => ({
          song,
          weight: Recommender.computeWeight(song)
        }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5);

      related.forEach(({ song }) => {
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

    // --- 优化点 2: 重写淡入淡出函数，使其更健壮 ---
    fadeOut(callback) {
      // 1. 先清除上一个动画，防止用户快速点击时，多个动画冲突
      clearInterval(this.state.fadeInterval);

      const step = 0.05;
      const interval = 50;
      const audio = this.dom.audio;

      if (audio.volume === 0) {
        if(callback) callback();
        return;
      }

      // 2. 将新的动画 ID 保存到 state 中
      this.state.fadeInterval = setInterval(() => {
        if (audio.volume > step) {
          audio.volume = Math.max(0, audio.volume - step);
        } else {
          audio.volume = 0;
          clearInterval(this.state.fadeInterval);
          if (callback) callback();
        }
      }, interval);
    },

    fadeIn() {
      // 1. 先清除上一个动画
      clearInterval(this.state.fadeInterval);

      const step = 0.05;
      const interval = 50;
      const audio = this.dom.audio;
      
      // 2. 先尝试播放，这会触发 'play' 事件，但我们的 fadeIn 是由 'play' 触发的，
      //    所以要确保音频是真的在播放
      if(audio.paused) {
          audio.play().catch(e => console.warn('自动播放可能被浏览器阻止:', e));
      }
      
      if (audio.volume === this.dom.originalVolume) {
        return;
      }

      // 3. 将新的动画 ID 保存到 state 中
      this.state.fadeInterval = setInterval(() => {
        if (audio.volume < this.dom.originalVolume - step) {
          audio.volume = Math.min(this.dom.originalVolume, audio.volume + step);
        } else {
          audio.volume = this.dom.originalVolume;
          clearInterval(this.state.fadeInterval);
        }
      }, interval);
    }
  };

  // SleepController 及其事件监听器保持不变
  const SleepController = {
    enabled: false,
    endTime: 0,
    tagFilter: [],
    intervalId: null,

    start(minutes, tag) {
      this.enabled = true;
      this.endTime = Date.now() + minutes * 60 * 1000;
      this.tagFilter = [tag];
      document.getElementById('sleep-status').textContent = `已启用：播放 ${minutes} 分钟，仅播放「${tag}」相关音乐`;
      this.updateRemainingTime();
      this.intervalId = setInterval(() => this.updateRemainingTime(), 1000);
    },

    stop() {
      this.enabled = false;
      this.tagFilter = [];
      clearInterval(this.intervalId);
      document.getElementById('sleep-status').textContent = '未启用';
    },

    isActive() {
      return this.enabled && Date.now() < this.endTime;
    },

    isSongAllowed(song) {
      if (!this.isActive()) return true;
      return song.tags.some(tag => this.tagFilter.includes(tag));
    },

    updateRemainingTime() {
      if (!this.isActive()) {
        this.stop();
        return;
      }
      const msLeft = this.endTime - Date.now();
      const min = Math.floor(msLeft / 60000);
      const sec = Math.floor((msLeft % 60000) / 1000).toString().padStart(2, '0');
      document.getElementById('sleep-status').textContent = `剩余时间：${min}:${sec}，仅播放「${this.tagFilter[0]}」相关音乐`;
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
    const selectedTagBtn = document.querySelector('.tag-btn.selected');
    const minutes = parseInt(document.getElementById('sleep-minutes').value);
    if (selectedTagBtn && minutes) {
      SleepController.start(minutes, selectedTagBtn.dataset.tag);
    }
  });

  document.getElementById('sleep-stop-btn').addEventListener('click', () => {
    SleepController.stop();
  });


  MusicPlayer.init();
});
