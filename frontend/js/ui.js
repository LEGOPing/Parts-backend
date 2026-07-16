function calculateP() {
    try {
        const testElement = document.createElement('div');
        testElement.style.width = '1in';
        testElement.style.height = '1in';
        testElement.style.position = 'absolute';
        testElement.style.visibility = 'hidden';
        document.body.appendChild(testElement);
        
        const dpi = testElement.offsetWidth;
        document.body.removeChild(testElement);
        
        const p = (8 / 25.4) * dpi;
        return Math.round(p);
    } catch (error) {
        return 30;
    }
}

function switchTab(tabName, btn) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    document.querySelectorAll('.nav button').forEach(button => {
        button.classList.remove('active');
    });
    if (btn) {
        btn.classList.add('active');
    }
    
    if (tabName === 'repositories') {
        loadRepositories();
    } else if (tabName === 'parts') {
        if (selectedBox) {
            loadParts(selectedBox.id);
        }
    } else if (tabName === 'search') {
        clearSearchResults();
    } else if (tabName === 'settings') {
        loadStats();
    }
}

async function loadRepositories() {
    const repos = await getRepositories();
    const list = document.getElementById('repositories-list');
    list.innerHTML = '';
    
    document.getElementById('repository-count').textContent = repos.length;
    
    const boxCounts = {};
    await Promise.all(repos.map(async repo => {
        const boxes = await getBoxes(repo.id);
        boxCounts[repo.id] = boxes.length;
    }));
    
    repos.forEach(repo => {
        const card = document.createElement('div');
        card.className = `repository-card ${selectedRepository && selectedRepository.id === repo.id ? 'selected' : ''}`;
        card.dataset.id = repo.id;
        
        card.innerHTML = `
            <div class="repo-card-header">
                <h3>${repo.name}</h3>
                <button class="repo-delete-btn" onclick="event.stopPropagation(); deleteRepositoryConfirm('${repo.id}')">×</button>
            </div>
            <div class="repo-info">
                <span class="repo-id">ID: ${repo.id}</span>
                <span class="repo-box-count">${boxCounts[repo.id]}B</span>
            </div>
        `;
        
        card.addEventListener('click', () => {
            if (!editingRepository) {
                selectRepository(repo);
            }
        });
        
        setupLongPress(card, () => {
            if (repo.name !== '待定盒子') {
                startEditRepository(card, repo);
            }
        });
        
        list.appendChild(card);
    });
}

async function selectRepository(repo) {
    setSelectedRepository(repo);
    
    document.querySelectorAll('.repository-card').forEach(card => {
        card.classList.remove('selected');
        if (card.dataset.id === repo.id) {
            card.classList.add('selected');
        }
    });
    
    document.getElementById('box-management').style.display = 'block';
    document.getElementById('no-repository-selected').style.display = 'none';
    
    document.getElementById('selected-repository-name').textContent = `${repo.name} - 盒子管理`;
    
    await loadBoxes(repo.id);
}

function startEditRepository(card, repo) {
    setEditingRepository(repo);
    
    card.innerHTML = `
        <input type="text" value="${repo.name}" class="repo-edit-input" />
        <div class="repo-info">
            <span class="repo-id">ID: ${repo.id}</span>
            <span class="repo-box-count">0B</span>
        </div>
    `;
    
    const input = card.querySelector('.repo-edit-input');
    input.focus();
    input.select();
    
    input.addEventListener('blur', () => {
        saveRepositoryName(card, repo.id, input.value);
    });
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveRepositoryName(card, repo.id, input.value);
        }
    });
}

async function saveRepositoryName(card, id, name) {
    if (name.trim() === '') {
        name = '新仓库';
    }
    
    const success = await updateRepository(id, { name: name.trim() });
    setEditingRepository(null);
    
    if (success) {
        await loadRepositories();
        if (selectedRepository && selectedRepository.id === id) {
            selectedRepository.name = name.trim();
            document.getElementById('selected-repository-name').textContent = `${name.trim()} - 盒子管理`;
        }
    } else {
        await loadRepositories();
    }
}

