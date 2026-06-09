// ========================================================
// 1. SYSTEM PROMPTS 
// ========================================================
const hololiveSystemPrompt = `You are an expert translator for the Hololive Official Card Game. 
Translate the provided Japanese card text into English. 
You MUST adhere to the following official game glossary:
- Translate the energy resource as "Cheer" (do not use "Yell").
- Capitalize official mechanics: "Bloom", "Collab", "Arts", and "Oshi Skill".
- Ensure card types strictly match one of the following: "Oshi", "Holomem", "Support", or "Cheer".

Return the translation strictly as valid JSON matching this schema:
{
  "card_name": "String",
  "card_type": "String",
  "bloom_level": "String (e.g., 'Debut', '1st', '2nd', 'Spot' or null if not applicable)",
  "card_id": "String (e.g., 'hBP01-001' usually found at bottom right, or null)",
  "hp": "Number or null",
  "arts_text": "String or null",
  "skills_text": "String or null"
}`;

// ========================================================
// 2. HELPER FUNCTIONS & API CONNECTOR
// ========================================================
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
  });
}

function generateThumbnail(base64Image) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const size = 64; 
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            
            const scale = Math.max(size / img.width, size / img.height);
            const x = (size / scale - img.width) / 2;
            const y = (size / scale - img.height) / 2;
            
            ctx.scale(scale, scale);
            ctx.drawImage(img, x, y);
            
            resolve(canvas.toDataURL('image/jpeg', 0.4));
        };
        img.src = "data:image/jpeg;base64," + base64Image;
    });
}

// ── DYNAMIC SKILL PARSER ──
function parseSkillText(rawText) {
    // Safety string conversion to prevent crashes on bad data
    let skillText = rawText ? String(rawText) : "None";

    // 👉 THE FIX: Convert angle brackets to safe HTML entities right away
    skillText = skillText.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    let labelText = "Card Effect";
    let labelBg = "var(--holo-blue)";
    let isNone = false;

    if (skillText.includes("Bloom Effect") || skillText.includes("Bloom effect")) {
        labelText = "Bloom Effect";
        labelBg = "var(--holo-blue)";
        skillText = skillText.replace(/Bloom [Ee]ffect:?\s*/, '').trim();
    } else if (skillText.includes("Collab Effect") || skillText.includes("Collab effect")) {
        labelText = "Collab Effect";
        labelBg = "var(--holo-rose)";
        skillText = skillText.replace(/Collab [Ee]ffect:?\s*/, '').trim();
    } else if (skillText.includes("Gift")) {
        labelText = "Gift";
        labelBg = "var(--holo-teal)";
        skillText = skillText.replace(/Gift:?\s*/, '').trim();
    } else if (skillText !== "None" && skillText.trim() !== "" && skillText !== "-") {
        labelText = "Auto / Card Effect";
        labelBg = "var(--holo-orange)";
    } else {
        isNone = true;
    }

    return { skillText, labelText, labelBg, isNone };
}

async function translateCard(cardText, imageBase64, systemPrompt) {
    const workerUrl = "https://holomtg-translator.siusprass.workers.dev";
  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        textToTranslate: cardText || "Translate the rules text visible on this card image.",
        imageBase64: imageBase64,
        systemInstruction: systemPrompt
      })
    });
    const result = await response.json();
    if (result.error) return null; 
    
    let cleanJsonText = result.candidates[0].content.parts[0].text.trim();
    cleanJsonText = cleanJsonText.split("```json").join("").split("```").join("").trim();
    
    return JSON.parse(cleanJsonText);
  } catch (error) {
    return null;
  }
}

// ========================================================
// 3. HISTORY MANAGEMENT (LOCAL STORAGE)
// ========================================================
const MAX_HISTORY = 20;

function getHistory() {
    const saved = localStorage.getItem('ocgScannerHistory');
    return saved ? JSON.parse(saved) : [];
}

async function saveToHistory(cardData, originalBase64) {
    if (!cardData || !cardData.card_name || cardData.card_name.toLowerCase() === "unknown card") return;

    const thumbnail = originalBase64 ? await generateThumbnail(originalBase64) : null;
    cardData.thumbnail = thumbnail;

    let history = getHistory();
    history.unshift(cardData);
    
    if (history.length > MAX_HISTORY) {
        history = history.slice(0, MAX_HISTORY);
    }
    localStorage.setItem('ocgScannerHistory', JSON.stringify(history));
    renderHistory();
}

