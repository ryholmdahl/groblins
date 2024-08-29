type Coordinate = {
  x: number;
  y: number;
};

function generateTerrain(width: number, height: number, n_sines: number = 10): Coordinate[] {
  const terrain = [...Array(width).keys()].map((i) => ({ x: i, y: height / 2 }));
  for (let i = 0; i < n_sines; i++) {
    const amplitude = Math.random() * height * 0.1;
    const frequency = Math.random() / 2;
    const phase = Math.random() * 2 * Math.PI;
    for (let x = 0; x < width; x++) {
      const y = amplitude * Math.sin(frequency * x + phase);
      console.log(y);
      terrain[x].y -= y;
    }
  }
  return terrain.map(({ x, y }) => ({ x, y: Math.floor(y) }));
}

export { generateTerrain };