async function addRepository() {
    console.log('addRepository called');
    try {
        const newRepo = await createRepository('新仓库');
        if (newRepo) {
            await loadRepositories();
            setTimeout(() => {
                selectRepository(newRepo);
            }, 100);
        } else {
            alert('添加仓库失败：云函数返回为空，请检查云函数是否正确部署');
        }
    } catch (error) {
        console.error('添加仓库异常:', error);
        alert('添加仓库失败：' + error.message);
    }
}

async function deleteRepositoryConfirm(id) {
    if (confirm('确定要删除这个仓库吗？删除后将同时删除仓库中的所有盒子和零件。')) {
        const success = await deleteRepository(id);
        if (success) {
            if (selectedRepository && selectedRepository.id === id) {
                setSelectedRepository(null);
                document.getElementById('box-management').style.display = 'none';
                document.getElementById('no-repository-selected').style.display = 'flex';
            }
            await loadRepositories();
        }
    }
}

async function loadBoxes(repoId) {
    const boxes = await getBoxes(repoId);
    const grid = document.getElementById('boxes-list');
    grid.innerHTML = '';
    
    document.getElementById('box-count').textContent = boxes.length;
    
    const partCounts = {};
    await Promise.all(boxes.map(async box => {
        const parts = await getParts(box.id);
        partCounts[box.id] = parts.length;
    }));
    
    boxes.forEach(box => {
        const card = document.createElement('div');
        card.className = `box-card ${box.name === '新盒子' ? 'default' : ''}`;
        card.dataset.id = box.id;
        
        card.innerHTML = `
            <div class="box-card-header">
                <h4>${box.name}</h4>
                <button class="box-delete-btn" onclick="event.stopPropagation(); deleteBoxConfirm('${box.id}')">×</button>
            </div>
            <div class="box-info">
                <div class="box-number">ID: ${box.box_number}</div>
                <div class="box-part-count">${partCounts[box.id]}P</div>
            </div>
        `;
        
        card.addEventListener('click', () => {
            if (!editingBox) {
                setSelectedBox(box);
                document.getElementById('selected-box-name').textContent = `${box.name}盒子_零件管理`;
                const btn = document.querySelector('.part-btn');
                switchTab('parts', btn);
            }
        });
        
        setupLongPress(card, () => {
            if (box.name !== '待定零件') {
                startEditBox(card, box);
            }
        });
        
        grid.appendChild(card);
    });
}

function startEditBox(card, box) {
    setEditingBox(box);
    
    card.innerHTML = `
        <input type="text" value="${box.name}" class="box-edit-input" />
        <div class="box-info">
            <div class="box-number">ID: ${box.box_number}</div>
            <div class="box-part-count">0P</div>
        </div>
    `;
    
    const input = card.querySelector('.box-edit-input');
    input.focus();
    input.select();
    
    input.addEventListener('blur', () => {
        saveBoxName(card, box.id, input.value);
    });
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveBoxName(card, box.id, input.value);
        }
    });
}

async function saveBoxName(card, id, name) {
    if (name.trim() === '') {
        name = '新盒子';
    }
    
    const success = await updateBox(id, { name: name.trim() });
    setEditingBox(null);
    
    if (success && selectedRepository) {
        await loadBoxes(selectedRepository.id);
    }
}

async function addBox() {
    if (!selectedRepository) {
        alert('请先选择一个仓库');
        return;
    }
    
    const boxes = await getBoxes(selectedRepository.id);
    const maxBoxNumber = boxes.reduce((max, box) => Math.max(max, box.box_number || 0), 0);
    const newBoxNumber = maxBoxNumber + 1;
    
    const newBox = await createBox(selectedRepository.id, newBoxNumber, '新盒子');
    if (newBox && selectedRepository) {
        await loadBoxes(selectedRepository.id);
    }
}

