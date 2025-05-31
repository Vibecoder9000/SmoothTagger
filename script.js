document.addEventListener('DOMContentLoaded', () => {
    const folderSelectionScreen = document.getElementById('folderSelectionScreen');
    const projectFolderPathInput = document.getElementById('projectFolderPathInput');
    const loadProjectFolderButton = document.getElementById('loadProjectFolderButton');
    const folderError = document.getElementById('folderError');
    const mainTaggerUI = document.getElementById('mainTaggerUI');
    const mainImage = document.getElementById('mainImage');
    const galleryGridContainer = document.getElementById('galleryGridContainer');
    const closeTaggerButton = document.getElementById('closeTaggerButton');
    
    const globalTagInput = document.getElementById('globalTagInput');
    const addSingleGlobalTagButton = document.getElementById('addSingleGlobalTagButton');
    const availableTagsDisplay = document.getElementById('availableTagsDisplay');
    
    const applicationBox = document.getElementById('applicationBox');
    const currentImageIdentifierSpan = document.getElementById('currentImageIdentifier');
    
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    
    const addToAllInput = document.getElementById('addToAllInput');
    const addToAllButton = document.getElementById('addToAllButton');
    
    const dragGhost = document.getElementById('dragGhost');

    // UI elements for image processing features
    const makeOneToOneButton = document.getElementById('makeOneToOneButton');
    const downscaleButton = document.getElementById('downscaleButton');
    const statsModal = document.getElementById('statsModal');
    const finalCloseButton = document.getElementById('finalCloseButton');
    const modalStatsImagesTagged = document.getElementById('modalStatsImagesTagged');
    const modalStatsUniqueTags = document.getElementById('modalStatsUniqueTags');
    const modalStatsTagFrequencyList = document.getElementById('modalStatsTagFrequencyList');
    const modalConfirmationView = document.getElementById('modalConfirmationView');
    const modalStatsView = document.getElementById('modalStatsView');
    const modalConfirmYesButton = document.getElementById('modalConfirmYesButton');
    const modalConfirmNoButton = document.getElementById('modalConfirmNoButton');
    const size512Button = document.getElementById('size512Button'); // Keep for downscaleButton
    const size1024Button = document.getElementById('size1024Button'); // Keep for downscaleButton
    const toastNotification = document.getElementById('toastNotification');

    let selectedSize = 512; // Default size, used by Downscale to Target
    let currentProjectServerPath = '';
    let imageFiles = [];
    let textFileContents = {};
    let currentImageIndex = -1;
    const availableTagColors = [
        '#A93226', '#2471A3', '#1E8449', '#AF601A',
        '#7D3C98', '#117A65', '#4D5656', '#9A7D0A',
        '#6C3483', '#1B4F72', '#922B21', '#145A32',
        '#78281F', '#154360', '#0E6251', '#7E5109'
    ];
    let globalTagsSet = new Set();
    const API_BASE_URL = '/api';
    let draggedTagElement = null;

    let toastTimeout; // Variable to hold the timeout ID for the toast

    function showToast(message) {
        if (!toastNotification) return;
        toastNotification.textContent = message;
        toastNotification.classList.add('show');

        // Clear any existing timeout to prevent premature hiding
        if (toastTimeout) {
            clearTimeout(toastTimeout);
        }

        toastTimeout = setTimeout(() => {
            toastNotification.classList.remove('show');
        }, 3000);
    }

    function logMessage(message, type = 'info') {
        const prefix = `[${new Date().toLocaleTimeString()}]`;
        if (type === 'error') console.error(`${prefix} ${message}`);
        else if (type === 'success') console.log(`${prefix} %c${message}`, 'color: lightgreen;');
        else console.log(`${prefix} ${message}`);
    }

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
                    tags.forEach(tag => addGlobalTagUI(tag, false));
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
    window.addEventListener('beforeunload', () => saveState(true));
    loadState();

    window.addEventListener('beforeunload', (event) => {
        const confirmationMessage = 'Are you sure you want to leave?';
        event.preventDefault();
        event.returnValue = confirmationMessage;
        return confirmationMessage;
    });

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
                    try { errorData = await response.json(); } catch (e) { }
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
                    saveState(true);
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

    function loadInitialGlobalTagsFromFiles() {
        const allTagsFromFiles = new Set();
        Object.values(textFileContents).forEach(tagsArray => {
            tagsArray.forEach(tag => allTagsFromFiles.add(tag.toLowerCase().replace(/\s+/g, '_')));
        });
        if (availableTagsDisplay) availableTagsDisplay.innerHTML = '';
        globalTagsSet.clear();
        allTagsFromFiles.forEach(tag => addGlobalTagUI(tag, false));
        saveState(true);
    }

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
        saveState(false);
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
        tagsArray.forEach(tagText => addTagToApplicationBox(tagText, false));
    }

    if (addSingleGlobalTagButton && globalTagInput) {
        addSingleGlobalTagButton.addEventListener('click', () => {
            const tagText = globalTagInput.value.trim();
            if (tagText) {
                addGlobalTagUI(tagText, true);
                globalTagInput.value = '';
                globalTagInput.focus(); 
            }
        });

        globalTagInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); 
                addSingleGlobalTagButton.click();
            }
        });
    }
    
    function addGlobalTagUI(tagText, shouldSaveGlobalList = true) {
        const normalizedTag = tagText.toLowerCase().replace(/\s+/g, '_');
        if (!globalTagsSet.has(normalizedTag) && normalizedTag) {
            globalTagsSet.add(normalizedTag);
            const tagElement = createTagElement(normalizedTag, true, true);
            if (availableTagsDisplay) availableTagsDisplay.appendChild(tagElement);
            if (shouldSaveGlobalList) {
                saveState(true);
            }
        }
    }
    
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
                addTagToApplicationBox(text, true);
            });
        } else {
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
                e.dataTransfer.dropEffect = 'move';
            }
        });

        applicationBox.addEventListener('drop', async (e) => {
            e.preventDefault();
            const tagText = e.dataTransfer.getData('text/plain');

            if (draggedTagElement && draggedTagElement.parentNode === applicationBox) {
                draggedTagElement = null;
                return;
            }
            
            if (tagText) {
                addTagToApplicationBox(tagText, true);
            }
            if (draggedTagElement) draggedTagElement = null;
        });
    }

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
        }
    });
    
    async function addTagToApplicationBox(tagText, shouldSave) {
        if (!applicationBox) return;
        const existingTags = Array.from(applicationBox.querySelectorAll('.tag')).map(t => t.textContent);
        if (!existingTags.includes(tagText)) {
            const tagElement = createTagElement(tagText, true, false);
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
        
        textFileContents[txtFileName] = tagsInBox;

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
        } catch (error) {
            logMessage(`Error saving tags for ${currentImageFile}: ${error.message}`, 'error');
        }
    }

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
            if (currentImageIndex !== -1) loadTagsForCurrentImage();
            addGlobalTagUI(tagToAdd, true);
        });
    }

    function navigatePrev() { if (imageFiles.length > 0) displayImage(currentImageIndex - 1); }
    function navigateNext() { if (imageFiles.length > 0) displayImage(currentImageIndex + 1); }
    if (prevButton) prevButton.addEventListener('click', navigatePrev);
    if (nextButton) nextButton.addEventListener('click', navigateNext);
    document.addEventListener('keydown', (e) => {
        if (mainTaggerUI && mainTaggerUI.style.display === 'flex' &&
            document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'TEXTAREA') {
            
            if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') navigatePrev();
            else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') navigateNext();
        }
    });

    if (galleryGridContainer) {
        galleryGridContainer.addEventListener('wheel', (event) => {
            if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
                return; 
            }
            event.preventDefault();
            const scrollAmount = event.deltaY * 0.8;
            galleryGridContainer.scrollLeft += scrollAmount;
        }, { passive: false });
    }

    function showModalWithConfirmation() {
        if (statsModal && modalConfirmationView && modalStatsView) {
            modalConfirmationView.style.display = 'block';
            modalStatsView.style.display = 'none';
            statsModal.style.display = 'flex';
            logMessage("Modal displayed with confirmation view.");
        } else {
            logMessage("Modal or its view components not found.", "error");
        }
    }

    function populateAndShowStatsView() {
        if (!statsModal || !modalConfirmationView || !modalStatsView || !modalStatsImagesTagged || !modalStatsUniqueTags || !modalStatsTagFrequencyList) {
            logMessage("One or more stats modal components for stats view are missing.", "error");
            return;
        }

        // --- Calculate Statistics (same logic as before) ---
        let imagesTaggedCount = 0;
        const allTags = [];
        const tagFrequencies = {};

        for (const txtFileName in textFileContents) {
            if (textFileContents.hasOwnProperty(txtFileName)) {
                const tags = textFileContents[txtFileName];
                if (tags && tags.length > 0) {
                    imagesTaggedCount++;
                    tags.forEach(tag => {
                        allTags.push(tag);
                        tagFrequencies[tag] = (tagFrequencies[tag] || 0) + 1;
                    });
                }
            }
        }
        const uniqueTags = new Set(allTags);

        // --- Populate Modal Content ---
        modalStatsImagesTagged.textContent = imagesTaggedCount;
        modalStatsUniqueTags.textContent = uniqueTags.size;

        modalStatsTagFrequencyList.innerHTML = ''; // Clear previous list
        if (Object.keys(tagFrequencies).length > 0) {
            const sortedTags = Object.entries(tagFrequencies).sort(([,a],[,b]) => b-a); // Sort by frequency

            sortedTags.forEach(([tag, count]) => {
                const listItem = document.createElement('li');
                listItem.textContent = `${tag}: ${count}`;
                modalStatsTagFrequencyList.appendChild(listItem);
            });
        } else {
            const listItem = document.createElement('li');
            listItem.textContent = 'No tags found.';
            modalStatsTagFrequencyList.appendChild(listItem);
        }

        // --- Switch Views Within Modal ---
        modalConfirmationView.style.display = 'none';
        modalStatsView.style.display = 'block';
        logMessage("Statistics view displayed in modal.");

        const copyAllTagsButton = document.getElementById('copyAllTagsButton');
        if (copyAllTagsButton) {
            copyAllTagsButton.addEventListener('click', async () => {
                const tagsToCopy = Object.keys(tagFrequencies);
                if (tagsToCopy.length > 0) {
                    const tagsString = tagsToCopy.join(', ');
                    try {
                        await navigator.clipboard.writeText(tagsString);
                        showToast('Tags copied to clipboard!');
                    } catch (err) {
                        showToast('Error copying tags.');
                        console.error('Clipboard error:', err);
                    }
                } else {
                    showToast('No tags to copy.');
                }
            });
        }
    }

    // --- Image Processing Feature Logic ---

    // Event listeners for the 512/1024 size switch (used by Downscale to Target)
    if (size512Button && size1024Button) {
        size512Button.addEventListener('click', () => {
            selectedSize = 512;
            size512Button.classList.add('active');
            size1024Button.classList.remove('active');
            logMessage(`Selected size: ${selectedSize}x${selectedSize}`);
        });

        size1024Button.addEventListener('click', () => {
            selectedSize = 1024;
            size1024Button.classList.add('active');
            size512Button.classList.remove('active');
            logMessage(`Selected size: ${selectedSize}x${selectedSize}`);
        });
    }

    // Event listener for "Make 1:1 Ratio" button
    if (makeOneToOneButton) {
        makeOneToOneButton.addEventListener('click', async () => {
            if (currentImageIndex === -1 || !imageFiles[currentImageIndex]) {
                logMessage('No image selected for "Make 1:1 Ratio".', 'error');
                alert('No image selected. Please select an image first.');
                return;
            }

            const imageName = imageFiles[currentImageIndex];
            logMessage(`"Make 1:1 Ratio" button clicked for "${imageName}".`, 'info');

            try {
                const response = await fetch(`${API_BASE_URL}/make-one-to-one`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        folderPath: currentProjectServerPath,
                        imageName: imageName,
                    })
                });

                if (!response.ok) {
                    let errorData = { error: `Server error: ${response.status}` };
                    try { errorData = await response.json(); } catch (e) { /* ignore parsing error */ }
                    throw new Error(errorData.error || `Failed with status ${response.status}`);
                }

                const result = await response.json();
                logMessage(`Image "${imageName}" successfully processed by "Make 1:1 Ratio". Output: ${result.outputPath}`, 'success');

                if (mainImage) {
                    mainImage.src = `${API_BASE_URL}/image?folderPath=${encodeURIComponent(currentProjectServerPath)}&imageName=${encodeURIComponent(imageName)}&t=${new Date().getTime()}`;
                }
                const thumb = galleryGridContainer.querySelector(`img[data-index="${currentImageIndex}"]`);
                if (thumb) {
                    thumb.src = `${API_BASE_URL}/image?folderPath=${encodeURIComponent(currentProjectServerPath)}&imageName=${encodeURIComponent(imageName)}&t=${new Date().getTime()}`;
                }

            } catch (error) {
                logMessage(`Error during "Make 1:1 Ratio" for "${imageName}": ${error.message}`, 'error');
                alert(`Error processing image with "Make 1:1 Ratio": ${error.message}`);
            }
        });
    }

    // Event listener for "Downscale to Target" button
    if (downscaleButton) {
        downscaleButton.addEventListener('click', async () => {
            if (currentImageIndex === -1 || !imageFiles[currentImageIndex]) {
                logMessage('No image selected for "Downscale to Target".', 'error');
                alert('No image selected. Please select an image first.');
                return;
            }

            const imageName = imageFiles[currentImageIndex];
            logMessage(`"Downscale to Target" button clicked for "${imageName}" with target ${selectedSize}x${selectedSize}.`, 'info');

            try {
                const response = await fetch(`${API_BASE_URL}/downscale-to-target`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        folderPath: currentProjectServerPath,
                        imageName: imageName,
                        targetSize: selectedSize
                    })
                });

                if (!response.ok) {
                    let errorData = { error: `Server error: ${response.status}` };
                    try { errorData = await response.json(); } catch (e) { /* ignore parsing error */ }
                    // For specific user feedback on preconditions
                    if (response.status === 400) { // Bad Request, likely a precondition failure
                         logMessage(`Precondition failed for "Downscale to Target" on "${imageName}": ${errorData.error}`, 'error');
                         alert(`Could not downscale: ${errorData.error}`);
                         return; // Stop further generic error handling
                    }
                    throw new Error(errorData.error || `Failed with status ${response.status}`);
                }

                const result = await response.json();
                logMessage(`Image "${imageName}" successfully processed by "Downscale to Target". Output: ${result.outputPath}`, 'success');

                if (mainImage) {
                    mainImage.src = `${API_BASE_URL}/image?folderPath=${encodeURIComponent(currentProjectServerPath)}&imageName=${encodeURIComponent(imageName)}&t=${new Date().getTime()}`;
                }
                const thumb = galleryGridContainer.querySelector(`img[data-index="${currentImageIndex}"]`);
                if (thumb) {
                    thumb.src = `${API_BASE_URL}/image?folderPath=${encodeURIComponent(currentProjectServerPath)}&imageName=${encodeURIComponent(imageName)}&t=${new Date().getTime()}`;
                }

            } catch (error) {
                logMessage(`Error during "Downscale to Target" for "${imageName}": ${error.message}`, 'error');
                alert(`Error processing image with "Downscale to Target": ${error.message}`);
            }
        });
    }
    // --- End Image Processing Feature Logic ---

    if (closeTaggerButton) {
        closeTaggerButton.addEventListener('click', () => {
            logMessage("Main 'X' button clicked. Showing modal with confirmation.");
            showModalWithConfirmation();
        });
    }

    if (finalCloseButton) {
        finalCloseButton.addEventListener('click', () => {
            logMessage("Final close button clicked. Attempting to close window.");
            // Hide the modal first, so it's not visible if window.close() fails
            if (statsModal) {
                statsModal.style.display = 'none';
            }
            window.close();
            // Note: window.close() might not work in all browser contexts,
            // especially if the window wasn't opened by script.
        });
    }

    if (modalConfirmYesButton) {
        modalConfirmYesButton.addEventListener('click', () => {
            logMessage("'Yes' button clicked in modal confirmation.");
            populateAndShowStatsView();
        });
    }

    if (modalConfirmNoButton) {
        modalConfirmNoButton.addEventListener('click', () => {
            logMessage("'No' button clicked in modal confirmation. Hiding modal.");
            if (statsModal) {
                statsModal.style.display = 'none';
            }
        });
    }
});