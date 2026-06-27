class SpatialHash {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }
    insert(item) {
        let minX = item.x - item.r, maxX = item.x + item.r;
        let minY = item.y - item.r, maxY = item.y + item.r;
        let startX = Math.floor(minX / this.cellSize), endX = Math.floor(maxX / this.cellSize);
        let startY = Math.floor(minY / this.cellSize), endY = Math.floor(maxY / this.cellSize);
        
        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                let key = x + ',' + y;
                let list = this.grid.get(key);
                if (!list) {
                    list = [];
                    this.grid.set(key, list);
                }
                list.push(item);
            }
        }
    }
    query(item) {
        let minX = item.x - item.r, maxX = item.x + item.r;
        let minY = item.y - item.r, maxY = item.y + item.r;
        let startX = Math.floor(minX / this.cellSize), endX = Math.floor(maxX / this.cellSize);
        let startY = Math.floor(minY / this.cellSize), endY = Math.floor(maxY / this.cellSize);
        
        let found = new Set();
        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                let key = x + ',' + y;
                let list = this.grid.get(key);
                if (list) {
                    for (let other of list) {
                        found.add(other);
                    }
                }
            }
        }
        return Array.from(found);
    }
}
module.exports = SpatialHash;