async function deleteBoxConfirm(id) {
    if (confirm('确定要删除这个盒子吗？')) {
        const success = await deleteBox(id);
        if (success && selectedRepository) {
            await loadBoxes(selectedRepository.id);
        }
    }
}

async function loadParts(boxId) {
    const parts = await getParts(boxId);
    const colors = await fetchAllColors();
    const colorMap = {};
    colors.forEach(c => colorMap[c.id] = c);
    
    const list = document.getElementById('parts-list');
    list.innerHTML = '';
    
    document.getElementById('part-count').textContent = parts.length;
    
    parts.forEach(part => {
        const card = document.createElement('div');
        card.className = 'part-card';
        card.dataset.id = part.id;
        
        const color = colorMap[part.color_id];
        const colorName = color ? color.name : '未知颜色';
        
        card.innerHTML = `
            <div class="part-num">${part.part_num}</div>
            <div class="part-image">
                <img src="https://cdn.rebrickable.com/media/parts/${part.part_num}_${part.color_id}.jpg" alt="${part.name}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=no-image>暂无图片</div>'">
            </div>
            <div class="part-name">${part.name}</div>
            <div class="part-color">${colorName}</div>
            <div class="part-info">
                <span class="part-new-status ${part.is_new ? 'new' : 'used'}">${part.is_new ? '新' : '旧'}</span>
                <span class="part-quantity">${part.quantity}</span>
            </div>
        `;
        
        card.addEventListener('click', () => {
            showPartDetail(part);
        });
        
        setupLongPress(card, () => editPartQuantity(part));
        
        list.appendChild(card);
    });
}

function setupLongPress(element, callback) {
    let longPressTimer;
    
    const start = () => {
        longPressTimer = setTimeout(callback, 800);
    };
    
    const end = () => {
        clearTimeout(longPressTimer);
    };
    
    element.addEventListener('mousedown', start);
    element.addEventListener('mouseup', end);
    element.addEventListener('mouseleave', end);
    element.addEventListener('touchstart', start);
    element.addEventListener('touchend', end);
}

function editPartQuantity(part) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content quantity-edit-modal';

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">编辑数量</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">取消</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="quantity-edit-container">
                <button class="quantity-btn decrease" onclick="changeQuantity(-1)">−</button>
                <div class="quantity-display" id="quantity-display">${part.quantity}</div>
                <button class="quantity-btn increase" onclick="changeQuantity(1)">+</button>
            </div>
            <div class="quantity-edit-footer">
                <button class="btn-save" onclick="savePartQuantity('${part.id}')">保存</button>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    window.currentEditQuantity = part.quantity;

    function changeQuantity(delta) {
        window.currentEditQuantity = Math.max(0, window.currentEditQuantity + delta);
        document.getElementById('quantity-display').textContent = window.currentEditQuantity;
    }

    window.changeQuantity = changeQuantity;
}

function savePartQuantity(partId) {
    const quantity = window.currentEditQuantity;
    if (quantity >= 0) {
        updatePartQuantity(partId, quantity);
        document.querySelector('.modal-overlay.active').remove();
    }
}

async function updatePartQuantity(partId, quantity) {
    const success = await updatePart(partId, { quantity: quantity });
    if (success && selectedBox) {
        await loadParts(selectedBox.id);
    }
}

