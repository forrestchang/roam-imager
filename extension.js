// Imager Extension - Help users manage images in Roam Research

const POPUP_ID = "imager-popup";
const LIGHTBOX_ID = "imager-lightbox";
let IMAGES_PER_ROW = 6; // Default images per row
let IMAGES_PER_PAGE = 50; // Default images per page
let SORT_ORDER = 'newest'; // Default sort order: 'newest', 'oldest', 'page-alpha', 'page-reverse'

// Get parent and child blocks content for a given block uid
async function getBlockContext(uid) {
    try {
        // Query for parent block
        const parentQuery = `
            [:find ?parent-string
             :where
             [?b :block/uid "${uid}"]
             [?b :block/parents ?parent]
             [?parent :block/string ?parent-string]]
        `;
        
        // Query for child blocks
        const childrenQuery = `
            [:find ?child-string
             :where
             [?b :block/uid "${uid}"]
             [?b :block/children ?child]
             [?child :block/string ?child-string]]
        `;
        
        // Query for sibling blocks (previous and next)
        const siblingsQuery = `
            [:find ?sibling-string ?sibling-order
             :where
             [?b :block/uid "${uid}"]
             [?b :block/order ?current-order]
             [?parent :block/children ?b]
             [?parent :block/children ?sibling]
             [?sibling :block/order ?sibling-order]
             [?sibling :block/string ?sibling-string]
             [(not= ?b ?sibling)]
             [(>= ?sibling-order (- ?current-order 1))]
             [(<= ?sibling-order (+ ?current-order 1))]]
        `;
        
        const parentResults = await window.roamAlphaAPI.q(parentQuery);
        const childrenResults = await window.roamAlphaAPI.q(childrenQuery);
        const siblingsResults = await window.roamAlphaAPI.q(siblingsQuery);
        
        const parentContent = parentResults.map(([content]) => content).join(' ');
        const childrenContent = childrenResults.map(([content]) => content).join(' ');
        const siblingsContent = siblingsResults.map(([content]) => content).join(' ');
        
        return { parentContent, childrenContent, siblingsContent };
    } catch (error) {
        console.error(`Error fetching context for block ${uid}:`, error);
        return { parentContent: '', childrenContent: '', siblingsContent: '' };
    }
}

// Get just the UIDs of blocks containing images (very fast)
async function getImageBlockUids() {
    try {
        console.log("Getting image block UIDs...");
        
        const query = `
            [:find ?uid ?create-time
             :where
             [?b :block/uid ?uid]
             [?b :block/string ?string]
             [(clojure.string/includes? ?string "![")]
             (or-join [?b ?create-time]
               (and [?b :create/time ?create-time])
               (and [(missing? $ ?b :create/time)]
                    [(ground 0) ?create-time]))]
        `;
        
        const results = await window.roamAlphaAPI.q(query);
        console.log(`Found ${results.length} blocks potentially containing images`);
        
        // Sort by creation date (newest first)
        results.sort((a, b) => (b[1] || 0) - (a[1] || 0));
        
        return results;
    } catch (error) {
        console.error("Error fetching image UIDs:", error);
        return [];
    }
}

