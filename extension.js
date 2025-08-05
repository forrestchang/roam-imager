// Imager Extension - Help users manage images in Roam Research

const POPUP_ID = "imager-popup";
const LIGHTBOX_ID = "imager-lightbox";
let IMAGES_PER_ROW = 6; // Default images per row
let IMAGES_PER_PAGE = 50; // Default images per page

// Query all images from the graph
async function getImages() {
    try {
        console.log("Fetching images from graph...");
        
        // Query for blocks containing markdown images
        const query = `
            [:find ?uid ?string ?create-time ?page-title
             :where
             [?b :block/uid ?uid]
             [?b :block/string ?string]
             [(clojure.string/includes? ?string "![")]
             [?b :block/page ?page]
             [?page :node/title ?page-title]
             (or-join [?b ?create-time]
               (and [?b :create/time ?create-time])
               (and [(missing? $ ?b :create/time)]
                    [(ground 0) ?create-time]))]
        `;
        
        const results = await window.roamAlphaAPI.q(query);
        console.log(`Found ${results.length} blocks potentially containing images`);
        
        // Extract images from blocks - only markdown format ![]()
        const images = [];
        
        results.forEach(([uid, content, createTime, pageTitle]) => {
            // Match markdown images - including empty alt text like ![](url)
            const markdownRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
            let match;
            
            while ((match = markdownRegex.exec(content)) !== null) {
                const url = match[2];
                if (url) {
                    images.push({
                        uid,
                        url: url.trim(),
                        alt: match[1] || "Image",
                        createTime: createTime || Date.now(),
                        pageTitle: pageTitle || "Untitled"
                    });
                }
            }
        });
        
        // Sort by creation date (newest first)
        images.sort((a, b) => b.createTime - a.createTime);
        
        console.log(`Extracted ${images.length} unique images`);
        return images;
        
    } catch (error) {
        console.error("Error fetching images:", error);
        return [];
    }
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
    
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = imageAlt;
    img.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        box-shadow: 0 0 50px rgba(0, 0, 0, 0.5);
    `;
    
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
    
    // Close on Escape key
    const escHandler = (e) => {
        if (e.key === "Escape") {
            lightbox.remove();
            document.removeEventListener("keydown", escHandler);
        }
    };
    document.addEventListener("keydown", escHandler);
    
    lightbox.appendChild(img);
    lightbox.appendChild(closeBtn);
    document.body.appendChild(lightbox);
}

// Create image grid
function createImageGrid(images, page, container) {
    container.innerHTML = "";
    
    // Store data for refresh
    container.dataset.images = JSON.stringify(images);
    container.dataset.currentPage = page;
    
    const startIdx = (page - 1) * IMAGES_PER_PAGE;
    const endIdx = Math.min(startIdx + IMAGES_PER_PAGE, images.length);
    const pageImages = images.slice(startIdx, endIdx);
    
    // Create grid container
    const grid = document.createElement("div");
    const minWidth = Math.floor(1000 / IMAGES_PER_ROW) - 20; // Calculate min width based on images per row
    grid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(${IMAGES_PER_ROW}, 1fr);
        gap: 16px;
        padding: 20px;
    `;
    
    pageImages.forEach(image => {
        const imageContainer = document.createElement("div");
        imageContainer.style.cssText = `
            position: relative;
            background: #f0f0f0;
            border-radius: 8px;
            overflow: hidden;
            cursor: zoom-in;
            transition: transform 0.2s;
            aspect-ratio: 1;
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
            height: 100%;
            object-fit: cover;
        `;
        
        img.onerror = () => {
            img.style.display = "none";
            const placeholder = document.createElement("div");
            placeholder.style.cssText = `
                width: 100%;
                height: 100%;
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
            <div style="opacity: 0.7; font-size: 11px;">${new Date(image.createTime).toLocaleDateString()}</div>
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
        grid.appendChild(imageContainer);
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
    
    // Header
    const header = document.createElement("div");
    header.className = "bp3-dialog-header";
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 24px;
        border-bottom: 1px solid #e0e0e0;
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
    
    configSection.appendChild(rowConfig);
    configSection.appendChild(pageConfig);
    
    leftSection.appendChild(title);
    leftSection.appendChild(configSection);
    
    const closeBtn = document.createElement("button");
    closeBtn.className = "bp3-button bp3-minimal bp3-icon-cross";
    closeBtn.onclick = () => overlay.remove();
    
    header.appendChild(leftSection);
    header.appendChild(closeBtn);
    
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
        align-items: center;
        justify-content: center;
        height: 200px;
        color: #666;
    `;
    loading.textContent = "Loading images...";
    content.appendChild(loading);
    
    popup.appendChild(header);
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
        // Check if popup already exists
        if (document.getElementById(POPUP_ID)) return;
        
        const { overlay, content } = createPopup();
        document.body.appendChild(overlay);
        
        // Load images
        const images = await getImages();
        
        if (images.length === 0) {
            content.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 200px; color: #666;">
                    No images found in your graph
                </div>
            `;
        } else {
            createImageGrid(images, 1, content);
        }
    };
    
    return button;
}

// Show image gallery
async function showImageGallery() {
    if (document.getElementById(POPUP_ID)) return;
    
    const { overlay, content } = createPopup();
    document.body.appendChild(overlay);
    
    const images = await getImages();
    
    if (images.length === 0) {
        content.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 200px; color: #666;">
                No images found in your graph
            </div>
        `;
    } else {
        createImageGrid(images, 1, content);
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