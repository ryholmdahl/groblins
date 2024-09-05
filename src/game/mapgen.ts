function generateTerrain(
  width: number,
  height: number,
  n_sines: number = 10,
  amplitudeX: number = 0.05
): {
  x: number;
  y: number;
  cave: boolean;
}[] {
  const peaks = [...Array(width).keys()].map((i) => ({ x: i, y: height / 2 }));
  for (let i = 0; i < n_sines; i++) {
    const amplitude = Math.random() * height * amplitudeX;
    const frequency = Math.random() / 2;
    const phase = Math.random() * 2 * Math.PI;
    for (let x = 0; x < width; x++) {
      const y = amplitude * Math.sin(frequency * x + phase);
      peaks[x].y -= y;
    }
  }
  let terrain: Set<string> = new Set();
  peaks
    .map(({ x, y }) => ({ x: Math.floor(x), y: Math.floor(y) }))
    .forEach((peak) => {
      for (let y = 0; y < peak.y; y++) {
        terrain.delete(`${peak.x},${y}`);
      }
      terrain.add(`${peak.x},${peak.y}`);
      for (let y = peak.y + 1; y < height; y++) {
        if (Math.random() > Math.min(0.5, (y - peak.y) / (height - peak.y))) {
          terrain.add(`${peak.x},${y}`);
        }
      }
    });
  for (let i = 0; i < 3; i++) {
    const newTerrain = new Set(terrain);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let neighborCount = [-1, 0, 1]
          .map((dx) => [
            [dx, -1],
            [dx, 0],
            [dx, 1]
          ])
          .flat()
          .reduce(
            (prev, [dx, dy]) =>
              prev + (!(dx === 0 && dy === 0) && terrain.has(`${x + dx},${y + dy}`) ? 1 : 0),
            0
          );
        const currentCell = terrain.has(`${x},${y}`);
        if (currentCell && neighborCount < 3) {
          newTerrain.delete(`${x},${y}`);
        } else if (!currentCell && neighborCount >= 5) {
          newTerrain.add(`${x},${y}`);
        }
      }
    }
    terrain = newTerrain;
  }

  const result: { x: number; y: number; cave: boolean }[] = [];
  for (let x = 0; x < width; x++) {
    const peakY = Math.floor(peaks[x].y);
    for (let y = peakY; y < height; y++) {
      const isTerrain = terrain.has(`${x},${y}`);
      if (isTerrain) {
        result.push({ x, y, cave: false });
      } else {
        result.push({ x, y, cave: true });
      }
    }
  }

  return result;
}

export { generateTerrain };