// Process a batch of UIDs to extract images
async function processImageBatch(uidBatch) {
    const images = [];
    
    for (const [uid, createTime] of uidBatch) {
        try {
            // Get block content
            const blockQuery = `
                [:find ?string ?page-title
                 :where
                 [?b :block/uid "${uid}"]
                 [?b :block/string ?string]
                 [?b :block/page ?page]
                 [?page :node/title ?page-title]]
            `;
            
            const blockResult = await window.roamAlphaAPI.q(blockQuery);
            if (blockResult.length > 0) {
                const [content, pageTitle] = blockResult[0];
                
                // Extract images from content
                const markdownRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                let match;
                
                while ((match = markdownRegex.exec(content)) !== null) {
                    const url = match[2];
                    if (url) {
                        // Filter out images from mmbiz.qpic.cn domain
                        const trimmedUrl = url.trim();
                        if (!trimmedUrl.includes('mmbiz.qpic.cn')) {
                            images.push({
                                uid,
                                url: trimmedUrl,
                                alt: match[1] || "Image",
                                createTime: createTime > 0 ? createTime : null,
                                pageTitle: pageTitle || "Untitled",
                                blockContent: content,
                                parentContent: '',
                                childrenContent: '',
                                siblingsContent: '',
                                searchableContent: `${content} ${pageTitle}`.toLowerCase(),
                                contextLoaded: false
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing UID ${uid}:`, error);
        }
    }
    
    return images;
}

// Enhance images with context data progressively
async function enhanceImagesWithContext(images, onProgress) {
    const batchSize = 10; // Process 10 images at a time
    
    for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, Math.min(i + batchSize, images.length));
        
        // Process batch in parallel
        await Promise.all(batch.map(async (image) => {
            if (!image.contextLoaded) {
                const { parentContent, childrenContent, siblingsContent } = await getBlockContext(image.uid);
                image.parentContent = parentContent;
                image.childrenContent = childrenContent;
                image.siblingsContent = siblingsContent;
                image.searchableContent = `${image.blockContent} ${parentContent} ${childrenContent} ${siblingsContent} ${image.pageTitle}`.toLowerCase();
                image.contextLoaded = true;
            }
        }));
        
        // Call progress callback
        if (onProgress) {
            onProgress(Math.min(i + batchSize, images.length), images.length);
        }
    }
    
    return images;
}

// Sort images based on selected criteria
function sortImages(images, sortOrder) {
    const sorted = [...images];
    
    switch (sortOrder) {
        case 'newest':
            // Sort by creation time, newest first
            // Put items with no timestamp at the end
            sorted.sort((a, b) => {
                if (a.createTime === null && b.createTime === null) return 0;
                if (a.createTime === null) return 1;
                if (b.createTime === null) return -1;
                return b.createTime - a.createTime;
            });
            break;
        case 'oldest':
            // Sort by creation time, oldest first
            // Put items with no timestamp at the end
            sorted.sort((a, b) => {
                if (a.createTime === null && b.createTime === null) return 0;
                if (a.createTime === null) return 1;
                if (b.createTime === null) return -1;
                return a.createTime - b.createTime;
            });
            break;
        case 'page-alpha':
            // Sort by page title alphabetically
            sorted.sort((a, b) => a.pageTitle.localeCompare(b.pageTitle));
            break;
        case 'page-reverse':
            // Sort by page title reverse alphabetically
            sorted.sort((a, b) => b.pageTitle.localeCompare(a.pageTitle));
            break;
        default:
            // Default to newest first
            sorted.sort((a, b) => {
                if (a.createTime === null && b.createTime === null) return 0;
                if (a.createTime === null) return 1;
                if (b.createTime === null) return -1;
                return b.createTime - a.createTime;
            });
    }
    
    return sorted;
}

// Create lightbox for zoomed image view
function createLightbox(imageUrl, imageAlt) {
    // Remove existing lightbox if any
    const existing = document.getElementById(LIGHTBOX_ID);
    if (existing) existing.remove();
    
    const lightbox = document.createElement("div");
    lightbox.id = LIGHTBOX_ID;
    lightbox.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        cursor: zoom-out;
        padding: 40px;
    `;
    
    // Container for image and copy button
    const contentContainer = document.createElement("div");
    contentContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        max-width: 90%;
        max-height: 90%;
    `;
    
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = imageAlt;
    img.style.cssText = `
        max-width: 100%;
        max-height: calc(100% - 60px);
        object-fit: contain;
        box-shadow: 0 0 50px rgba(0, 0, 0, 0.5);
        cursor: default;
    `;
    
    // Copy to clipboard button
    const copyBtn = document.createElement("button");
    copyBtn.className = "bp3-button bp3-intent-primary";
    copyBtn.innerHTML = '<span class="bp3-icon bp3-icon-duplicate"></span> Copy Image to Clipboard';
    copyBtn.style.cssText = `
        background: rgba(255, 255, 255, 0.9);
        color: #106ba3;
        font-weight: 500;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
    `;
    
    copyBtn.onmouseover = () => {
        copyBtn.style.background = "rgba(255, 255, 255, 1)";
        copyBtn.style.transform = "scale(1.05)";
    };
    
    copyBtn.onmouseout = () => {
        copyBtn.style.background = "rgba(255, 255, 255, 0.9)";
        copyBtn.style.transform = "scale(1)";
    };
    
    copyBtn.onclick = async (e) => {
        e.stopPropagation();
        
        try {
            // Fetch the image and convert to blob
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            
            // Create clipboard item
            const clipboardItem = new ClipboardItem({
                [blob.type]: blob
            });
            
            // Copy to clipboard
            await navigator.clipboard.write([clipboardItem]);
            
            // Show success feedback
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = '<span class="bp3-icon bp3-icon-tick"></span> Copied!';
            copyBtn.style.background = "#0f9960";
            copyBtn.style.color = "white";
            
            setTimeout(() => {
                copyBtn.innerHTML = originalText;
                copyBtn.style.background = "rgba(255, 255, 255, 0.9)";
                copyBtn.style.color = "#106ba3";
            }, 2000);
        } catch (error) {
            console.error("Failed to copy image:", error);
            
            // Show error feedback
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = '<span class="bp3-icon bp3-icon-error"></span> Copy failed';
            copyBtn.style.background = "#db3737";
            copyBtn.style.color = "white";
            
            setTimeout(() => {
                copyBtn.innerHTML = originalText;
                copyBtn.style.background = "rgba(255, 255, 255, 0.9)";
                copyBtn.style.color = "#106ba3";
            }, 2000);
        }
    };
    
    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "bp3-button bp3-minimal bp3-icon-cross";
    closeBtn.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        color: white;
        font-size: 24px;
    `;
    closeBtn.onclick = () => lightbox.remove();
    
    // Close on background click
    lightbox.onclick = (e) => {
        if (e.target === lightbox) {
            lightbox.remove();
        }
    };
    
    // Prevent closing when clicking on image or copy button
    contentContainer.onclick = (e) => {
        e.stopPropagation();
    };
    
    // Close on Escape key
    const escHandler = (e) => {
        if (e.key === "Escape") {
            lightbox.remove();
            document.removeEventListener("keydown", escHandler);
        }
    };
    document.addEventListener("keydown", escHandler);
    
    contentContainer.appendChild(img);
    contentContainer.appendChild(copyBtn);
    lightbox.appendChild(contentContainer);
    lightbox.appendChild(closeBtn);
    document.body.appendChild(lightbox);
}

// Create image grid
function createImageGrid(images, page, container, allImages = null) {
    container.innerHTML = "";
    
    // Store data for refresh
    container.dataset.images = JSON.stringify(images);
    container.dataset.currentPage = page;
    
    // Store all images if provided (for search functionality)
    if (allImages) {
        container.dataset.allImages = JSON.stringify(allImages);
    }
    
    const startIdx = (page - 1) * IMAGES_PER_PAGE;
    const endIdx = Math.min(startIdx + IMAGES_PER_PAGE, images.length);
    const pageImages = images.slice(startIdx, endIdx);
    
    // Create masonry container with flexbox
    const grid = document.createElement("div");
    grid.style.cssText = `
        display: flex;
        gap: 16px;
        padding: 20px;
        align-items: flex-start;
    `;
    
    // Create columns for masonry
    const columns = [];
    for (let i = 0; i < IMAGES_PER_ROW; i++) {
        const column = document.createElement("div");
        column.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 16px;
        `;
        columns.push(column);
        grid.appendChild(column);
    }
    
    // Track the estimated height of each column
    const columnHeights = new Array(IMAGES_PER_ROW).fill(0);
    
    pageImages.forEach((image, idx) => {
        // Find the shortest column
        let minHeight = columnHeights[0];
        let targetColumn = 0;
        for (let i = 1; i < IMAGES_PER_ROW; i++) {
            if (columnHeights[i] < minHeight) {
                minHeight = columnHeights[i];
                targetColumn = i;
            }
        }
        
        const imageContainer = document.createElement("div");
        imageContainer.style.cssText = `
            position: relative;
            background: #f0f0f0;
            border-radius: 8px;
            overflow: hidden;
            cursor: zoom-in;
            transition: transform 0.2s;
            width: 100%;
        `;
        
        imageContainer.onmouseover = () => {
            imageContainer.style.transform = "scale(1.02)";
        };
        
        imageContainer.onmouseout = () => {
            imageContainer.style.transform = "scale(1)";
        };
        
        const img = document.createElement("img");
        img.src = image.url;
        img.alt = image.alt;
        img.style.cssText = `
            width: 100%;
            height: auto;
            display: block;
        `;
        
        img.onerror = () => {
            img.style.display = "none";
            const placeholder = document.createElement("div");
            placeholder.style.cssText = `
                width: 100%;
                height: 200px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #e0e0e0;
                color: #666;
                font-size: 14px;
                text-align: center;
                padding: 8px;
            `;
            placeholder.textContent = "Image not found";
            imageContainer.appendChild(placeholder);
        };
        
        // Click to zoom
        imageContainer.onclick = (e) => {
            e.stopPropagation();
            createLightbox(image.url, image.alt);
        };
        
        // Add hover info with navigation button
        const info = document.createElement("div");
        info.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px;
            font-size: 12px;
            transform: translateY(100%);
            transition: transform 0.2s;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        
        const infoText = document.createElement("div");
        infoText.style.cssText = "flex: 1; overflow: hidden;";
        infoText.innerHTML = `
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">${image.pageTitle}</div>
            <div style="opacity: 0.7; font-size: 11px;">${image.createTime ? new Date(image.createTime).toLocaleDateString() : 'No date'}</div>
        `;
        
        const navButton = document.createElement("button");
        navButton.className = "bp3-button bp3-minimal bp3-small";
        navButton.innerHTML = '<span class="bp3-icon bp3-icon-arrow-right"></span>';
        navButton.style.cssText = "color: white; padding: 4px;";
        navButton.title = "Go to source block";
        navButton.onclick = (e) => {
            e.stopPropagation();
            window.roamAlphaAPI.ui.mainWindow.openBlock({
                block: { uid: image.uid }
            });
        };
        
        info.appendChild(infoText);
        info.appendChild(navButton);
        
        imageContainer.onmouseover = () => {
            info.style.transform = "translateY(0)";
            imageContainer.style.transform = "scale(1.02)";
        };
        
        imageContainer.onmouseout = () => {
            info.style.transform = "translateY(100%)";
            imageContainer.style.transform = "scale(1)";
        };
        
        imageContainer.appendChild(img);
        imageContainer.appendChild(info);
        
        // Add to the selected column
        columns[targetColumn].appendChild(imageContainer);
        
        // Estimate the height this image will take (can be refined with actual image dimensions)
        // Using a rough estimate: most images are between 200-400px tall
        columnHeights[targetColumn] += 300;
    });
    
    container.appendChild(grid);
    
    // Create pagination controls
    if (images.length > IMAGES_PER_PAGE) {
        const totalPages = Math.ceil(images.length / IMAGES_PER_PAGE);
        const pagination = document.createElement("div");
        pagination.style.cssText = `
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            padding: 16px;
            border-top: 1px solid #e0e0e0;
        `;
        
        // Previous button
        const prevBtn = document.createElement("button");
        prevBtn.className = "bp3-button bp3-minimal";
        prevBtn.textContent = "Previous";
        prevBtn.disabled = page === 1;
        prevBtn.onclick = () => createImageGrid(images, page - 1, container);
        
        // Page info
        const pageInfo = document.createElement("span");
        pageInfo.textContent = `Page ${page} of ${totalPages} (${images.length} images)`;
        pageInfo.style.cssText = "color: #666; font-size: 14px;";
        
        // Next button
        const nextBtn = document.createElement("button");
        nextBtn.className = "bp3-button bp3-minimal";
        nextBtn.textContent = "Next";
        nextBtn.disabled = page === totalPages;
        nextBtn.onclick = () => createImageGrid(images, page + 1, container);
        
        pagination.appendChild(prevBtn);
        pagination.appendChild(pageInfo);
        pagination.appendChild(nextBtn);
        
        container.appendChild(pagination);
    }
}

// Create the image gallery popup
function createPopup() {
    const overlay = document.createElement("div");
    overlay.id = POPUP_ID;
    overlay.className = "bp3-overlay bp3-overlay-open";
    overlay.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1000;
        padding: 20px;
    `;
    
    const popup = document.createElement("div");
    popup.className = "imager-popup bp3-dialog";
    popup.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 0;
        width: 90%;
        max-width: 1200px;
        height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    `;
    
    // Header container for both rows
    const headerContainer = document.createElement("div");
    headerContainer.style.cssText = `
        border-bottom: 1px solid #e0e0e0;
    `;
    
    // First row - Title, config options, and close button
    const header = document.createElement("div");
    header.className = "bp3-dialog-header";
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 24px 8px 24px;
        border-bottom: none;
    `;
    
    const leftSection = document.createElement("div");
    leftSection.style.cssText = "display: flex; align-items: center; gap: 20px;";
    
    const title = document.createElement("h3");
    title.textContent = "Image Gallery";
    title.style.margin = "0";
    
    // Add configuration controls
    const configSection = document.createElement("div");
    configSection.style.cssText = "display: flex; align-items: center; gap: 20px; font-size: 14px;";
    
    // Images per row selector
    const rowConfig = document.createElement("div");
    rowConfig.style.cssText = "display: flex; align-items: center; gap: 8px;";
    
    const rowLabel = document.createElement("span");
    rowLabel.textContent = "Images per row:";
    rowLabel.style.color = "#5c7080";
    
    const rowSelector = document.createElement("select");
    rowSelector.className = "bp3-select";
    
    [3, 4, 5, 6, 8, 10].forEach(num => {
        const option = document.createElement("option");
        option.value = num;
        option.textContent = num;
        if (num === IMAGES_PER_ROW) option.selected = true;
        rowSelector.appendChild(option);
    });
    
    rowSelector.onchange = (e) => {
        IMAGES_PER_ROW = parseInt(e.target.value);
        // Store preference
        localStorage.setItem('imager-images-per-row', IMAGES_PER_ROW);
        // Refresh the grid
        if (content.dataset.images) {
            const images = JSON.parse(content.dataset.images);
            const currentPage = parseInt(content.dataset.currentPage) || 1;
            createImageGrid(images, currentPage, content);
        }
    };
    
    rowConfig.appendChild(rowLabel);
    rowConfig.appendChild(rowSelector);
    
    // Images per page selector
    const pageConfig = document.createElement("div");
    pageConfig.style.cssText = "display: flex; align-items: center; gap: 8px;";
    
    const pageLabel = document.createElement("span");
    pageLabel.textContent = "Images per page:";
    pageLabel.style.color = "#5c7080";
    
    const pageSelector = document.createElement("select");
    pageSelector.className = "bp3-select";
    
    [20, 30, 50, 100, 200].forEach(num => {
        const option = document.createElement("option");
        option.value = num;
        option.textContent = num;
        if (num === IMAGES_PER_PAGE) option.selected = true;
        pageSelector.appendChild(option);
    });
    
    pageSelector.onchange = (e) => {
        IMAGES_PER_PAGE = parseInt(e.target.value);
        // Store preference
        localStorage.setItem('imager-images-per-page', IMAGES_PER_PAGE);
        // Refresh the grid
        if (content.dataset.images) {
            const images = JSON.parse(content.dataset.images);
            createImageGrid(images, 1, content); // Reset to page 1
        }
    };
    
    pageConfig.appendChild(pageLabel);
    pageConfig.appendChild(pageSelector);
    
    // Sort order selector
    const sortConfig = document.createElement("div");
    sortConfig.style.cssText = "display: flex; align-items: center; gap: 8px;";
    
    const sortLabel = document.createElement("span");
    sortLabel.textContent = "Sort by:";
    sortLabel.style.color = "#5c7080";
    
    const sortSelector = document.createElement("select");
    sortSelector.className = "bp3-select";
    
    const sortOptions = [
        { value: 'newest', text: 'Newest First' },
        { value: 'oldest', text: 'Oldest First' },
        { value: 'page-alpha', text: 'Page Title (A-Z)' },
        { value: 'page-reverse', text: 'Page Title (Z-A)' }
    ];
    
    sortOptions.forEach(opt => {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.text;
        if (opt.value === SORT_ORDER) option.selected = true;
        sortSelector.appendChild(option);
    });
    
    sortSelector.onchange = (e) => {
        SORT_ORDER = e.target.value;
        // Store preference
        localStorage.setItem('imager-sort-order', SORT_ORDER);
        // Re-sort and refresh the grid
        if (content.dataset.allImages) {
            const allImages = JSON.parse(content.dataset.allImages);
            const sortedImages = sortImages(allImages, SORT_ORDER);
            content.dataset.allImages = JSON.stringify(sortedImages);
            content.dataset.images = JSON.stringify(sortedImages);
            createImageGrid(sortedImages, 1, content, sortedImages);
        }
    };
    
    sortConfig.appendChild(sortLabel);
    sortConfig.appendChild(sortSelector);
    
    configSection.appendChild(rowConfig);
    configSection.appendChild(pageConfig);
    configSection.appendChild(sortConfig);
    
    leftSection.appendChild(title);
    leftSection.appendChild(configSection);
    
    const closeBtn = document.createElement("button");
    closeBtn.className = "bp3-button bp3-minimal bp3-icon-cross";
    closeBtn.onclick = () => overlay.remove();
    
    header.appendChild(leftSection);
    header.appendChild(closeBtn);
    
    // Second row - Search bar
    const searchRow = document.createElement("div");
    searchRow.style.cssText = `
        padding: 8px 24px 16px 24px;
        display: flex;
        align-items: center;
    `;
    
    const searchInput = document.createElement("input");
    searchInput.className = "bp3-input bp3-large";
    searchInput.type = "text";
    searchInput.placeholder = "Loading images... Search will be available soon";
    searchInput.style.cssText = "width: 100%; opacity: 0.6;";
    searchInput.disabled = true; // Start disabled
    searchInput.id = "imager-search-input";
    
    searchInput.oninput = (e) => {
        const searchTerm = e.target.value.toLowerCase();
        if (content.dataset.allImages) {
            const allImages = JSON.parse(content.dataset.allImages);
            let filteredImages = searchTerm 
                ? allImages.filter(img => img.searchableContent.includes(searchTerm))
                : allImages;
            
            // Apply current sort order to filtered results
            filteredImages = sortImages(filteredImages, SORT_ORDER);
            
            // Update displayed images
            content.dataset.images = JSON.stringify(filteredImages);
            createImageGrid(filteredImages, 1, content);
        }
    };
    
    searchRow.appendChild(searchInput);
    
    // Assemble the header container
    headerContainer.appendChild(header);
    headerContainer.appendChild(searchRow);
    
    // Content area
    const content = document.createElement("div");
    content.className = "bp3-dialog-body";
    content.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 0;
    `;
    
    // Loading indicator
    const loading = document.createElement("div");
    loading.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: #666;
        gap: 10px;
    `;
    loading.innerHTML = `
        <div>Loading images...</div>
        <div style="font-size: 12px; opacity: 0.7;">Fetching image blocks and their context</div>
    `;
    content.appendChild(loading);
    
    popup.appendChild(headerContainer);
    popup.appendChild(content);
    overlay.appendChild(popup);
    
    // Close on overlay click
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    };
    
    // Close on Escape key
    document.addEventListener("keydown", function escHandler(e) {
        if (e.key === "Escape" && document.getElementById(POPUP_ID)) {
            overlay.remove();
            document.removeEventListener("keydown", escHandler);
        }
    });
    
    return { overlay, content };
}

// Create topbar button
function createTopbarButton() {
    const button = document.createElement("button");
    button.id = "imager-button";
    button.className = "bp3-button bp3-minimal bp3-icon-media";
    button.title = "Image Gallery";
    button.style.cssText = "margin: 0 4px;";
    
    button.onclick = async () => {
        showImageGallery();
    };
    
    return button;
}

// Show image gallery
async function showImageGallery() {
    if (document.getElementById(POPUP_ID)) return;
    
    const { overlay, content } = createPopup();
    document.body.appendChild(overlay);
    
    // Get just the UIDs first (very fast)
    const imageUids = await getImageBlockUids();
    
    if (imageUids.length === 0) {
        content.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 200px; color: #666;">
                No images found in your graph
            </div>
        `;
        return;
    }
    
    // Process first batch immediately to show something
    const firstBatchSize = Math.min(50, imageUids.length); // Show first 50 images immediately
    const firstBatch = imageUids.slice(0, firstBatchSize);
    const remainingUids = imageUids.slice(firstBatchSize);
    
    // Process first batch
    const firstImages = await processImageBatch(firstBatch);
    let allImages = [...firstImages];
    
    // Apply initial sorting
    allImages = sortImages(allImages, SORT_ORDER);
    
    // Show first images immediately
    createImageGrid(allImages, 1, content, allImages);
    
    // Add loading indicator for remaining images
    if (remainingUids.length > 0) {
        const loadingInfo = document.createElement("div");
        loadingInfo.style.cssText = `
            position: absolute;
            top: 60px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 100;
        `;
        loadingInfo.textContent = `Loading ${firstImages.length} of ${imageUids.length} images...`;
        overlay.appendChild(loadingInfo);
        
        // Process remaining images in background
        const batchSize = 50;
        let processed = firstBatchSize;
        
        for (let i = 0; i < remainingUids.length; i += batchSize) {
            const batch = remainingUids.slice(i, Math.min(i + batchSize, remainingUids.length));
            const newImages = await processImageBatch(batch);
            
            // Add new images to the array
            allImages.push(...newImages);
            processed += batch.length;
            
            // Re-sort all images with current sort order
            allImages = sortImages(allImages, SORT_ORDER);
            
            // Update loading info
            loadingInfo.textContent = `Loading ${allImages.length} of ${imageUids.length} images...`;
            
            // Update the grid if we're on page 1
            const currentPage = parseInt(content.dataset.currentPage) || 1;
            if (currentPage === 1) {
                createImageGrid(allImages, 1, content, allImages);
            } else {
                // Just update the stored data
                content.dataset.allImages = JSON.stringify(allImages);
                content.dataset.images = JSON.stringify(allImages);
            }
            
            // Small delay to prevent UI blocking
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // Remove loading indicator
        loadingInfo.remove();
        
        // Enable search after all images are loaded
        const searchInput = document.getElementById('imager-search-input');
        if (searchInput) {
            searchInput.disabled = false;
            searchInput.placeholder = "Search images...";
            searchInput.style.opacity = "1";
        }
        
        // Now enhance with context in background (optional, lower priority)
        enhanceImagesWithContext(allImages, (processed, total) => {
            // Update the stored data silently
            if (content.dataset.allImages) {
                content.dataset.allImages = JSON.stringify(allImages);
            }
        });
    } else {
        // If no remaining images, enable search immediately
        const searchInput = document.getElementById('imager-search-input');
        if (searchInput) {
            searchInput.disabled = false;
            searchInput.placeholder = "Search images...";
            searchInput.style.opacity = "1";
        }
    }
}

// Main extension object
export default {
    onload: ({ extensionAPI }) => {
        console.log("Imager extension loading...");
        
        // Load saved preferences
        const savedImagesPerRow = localStorage.getItem('imager-images-per-row');
        if (savedImagesPerRow) {
            IMAGES_PER_ROW = parseInt(savedImagesPerRow);
        }
        
        const savedImagesPerPage = localStorage.getItem('imager-images-per-page');
        if (savedImagesPerPage) {
            IMAGES_PER_PAGE = parseInt(savedImagesPerPage);
        }
        
        const savedSortOrder = localStorage.getItem('imager-sort-order');
        if (savedSortOrder) {
            SORT_ORDER = savedSortOrder;
        }
        
        // Register command palette command
        extensionAPI.settings.panel.create({
            tabTitle: "Imager",
            settings: [{
                id: "imager-command",
                name: "Open Image Gallery",
                description: "View all images in your graph",
                action: {
                    type: "button",
                    onClick: showImageGallery
                }
            }]
        });
        
        // Add command to command palette
        window.roamAlphaAPI.ui.commandPalette.addCommand({
            label: "Open Image Gallery",
            callback: showImageGallery
        });
        
        // Add topbar button
        const topbar = document.querySelector(".rm-topbar");
        if (topbar) {
            const button = createTopbarButton();
            
            // Find the right place to insert
            const graphIcon = topbar.querySelector(".bp3-icon-graph");
            if (graphIcon && graphIcon.parentElement) {
                graphIcon.parentElement.insertAdjacentElement('afterend', button);
            } else {
                topbar.appendChild(button);
            }
            
            console.log("Imager button added to topbar");
        }
        
        console.log("Imager extension loaded successfully");
    },
    
    onunload: () => {
        console.log("Imager extension unloading...");
        
        // Remove topbar button
        const button = document.getElementById("imager-button");
        if (button) {
            button.remove();
        }
        
        // Remove popup if open
        const popup = document.getElementById(POPUP_ID);
        if (popup) {
            popup.remove();
        }
        
        // Remove lightbox if open
        const lightbox = document.getElementById(LIGHTBOX_ID);
        if (lightbox) {
            lightbox.remove();
        }
        
        console.log("Imager extension unloaded");
    }
};