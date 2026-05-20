export interface RowBand {
    y0: number;
    y1: number;
}

export interface GridBounds {
    x0: number;
    x1: number;
    rows: RowBand[];
}

function luminance(r: number, g: number, b: number): number {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** True when the pixel belongs to a tile (not the page background). */
export function isTilePixel(r: number, g: number, b: number): boolean {
    return r > 40 || g > 40 || b > 40;
}

function rowActivity(
    data: Uint8ClampedArray,
    width: number,
    y: number,
): number {
    let count = 0;
    const offset = y * width * 4;
    for (let x = 0; x < width; x++) {
        const i = offset + x * 4;
        if (isTilePixel(data[i], data[i + 1], data[i + 2])) count++;
    }
    return count;
}

function detectRowBands(
    data: Uint8ClampedArray,
    width: number,
    height: number,
): RowBand[] {
    const threshold = width * 0.12;
    const bands: RowBand[] = [];
    let inBand = false;
    let start = 0;

    for (let y = 0; y < height; y++) {
        const active = rowActivity(data, width, y) > threshold;
        if (active) {
            if (!inBand) {
                inBand = true;
                start = y;
            }
        } else if (inBand) {
            bands.push({ y0: start, y1: y - 1 });
            inBand = false;
        }
    }
    if (inBand) bands.push({ y0: start, y1: height - 1 });
    return bands;
}

function bandHeight(band: RowBand): number {
    return band.y1 - band.y0 + 1;
}

/** Keep the tallest cluster of evenly-sized tile rows (the Wordle grid). */
export function selectGridRows(
    bands: RowBand[],
    imageHeight: number,
): RowBand[] {
    const minHeight = Math.max(24, Math.round(imageHeight * 0.055));
    const tileBands = bands.filter((band) => bandHeight(band) >= minHeight);
    if (tileBands.length === 0) return [];

    const medianHeight = tileBands
        .map(bandHeight)
        .sort((a, b) => a - b)[Math.floor(tileBands.length / 2)];

    const gridBands = tileBands.filter((band) => {
        const h = bandHeight(band);
        return h >= medianHeight * 0.75 && h <= medianHeight * 1.25;
    });

    return gridBands.slice(0, 6);
}

export function findGridBounds(
    data: Uint8ClampedArray,
    width: number,
    height: number,
): GridBounds | null {
    const rows = selectGridRows(detectRowBands(data, width, height), height);
    if (rows.length === 0) return null;

    let x0 = width;
    let x1 = 0;
    for (const band of rows) {
        for (let y = band.y0; y <= band.y1; y++) {
            const offset = y * width * 4;
            for (let x = 0; x < width; x++) {
                const i = offset + x * 4;
                if (!isTilePixel(data[i], data[i + 1], data[i + 2])) continue;
                x0 = Math.min(x0, x);
                x1 = Math.max(x1, x);
            }
        }
    }

    if (x1 <= x0) return null;
    return { x0, x1, rows };
}

export async function loadImageToCanvas(file: File): Promise<HTMLCanvasElement> {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
}

function countDarkPixels(imageData: ImageData): number {
    let count = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
        if (imageData.data[i] < 128) count++;
    }
    return count;
}

function binarizeRegion(
    src: ImageData,
    destCtx: CanvasRenderingContext2D,
): ImageData {
    const bin = destCtx.createImageData(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
        const lum = luminance(src.data[i], src.data[i + 1], src.data[i + 2]);
        const value = lum > 165 ? 0 : 255;
        bin.data[i] = value;
        bin.data[i + 1] = value;
        bin.data[i + 2] = value;
        bin.data[i + 3] = 255;
    }
    return bin;
}

function scaleCanvas(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = source.width * scale;
    out.height = source.height * scale;
    const outCtx = out.getContext("2d");
    if (!outCtx) return source;
    outCtx.imageSmoothingEnabled = false;
    outCtx.drawImage(source, 0, 0, out.width, out.height);
    return out;
}

function renderBinarizedCrop(
    source: HTMLCanvasElement,
    x: number,
    y: number,
    width: number,
    height: number,
    scale: number,
): HTMLCanvasElement | null {
    const srcCtx = source.getContext("2d");
    if (!srcCtx || width <= 0 || height <= 0) return null;

    const src = srcCtx.getImageData(x, y, width, height);
    if (countDarkPixels(src) < width * height * 0.01) return null;

    const tmp = document.createElement("canvas");
    tmp.width = width;
    tmp.height = height;
    const tmpCtx = tmp.getContext("2d");
    if (!tmpCtx) return null;
    tmpCtx.putImageData(binarizeRegion(src, tmpCtx), 0, 0);
    return scaleCanvas(tmp, scale);
}

/** Binarize a grid row and scale up so Tesseract reads large caps reliably. */
export function renderRowForOcr(
    source: HTMLCanvasElement,
    bounds: GridBounds,
    row: RowBand,
    scale = 3,
): HTMLCanvasElement | null {
    const rowHeight = row.y1 - row.y0 + 1;
    const gridWidth = bounds.x1 - bounds.x0 + 1;
    return renderBinarizedCrop(
        source,
        bounds.x0,
        row.y0,
        gridWidth,
        rowHeight,
        scale,
    );
}

/** Binarize one tile in a grid row (more reliable than whole-row OCR for some fonts). */
export function renderTileForOcr(
    source: HTMLCanvasElement,
    bounds: GridBounds,
    row: RowBand,
    tileIndex: number,
    scale = 5,
): HTMLCanvasElement | null {
    const rowHeight = row.y1 - row.y0 + 1;
    const gridWidth = bounds.x1 - bounds.x0 + 1;
    const tileWidth = gridWidth / 5;
    const inset = Math.max(2, Math.floor(tileWidth * 0.08));
    const x0 = Math.round(bounds.x0 + tileIndex * tileWidth) + inset;
    const x1 = Math.round(bounds.x0 + (tileIndex + 1) * tileWidth) - inset;
    return renderBinarizedCrop(source, x0, row.y0, x1 - x0, rowHeight, scale);
}
