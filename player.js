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
    // ...原代码保持...
  };

  // 睡眠控制模块
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

  // 折叠展开
  document.getElementById('sleep-toggle').addEventListener('click', () => {
    const panel = document.getElementById('sleep-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // 选择标签按钮
  document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // 选择时间后自动开始
  document.getElementById('sleep-minutes').addEventListener('change', () => {
    const selectedTagBtn = document.querySelector('.tag-btn.selected');
    const minutes = parseInt(document.getElementById('sleep-minutes').value);
    if (selectedTagBtn && minutes) {
      SleepController.start(minutes, selectedTagBtn.dataset.tag);
    }
  });

  // 停止按钮
  document.getElementById('sleep-stop-btn').addEventListener('click', () => {
    SleepController.stop();
  });

  MusicPlayer.init();
});