function showAddPartSheet() {
    if (!selectedBox) {
        alert('请先选择一个盒子');
        return;
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    
    const sheet = document.createElement('div');
    sheet.className = 'modal-content';
    
    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">添加零件</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">取消</button>
                <button class="btn-save" onclick="saveNewPart(this)">保存</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="form-section">
                <div class="form-row">
                    <label class="form-label">零件型号：</label>
                    <input type="text" id="new-part-num" class="form-input" placeholder="请输入零件型号" />
                    <button class="btn-secondary" onclick="showPartSelector()" style="padding: 8px 10px; font-size: 12px;">选择零件</button>
                    <div class="status-group">
                        <span class="status-label">状态：</span>
                        <button id="status-new" class="status-btn active" onclick="togglePartNewStatus(true)">新品</button>
                        <button id="status-used" class="status-btn" onclick="togglePartNewStatus(false)">旧品</button>
                    </div>
                </div>
            </div>
            <div class="form-section">
                <div class="form-row">
                    <label class="form-label">零件名称：</label>
                    <input type="text" id="new-part-name" class="form-input" placeholder="请输入零件名称" />
                </div>
                <div class="form-row">
                    <label class="form-label">零件颜色：</label>
                    <input type="text" id="new-part-color" class="form-input" placeholder="请输入颜色ID" />
                    <button class="btn-secondary" onclick="showColorPicker()" style="padding: 8px 10px; font-size: 12px;">选择颜色</button>
                </div>
            </div>
            <div class="form-section">
                <div class="quantity-weight-row">
                    <div>
                        <label class="form-label">零件数量：</label>
                        <input type="number" id="new-part-quantity" class="form-input" placeholder="请输入数量" value="1" />
                    </div>
                </div>
            </div>
            <div id="add-part-error" style="color: red; font-size: 12px; display: none; padding: 10px; background: rgba(255, 0, 0, 0.1); border-radius: 4px;"></div>
        </div>
    `;
    
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    
    window.newPartIsNew = true;
}

function togglePartNewStatus(isNew) {
    window.newPartIsNew = isNew;
    document.getElementById('status-new').classList.toggle('active', isNew);
    document.getElementById('status-used').classList.toggle('active', !isNew);
}

async function saveNewPart(button) {
    const partNum = document.getElementById('new-part-num').value;
    const partName = document.getElementById('new-part-name').value;
    const colorInput = document.getElementById('new-part-color').value;
    const quantity = parseInt(document.getElementById('new-part-quantity').value);
    
    if (!partNum) {
        document.getElementById('add-part-error').textContent = '请输入零件型号';
        document.getElementById('add-part-error').style.display = 'block';
        return;
    }
    
    if (!colorInput) {
        document.getElementById('add-part-error').textContent = '请输入颜色ID';
        document.getElementById('add-part-error').style.display = 'block';
        return;
    }
    
    if (isNaN(quantity) || quantity <= 0) {
        document.getElementById('add-part-error').textContent = '请输入有效的数量';
        document.getElementById('add-part-error').style.display = 'block';
        return;
    }
    
    const newPart = await createPart({
        box_id: selectedBox.id,
        part_num: partNum,
        name: partName || partNum,
        color_id: parseInt(colorInput),
        quantity: quantity,
        is_new: window.newPartIsNew
    });
    
    if (newPart) {
        button.closest('.modal-overlay').remove();
        if (selectedBox) {
            await loadParts(selectedBox.id);
        }
    }
}

function showPartSelector() {
    if (!selectedBox) {
        alert('请先选择一个盒子');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content part-selector-modal';

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">选择零件</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="part-search-bar">
                <input type="text" id="part-search-input" placeholder="搜索零件型号或名称..." />
            </div>
            <div class="part-suggestions" id="part-suggestions"></div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    document.getElementById('part-search-input').addEventListener('input', function(e) {
        handlePartSearch(e.target.value);
    });

    document.getElementById('part-search-input').focus();
    handlePartSearch('');
}

async function handlePartSearch(query) {
    const suggestions = await getPartSuggestions(query);
    const container = document.getElementById('part-suggestions');
    container.innerHTML = '';

    if (suggestions.length === 0) {
        container.innerHTML = '<div class="no-suggestions">未找到匹配的零件</div>';
        return;
    }

    suggestions.forEach(part => {
        const item = document.createElement('div');
        item.className = 'part-suggestion-item';

        item.innerHTML = `
            <div class="part-suggestion-num">${part.part_num}</div>
            <div class="part-suggestion-name">${part.name}</div>
        `;

        item.addEventListener('click', () => {
            document.getElementById('new-part-num').value = part.part_num;
            document.getElementById('new-part-name').value = part.name;
            document.querySelector('.modal-overlay.active').remove();
        });

        container.appendChild(item);
    });
}

function showColorPicker() {
    if (!selectedBox) {
        alert('请先选择一个盒子');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content color-picker-modal';

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">选择颜色</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="color-search-bar">
                <input type="text" id="color-search-input" placeholder="搜索颜色名称..." />
            </div>
            <div class="color-grid" id="color-grid"></div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    loadColorGrid();

    document.getElementById('color-search-input').addEventListener('input', function(e) {
        filterColors(e.target.value);
    });
}

async function loadColorGrid() {
    const colors = await fetchAllColors();
    const grid = document.getElementById('color-grid');
    grid.innerHTML = '';

    colors.forEach(color => {
        const colorCard = document.createElement('div');
        colorCard.className = 'color-card';
        colorCard.dataset.id = color.id;
        colorCard.style.borderColor = color.rgb;

        colorCard.innerHTML = `
            <div class="color-preview" style="background-color: ${color.rgb}; border: 1px solid ${color.rgb === '#ffffff' ? '#ccc' : color.rgb}">
                <div class="color-check" style="display: none;">✓</div>
            </div>
            <div class="color-name">${color.name}</div>
            <div class="color-id">ID: ${color.id}</div>
        `;

        colorCard.addEventListener('click', () => {
            document.getElementById('new-part-color').value = color.id;
            document.querySelector('.modal-overlay.active').remove();
        });

        grid.appendChild(colorCard);
    });
}

function filterColors(searchText) {
    const cards = document.querySelectorAll('.color-card');
    cards.forEach(card => {
        const name = card.querySelector('.color-name').textContent.toLowerCase();
        const id = card.querySelector('.color-id').textContent;
        const match = name.includes(searchText.toLowerCase()) || id.includes(searchText);
        card.style.display = match ? 'block' : 'none';
    });
}



async function handleAdvancedSearch() {
    const params = {
        partNum: document.getElementById('search-part-num').value,
        partName: document.getElementById('search-part-name').value,
        colorId: document.getElementById('search-color-id').value,
        isNew: document.getElementById('search-status').value === '' ? undefined : 
               document.getElementById('search-status').value === 'true'
    };
    
    const parts = await advancedSearchParts(params);
    renderSearchResults(parts);
}

function resetSearchFilters() {
    document.getElementById('search-part-num').value = '';
    document.getElementById('search-part-name').value = '';
    document.getElementById('search-color-id').value = '';
    document.getElementById('search-status').value = '';
    document.getElementById('search-results').innerHTML = '';
}

function renderSearchResults(parts) {
    const results = document.getElementById('search-results');
    results.innerHTML = '';
    
    if (parts.length === 0) {
        results.innerHTML = '<div class="no-search-results"><p>没有找到匹配的零件</p></div>';
        return;
    }
    
    parts.forEach(part => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        
        getColorName(part.color_id).then(colorName => {
            item.innerHTML = `
                <div class="search-result-num">${part.part_num}</div>
                <div class="search-result-info">
                    <div class="search-result-name">${part.name}</div>
                    <div class="search-result-meta">
                        <span class="search-result-color">${colorName || '未知颜色'}</span>
                        <span class="search-result-status ${part.is_new ? 'new' : 'used'}">${part.is_new ? '新' : '旧'}</span>
                    </div>
                </div>
                <div class="search-result-quantity">${part.quantity}</div>
            `;
        });
        
        item.addEventListener('click', () => {
            showPartDetail(part);
        });
        
        results.appendChild(item);
    });
}

function clearSearchResults() {
    document.getElementById('search-part-num').value = '';
    document.getElementById('search-part-name').value = '';
    document.getElementById('search-color-id').value = '';
    document.getElementById('search-status').value = '';
    document.getElementById('search-results').innerHTML = '';
}

async function showPartDetail(part) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content part-detail-modal';

    const colorInfo = await getColorInfo(part.color_id);
    const colorName = colorInfo ? colorInfo.name : '未知颜色';
    const colorRgb = colorInfo ? colorInfo.rgb : '#ccc';

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">零件详情</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="part-detail-container">
                <div class="part-detail-image">
                    <img src="https://cdn.rebrickable.com/media/parts/${part.part_num}_${part.color_id}.jpg" alt="${part.name}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=no-image>暂无图片</div>'">
                </div>
                <div class="part-detail-info">
                    <div class="part-detail-row">
                        <span class="part-detail-label">型号</span>
                        <span class="part-detail-value">${part.part_num}</span>
                    </div>
                    <div class="part-detail-row">
                        <span class="part-detail-label">名称</span>
                        <span class="part-detail-value">${part.name}</span>
                    </div>
                    <div class="part-detail-row">
                        <span class="part-detail-label">颜色</span>
                        <span class="part-detail-value">
                            <span class="color-preview-small" style="background-color: ${colorRgb};"></span>
                            ${colorName} (ID: ${part.color_id})
                        </span>
                    </div>
                    <div class="part-detail-row">
                        <span class="part-detail-label">状态</span>
                        <span class="part-detail-value">
                            <span class="status-badge ${part.is_new ? 'new' : 'used'}">${part.is_new ? '新品' : '旧品'}</span>
                        </span>
                    </div>
                    <div class="part-detail-row">
                        <span class="part-detail-label">数量</span>
                        <span class="part-detail-value quantity-large">${part.quantity}</span>
                    </div>
                </div>
            </div>
            <div class="part-detail-actions">
                <button class="btn-edit-quantity" onclick="editPartQuantityFromDetail('${part.id}', ${part.quantity})">编辑数量</button>
                <button class="btn-delete-part" onclick="deletePartConfirm('${part.id}')">删除零件</button>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
}

function editPartQuantityFromDetail(partId, currentQuantity) {
    document.querySelector('.modal-overlay.active').remove();
    const part = { id: partId, quantity: currentQuantity };
    editPartQuantity(part);
}

function goBackToRepositories() {
    setSelectedBox(null);
    const btn = document.querySelector('.repo-btn');
    switchTab('repositories', btn);
}

function showCSVImporter() {
    if (!selectedBox) {
        alert('请先选择一个盒子');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const sheet = document.createElement('div');
    sheet.className = 'modal-content csv-importer-modal';

    sheet.innerHTML = `
        <div class="modal-header">
            <span class="modal-title">批量导入零件</span>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        </div>
        <div class="modal-body">
            <div class="csv-importer-container">
                <div class="csv-upload-area" id="csv-upload-area">
                    <input type="file" id="csv-file-input" accept=".csv" style="display: none;">
                    <div class="csv-upload-icon">📁</div>
                    <div class="csv-upload-text">点击或拖拽CSV文件到此处</div>
                    <div class="csv-format-hint">支持格式: part_num,name,color_id,quantity,is_new</div>
                </div>
                <div class="csv-preview" id="csv-preview" style="display: none;">
                    <h4>预览数据</h4>
                    <div class="csv-preview-table" id="csv-preview-table"></div>
                    <button class="btn-import-csv" onclick="confirmCSVImport()">确认导入</button>
                </div>
                <div class="import-status" id="import-status" style="display: none;"></div>
            </div>
        </div>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const uploadArea = document.getElementById('csv-upload-area');
    const fileInput = document.getElementById('csv-file-input');

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', (e) => e.preventDefault());
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.csv')) {
            processCSVFile(file);
        }
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            processCSVFile(file);
        }
    });
}

