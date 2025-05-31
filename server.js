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

// Helper function to determine fill color based on border pixels
async function determineFillColor(imageSharpInstance, initialMetadata) {
    // imageSharpInstance should be a clone if further operations are done on the original instance outside this function
    let fillColor = '#FFFFFF'; // Default to white
    try {
        if (initialMetadata.width > 1 && initialMetadata.height > 1) {
            const borderSize = 1;
            // Create a new sharp instance for each extract to avoid interference if the original instance is used elsewhere.
            const topBorder = await imageSharpInstance.clone().extract({ left: 0, top: 0, width: initialMetadata.width, height: borderSize }).raw().toBuffer({ resolveWithObject: true });
            const bottomBorder = await imageSharpInstance.clone().extract({ left: 0, top: initialMetadata.height - borderSize, width: initialMetadata.width, height: borderSize }).raw().toBuffer({ resolveWithObject: true });
            const leftBorder = await imageSharpInstance.clone().extract({ left: 0, top: 0, width: borderSize, height: initialMetadata.height }).raw().toBuffer({ resolveWithObject: true });
            const rightBorder = await imageSharpInstance.clone().extract({ left: initialMetadata.width - borderSize, top: 0, width: borderSize, height: initialMetadata.height }).raw().toBuffer({ resolveWithObject: true });

            const allBorderPixels = [
                ...topBorder.data, ...bottomBorder.data,
                ...leftBorder.data, ...rightBorder.data
            ];

            let totalLuminance = 0;
            const channels = initialMetadata.channels || 3;
            const numPixels = allBorderPixels.length / channels;

            if (numPixels > 0) {
                for (let i = 0; i < allBorderPixels.length; i += channels) {
                    const r = allBorderPixels[i];
                    const g = allBorderPixels[i+1];
                    const b = allBorderPixels[i+2];
                    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                    totalLuminance += luminance;
                }
                const avgLuminance = totalLuminance / numPixels;
                fillColor = avgLuminance > 128 ? '#FFFFFF' : '#000000';
                console.log(`Determined fill color: ${fillColor} (avg luminance: ${avgLuminance.toFixed(2)})`);
            } else {
                 console.log('Not enough border pixel data for determineFillColor, defaulting to white.');
            }
        } else {
            console.log('Image too small for border color analysis in determineFillColor, defaulting to white.');
        }
    } catch (error) {
        console.error(`Error in determineFillColor: ${error.message}. Defaulting to white.`);
        fillColor = '#FFFFFF'; // Fallback color
    }
    return fillColor;
}

// Helper function to write file with retry logic
async function writeFileWithRetry(filePath, buffer, maxAttempts = 3, delayMs = 250) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`Attempt ${attempt}/${maxAttempts} to write file to: ${filePath}`);
            await fs.writeFile(filePath, buffer);
            console.log(`Successfully wrote file to: ${filePath} on attempt ${attempt}`);
            return; // Exit on success
        } catch (writeError) {
            console.error(`Attempt ${attempt}/${maxAttempts} to write file ${filePath} failed. Error: ${writeError.message}`);
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            } else {
                throw writeError; // Re-throw the last error if all attempts fail
            }
        }
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

// Endpoint to make an image 1:1 ratio by padding
app.post('/api/make-one-to-one', async (req, res) => {
    const { folderPath, imageName } = req.body;

    if (!folderPath || !imageName) {
        return res.status(400).json({ error: 'Missing required parameters: folderPath, imageName.' });
    }

    const imagePath = path.join(folderPath, imageName);
    if (!path.resolve(imagePath).startsWith(path.resolve(folderPath))) {
        return res.status(403).json({ error: 'Forbidden: Path traversal attempt detected.' });
    }

    try {
        await fs.access(imagePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
        return res.status(404).json({ error: `Image not found or not accessible: ${err.message}` });
    }

    try {
        const image = sharp(imagePath);
        const metadata = await image.metadata();

        // Use a clone for color determination if the original 'image' instance is chained further before this color is used.
        // Here, 'image' is re-assigned, so it's fine.
        const fillColor = await determineFillColor(image.clone(), metadata);

        const newSize = Math.max(metadata.width, metadata.height);

        const processedImageBuffer = await image
            .removeAlpha() // Ensure image is opaque
            .flatten({ background: fillColor }) // Fill any transparent areas with determined color
            .resize({ // This ensures the content is placed correctly within the 'extend' operation
                width: metadata.width,
                height: metadata.height,
                fit: 'contain', // Content is scaled down if it exceeds these dimensions, but not up
                background: fillColor // Background for 'contain' if needed, though extend handles the main padding
            })
            .extend({
                top: Math.floor((newSize - metadata.height) / 2),
                bottom: Math.ceil((newSize - metadata.height) / 2),
                left: Math.floor((newSize - metadata.width) / 2),
                right: Math.ceil((newSize - metadata.width) / 2),
                background: fillColor
            })
            .png()
            .toBuffer();

        await writeFileWithRetry(imagePath, processedImageBuffer);

        const finalMetadata = await sharp(imagePath).metadata(); // Get new metadata

        res.json({
            success: true,
            message: 'Image successfully made 1:1.',
            outputPath: imagePath,
            newWidth: finalMetadata.width, // Should be newSize
            newHeight: finalMetadata.height, // Should be newSize
            fillColorUsed: fillColor
        });

    } catch (error) {
        console.error(`Error in /make-one-to-one for ${imageName}:`, error);
        res.status(500).json({ error: `Failed to make image 1:1. ${error.message}` });
    }
});


// Endpoint to downscale an image to a target size
app.post('/api/downscale-to-target', async (req, res) => {
    const { folderPath, imageName, targetSize } = req.body;

    if (!folderPath || !imageName || !targetSize) {
        return res.status(400).json({ error: 'Missing required parameters: folderPath, imageName, targetSize.' });
    }
    if (typeof targetSize !== 'number' || targetSize <= 0) {
        return res.status(400).json({ error: 'targetSize must be a positive number.' });
    }

    const imagePath = path.join(folderPath, imageName);
    if (!path.resolve(imagePath).startsWith(path.resolve(folderPath))) {
        return res.status(403).json({ error: 'Forbidden: Path traversal attempt detected.' });
    }

    try {
        await fs.access(imagePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
        return res.status(404).json({ error: `Image not found or not accessible: ${err.message}` });
    }

    try {
        const image = sharp(imagePath);
        const metadata = await image.metadata();

        if (metadata.width !== metadata.height) {
            return res.status(400).json({ error: 'Image is not 1:1 ratio. Please use "Make 1:1 Ratio" first.' });
        }
        if (metadata.width <= targetSize) {
            return res.status(400).json({ error: `Image width (${metadata.width}px) is not larger than target size (${targetSize}px). No downscaling needed.` });
        }

        const processedImageBuffer = await image
            .resize({ width: targetSize, height: targetSize }) // Already 1:1
            .png()
            .toBuffer();

        await writeFileWithRetry(imagePath, processedImageBuffer);

        const finalMetadata = await sharp(imagePath).metadata(); // Get new metadata


        res.json({
            success: true,
            message: 'Image successfully downscaled.',
            outputPath: imagePath,
            newWidth: finalMetadata.width, // Should be targetSize
            newHeight: finalMetadata.height // Should be targetSize
        });

    } catch (error) {
        console.error(`Error in /downscale-to-target for ${imageName}:`, error);
        res.status(500).json({ error: `Failed to downscale image. ${error.message}` });
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