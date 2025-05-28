document.addEventListener('DOMContentLoaded', () => {
    // --- Element Getters ---
    const folderSelectionScreen = document.getElementById('folderSelectionScreen');
    const projectFolderPathInput = document.getElementById('projectFolderPathInput');
    const loadProjectFolderButton = document.getElementById('loadProjectFolderButton');
    const folderError = document.getElementById('folderError');
    const mainTaggerUI = document.getElementById('mainTaggerUI');
    const mainImage = document.getElementById('mainImage');
    // const imageCountDisplay = document.getElementById('imageCountDisplay'); // Not used / Hidden by CSS
    const galleryGridContainer = document.getElementById('galleryGridContainer');
    
    const globalTagInput = document.getElementById('globalTagInput');
    const addSingleGlobalTagButton = document.getElementById('addSingleGlobalTagButton'); // Button for single global tag
    const availableTagsDisplay = document.getElementById('availableTagsDisplay');
    
    const applicationBox = document.getElementById('applicationBox');
    const currentImageIdentifierSpan = document.getElementById('currentImageIdentifier');
    
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    
    const addToAllInput = document.getElementById('addToAllInput');
    const addToAllButton = document.getElementById('addToAllButton');
    
    const dragGhost = document.getElementById('dragGhost');

    // --- Variables ---
    let currentProjectServerPath = '';
    let imageFiles = [];
    let textFileContents = {}; // Stores tags for each image file { "image.txt": ["tag1", "tag2"] }
    let currentImageIndex = -1;
    const availableTagColors = [
        '#A93226', '#2471A3', '#1E8449', '#AF601A',
        '#7D3C98', '#117A65', '#4D5656', '#9A7D0A',
        '#6C3483', '#1B4F72', '#922B21', '#145A32',
        '#78281F', '#154360', '#0E6251', '#7E5109'
    ];
    let globalTagsSet = new Set(); // Stores all unique global tags
    const API_BASE_URL = '/api';
    let draggedTagElement = null; // Holds the tag element being dragged from applicationBox

    // --- Logging Function ---
    function logMessage(message, type = 'info') {
        const prefix = `[${new Date().toLocaleTimeString()}]`;
        if (type === 'error') console.error(`${prefix} ${message}`);
        else if (type === 'success') console.log(`${prefix} %c${message}`, 'color: lightgreen;');
        else console.log(`${prefix} ${message}`);
    }

    // --- State Management (localStorage) ---
    function loadState() {
        const savedPath = localStorage.getItem('loraTagger_projectUserPath');
        const savedGlobalTags = localStorage.getItem('loraTagger_globalTags');
        if (savedPath && projectFolderPathInput) {
            projectFolderPathInput.value = savedPath;
        }
        if (savedGlobalTags) {
            try {
                const tags = JSON.parse(savedGlobalTags);
                if (Array.isArray(tags)) {
                    tags.forEach(tag => addGlobalTagUI(tag, false)); // false: don't re-save during load
                }
            } catch (e) {
                logMessage('Could not parse saved global tags from localStorage.', 'error');
                localStorage.removeItem('loraTagger_globalTags');
            }
        }
    }

    function saveState(saveGlobalTags = true) {
        if (projectFolderPathInput && projectFolderPathInput.value) {
            localStorage.setItem('loraTagger_projectUserPath', projectFolderPathInput.value);
        }
        if (currentProjectServerPath && currentImageIndex !== -1) {
             localStorage.setItem(`loraTagger_currentIndex_${currentProjectServerPath}`, currentImageIndex.toString());
        }
        if (saveGlobalTags) {
            const globalTagsArray = Array.from(globalTagsSet);
            if (globalTagsArray.length > 0) {
                localStorage.setItem('loraTagger_globalTags', JSON.stringify(globalTagsArray));
            } else {
                localStorage.removeItem('loraTagger_globalTags');
            }
        }
    }
    window.addEventListener('beforeunload', () => saveState(true)); // Save everything on unload
    loadState(); // Load state when DOM is ready

    // --- "LOAD PROJECT" BUTTON ---
    if (loadProjectFolderButton) {
        loadProjectFolderButton.addEventListener('click', async () => {
            const userPath = projectFolderPathInput.value.trim();
            if (!userPath) {
                if (folderError) folderError.textContent = 'Please enter a project folder path.';
                return;
            }
            if (folderError) folderError.textContent = '';
            logMessage(`Attempting to load folder: ${userPath}`);

            try {
                const response = await fetch(`${API_BASE_URL}/list-folder`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderPath: userPath })
                });

                if (!response.ok) {
                    let errorData = { error: `Server error: ${response.status}` };
                    try { errorData = await response.json(); } catch (e) { /* ignore if not json */ }
                    throw new Error(errorData.error || `Failed with status ${response.status}`);
                }

                const data = await response.json();
                
                currentProjectServerPath = data.resolvedFolderPath;
                imageFiles = data.imageFiles;
                textFileContents = {}; 
                for (const fileName in data.textFileContents) {
                    textFileContents[fileName] = data.textFileContents[fileName]
                        .split(',').map(t => t.trim()).filter(t => t);
                }

                logMessage(`Loaded ${imageFiles.length} images from '${currentProjectServerPath}'.`, 'success');
                
                if (imageFiles.length > 0) {
                    if(folderSelectionScreen) folderSelectionScreen.style.display = 'none';
                    if(mainTaggerUI) mainTaggerUI.style.display = 'flex';
                    
                    populateGalleryGrid(); 
                    
                    const savedImageIndex = localStorage.getItem(`loraTagger_currentIndex_${currentProjectServerPath}`);
                    currentImageIndex = (savedImageIndex && parseInt(savedImageIndex, 10) < imageFiles.length) ? parseInt(savedImageIndex, 10) : 0;

                    displayImage(currentImageIndex); 
                    loadInitialGlobalTagsFromFiles(); 
                    saveState(true); // Save path and current index
                } else {
                    if(folderError) folderError.textContent = 'No images found in the specified folder.';
                    logMessage('No compatible image files found.', 'error');
                }

            } catch (error) {
                if(folderError) folderError.textContent = `Error: ${error.message}`;
                logMessage(`Failed to load folder: ${error.message}`, 'error');
            }
        });
    }

    // --- Initial Global Tags from Text Files ---
    function loadInitialGlobalTagsFromFiles() {
        const allTagsFromFiles = new Set();
        Object.values(textFileContents).forEach(tagsArray => {
            tagsArray.forEach(tag => allTagsFromFiles.add(tag.toLowerCase().replace(/\s+/g, '_')));
        });
        if (availableTagsDisplay) availableTagsDisplay.innerHTML = ''; // Clear existing global tags UI
        globalTagsSet.clear(); // Clear the JS Set
        allTagsFromFiles.forEach(tag => addGlobalTagUI(tag, false)); // Add without re-saving to localStorage
        saveState(true); // Save the newly populated globalTagsSet from files
    }

    // --- Gallery Population & Image Display ---
    function populateGalleryGrid() {
        if (!galleryGridContainer) return;
        galleryGridContainer.innerHTML = '';
        if (imageFiles.length === 0) return;

        imageFiles.forEach((fileName, index) => {
            const wrapper = document.createElement('div'); 
            const thumb = document.createElement('img');
            thumb.src = `${API_BASE_URL}/image?folderPath=${encodeURIComponent(currentProjectServerPath)}&imageName=${encodeURIComponent(fileName)}`;
            thumb.alt = `Thumbnail ${fileName}`;
            thumb.dataset.index = index; 
            thumb.addEventListener('click', () => displayImage(index));
            
            wrapper.appendChild(thumb); 
            galleryGridContainer.appendChild(wrapper); 
        });
    }

    function displayImage(index) {
        if (imageFiles.length === 0) return;
        if (index >= imageFiles.length) currentImageIndex = 0;
        else if (index < 0) currentImageIndex = imageFiles.length - 1;
        else currentImageIndex = index;

        const fileName = imageFiles[currentImageIndex];
        if (mainImage) {
            mainImage.src = `${API_BASE_URL}/image?folderPath=${encodeURIComponent(currentProjectServerPath)}&imageName=${encodeURIComponent(fileName)}`;
            mainImage.alt = fileName;
        }
        
        document.querySelectorAll('.gallery-grid-container img').forEach(img => {
            img.classList.toggle('active-thumb', parseInt(img.dataset.index) === currentImageIndex);
        });

        const activeThumbImg = galleryGridContainer.querySelector(`img.active-thumb`);
        if (activeThumbImg && activeThumbImg.parentElement && typeof activeThumbImg.parentElement.scrollIntoView === 'function') {
            activeThumbImg.parentElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }

        loadTagsForCurrentImage();
        saveState(false); // Don't re-save global tags, just current index and path
    }

    function loadTagsForCurrentImage() {
        if (applicationBox) applicationBox.innerHTML = '';
        if (currentImageIndex === -1) {
            if (currentImageIdentifierSpan) currentImageIdentifierSpan.textContent = "";
            return;
        }
        const currentImageFile = imageFiles[currentImageIndex];
        const baseName = currentImageFile.replace(/\.[^/.]+$/, "");
        
        if (currentImageIdentifierSpan) {
            currentImageIdentifierSpan.textContent = baseName;
        }
        
        const txtFileName = `${baseName}.txt`;
        const tagsArray = textFileContents[txtFileName] || [];
        tagsArray.forEach(tagText => addTagToApplicationBox(tagText, false)); // false: don't save on initial load
    }

    // --- Global Tag Input & Add Button ---
    if (addSingleGlobalTagButton && globalTagInput) {
        addSingleGlobalTagButton.addEventListener('click', () => {
            const tagText = globalTagInput.value.trim();
            if (tagText) {
                addGlobalTagUI(tagText, true); // true: save global tags after adding
                globalTagInput.value = '';
                globalTagInput.focus(); 
            }
        });

        globalTagInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); 
                addSingleGlobalTagButton.click(); // Trigger button click
            }
        });
    }
    
    function addGlobalTagUI(tagText, shouldSaveGlobalList = true) {
        const normalizedTag = tagText.toLowerCase().replace(/\s+/g, '_');
        if (!globalTagsSet.has(normalizedTag) && normalizedTag) {
            globalTagsSet.add(normalizedTag);
            const tagElement = createTagElement(normalizedTag, true, true); // isGlobal = true
            if (availableTagsDisplay) availableTagsDisplay.appendChild(tagElement);
            if (shouldSaveGlobalList) {
                saveState(true); // Save the updated globalTagsSet to localStorage
            }
        }
    }
    
    // --- Tag Element Creation & Drag/Drop ---
    function createTagElement(text, draggable, isGlobal = false) {
        const tag = document.createElement('span');
        tag.classList.add('tag');
        tag.textContent = text;
        tag.style.backgroundColor = availableTagColors[Math.abs(hashCode(text)) % availableTagColors.length];
        tag.draggable = draggable;

        if (isGlobal) { 
            tag.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', text);
                e.dataTransfer.effectAllowed = 'copy';
            });
            tag.addEventListener('click', () => { 
                addTagToApplicationBox(text, true); // true: save current image tags after adding
            });
        } else { // Tag in applicationBox (specific to an image)
            tag.addEventListener('dragstart', (e) => {
                draggedTagElement = tag; 
                e.dataTransfer.setData('text/plain', text);
                e.dataTransfer.effectAllowed = 'move';
                if (dragGhost) { 
                    dragGhost.textContent = text;
                    dragGhost.style.backgroundColor = tag.style.backgroundColor;
                    dragGhost.style.padding = '4px 8px';
                    dragGhost.style.borderRadius = '3px';
                    dragGhost.style.color = 'white';
                    e.dataTransfer.setDragImage(dragGhost, 0, 0); 
                }
                setTimeout(() => tag.classList.add('dragging'), 0); 
            });
            tag.addEventListener('dragend', () => {
                if (draggedTagElement) {
                    draggedTagElement.classList.remove('dragging');
                }
                draggedTagElement = null; 
            });
            tag.addEventListener('click', async () => { 
                tag.remove();
                await saveCurrentImageTags();
                logMessage(`Tag "${text}" removed by click. Saved.`, 'success');
            });
        }
        return tag;
    }

    function hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash); hash |= 0; 
        }
        return hash;
    }

    // Drag and Drop for applicationBox (receiving global tags or reordering/removing its own)
    if (applicationBox) {
        applicationBox.addEventListener('dragover', (e) => {
            e.preventDefault(); 
            e.dataTransfer.dropEffect = 'copy'; 
            if (draggedTagElement && draggedTagElement.parentNode === applicationBox) {
                e.dataTransfer.dropEffect = 'move'; // Indicate move if dragging within same box
            }
        });

        applicationBox.addEventListener('drop', async (e) => {
            e.preventDefault();
            const tagText = e.dataTransfer.getData('text/plain');

            if (draggedTagElement && draggedTagElement.parentNode === applicationBox) {
                // Handle reordering within applicationBox if desired (more complex)
                // For now, if it's dropped back into the same box, do nothing or re-append
                // draggedTagElement.classList.remove('dragging'); // Already handled by dragend
                // applicationBox.appendChild(draggedTagElement); // Re-append if it was visually removed
                draggedTagElement = null;
                return;
            }
            
            if (tagText) {
                addTagToApplicationBox(tagText, true); // Add (from global) and save
            }
            if (draggedTagElement) draggedTagElement = null; // Clear if it was a global tag
        });
    }

    // Global drag listeners for removing tags from applicationBox by dragging them out
    document.body.addEventListener('dragover', (e) => {
        if (draggedTagElement) { 
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move'; 
        }
    });

    document.body.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (draggedTagElement) {
            const parent = draggedTagElement.parentNode;
            if (parent === applicationBox && e.target !== applicationBox && (!applicationBox || !applicationBox.contains(e.target))) {
                const tagText = draggedTagElement.textContent;
                draggedTagElement.remove(); 
                await saveCurrentImageTags(); 
                logMessage(`Tag "${tagText}" removed by dragging out. Saved.`, 'success');
            }
            // Reset draggedTagElement, its class is removed in its own 'dragend' listener
            // draggedTagElement = null; // Handled by tag's own dragend
        }
    });
    
    async function addTagToApplicationBox(tagText, shouldSave) {
        if (!applicationBox) return;
        const existingTags = Array.from(applicationBox.querySelectorAll('.tag')).map(t => t.textContent);
        if (!existingTags.includes(tagText)) {
            const tagElement = createTagElement(tagText, true, false); // isGlobal = false
            applicationBox.appendChild(tagElement);
            if (shouldSave) {
                await saveCurrentImageTags();
                logMessage(`Tag "${tagText}" added to current image. Saved.`, 'success');
            }
        } else {
            logMessage(`Tag "${tagText}" already applied to current image.`, 'info');
        }
    }

    async function saveCurrentImageTags() {
        if (currentImageIndex === -1 || !imageFiles[currentImageIndex]) {
            logMessage("No image selected to save tags for.", 'error'); return;
        }
        const currentImageFile = imageFiles[currentImageIndex];
        if (!applicationBox) return;
        const tagsInBox = Array.from(applicationBox.querySelectorAll('.tag')).map(t => t.textContent);
        const txtFileName = currentImageFile.replace(/\.[^/.]+$/, "") + ".txt";
        
        textFileContents[txtFileName] = tagsInBox; // Update local cache

        try {
            const response = await fetch(`${API_BASE_URL}/save-tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    folderPath: currentProjectServerPath,
                    imageName: currentImageFile,
                    tags: tagsInBox
                })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }
            // logMessage(`Tags saved for ${currentImageFile}.`, 'success'); // Logged by calling function
        } catch (error) {
            logMessage(`Error saving tags for ${currentImageFile}: ${error.message}`, 'error');
        }
    }

    // --- "ADD TO ALL" FUNCTIONALITY ---
    if (addToAllButton && addToAllInput) {
        addToAllButton.addEventListener('click', async () => {
            const tagToAdd = addToAllInput.value.trim().toLowerCase().replace(/\s+/g, '_');
            if (!tagToAdd) {
                logMessage("No tag entered for 'Add to All'.", "info"); return;
            }
            if (imageFiles.length === 0) {
                logMessage("No images loaded to add tags to.", "error"); return;
            }
            logMessage(`Attempting to add "${tagToAdd}" to all ${imageFiles.length} images...`, "info");
            let successCount = 0; let alreadyPresentCount = 0;

            for (let i = 0; i < imageFiles.length; i++) {
                const imageFile = imageFiles[i];
                const baseName = imageFile.replace(/\.[^/.]+$/, "");
                const txtFileName = `${baseName}.txt`;
                let currentTags = textFileContents[txtFileName] || [];
                if (!currentTags.includes(tagToAdd)) {
                    currentTags.push(tagToAdd);
                    textFileContents[txtFileName] = currentTags; 
                    try {
                        const response = await fetch(`${API_BASE_URL}/save-tags`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                folderPath: currentProjectServerPath, imageName: imageFile, tags: currentTags
                            })
                        });
                        if (!response.ok) logMessage(`Failed to save tags for ${imageFile} during 'Add to All'.`, 'error');
                        else successCount++;
                    } catch (error) {
                        logMessage(`Error saving tags for ${imageFile}: ${error.message}`, 'error');
                    }
                } else {
                    alreadyPresentCount++;
                }
            }
            logMessage(`"${tagToAdd}" added to ${successCount} new images. Already present in ${alreadyPresentCount}.`, "success");
            addToAllInput.value = ''; 
            if (currentImageIndex !== -1) loadTagsForCurrentImage(); // Refresh current image tags if visible
            addGlobalTagUI(tagToAdd, true); // Add to global tags list and save global list
        });
    }

    // --- Navigation ---
    function navigatePrev() { if (imageFiles.length > 0) displayImage(currentImageIndex - 1); }
    function navigateNext() { if (imageFiles.length > 0) displayImage(currentImageIndex + 1); }
    if (prevButton) prevButton.addEventListener('click', navigatePrev);
    if (nextButton) nextButton.addEventListener('click', navigateNext);
    document.addEventListener('keydown', (e) => {
        // Check if the main tagger UI is visible and an input/textarea is NOT focused
        if (mainTaggerUI && mainTaggerUI.style.display === 'flex' &&
            document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA') {
            
            if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') navigatePrev();
            else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') navigateNext();
        }
    });

    // --- GALLERY HORIZONTAL SCROLL WITH MOUSE WHEEL ---
    if (galleryGridContainer) {
        galleryGridContainer.addEventListener('wheel', (event) => {
            if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) { // If horizontal scroll is already dominant
                return; 
            }
            event.preventDefault(); // Prevent page scroll
            const scrollAmount = event.deltaY * 0.8; // Adjust multiplier for scroll speed
            galleryGridContainer.scrollLeft += scrollAmount;
        }, { passive: false }); // passive: false is needed to call preventDefault()
    }
});