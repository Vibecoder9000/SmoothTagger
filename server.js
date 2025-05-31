const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const sharp = require('sharp'); // Added Sharp

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));

async function validateUserProvidedPath(userPath) {
    if (!userPath || typeof userPath !== 'string' || userPath.trim() === '') {
        throw new Error('Invalid path provided.');
    }
    const absolutePath = path.resolve(userPath);
    try {
        const stats = await fs.stat(absolutePath);
        if (!stats.isDirectory()) {
            throw new Error(`Path exists but is not a directory: ${absolutePath}`);
        }
        if (absolutePath === path.parse(absolutePath).root && userPath.includes('..')) {
             throw new Error('Access to root via ".." is restricted.');
        }
        return absolutePath;
    } catch (err) {
        if (err.code === 'ENOENT') {
            throw new Error(`Path does not exist: ${absolutePath}`);
        }
        console.error(`Error validating path "${userPath}" (resolved to "${absolutePath}"):`, err.message);
        throw err;
    }
}

app.post('/api/list-folder', async (req, res) => {
    const { folderPath } = req.body;
    try {
        const projectDir = await validateUserProvidedPath(folderPath);
        const items = await fs.readdir(projectDir);
        const imageFiles = items.filter(file => /\.(jpe?g|png|gif|webp)$/i.test(file))
            .sort((a, b) => {
                const numA = parseInt(a.match(/^\d+/)?.[0] || a);
                const numB = parseInt(b.match(/^\d+/)?.[0] || b);
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                return a.localeCompare(b);
            });

        const textFileContents = {};
        for (const item of items) {
            if (/\.txt$/i.test(item)) {
                try {
                    const content = await fs.readFile(path.join(projectDir, item), 'utf-8');
                    textFileContents[item] = content.trim();
                } catch (readErr) {
                    console.warn(`Could not read ${item}: ${readErr.message}`);
                    textFileContents[item] = "";
                }
            }
        }
        res.json({ imageFiles, textFileContents, resolvedFolderPath: projectDir });
    } catch (error) {
        console.error('Error listing folder:', error.message);
        res.status(400).json({ error: error.message || 'Failed to list folder contents.' });
    }
});