function deleteHistoryItem(index) {
    let history = getHistory();
    history.splice(index, 1);
    localStorage.setItem('ocgScannerHistory', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    const container = document.getElementById("history-container");
    const history = getHistory();
    const clearBtn = document.getElementById("clear-history-btn");

    if (!container) return; 

    if (history.length === 0) {
        container.innerHTML = `<div class="history-empty">No recent scans yet. Your last 20 cards will appear here.</div>`;
        if (clearBtn) clearBtn.style.display = "none";
        return;
    }

    if (clearBtn) clearBtn.style.display = "block";
    container.innerHTML = ""; 

    history.forEach((card, index) => {
        const type = card.card_type || "Type";
        const hp = card.hp ? ` | HP: ${card.hp}` : "";
        const level = card.bloom_level ? `[${card.bloom_level}] ` : "";
        const id = card.card_id ? ` • ${card.card_id}` : "";
        
        const imgTag = card.thumbnail 
            ? `<img src="${card.thumbnail}" class="history-thumb" alt="thumb"/>` 
            : `<div class="history-thumb" style="background:#333;"></div>`;

        const parsedSkill = parseSkillText(card.skills_text);
        const skillHtml = parsedSkill.isNone ? "" : `
            <div class="result-item item-skills">
                <div class="result-label" style="color: ${parsedSkill.labelBg}; font-weight:800; font-size:0.85rem; text-transform:uppercase;">${parsedSkill.labelText}</div>
                <div class="result-value">${parsedSkill.skillText}</div>
            </div>
        `;

        const itemHTML = `
            <div class="history-item">
                <button class="accordion-btn">
                    <div class="accordion-title-area">
                        ${imgTag}
                        <div>
                            <div>${level}${card.card_name}</div>
                            <div class="accordion-meta">${type}${id}</div>
                        </div>
                    </div>
                </button>
                <div class="accordion-content">
                    <div class="accordion-inner-grid">
                        <div class="result-item item-stats">
                            <div class="result-label" style="color: var(--text-mid); font-size: 0.85rem; text-transform: uppercase; font-weight: 800;">Card Stats</div>
                            <div class="result-value">${type}${hp}</div>
                        </div>
                        ${skillHtml}
                        <div class="result-item item-arts">
                            <div class="result-label" style="color: var(--brand-pink); font-size: 0.85rem; text-transform: uppercase; font-weight: 800;">Arts Skill</div>
                            <div class="result-value">${card.arts_text || "None"}</div>
                        </div>
                        <button class="btn-delete-item" data-index="${index}">Delete This Scan</button>
                    </div>
                </div>
            </div>
        `;
        container.innerHTML += itemHTML;
    });

    const accButtons = document.querySelectorAll(".accordion-btn");
    accButtons.forEach(btn => {
        btn.addEventListener("click", function() {
            this.classList.toggle("active");
            const content = this.nextElementSibling;
            if (content.style.maxHeight) {
                content.style.maxHeight = null; 
            } else {
                content.style.maxHeight = content.scrollHeight + "px"; 
            }
        });
    });

    const deleteButtons = document.querySelectorAll(".btn-delete-item");
    deleteButtons.forEach(btn => {
        btn.addEventListener("click", function() {
            const index = this.getAttribute("data-index");
            deleteHistoryItem(index);
        });
    });
}

renderHistory();

// ========================================================
// 4. UI UPDATER & STATE MANAGEMENT
// ========================================================
let isProcessing = false;
let currentBase64 = null;

function startCooldown(buttonElement, seconds) {
    let timeLeft = seconds;
    const timer = setInterval(() => {
        if (buttonElement) buttonElement.innerText = `API Busy. Retry in ${timeLeft}s...`;
        timeLeft--;
        if (timeLeft < 0) {
            clearInterval(timer);
            isProcessing = false;
            if (buttonElement) {
                buttonElement.innerText = "Translate Text / Retry Image";
                buttonElement.style.cursor = "pointer";
                buttonElement.style.opacity = "1";
            }
            const skillsOutput = document.getElementById("result-skills");
            if (skillsOutput) skillsOutput.innerText = "Ready to retry.";
        }
    }, 1000);
}

async function handleTranslation(rawText, imageBase64) {
    if (isProcessing) return; 
    
    const nameOutput = document.getElementById("result-name");
    // SAFETY CHECK: If we are not on the Scanner page, politely ignore the command
    if (!nameOutput) return; 
    
    isProcessing = true;
    const btn = document.getElementById("translate-hololive-btn");
    const statsOutput = document.getElementById("result-stats");
    const artsOutput = document.getElementById("result-arts");
    const skillsOutput = document.getElementById("result-skills");
    const skillSection = document.getElementById("proxy-section-skill");
    const skillLabel = document.getElementById("proxy-label-skill");

    try {
        // Safely update UI to loading state
        if (skillSection && skillLabel) {
            skillSection.style.display = "block";
            skillLabel.innerText = "Scanning Effect...";
            skillLabel.style.background = "var(--holo-blue)";
        }

        nameOutput.innerText = "Processing card scan...";
        statsOutput.innerText = "...";
        artsOutput.innerText = "Reading damage values...";
        skillsOutput.innerText = "Translating text...";
        
        if (btn) {
            btn.innerText = "Translating...";
            btn.style.opacity = "0.5";
            btn.style.cursor = "not-allowed";
        }
        
        const translatedData = await translateCard(rawText, imageBase64, hololiveSystemPrompt);

        if (translatedData) {
            nameOutput.innerText = translatedData.card_name || "Unknown Card";
            const type = translatedData.card_type || "Unknown Type";
            const hp = translatedData.hp ? `| HP: ${translatedData.hp}` : "";
            statsOutput.innerText = `${type} ${hp}`;
            artsOutput.innerText = translatedData.arts_text || "No Arts skill found.";
            
            const parsedSkill = parseSkillText(translatedData.skills_text);
            
            if (parsedSkill.isNone) {
                skillSection.style.display = "none";
            } else {
                skillSection.style.display = "block";
                skillLabel.innerText = parsedSkill.labelText;
                skillLabel.style.background = parsedSkill.labelBg;
                skillsOutput.innerText = parsedSkill.skillText;
            }
            
            await saveToHistory(translatedData, imageBase64);

            isProcessing = false;
            if (btn) {
                btn.innerText = "Translate Text / Retry Image";
                btn.style.opacity = "1";
                btn.style.cursor = "pointer";
            }
        } else {
            nameOutput.innerText = "Translation Failed";
            statsOutput.innerText = "-";
            artsOutput.innerText = "-";
            skillsOutput.innerText = "API rate limit or connection issue. Cooldown...";
            if (btn) startCooldown(btn, 10); // Reduced to 10 seconds!
        }
    } catch (err) {
        // FAILSAFE UN-STICK: Guarantees the app never stays frozen on an error
        isProcessing = false;
        nameOutput.innerText = "Error Processing Request";
        skillsOutput.innerText = "An unexpected error occurred.";
        if (btn) {
            btn.innerText = "Translate Text / Retry Image";
            btn.style.opacity = "1";
            btn.style.cursor = "pointer";
        }
    }
}

// ========================================================
// 5. EVENT LISTENERS
// ========================================================
const handleFileInput = async (event) => {
    if (isProcessing) {
        alert("Please wait for the current process or cooldown to finish.");
        return;
    }
    const file = event.target.files[0];
    if (!file) return;
    const previewImg = document.getElementById("image-preview");
    const previewContainer = document.getElementById("image-preview-container");
    if (previewImg && previewContainer) {
        previewImg.src = URL.createObjectURL(file);
        previewContainer.style.display = "block";
    }

    currentBase64 = await fileToBase64(file);
    handleTranslation(null, currentBase64);
};

const uploadInput = document.getElementById("card-upload-input");
if (uploadInput) uploadInput.addEventListener("change", handleFileInput);

const scanInput = document.getElementById("card-scan-input");
if (scanInput) scanInput.addEventListener("change", handleFileInput);

window.addEventListener("paste", async (event) => {
    if (isProcessing) return;
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    for (let item of items) {
        if (item.type.indexOf("image") !== -1) {
            const file = item.getAsFile();
            const previewImg = document.getElementById("image-preview");
            const previewContainer = document.getElementById("image-preview-container");
            if (previewImg && previewContainer) {
                previewImg.src = URL.createObjectURL(file);
                previewContainer.style.display = "block";
            }
            currentBase64 = await fileToBase64(file);
            handleTranslation(null, currentBase64);
            event.preventDefault(); 
            break;
        }
    }
});

const translateBtn = document.getElementById("translate-hololive-btn");
if (translateBtn) {
    translateBtn.addEventListener("click", () => {
        if (isProcessing) return;
        const rawJapaneseText = document.getElementById("card-input-textarea").value;
        const previewContainer = document.getElementById("image-preview-container");
        if (previewContainer && previewContainer.style.display === "block" && currentBase64) {
            handleTranslation(null, currentBase64);
            return;
        }
        if (!rawJapaneseText.trim()) {
            alert("Please paste Japanese card text or scan an image first!");
            return;
        }
        handleTranslation(rawJapaneseText, null);
    });
}

const clearBtn = document.getElementById("clear-history-btn");
if (clearBtn) {
    clearBtn.addEventListener("click", () => {
        if (confirm("Are you sure you want to delete your entire scan history? This cannot be undone.")) {
            localStorage.removeItem('ocgScannerHistory');
            renderHistory();
        }
    });
}