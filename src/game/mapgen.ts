function generateTerrain(
  width: number,
  height: number,
  n_sines: number = 10,
  amplitudeX: number = 1
): {
  x: number;
  y: number;
  cave: boolean;
}[] {
  const peaks = new Array(width).fill(0).map((_, i) => ({ x: i, y: height / 2 }));
  for (let i = 0; i < n_sines; i++) {
    const amplitude = Math.random() * amplitudeX;
    const frequency = Math.random() / 2;
    const phase = Math.random() * 2 * Math.PI;
    for (let x = 0; x < width; x++) {
      peaks[x].y = Math.min(
        Math.max(0, peaks[x].y - amplitude * Math.sin(frequency * x + phase)),
        height - 1
      );
    }
  }

  const terrain = new Array(width).fill(null).map(() => new Array(height).fill(false));
  peaks.forEach((peak) => {
    const peakY = Math.floor(peak.y);
    for (let y = peakY; y < height; y++) {
      if (Math.random() <= Math.min(0.5, (y - peakY) / (height - peakY))) {
        terrain[peak.x][y] = true;
      }
    }
  });

  for (let i = 0; i < 3; i++) {
    const newTerrain = terrain.map((row) => [...row]);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let neighborCount = 0;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx,
              ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && terrain[nx][ny]) {
              neighborCount++;
            }
          }
        }
        if (terrain[x][y] && neighborCount < 3) {
          newTerrain[x][y] = false;
        } else if (!terrain[x][y] && neighborCount >= 5) {
          newTerrain[x][y] = true;
        }
      }
    }
    terrain.forEach((row, x) =>
      row.forEach((_, y) => {
        terrain[x][y] = newTerrain[x][y];
      })
    );
  }

  const result: { x: number; y: number; cave: boolean }[] = [];
  for (let x = 0; x < width; x++) {
    const peakY = Math.floor(peaks[x].y);
    for (let y = peakY; y < height; y++) {
      result.push({ x, y, cave: terrain[x][y] });
    }
  }

  return result;
}

export { generateTerrain };