function parseCSVContent(content) {
    const lines = content.split('\n');
    const rows = [];

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        const row = parseCSVLine(line);
        rows.push(row);
    }

    return rows;
}

function parseCSVLine(line) {
    const result = [];
    let currentField = '';
    let inQuotes = false;

    for (const char of line) {
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(currentField.trim());
            currentField = '';
        } else {
            currentField += char;
        }
    }

    result.push(currentField.trim());
    return result;
}

async function processCSVFile(file) {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
        const content = e.target.result;
        const rows = parseCSVContent(content);
        
        if (rows.length < 2) {
            alert('CSV文件内容为空或格式不正确');
            return;
        }

        const headers = rows[0];
        const data = rows.slice(1);
        
        const importData = data.map(row => {
            const item = {};
            headers.forEach((header, index) => {
                item[header.trim().toLowerCase()] = row[index] || '';
            });
            return item;
        });

        showCSVPreview(headers, importData);
    };

    reader.readAsText(file);
}

function showCSVPreview(headers, data) {
    const preview = document.getElementById('csv-preview');
    const uploadArea = document.getElementById('csv-upload-area');
    const table = document.getElementById('csv-preview-table');

    uploadArea.style.display = 'none';
    preview.style.display = 'block';

    let html = '<table><thead><tr>';
    headers.forEach(h => {
        html += `<th>${h}</th>`;
    });
    html += '</tr></thead><tbody>';

    data.forEach(row => {
        html += '<tr>';
        headers.forEach(h => {
            html += `<td>${row[h.trim().toLowerCase()] || ''}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    table.innerHTML = html;

    window.currentCSVData = data;
}

async function confirmCSVImport() {
    if (!selectedBox || !window.currentCSVData) return;

    const data = window.currentCSVData.map(item => ({
        ...item,
        box_id: selectedBox.id
    }));

    const status = document.getElementById('import-status');
    const preview = document.getElementById('csv-preview');
    
    preview.style.display = 'none';
    status.style.display = 'block';
    status.innerHTML = '<div class="import-loading">正在导入...</div>';

    const result = await batchCreateParts(data);

    if (result.success) {
        status.innerHTML = `
            <div class="import-success">
                <div class="success-icon">✓</div>
                <div>导入成功！</div>
                <div>成功导入 ${result.count} 个零件</div>
                <button class="btn-close-import" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        `;
        if (selectedBox) {
            loadParts(selectedBox.id);
        }
    } else {
        let errorHtml = `
            <div class="import-error">
                <div class="error-icon">✗</div>
                <div>导入完成，但有部分失败</div>
                <div>成功导入 ${result.count} 个零件</div>
                <div class="error-list">
        `;
        result.errors.forEach(e => {
            errorHtml += `<div>${e.part_num}: ${e.error}</div>`;
        });
        errorHtml += `
                </div>
                <button class="btn-close-import" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            </div>
        `;
        status.innerHTML = errorHtml;
        if (selectedBox) {
            loadParts(selectedBox.id);
        }
    }
}

async function initializeApp() {
    try {
        const P = calculateP();
        document.documentElement.style.setProperty('--P', P);
        document.documentElement.style.setProperty('--card-width', (3 * P) + 'px');
        document.documentElement.style.setProperty('--card-height', (2 * P) + 'px');
        document.documentElement.style.setProperty('--grid-width', (9 * P + 30) + 'px');
        
        const repoBtn = document.querySelector('.nav button.repo-btn');
        switchTab('repositories', repoBtn);
        
        await loadRepositories();
    } catch (error) {
        console.error('应用初始化失败:', error);
        const list = document.getElementById('repositories-list');
        if (list) {
            list.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">无法连接到数据库，请检查网络连接或稍后重试</div>';
        }
    }
}

async function initializeDatabase() {
    if (!confirm('确定要初始化数据库吗？这将删除所有现有数据！')) {
        return;
    }
    
    try {
        const repos = await getRepositories();
        for (const repo of repos) {
            await deleteRepository(repo.id);
        }
        
        await createRepository('待定盒子');
        
        alert('数据库初始化成功！已创建默认仓库"待定盒子"');
        loadRepositories();
    } catch (error) {
        console.error('初始化数据库失败:', error);
        alert('初始化数据库失败: ' + error.message);
    }
}

async function backupData() {
    try {
        const repos = await getRepositories();
        let allBoxes = [];
        let allParts = [];
        
        for (const repo of repos) {
            const boxes = await getBoxes(repo.id);
            allBoxes = allBoxes.concat(boxes.map(b => ({ ...b, repository_id: repo.id })));
            
            for (const box of boxes) {
                const parts = await getParts(box.id);
                allParts = allParts.concat(parts.map(p => ({ ...p, box_id: box.id })));
            }
        }
        
        const backup = {
            timestamp: new Date().toISOString(),
            repositories: repos,
            boxes: allBoxes,
            parts: allParts
        };
        
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `parts_backup_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        alert('数据备份成功！');
    } catch (error) {
        console.error('数据备份失败:', error);
        alert('数据备份失败: ' + error.message);
    }
}

async function restoreData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!confirm('确定要恢复数据吗？这将覆盖当前所有数据！')) {
            return;
        }
        
        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const backup = JSON.parse(e.target.result);
                
                const existingRepos = await getRepositories();
                for (const repo of existingRepos) {
                    await deleteRepository(repo.id);
                }
                
                const repoMap = {};
                for (const repo of backup.repositories) {
                    const newRepo = await createRepository(repo.name);
                    if (newRepo) {
                        repoMap[repo.id] = newRepo.id;
                    }
                }
                
                const boxMap = {};
                for (const box of backup.boxes) {
                    const newBox = await createBox(
                        repoMap[box.repository_id] || Object.values(repoMap)[0],
                        box.box_number || 1,
                        box.name
                    );
                    if (newBox) {
                        boxMap[box.id] = newBox.id;
                    }
                }
                
                for (const part of backup.parts) {
                    await createPart({
                        box_id: boxMap[part.box_id] || Object.values(boxMap)[0],
                        part_num: part.part_num,
                        name: part.name,
                        color_id: part.color_id || 1,
                        is_new: part.is_new !== undefined ? part.is_new : true,
                        quantity: part.quantity || 1
                    });
                }
                
                alert('数据恢复成功！');
                loadRepositories();
            };
            
            reader.readAsText(file);
        } catch (error) {
            console.error('数据恢复失败:', error);
            alert('数据恢复失败: ' + error.message);
        }
    };
    
    input.click();
}

function clearCache() {
    if (!confirm('确定要清除本地缓存吗？')) {
        return;
    }
    
    localStorage.clear();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(reg => {
                reg.unregister();
            });
        });
    }
    
    alert('本地缓存已清除');
}

function reloadApp() {
    if (confirm('确定要重启应用吗？')) {
        location.reload();
    }
}

async function loadStats() {
    try {
        const repos = await getRepositories();
        document.getElementById('stat-repos').textContent = repos.length;
        
        let totalBoxes = 0;
        let totalParts = 0;
        let totalQuantity = 0;
        
        for (const repo of repos) {
            const boxes = await getBoxes(repo.id);
            totalBoxes += boxes.length;
            
            for (const box of boxes) {
                const parts = await getParts(box.id);
                totalParts += parts.length;
                totalQuantity += parts.reduce((sum, p) => sum + (p.quantity || 0), 0);
            }
        }
        
        document.getElementById('stat-boxes').textContent = totalBoxes;
        document.getElementById('stat-parts').textContent = totalParts;
        document.getElementById('stat-total-qty').textContent = totalQuantity;
    } catch (error) {
        console.error('加载统计信息失败:', error);
    }
}