// New endpoint for filling/padding image
app.post('/api/fill-image', async (req, res) => {
    const { folderPath, imageName, targetWidth, targetHeight } = req.body;

    if (!folderPath || !imageName || !targetWidth || !targetHeight) {
        return res.status(400).json({ error: 'Missing required parameters: folderPath, imageName, targetWidth, targetHeight.' });
    }

    if (typeof targetWidth !== 'number' || typeof targetHeight !== 'number' || targetWidth <= 0 || targetHeight <= 0) {
        return res.status(400).json({ error: 'targetWidth and targetHeight must be positive numbers.' });
    }

    const imagePath = path.join(folderPath, imageName);

    // Security check: Ensure imagePath is within the intended folderPath to prevent directory traversal
    if (!path.resolve(imagePath).startsWith(path.resolve(folderPath))) {
        console.error(`Forbidden access attempt: User path "${folderPath}", image name "${imageName}", resolved to "${imagePath}"`);
        return res.status(403).json({ error: 'Forbidden: Path traversal attempt detected.' });
    }

    try {
        await fs.access(imagePath, fs.constants.R_OK | fs.constants.W_OK); // Check read/write access
    } catch (err) {
        console.error(`Error accessing image file at ${imagePath}:`, err);
        return res.status(404).json({ error: `Image not found or not accessible at ${imagePath}. Details: ${err.message}` });
    }

    try {
        const image = sharp(imagePath);
        const metadata = await image.metadata();

        // Simplified border color detection: average luminance of border pixels
        // This is a basic heuristic. More advanced methods could be used.
        let fillColor = '#FFFFFF'; // Default to white

        if (metadata.width > 1 && metadata.height > 1) { // Ensure image is large enough to have distinct borders
            const borderSize = 1; // 1-pixel border
            const topBorder = await image.clone().extract({ left: 0, top: 0, width: metadata.width, height: borderSize }).raw().toBuffer({ resolveWithObject: true });
            const bottomBorder = await image.clone().extract({ left: 0, top: metadata.height - borderSize, width: metadata.width, height: borderSize }).raw().toBuffer({ resolveWithObject: true });
            const leftBorder = await image.clone().extract({ left: 0, top: 0, width: borderSize, height: metadata.height }).raw().toBuffer({ resolveWithObject: true });
            const rightBorder = await image.clone().extract({ left: metadata.width - borderSize, top: 0, width: borderSize, height: metadata.height }).raw().toBuffer({ resolveWithObject: true });

            const allBorderPixels = [
                ...topBorder.data, ...bottomBorder.data,
                ...leftBorder.data, ...rightBorder.data
            ];

            let totalLuminance = 0;
            const channels = metadata.channels || 3; // Assume 3 channels (RGB) if not specified
            const numPixels = allBorderPixels.length / channels;

            if (numPixels > 0) {
                for (let i = 0; i < allBorderPixels.length; i += channels) {
                    const r = allBorderPixels[i];
                    const g = allBorderPixels[i+1];
                    const b = allBorderPixels[i+2];
                    // Using standard luminance formula
                    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                    totalLuminance += luminance;
                    // If alpha channel is present and it's very transparent, this might influence choice
                    // For now, we rely on flatten later to handle transparency with the chosen fillColor
                }
                const avgLuminance = totalLuminance / numPixels;
                fillColor = avgLuminance > 128 ? '#FFFFFF' : '#000000'; // Threshold for black/white
                console.log(`Determined fill color: ${fillColor} (avg luminance: ${avgLuminance.toFixed(2)})`);
            } else {
                 console.log('Not enough border pixel data to determine color, defaulting to white.');
            }
        } else {
            console.log('Image too small for border color analysis, defaulting to white.');
        }


        // Create a new canvas and composite the original image onto it
        const processedImageBuffer = await sharp({
            create: {
                width: targetWidth,
                height: targetHeight,
                channels: metadata.channels === 4 ? 4 : 3, // Preserve alpha if original had it, for the composite step
                background: fillColor
            }
        })
        .composite([{
            input: await image.removeAlpha().flatten({ background: fillColor }).toBuffer(), // Fill transparent areas of original
            gravity: 'centre'
        }])
        .png() // Output as PNG to preserve quality, especially if original was PNG or had transparency
        .toBuffer();

        // Overwrite the original file
        await fs.writeFile(imagePath, processedImageBuffer);

        const finalMetadata = await sharp(imagePath).metadata(); // Get metadata of the new image

        res.json({
            success: true,
            message: `Image processed and saved to ${imageName}.`,
            outputPath: imagePath,
            newWidth: finalMetadata.width,
            newHeight: finalMetadata.height,
            fillColorUsed: fillColor
        });

    } catch (error) {
        console.error(`Error processing image ${imageName}:`, error);
        res.status(500).json({ error: `Failed to process image. ${error.message}` });
    }
});

app.get('/api/image', async (req, res) => {
    const { folderPath, imageName } = req.query;
    if (!folderPath || !imageName) {
        return res.status(400).json({ error: 'folderPath and imageName are required' });
    }
    try {
        const imageFilePath = path.join(folderPath, imageName);
        if (!imageFilePath.startsWith(folderPath)) {
             return res.status(403).send('Forbidden: Access outside designated folder.');
        }
        await fs.access(imageFilePath, fs.constants.F_OK);
        res.sendFile(imageFilePath);
    } catch (error) {
        console.error(`Error serving image ${imageName} from ${folderPath}:`, error.message);
        if (error.code === 'ENOENT') {
            res.status(404).send('Image not found');
        } else {
            res.status(500).send('Error serving image');
        }
    }
});

app.post('/api/save-tags', async (req, res) => {
    const { folderPath, imageName, tags } = req.body;
    if (!folderPath || !imageName || tags === undefined) {
        return res.status(400).json({ error: 'folderPath, imageName, and tags are required' });
    }
    try {
        const baseName = imageName.replace(/\.[^/.]+$/, "");
        const txtFileName = `${baseName}.txt`;
        const txtFilePath = path.join(folderPath, txtFileName);
        if (!txtFilePath.startsWith(folderPath)) {
             return res.status(403).json({ error: 'Forbidden: Access outside designated folder.' });
        }
        await fs.writeFile(txtFilePath, tags.join(', '));
        res.json({ success: true, message: `Tags saved to ${txtFileName}` });
    } catch (error) {
        console.error('Error saving tags:', error.message);
        res.status(500).json({ error: 'Failed to save tags. Check server logs.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Lora Tagger server running on http://localhost:${PORT}`);
    console.log(`Serving static files and API from: ${__dirname}`);
    console.log(`Enter the full path to your image project folder in the UI.`);
});