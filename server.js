const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000; // You can change this port

app.use(cors());
app.use(express.json());

// Serve static files (index.html, style.css, script.js) from the root directory
app.use(express.static(__dirname));

// Helper to validate user-provided path and ensure it's a directory
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

// API Endpoint: List contents of a folder
app.post('/api/list-folder', async (req, res) => {
    const { folderPath } = req.body;
    try {
        const projectDir = await validateUserProvidedPath(folderPath);
        const items = await fs.readdir(projectDir);
        const imageFiles = items.filter(file => /\.(jpe?g|png|gif|webp)$/i.test(file))
            .sort((a, b) => { // a and b are filenames (strings)
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

// API Endpoint: Get image file
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

// API Endpoint: Save tags for an image
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

// Serve index.html for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Lora Tagger server running on http://localhost:${PORT}`);
    console.log(`Serving static files and API from: ${__dirname}`);
    console.log(`Enter the full path to your image project folder in the UI.`);
});