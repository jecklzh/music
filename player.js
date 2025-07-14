// ✅ 播放器脚本，支持标签组合惩罚、播放原谅、稳定推荐

const audio = document.getElementById('audio');
let currentIndex = null;
let historyStack = [];
let skipHistory = JSON.parse(localStorage.getItem('skipHistory') || '{}');

function generateTagCombos(tags) {
  const combos = [];
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      combos.push(`${tags[i]}|${tags[j]}`);
    }
  }
  return combos;
}

audio.ontimeupdate = () => {
  if (currentIndex !== null) {
    localStorage.setItem('lastSongIndex', currentIndex);
    localStorage.setItem('lastSongTime', audio.currentTime);
  }
};

audio.onended = () => {
  const song = musicList[currentIndex];
  song.tags.forEach(tag => {
    if (skipHistory[tag]) skipHistory[tag] *= 0.5;
  });
  generateTagCombos(song.tags).forEach(combo => {
    if (skipHistory[combo]) skipHistory[combo] *= 0.3;
  });
  localStorage.setItem('skipHistory', JSON.stringify(skipHistory));
};

function updatePlayer(song, startTime = 0) {
  document.getElementById('song-title').textContent = song.title;
  document.getElementById('song-tags').textContent = song.tags.join(', ');
  audio.src = song.file;
  audio.onloadedmetadata = () => {
    audio.currentTime = startTime;
    audio.play();
  };
  renderRelatedSongs(song);
}

function pickNextSong() {
  const weights = musicList.map((song, idx) => {
    let weight = 1;

    song.tags.forEach(tag => {
      const penalty = skipHistory[tag] || 0;
      weight -= penalty * 0.1;
    });

    const combos = generateTagCombos(song.tags);
    combos.forEach(combo => {
      const comboPenalty = skipHistory[combo] || 0;
      weight -= comboPenalty * 0.3;
    });

    return { idx, weight: Math.max(weight, 0.1) };
  });

  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  const rand = Math.random() * total;
  let acc = 0;
  for (const w of weights) {
    acc += w.weight;
    if (rand < acc) return w.idx;
  }
  return 0;
}

function skipSong() {
  if (currentIndex !== null) {
    const song = musicList[currentIndex];
    song.tags.forEach(tag => {
      const base = skipHistory[tag] || 0;
      skipHistory[tag] = Math.min(base + 0.5, 10);
    });
    generateTagCombos(song.tags).forEach(combo => {
      const base = skipHistory[combo] || 0;
      const inc = base * 0.3 + 1;
      skipHistory[combo] = Math.min(base + inc, 15);
    });
    localStorage.setItem('skipHistory', JSON.stringify(skipHistory));
    historyStack.push(currentIndex);
  }
  localStorage.removeItem('lastSongIndex');
  localStorage.removeItem('lastSongTime');
  currentIndex = pickNextSong();
  updatePlayer(musicList[currentIndex]);
}

function prevSong() {
  if (historyStack.length > 0) {
    currentIndex = historyStack.pop();
    updatePlayer(musicList[currentIndex]);
  }
}

function renderRelatedSongs(currentSong) {
  const container = document.getElementById('related-songs');
  container.innerHTML = '';
  const related = musicList.filter((song, idx) => {
    if (song === currentSong) return false;
    return song.tags.some(tag => currentSong.tags.includes(tag));
  }).slice(0, 3);
  related.forEach(song => {
    const div = document.createElement('div');
    div.className = 'related-song';
    div.textContent = `${song.title} (${song.tags.join(', ')})`;
    div.onclick = () => {
      historyStack.push(currentIndex);
      localStorage.removeItem('lastSongIndex');
      localStorage.removeItem('lastSongTime');
      currentIndex = musicList.indexOf(song);
      updatePlayer(song);
    };
    container.appendChild(div);
  });
}

function searchByTag() {
  const input = document.getElementById('tag-search').value.trim();
  const resultBox = document.getElementById('search-results');
  resultBox.innerHTML = '';
  if (input === '') return;

  const results = musicList.filter(song =>
    song.tags.some(tag => tag.includes(input))
  ).slice(0, 6);

  results.forEach(song => {
    const div = document.createElement('div');
    div.className = 'search-result-item';
    div.textContent = `${song.title} (${song.tags.join(', ')})`;
    div.onclick = () => {
      historyStack.push(currentIndex);
      localStorage.removeItem('lastSongIndex');
      localStorage.removeItem('lastSongTime');
      currentIndex = musicList.indexOf(song);
      updatePlayer(song);
    };
    resultBox.appendChild(div);
  });
}

if (localStorage.getItem('lastSongIndex')) {
  currentIndex = parseInt(localStorage.getItem('lastSongIndex'));
  const time = parseFloat(localStorage.getItem('lastSongTime') || 0);
  updatePlayer(musicList[currentIndex], time);
} else {
  skipSong();
}
